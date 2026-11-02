package handler

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// WorkBuddy 技能对话调试台：
// 用管理员填写的 OpenElf API Key 直连 openelf-api 的 MCP 端点（/mcp），
// 模型走平台内部网关（/internal/v1/chat/completions，HMAC 签名），
// 在服务端完成「模型 → 工具调用 → 结果回填」循环，前端只看到对话与调用轨迹。
// 密钥只在本次请求内使用，不落库、不写日志。

const (
	internalChatPath     = "/internal/v1/chat/completions"
	workBuddyMaxRounds   = 6                    // 单轮对话最多几次工具往返，防止死循环
	workBuddyHTTPTimeout = 90 * time.Second     // 模型/工具单次调用超时
	workBuddyResultLimit = 4 << 20              // 单次响应体上限
	workBuddySkillDir    = "image-studio-skill" // 默认调试技能
)

type workBuddyChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type workBuddyChatRequest struct {
	APIKey    string                 `json:"api_key"`
	Model     string                 `json:"model"`
	Skill     string                 `json:"skill"`
	BaseURL   string                 `json:"base_url"`  // 非空时走自定义 OpenAI 兼容通道（测试用）
	ModelKey  string                 `json:"model_key"` // 自定义通道的模型密钥，仅本次请求使用
	MaxRounds int                    `json:"max_rounds"`
	Messages  []workBuddyChatMessage `json:"messages"`
}

// workBuddyStep 一次工具调用轨迹，供前端逐步展示。
type workBuddyStep struct {
	Round     int            `json:"round"`
	Tool      string         `json:"tool"`
	Arguments map[string]any `json:"arguments"`
	OK        bool           `json:"ok"`
	Error     string         `json:"error"`
	Result    any            `json:"result"`
	Images    []string       `json:"images"`
}

type workBuddyChatResponse struct {
	Reply  string          `json:"reply"`
	Model  string          `json:"model"`
	Rounds int             `json:"rounds"`
	Steps  []workBuddyStep `json:"steps"`
}

// mcpRPC 发一次 JSON-RPC 请求；401/HTTP 异常统一转成中文提示。
func (d Deps) mcpRPC(ctx context.Context, apiKey string, payload map[string]any) (map[string]any, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.Cfg.WorkBuddyMCPURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: workBuddyHTTPTimeout}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("连接形象工坊失败：%w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, workBuddyResultLimit))
	if res.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("API Key 无效或已吊销，请到 OpenElf 开放平台控制台重新创建")
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("形象工坊返回 HTTP %d", res.StatusCode)
	}

	var rpc struct {
		Result map[string]any `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &rpc); err != nil {
		return nil, fmt.Errorf("形象工坊响应解析失败")
	}
	if rpc.Error != nil {
		return nil, fmt.Errorf("%s", rpc.Error.Message)
	}
	if rpc.Result == nil {
		return nil, fmt.Errorf("形象工坊响应缺少 result")
	}
	return rpc.Result, nil
}

// marshalNoEscape 序列化为紧凑 JSON 且不做 HTML 转义。
// 平台网关按「原始 JSON 文本」算签名，中转义字符会改变摘要导致 401。
func marshalNoEscape(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// internalChat 调用平台内部模型网关；签名规则与服务端 gateway.js 保持一致。
func (d Deps) internalChat(ctx context.Context, payload map[string]any) (map[string]any, error) {
	if d.Cfg.InternalSecret == "" {
		return nil, fmt.Errorf("未配置 INTERNAL_CALLBACK_SECRET，无法调用平台模型网关")
	}
	body, err := marshalNoEscape(payload)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(body)
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	mac := hmac.New(sha256.New, []byte(d.Cfg.InternalSecret))
	mac.Write([]byte(ts + internalChatPath + hex.EncodeToString(sum[:])))
	signature := hex.EncodeToString(mac.Sum(nil))

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.Cfg.InternalAPIBaseURL+internalChatPath, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-oe-timestamp", ts)
	req.Header.Set("x-oe-signature", signature)

	client := &http.Client{Timeout: workBuddyHTTPTimeout}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("调用平台模型网关失败：%w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, workBuddyResultLimit))
	if res.StatusCode != http.StatusOK {
		// 不透传上游细节，只保留状态码便于排查
		return nil, fmt.Errorf("平台模型网关返回 HTTP %d（检查模型 ID 与厂商密钥）", res.StatusCode)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("平台模型网关响应解析失败")
	}
	return out, nil
}

// customChat 直连 OpenAI 兼容的第三方模型通道（测试用）。
// 只放行白名单域名、只允许 https，密钥仅用于本次转发。
func (d Deps) customChat(ctx context.Context, baseURL, modelKey string, payload map[string]any) (map[string]any, error) {
	u, err := url.Parse(baseURL)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return nil, fmt.Errorf("自定义模型地址必须是 https 地址")
	}
	allowed := false
	for _, h := range d.Cfg.WorkBuddyLLMHosts {
		if strings.EqualFold(h, u.Host) {
			allowed = true
			break
		}
	}
	if !allowed {
		return nil, fmt.Errorf("该模型域名不在白名单（当前允许：%s）", strings.Join(d.Cfg.WorkBuddyLLMHosts, "、"))
	}
	body, err := marshalNoEscape(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(baseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+modelKey)

	client := &http.Client{Timeout: workBuddyHTTPTimeout}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("调用自定义模型失败：%w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, workBuddyResultLimit))
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("自定义模型返回 HTTP %d（检查地址、密钥与模型 ID）", res.StatusCode)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("自定义模型响应解析失败")
	}
	return out, nil
}

// collectImages 从工具结果里挑出可直接渲染的图片地址（缩略图优先）。
func collectImages(node any, out *[]string) {
	if len(*out) >= 6 {
		return
	}
	switch v := node.(type) {
	case map[string]any:
		for _, key := range []string{"thumbDataUrl", "imageUrl", "thumbUrl", "sheetUrl"} {
			s, ok := v[key].(string)
			if !ok || s == "" {
				continue
			}
			if key == "thumbDataUrl" && !strings.HasPrefix(s, "data:image/") {
				continue
			}
			if key != "thumbDataUrl" && !strings.HasPrefix(s, "http") {
				continue
			}
			*out = append(*out, s)
			if len(*out) >= 6 {
				return
			}
		}
		for _, child := range v {
			collectImages(child, out)
		}
	case []any:
		for _, child := range v {
			collectImages(child, out)
		}
	}
}

// readSkillPrompt 读取技能正文作为 system prompt，确保测的是真实上架内容。
func (d Deps) readSkillPrompt(skill string) (string, string, error) {
	if skill == "" {
		skill = workBuddySkillDir
	}
	// 只允许简单目录名，避免路径穿越
	if strings.ContainsAny(skill, "/\\.") {
		return "", "", fmt.Errorf("技能名不合法")
	}
	path := filepath.Join(d.Cfg.WorkBuddyDir, "packages", skill, "SKILL.md")
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", "", fmt.Errorf("未找到技能正文：%s", skill)
	}
	return skill, string(raw), nil
}

// WorkBuddyChat POST /api/v1/workbuddy/chat
// 一次请求完成一轮用户消息：模型可能多次调用工具，最终返回文本与全部调用轨迹。
func (d Deps) WorkBuddyChat(c *gin.Context) {
	var in workBuddyChatRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "请求体格式错误"})
		return
	}
	in.APIKey = strings.TrimSpace(in.APIKey)
	in.Model = strings.TrimSpace(in.Model)
	if in.APIKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_api_key", "message": "请填写 OpenElf API Key"})
		return
	}
	if in.Model == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_model", "message": "请选择或填写模型"})
		return
	}
	// 自定义通道必须带模型密钥，且地址在服务端白名单内
	in.BaseURL = strings.TrimSpace(in.BaseURL)
	in.ModelKey = strings.TrimSpace(in.ModelKey)
	if in.BaseURL != "" && in.ModelKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_model_key", "message": "自定义模型通道需要填写模型密钥"})
		return
	}
	if len(in.Messages) == 0 || len(in.Messages) > 40 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_messages", "message": "对话消息数量不合法"})
		return
	}
	for _, m := range in.Messages {
		if strings.TrimSpace(m.Content) == "" || (m.Role != "user" && m.Role != "assistant") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad_messages", "message": "消息内容为空或角色不合法"})
			return
		}
	}

	_, skillPrompt, err := d.readSkillPrompt(in.Skill)
	if err != nil {
		// 技能目录未同步时降级为通用提示，仍可测工具链路
		skillPrompt = "你是 OpenElf 形象工坊助手，按 fetch_layers → generate_preview → create_character → generate_character 的顺序协助用户创作 AI 形象，并在生成正式形象前说明会产生费用。"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Minute)
	defer cancel()

	toolsResult, err := d.mcpRPC(ctx, in.APIKey, map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": "tools/list",
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "mcp_failed", "message": err.Error()})
		return
	}

	messages := []map[string]any{
		{"role": "system", "content": skillPrompt},
	}
	for _, m := range in.Messages {
		messages = append(messages, map[string]any{"role": m.Role, "content": m.Content})
	}

	// MCP 的工具描述用 inputSchema，模型网关需要 OpenAI 的 function 包装
	openAITools := make([]map[string]any, 0)
	if list, ok := toolsResult["tools"].([]any); ok {
		for _, raw := range list {
			tool, _ := raw.(map[string]any)
			name, _ := tool["name"].(string)
			if name == "" {
				continue
			}
			params := tool["inputSchema"]
			if params == nil {
				params = map[string]any{"type": "object", "properties": map[string]any{}}
			}
			openAITools = append(openAITools, map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        name,
					"description": tool["description"],
					"parameters":  params,
				},
			})
		}
	}

	rounds := in.MaxRounds
	if rounds <= 0 || rounds > workBuddyMaxRounds {
		rounds = workBuddyMaxRounds
	}

	// 模型通道：默认走平台内部网关；填了自定义地址则直连第三方 OpenAI 兼容接口
	send := func(ctx context.Context, payload map[string]any) (map[string]any, error) {
		if in.BaseURL != "" {
			return d.customChat(ctx, in.BaseURL, in.ModelKey, payload)
		}
		return d.internalChat(ctx, payload)
	}

	steps := make([]workBuddyStep, 0)
	reply := ""
	used := 0
	for i := 1; i <= rounds; i++ {
		used = i
		payload := map[string]any{
			"model":       in.Model,
			"messages":    messages,
			"tools":       openAITools,
			"tool_choice": "auto",
			"temperature": 0.3,
			"stream":      false,
		}
		out, err := send(ctx, payload)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "chat_failed", "message": err.Error(), "steps": steps})
			return
		}
		message := firstChoiceMessage(out)
		if message == nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "chat_failed", "message": "模型返回为空", "steps": steps})
			return
		}

		calls, _ := message["tool_calls"].([]any)
		content, _ := message["content"].(string)
		if len(calls) == 0 {
			reply = content
			break
		}

		messages = append(messages, message)
		for _, raw := range calls {
			call, _ := raw.(map[string]any)
			id, _ := call["id"].(string)
			fn, _ := call["function"].(map[string]any)
			name, _ := fn["name"].(string)
			argsText, _ := fn["arguments"].(string)
			args := map[string]any{}
			if argsText != "" {
				_ = json.Unmarshal([]byte(argsText), &args)
			}

			step := workBuddyStep{Round: i, Tool: name, Arguments: args, Images: []string{}}
			callResult, callErr := d.mcpRPC(ctx, in.APIKey, map[string]any{
				"jsonrpc": "2.0", "id": 2, "method": "tools/call",
				"params": map[string]any{"name": name, "arguments": args},
			})
			var toolContent string
			if callErr != nil {
				step.OK = false
				step.Error = callErr.Error()
				step.Result = map[string]any{"error": callErr.Error()}
				toolContent = `{"error":"` + strings.ReplaceAll(callErr.Error(), `"`, `'`) + `"}`
			} else {
				step.OK = true
				step.Result = callResult["structuredContent"]
				collectImages(callResult["structuredContent"], &step.Images)
				// 优先把 MCP 的文本结果回填给模型，避免把整段 base64 塞进上下文
				if items, ok := callResult["content"].([]any); ok && len(items) > 0 {
					if first, ok := items[0].(map[string]any); ok {
						if text, ok := first["text"].(string); ok {
							toolContent = text
						}
					}
				}
				if toolContent == "" {
					raw, _ := json.Marshal(callResult["structuredContent"])
					toolContent = string(raw)
				}
				if len(toolContent) > 200_000 {
					toolContent = toolContent[:200_000] + "…(已截断)"
				}
			}
			steps = append(steps, step)
			messages = append(messages, map[string]any{
				"role": "tool", "tool_call_id": id, "content": toolContent,
			})
		}
	}

	if reply == "" {
		reply = "模型在最大步数内没有给出最终答复，请查看下方工具调用轨迹后重试。"
	}

	c.JSON(http.StatusOK, workBuddyChatResponse{
		Reply:  reply,
		Model:  in.Model,
		Rounds: used,
		Steps:  steps,
	})
}

// firstChoiceMessage 取 choices[0].message。
func firstChoiceMessage(out map[string]any) map[string]any {
	choices, _ := out["choices"].([]any)
	if len(choices) == 0 {
		return nil
	}
	first, _ := choices[0].(map[string]any)
	message, _ := first["message"].(map[string]any)
	return message
}
