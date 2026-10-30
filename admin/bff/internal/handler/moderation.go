package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"openelf-admin-bff/internal/middleware"
	"openelf-admin-bff/internal/model"
)

// moderationStates 举报单状态白名单（all 表示不过滤）。
var moderationStates = map[string]bool{
	"open": true, "resolved": true, "dismissed": true, "all": true,
}

// moderationTargetTypes 举报目标类型白名单，与 compliance_reports.target_type 一致。
var moderationTargetTypes = map[string]bool{
	"post": true, "comment": true, "elf": true, "user": true, "chat": true,
}

// ListModerationReports GET /api/v1/moderation/reports?state=&target_type=&environment=&page=&page_size=
// state 默认 open；created_at 为 VARCHAR ISO 字符串，按字符串倒序即可。
func (d Deps) ListModerationReports(c *gin.Context) {
	page, pageSize, offset := pageParams(c, 20, 100)

	state := strings.TrimSpace(c.DefaultQuery("state", "open"))
	if state == "" {
		state = "open"
	}
	if !moderationStates[state] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "INVALID_STATE", "message": "state 只允许 open / resolved / dismissed / all"})
		return
	}

	targetType := strings.TrimSpace(c.Query("target_type"))
	if targetType != "" && !moderationTargetTypes[targetType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "INVALID_TARGET_TYPE", "message": "target_type 只允许 post / comment / elf / user / chat"})
		return
	}

	environment := strings.TrimSpace(c.Query("environment"))
	if environment != "" && !model.ValidEnv(environment) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_environment", "message": "环境参数只允许 Production 或 Sandbox"})
		return
	}

	where := []string{"1=1"}
	args := make([]any, 0)
	if state != "all" {
		where = append(where, "state = ?")
		args = append(args, state)
	}
	if targetType != "" {
		where = append(where, "target_type = ?")
		args = append(args, targetType)
	}
	if environment != "" {
		where = append(where, "environment = ?")
		args = append(args, environment)
	}
	cond := strings.Join(where, " AND ")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var total int64
	if err := d.DB.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM compliance_reports WHERE "+cond, args...).Scan(&total); err != nil {
		d.internalError(c, "count moderation reports failed", err)
		return
	}

	args2 := append(append([]any{}, args...), pageSize, offset)
	rows, err := d.DB.QueryContext(ctx,
		`SELECT id, user_id, target_type, target_id, reason, detail, state, environment,
			created_at, resolved_at, resolved_by, resolution, note
		 FROM compliance_reports WHERE `+cond+`
		 ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`, args2...)
	if err != nil {
		d.internalError(c, "list moderation reports failed", err)
		return
	}
	defer rows.Close()

	items := make([]gin.H, 0)
	for rows.Next() {
		var id, userID, targetTypeValue, targetID, reason, detail, stateValue, environmentValue, createdAt string
		var resolvedAt, resolvedBy, resolution, note sql.NullString
		if err := rows.Scan(&id, &userID, &targetTypeValue, &targetID, &reason, &detail, &stateValue,
			&environmentValue, &createdAt, &resolvedAt, &resolvedBy, &resolution, &note); err != nil {
			d.internalError(c, "scan moderation reports failed", err)
			return
		}
		items = append(items, gin.H{
			"id": id, "user_id": userID, "target_type": targetTypeValue, "target_id": targetID,
			"reason": reason, "detail": detail, "state": stateValue, "environment": environmentValue,
			"created_at":  createdAt,
			"resolved_at": platformNullableString(resolvedAt),
			"resolved_by": platformNullableString(resolvedBy),
			"resolution":  platformNullableString(resolution),
			"note":        platformNullableString(note),
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

type resolveModerationReportRequest struct {
	Action string `json:"action"`
	Note   string `json:"note"`
}

// ResolveModerationReport POST /api/v1/moderation/reports/:id/resolve
// action=dismiss 仅关闭举报；action=remove_content 在同一事务内软删内容并关闭举报。
// elf/user/chat 不支持在举报页下架，返回 409。
func (d Deps) ResolveModerationReport(c *gin.Context) {
	var req resolveModerationReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "请求体不是合法 JSON"})
		return
	}
	action := strings.TrimSpace(req.Action)
	note := strings.TrimSpace(req.Note)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		d.internalError(c, "begin moderation resolve tx failed", err)
		return
	}
	defer func() { _ = tx.Rollback() }()

	var id, targetType, targetID, environment string
	err = tx.QueryRowContext(ctx,
		`SELECT id, target_type, target_id, environment
		 FROM compliance_reports WHERE id = ? FOR UPDATE`, c.Param("id")).
		Scan(&id, &targetType, &targetID, &environment)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "REPORT_NOT_FOUND", "message": "举报不存在"})
		return
	}
	if err != nil {
		d.internalError(c, "read moderation report failed", err)
		return
	}

	if action != "dismiss" && action != "remove_content" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "INVALID_ACTION", "message": "action 只允许 dismiss 或 remove_content"})
		return
	}
	if utf8.RuneCountInString(note) > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "INVALID_NOTE", "message": "note 不能超过 500 个字符"})
		return
	}

	now := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	resolvedBy := c.GetString(middleware.CtxActorName)
	if resolvedBy == "" {
		resolvedBy = c.GetString(middleware.CtxActorID)
	}
	var noteValue any
	if note != "" {
		noteValue = note
	}

	if action == "dismiss" {
		if _, err := tx.ExecContext(ctx,
			`UPDATE compliance_reports SET state = 'dismissed', resolution = 'dismiss',
			 resolved_at = ?, resolved_by = ?, note = ? WHERE id = ?`,
			now, resolvedBy, noteValue, id); err != nil {
			d.internalError(c, "dismiss moderation report failed", err)
			return
		}
	} else {
		var kind, nextState string
		switch targetType {
		case "post":
			kind, nextState = "post", "deleted"
		case "comment":
			kind, nextState = "comment", "removed"
		case "elf", "user", "chat":
			c.JSON(http.StatusConflict, gin.H{
				"error":   "CONTENT_TYPE_UNSUPPORTED",
				"message": "该类型内容不支持在举报页下架，请前往对应页面处理",
			})
			return
		default:
			c.JSON(http.StatusConflict, gin.H{
				"error":   "CONTENT_TYPE_UNSUPPORTED",
				"message": "该类型内容不支持在举报页下架，请前往对应页面处理",
			})
			return
		}

		if _, err := tx.ExecContext(ctx,
			`UPDATE payment_objects SET state = ?, updated_at = ?
			 WHERE kind = ? AND object_id = ? AND environment = ?`,
			nextState, now, kind, targetID, environment); err != nil {
			d.internalError(c, "remove moderated content failed", err)
			return
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE compliance_reports SET state = 'resolved', resolution = 'removed',
			 resolved_at = ?, resolved_by = ?, note = ? WHERE id = ?`,
			now, resolvedBy, noteValue, id); err != nil {
			d.internalError(c, "resolve moderation report failed", err)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		d.internalError(c, "commit moderation resolve tx failed", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// mediaPostPayload 是 payment_objects(kind=post) 里 UGC 视频帖的字段子集。
type mediaPostPayload struct {
	ID         string `json:"id"`
	ElfID      string `json:"elfId"`
	Body       string `json:"body"`
	VideoURL   string `json:"videoUrl"`
	CoverURL   string `json:"coverUrl"`
	CreatedAt  string `json:"createdAt"`
	UploadedBy string `json:"uploadedBy"`
}

type mediaElfPayload struct {
	Name string `json:"name"`
}

// ListModerationPendingMedia GET /api/v1/moderation/pending-media?environment=&page=&page_size=
// 人类上传的 UGC 视频先以 state=pending_review 入库，通过审核后才进入信息流。
func (d Deps) ListModerationPendingMedia(c *gin.Context) {
	page, pageSize, offset := pageParams(c, 20, 100)

	environment := strings.TrimSpace(c.Query("environment"))
	if environment != "" && !model.ValidEnv(environment) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_environment", "message": "环境参数只允许 Production 或 Sandbox"})
		return
	}

	where := []string{"kind = 'post'", "state = 'pending_review'"}
	args := make([]any, 0)
	if environment != "" {
		where = append(where, "environment = ?")
		args = append(args, environment)
	}
	cond := strings.Join(where, " AND ")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var total int64
	if err := d.DB.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM payment_objects WHERE "+cond, args...).Scan(&total); err != nil {
		d.internalError(c, "count pending media failed", err)
		return
	}

	args2 := append(append([]any{}, args...), pageSize, offset)
	rows, err := d.DB.QueryContext(ctx,
		`SELECT environment, object_id, ref_id, payload, updated_at
		 FROM payment_objects WHERE `+cond+`
		 ORDER BY updated_at DESC, object_id ASC LIMIT ? OFFSET ?`, args2...)
	if err != nil {
		d.internalError(c, "list pending media failed", err)
		return
	}
	defer rows.Close()

	type mediaRow struct {
		environment string
		objectID    string
		refID       sql.NullString
		payload     mediaPostPayload
		updatedAt   string
	}
	rowsData := make([]mediaRow, 0)
	elfIDsByEnv := map[string]map[string]bool{}
	for rows.Next() {
		var environmentValue, objectID, payloadText, updatedAt string
		var refID sql.NullString
		if err := rows.Scan(&environmentValue, &objectID, &refID, &payloadText, &updatedAt); err != nil {
			d.internalError(c, "scan pending media failed", err)
			return
		}
		var payload mediaPostPayload
		// 单条 payload 损坏不阻塞整个队列，仍把原始记录展示出来供人工判断。
		_ = json.Unmarshal([]byte(payloadText), &payload)
		if payload.ElfID == "" && refID.Valid {
			payload.ElfID = refID.String
		}
		rowsData = append(rowsData, mediaRow{
			environment: environmentValue, objectID: objectID, refID: refID,
			payload: payload, updatedAt: updatedAt,
		})
		if payload.ElfID != "" {
			if elfIDsByEnv[environmentValue] == nil {
				elfIDsByEnv[environmentValue] = map[string]bool{}
			}
			elfIDsByEnv[environmentValue][payload.ElfID] = true
		}
	}

	// 批量取 AI 名称，避免逐条回查。
	elfNames := map[string]string{}
	for env, idSet := range elfIDsByEnv {
		placeholders := make([]string, 0, len(idSet))
		elfArgs := make([]any, 0, len(idSet)+1)
		elfArgs = append(elfArgs, env)
		for id := range idSet {
			placeholders = append(placeholders, "?")
			elfArgs = append(elfArgs, id)
		}
		nameRows, err := d.DB.QueryContext(ctx,
			"SELECT object_id, payload FROM payment_objects WHERE environment = ? AND kind = 'elf' AND object_id IN ("+
				strings.Join(placeholders, ",")+")", elfArgs...)
		if err != nil {
			d.internalError(c, "load pending media elf names failed", err)
			return
		}
		for nameRows.Next() {
			var objectID, payloadText string
			if err := nameRows.Scan(&objectID, &payloadText); err != nil {
				nameRows.Close()
				d.internalError(c, "scan pending media elf name failed", err)
				return
			}
			var elfPayload mediaElfPayload
			_ = json.Unmarshal([]byte(payloadText), &elfPayload)
			elfNames[env+"|"+objectID] = elfPayload.Name
		}
		nameRows.Close()
	}

	items := make([]gin.H, 0, len(rowsData))
	for _, row := range rowsData {
		items = append(items, gin.H{
			"id":          row.objectID,
			"environment": row.environment,
			"elf_id":      row.payload.ElfID,
			"elf_name":    elfNames[row.environment+"|"+row.payload.ElfID],
			"body":        row.payload.Body,
			"video_url":   row.payload.VideoURL,
			"cover_url":   row.payload.CoverURL,
			"uploaded_by": row.payload.UploadedBy,
			"created_at":  row.payload.CreatedAt,
			"submitted_at": row.updatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

type reviewPendingMediaRequest struct {
	Environment string `json:"environment"`
	Action      string `json:"action"`
	Note        string `json:"note"`
}

// ReviewPendingMedia POST /api/v1/moderation/pending-media/:id/review
// action=approve 通过（state 置空进入信息流）；action=reject 驳回（state=rejected）。
func (d Deps) ReviewPendingMedia(c *gin.Context) {
	var req reviewPendingMediaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "请求体不是合法 JSON"})
		return
	}
	environment := strings.TrimSpace(req.Environment)
	if environment == "" || !model.ValidEnv(environment) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_environment", "message": "environment 只允许 Production 或 Sandbox"})
		return
	}
	action := strings.TrimSpace(req.Action)
	if action != "approve" && action != "reject" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "INVALID_ACTION", "message": "action 只允许 approve 或 reject"})
		return
	}
	note := strings.TrimSpace(req.Note)
	if utf8.RuneCountInString(note) > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "INVALID_NOTE", "message": "note 不能超过 500 个字符"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		d.internalError(c, "begin pending media review tx failed", err)
		return
	}
	defer func() { _ = tx.Rollback() }()

	mediaID := c.Param("id")
	var state string
	err = tx.QueryRowContext(ctx,
		`SELECT state FROM payment_objects
		 WHERE environment = ? AND kind = 'post' AND object_id = ? FOR UPDATE`,
		environment, mediaID).Scan(&state)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "MEDIA_NOT_FOUND", "message": "待审核视频不存在"})
		return
	}
	if err != nil {
		d.internalError(c, "read pending media failed", err)
		return
	}
	if state != "pending_review" {
		c.JSON(http.StatusConflict, gin.H{"error": "ALREADY_REVIEWED", "message": "该视频已审核过，请刷新列表"})
		return
	}

	nextState := ""
	if action == "reject" {
		nextState = "rejected"
	}
	now := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	if _, err := tx.ExecContext(ctx,
		`UPDATE payment_objects SET state = ?, updated_at = ?
		 WHERE environment = ? AND kind = 'post' AND object_id = ?`,
		nextState, now, environment, mediaID); err != nil {
		d.internalError(c, "review pending media failed", err)
		return
	}

	if err := tx.Commit(); err != nil {
		d.internalError(c, "commit pending media review tx failed", err)
		return
	}

	reviewer := c.GetString(middleware.CtxActorName)
	if reviewer == "" {
		reviewer = c.GetString(middleware.CtxActorID)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "state": nextState, "reviewer": reviewer, "note": note})
}
