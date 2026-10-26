package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"openelf-admin-bff/internal/model"
)

// 官方 AI 建档：沿用 payment_objects（kind='elf'），payload 增加 isOfficial / series / officialNote。
// 本期不接 App 读取，只在后台侧完成上传、建档、一级挂单的运营链路。

var officialObjectIDRE = regexp.MustCompile(`^[A-Za-z0-9_-]{3,64}$`)

var officialSeriesFormats = map[string]bool{
	"audio": true, "video": true, "text": true, "image": true,
}

type officialSeries struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Format   string `json:"format"`
	CoverURL string `json:"coverUrl"`
	Cadence  string `json:"cadence"`
	Desc     string `json:"desc"`
}

type officialListing struct {
	Enabled  bool   `json:"enabled"`
	Price    int64  `json:"price"`
	Title    string `json:"title"`
	Subtitle string `json:"subtitle"`
	Note     string `json:"note"`
}

// officialFields 建档与更新的公共字段。
type officialFields struct {
	Name          string           `json:"name"`
	Nickname      string           `json:"nickname"`
	Initial       string           `json:"initial"`
	Tagline       string           `json:"tagline"`
	Intro         string           `json:"intro"`
	Persona       string           `json:"persona"`
	Fear          string           `json:"fear"`
	Habit         string           `json:"habit"`
	Generation    int              `json:"generation"`
	Edition       string           `json:"edition"`
	BaseCapacity  int              `json:"baseCapacity"`
	LearnedSkills []string         `json:"learnedSkills"`
	AvatarURL     string           `json:"avatarUrl"`
	PortraitURL   string           `json:"portraitUrl"`
	Series        []officialSeries `json:"series"`
	OfficialNote  string           `json:"officialNote"`
}

type officialCreateRequest struct {
	Environment string           `json:"environment" binding:"required"`
	ObjectID    string           `json:"object_id"`
	officialFields
	Listing officialListing `json:"listing"`
}

// ListOfficialElves GET /api/v1/elves/official?env=
// 返回官方 AI 完整 payload 与对应的开放挂单。
func (d Deps) ListOfficialElves(c *gin.Context) {
	env, ok := envParam(c)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	rows, err := d.DB.QueryContext(ctx,
		`SELECT object_id, owner_id, state, updated_at, payload
		 FROM payment_objects
		 WHERE environment = ? AND kind = 'elf'
		   AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.isOfficial')) = 'true'
		 ORDER BY updated_at DESC, object_id ASC LIMIT 200`, env)
	if err != nil {
		d.internalError(c, "list official elves failed", err)
		return
	}
	defer rows.Close()

	items := make([]gin.H, 0)
	for rows.Next() {
		var oid, state, updatedAt, payload string
		var ownerID sql.NullString
		if err := rows.Scan(&oid, &ownerID, &state, &updatedAt, &payload); err != nil {
			d.internalError(c, "scan official elves failed", err)
			return
		}
		items = append(items, gin.H{
			"object_id": oid, "owner_id": ownerID.String, "state": state,
			"updated_at": updatedAt, "payload": json.RawMessage(payload),
		})
	}
	if err := rows.Err(); err != nil {
		d.internalError(c, "iterate official elves failed", err)
		return
	}
	_ = rows.Close()

	// 一次性取全部官方挂单，按 payload.elfId 归并
	listings := map[string]json.RawMessage{}
	lrows, err := d.DB.QueryContext(ctx,
		`SELECT payload FROM payment_objects
		 WHERE environment = ? AND kind = 'listing'
		   AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.isOfficial')) = 'true'
		 ORDER BY updated_at DESC LIMIT 500`, env)
	if err != nil {
		d.internalError(c, "list official listings failed", err)
		return
	}
	defer lrows.Close()
	for lrows.Next() {
		var raw string
		if err := lrows.Scan(&raw); err != nil {
			d.internalError(c, "scan official listings failed", err)
			return
		}
		var probe struct {
			ElfID string `json:"elfId"`
		}
		if json.Unmarshal([]byte(raw), &probe) == nil && probe.ElfID != "" {
			if _, exists := listings[probe.ElfID]; !exists {
				listings[probe.ElfID] = json.RawMessage(raw)
			}
		}
	}

	for _, item := range items {
		if raw, has := listings[item["object_id"].(string)]; has {
			item["listing"] = raw
		} else {
			item["listing"] = nil
		}
	}

	c.JSON(http.StatusOK, gin.H{"items": items, "total": len(items)})
}

// CreateOfficialElf POST /api/v1/elves/official（仅 super_admin）
// 创建官方 AI 建档；listing.enabled 时同步写一级市场挂单。
func (d Deps) CreateOfficialElf(c *gin.Context) {
	var req officialCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "参数不合法"})
		return
	}
	if !envBody(c, req.Environment) {
		return
	}
	if msg := normalizeAndValidate(&req.officialFields); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_field", "message": msg})
		return
	}
	if req.Listing.Enabled {
		if req.Listing.Price < 1 || req.Listing.Price > 1_000_000 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_field", "message": "挂单价格需在 1–1000000 钻石之间"})
			return
		}
		req.Listing.Title = strings.TrimSpace(req.Listing.Title)
		req.Listing.Subtitle = strings.TrimSpace(req.Listing.Subtitle)
		req.Listing.Note = strings.TrimSpace(req.Listing.Note)
		if len([]rune(req.Listing.Title)) > 40 || len([]rune(req.Listing.Subtitle)) > 60 || len([]rune(req.Listing.Note)) > 200 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_field", "message": "挂单标题/副标题/备注过长"})
			return
		}
	}

	objID := strings.TrimSpace(req.ObjectID)
	if objID == "" {
		objID = "elf_" + model.NewID()
	} else if !officialObjectIDRE.MatchString(objID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_object_id", "message": "object_id 只允许字母、数字、下划线与短横线（3–64 位）"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		d.internalError(c, "begin tx failed", err)
		return
	}
	defer tx.Rollback()

	var exists int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM payment_objects WHERE environment = ? AND kind = 'elf' AND object_id = ?`,
		req.Environment, objID).Scan(&exists); err != nil {
		d.internalError(c, "check elf exists failed", err)
		return
	}
	if exists > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "already_exists", "message": "该 object_id 已存在，请换一个或改用更新接口"})
		return
	}

	now := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	status := "official"
	if req.Listing.Enabled {
		status = "listed"
	}
	payload := buildOfficialPayload(objID, req.officialFields, status, now)

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO payment_objects (environment, kind, object_id, owner_id, ref_id, state, payload, updated_at)
		 VALUES (?, 'elf', ?, NULL, NULL, '', ?, ?)`,
		req.Environment, objID, payload, now); err != nil {
		d.internalError(c, "insert official elf failed", err)
		return
	}

	listingID := ""
	var listingPayload string
	if req.Listing.Enabled {
		listingID = "lst_" + model.NewID()
		title := req.Listing.Title
		if title == "" {
			title = req.officialFields.Name + " · 官方首发"
		}
		subtitle := req.Listing.Subtitle
		if subtitle == "" {
			subtitle = "官方首发"
		}
		doc := map[string]any{
			"id": listingID, "market": "primary", "elfId": objID,
			"title": title, "subtitle": subtitle, "price": req.Listing.Price,
			"edition": req.officialFields.Edition, "note": req.Listing.Note,
			"sellerId": nil, "sellerLabel": "OpenElf 官方",
			"isOfficial": true, "state": "open", "createdAt": now,
		}
		raw, err := json.Marshal(doc)
		if err != nil {
			d.internalError(c, "marshal official listing failed", err)
			return
		}
		listingPayload = string(raw)
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO payment_objects (environment, kind, object_id, owner_id, ref_id, state, payload, updated_at)
			 VALUES (?, 'listing', ?, NULL, ?, 'open', ?, ?)`,
			req.Environment, listingID, objID, listingPayload, now); err != nil {
			d.internalError(c, "insert official listing failed", err)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		d.internalError(c, "commit official elf failed", err)
		return
	}

	resp := gin.H{
		"ok": true, "object_id": objID, "listing_id": listingID,
		"payload": json.RawMessage(payload),
	}
	if listingID != "" {
		resp["listing"] = json.RawMessage(listingPayload)
	}
	c.JSON(http.StatusOK, resp)
}

// UpdateOfficialElf PUT /api/v1/elves/:id/official（仅 super_admin）
// 只更新官方字段与栏目，不改变所有权、状态与挂单。
func (d Deps) UpdateOfficialElf(c *gin.Context) {
	var req struct {
		Environment string `json:"environment" binding:"required"`
		officialFields
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "参数不合法"})
		return
	}
	if !envBody(c, req.Environment) {
		return
	}
	if msg := normalizeAndValidate(&req.officialFields); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_field", "message": msg})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		d.internalError(c, "begin tx failed", err)
		return
	}
	defer tx.Rollback()

	var raw string
	err = tx.QueryRowContext(ctx,
		`SELECT payload FROM payment_objects
		 WHERE environment = ? AND kind = 'elf' AND object_id = ? FOR UPDATE`,
		req.Environment, c.Param("id")).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "精灵不存在"})
		return
	}
	if err != nil {
		d.internalError(c, "lock official elf failed", err)
		return
	}

	var doc map[string]any
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		d.internalError(c, "parse official elf payload failed", err)
		return
	}
	if ok, _ := doc["isOfficial"].(bool); !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "not_official", "message": "该精灵不是官方建档，不能用此接口更新"})
		return
	}

	applyOfficialFields(doc, req.officialFields)
	now := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	doc["updatedAt"] = now
	merged, err := json.Marshal(doc)
	if err != nil {
		d.internalError(c, "marshal official elf payload failed", err)
		return
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE payment_objects SET payload = ?, updated_at = ?
		 WHERE environment = ? AND kind = 'elf' AND object_id = ?`,
		string(merged), now, req.Environment, c.Param("id")); err != nil {
		d.internalError(c, "update official elf failed", err)
		return
	}
	if err := tx.Commit(); err != nil {
		d.internalError(c, "commit official elf failed", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "object_id": c.Param("id"), "payload": json.RawMessage(merged)})
}

// —— 内部辅助 ——

func buildOfficialPayload(id string, f officialFields, status, now string) string {
	doc := map[string]any{
		"id":        id,
		"serial":    "#" + strings.ToUpper(idSuffix(id)),
		"name":      f.Name,
		"nickname":  f.Nickname,
		"initial":   f.Initial,
		"ownerId":   nil,
		"ownerLabel": "OpenElf 官方",
		"generation": f.Generation,
		"edition":    f.Edition,
		"persona":    f.Persona,
		"fear":       f.Fear,
		"habit":      f.Habit,
		"status":     status,
		"followers":  0,
		"echo":       0,
		"works":      0,
		"attention":  0,
		"slots":      f.BaseCapacity,
		"baseCapacity": f.BaseCapacity,
		"equipped":     f.LearnedSkills,
		"ownedModules": f.LearnedSkills,
		"learnedSkills": f.LearnedSkills,
		"today":        []any{},
		"relations":    []any{},
		"tagline":      f.Tagline,
		"intro":        f.Intro,
		"avatarUrl":    f.AvatarURL,
		"portraitUrl":  f.PortraitURL,
		"isOfficial":   true,
		"series":       seriesDoc(f.Series),
		"officialNote": f.OfficialNote,
		"compliance": map[string]any{
			"aiGeneratedLabel":     "内容由 AI 生成",
			"internalTestingOnly":  true,
			"noDeepSeekAssociation": true,
		},
		"createdAt": now,
		"updatedAt": now,
	}
	raw, _ := json.Marshal(doc)
	return string(raw)
}

func applyOfficialFields(doc map[string]any, f officialFields) {
	doc["name"] = f.Name
	doc["nickname"] = f.Nickname
	doc["initial"] = f.Initial
	doc["persona"] = f.Persona
	doc["fear"] = f.Fear
	doc["habit"] = f.Habit
	doc["generation"] = f.Generation
	doc["edition"] = f.Edition
	doc["slots"] = f.BaseCapacity
	doc["baseCapacity"] = f.BaseCapacity
	doc["equipped"] = f.LearnedSkills
	doc["ownedModules"] = f.LearnedSkills
	doc["learnedSkills"] = f.LearnedSkills
	doc["tagline"] = f.Tagline
	doc["intro"] = f.Intro
	doc["avatarUrl"] = f.AvatarURL
	doc["portraitUrl"] = f.PortraitURL
	doc["series"] = seriesDoc(f.Series)
	doc["officialNote"] = f.OfficialNote
}

func seriesDoc(series []officialSeries) []map[string]any {
	out := make([]map[string]any, 0, len(series))
	for _, s := range series {
		out = append(out, map[string]any{
			"id": s.ID, "name": s.Name, "format": s.Format,
			"coverUrl": s.CoverURL, "cadence": s.Cadence, "desc": s.Desc,
		})
	}
	return out
}

func idSuffix(id string) string {
	if len(id) <= 6 {
		return id
	}
	return id[len(id)-6:]
}

func normalizeAndValidate(f *officialFields) string {
	f.Name = strings.TrimSpace(f.Name)
	f.Nickname = strings.TrimSpace(f.Nickname)
	f.Initial = strings.TrimSpace(f.Initial)
	f.Tagline = strings.TrimSpace(f.Tagline)
	f.Intro = strings.TrimSpace(f.Intro)
	f.Persona = strings.TrimSpace(f.Persona)
	f.Fear = strings.TrimSpace(f.Fear)
	f.Habit = strings.TrimSpace(f.Habit)
	f.Edition = strings.TrimSpace(f.Edition)
	f.AvatarURL = strings.TrimSpace(f.AvatarURL)
	f.PortraitURL = strings.TrimSpace(f.PortraitURL)
	f.OfficialNote = strings.TrimSpace(f.OfficialNote)

	if f.Name == "" {
		return "名称必填"
	}
	if len([]rune(f.Name)) > 32 || len([]rune(f.Nickname)) > 32 {
		return "名称/昵称不超过 32 字"
	}
	if len([]rune(f.Initial)) == 0 {
		f.Initial = string([]rune(f.Name)[0])
	}
	if len([]rune(f.Initial)) > 4 {
		return "首字不超过 4 字"
	}
	if f.Generation < 1 || f.Generation > 99 {
		f.Generation = 1
	}
	if f.Edition == "" {
		f.Edition = "官方首发"
	}
	if len([]rune(f.Edition)) > 24 {
		return "版本名称不超过 24 字"
	}
	if f.BaseCapacity < 1 || f.BaseCapacity > 12 {
		return "基础学习位需在 1–12 之间"
	}
	if len(f.LearnedSkills) > 12 {
		return "已学技能不超过 12 个"
	}
	for i, s := range f.LearnedSkills {
		f.LearnedSkills[i] = strings.TrimSpace(s)
		if f.LearnedSkills[i] == "" {
			return "已学技能不能为空"
		}
	}
	if len([]rune(f.Tagline)) > 64 || len([]rune(f.Intro)) > 1000 {
		return "一句话简介不超过 64 字，详细简介不超过 1000 字"
	}
	if len([]rune(f.Persona)) > 200 || len([]rune(f.Fear)) > 200 || len([]rune(f.Habit)) > 200 {
		return "人格三字段各自不超过 200 字"
	}
	if len([]rune(f.OfficialNote)) > 200 {
		return "官方备注不超过 200 字"
	}
	if !validAssetURL(f.AvatarURL) || !validAssetURL(f.PortraitURL) {
		return "头像/立绘地址必须是 http(s) 或 /api/v1/assets/ 开头的站内地址"
	}
	if len(f.Series) > 8 {
		return "栏目不超过 8 个"
	}
	seen := map[string]bool{}
	for i := range f.Series {
		s := &f.Series[i]
		s.ID = strings.TrimSpace(s.ID)
		s.Name = strings.TrimSpace(s.Name)
		s.Format = strings.TrimSpace(s.Format)
		s.CoverURL = strings.TrimSpace(s.CoverURL)
		s.Cadence = strings.TrimSpace(s.Cadence)
		s.Desc = strings.TrimSpace(s.Desc)
		if s.ID == "" || s.Name == "" {
			return "栏目的 id 与名称必填"
		}
		if seen[s.ID] {
			return "栏目 id 不能重复"
		}
		seen[s.ID] = true
		if !officialSeriesFormats[strings.ToLower(s.Format)] {
			return "栏目形态只允许 audio / video / text / image"
		}
		if len([]rune(s.Name)) > 16 || len([]rune(s.Cadence)) > 32 || len([]rune(s.Desc)) > 200 {
			return "栏目名称不超过 16 字，更新节奏不超过 32 字，简介不超过 200 字"
		}
		if !validAssetURL(s.CoverURL) {
			return "栏目封面地址必须是 http(s) 或 /api/v1/assets/ 开头的站内地址"
		}
	}
	return ""
}

func validAssetURL(u string) bool {
	if u == "" {
		return true
	}
	if len(u) > 500 {
		return false
	}
	return strings.HasPrefix(u, "/api/v1/assets/") ||
		strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "http://")
}
