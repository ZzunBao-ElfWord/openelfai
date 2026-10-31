package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Config 全部来自环境变量（见 .env.example）。禁止硬编码密钥。
type Config struct {
	Port               string
	ListenHost         string
	MysqlDSN           string
	JWTSecret          string
	JWTTTL             time.Duration
	AllowedIPs         map[string]bool // 登录 IP 白名单；空 = 不限制
	CORSOrigins        []string
	BootstrapUsername  string
	BootstrapPassword  string
	NodeAPIHealthURL   string
	SecretsKey         string // 上游厂商密钥加密密钥（base64 编码的 32 字节 AES-256 密钥）
	AssetsDir          string // 运营素材落盘目录（官方 AI 形象/栏目封面）
	OpsAPIBaseURL      string // 形象工坊内部运营接口地址（openelf-api /internal/ops/character）
	OpsToken           string // 内部运营接口令牌（请求头 x-ops-token）；为空时形象工坊整体不可用
	OpsAssetBaseURL    string // 形象图片外链前缀，默认与 OpsAPIBaseURL 相同
	WorkBuddyDir       string // WorkBuddy 上架项目目录（含 dist/manifest.json 与 RELEASES.md）
	WorkBuddyMCPURL    string // 形象工坊 MCP 端点（/mcp），默认与 OPS_API_BASE_URL 同源
	InternalAPIBaseURL string // openelf-api 内部地址，供 WorkBuddy 调试台调用模型网关
	InternalSecret     string // 内部回调签名密钥 INTERNAL_CALLBACK_SECRET，须与 openelf-api 一致
	WorkBuddyLLMHosts  []string // 调试台允许直连的第三方模型域名白名单（逗号分隔）
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// Load 读取并校验环境变量。关键项缺失时返回的零值由调用方决定是否致命，
// 这里保持宽容以便 `go run` 本地调试（连不上 MySQL 会在启动时报错）。
func Load() *Config {
	ttlHours, _ := strconv.Atoi(env("JWT_TTL_HOURS", "12"))
	if ttlHours <= 0 {
		ttlHours = 12
	}

	// 调试台第三方模型域名白名单：只允许这些域名，避免后台变成开放代理
	llmHosts := strings.Split(env("WORKBUDDY_LLM_ALLOWED_HOSTS", "tokenhub.tencentmaas.com"), ",")
	hosts := make([]string, 0, len(llmHosts))
	for _, h := range llmHosts {
		if h = strings.TrimSpace(h); h != "" {
			hosts = append(hosts, h)
		}
	}

	rawOrigins := env("CORS_ORIGINS", "http://localhost:5173")
	origins := make([]string, 0)
	for _, o := range strings.Split(rawOrigins, ",") {
		if o = strings.TrimSpace(o); o != "" {
			origins = append(origins, o)
		}
	}

	// 登录 IP 白名单（逗号分隔）；为空表示不限制来源
	allowedIPs := map[string]bool{}
	for _, ip := range strings.Split(env("ALLOWED_IPS", ""), ",") {
		if ip = strings.TrimSpace(ip); ip != "" {
			allowedIPs[ip] = true
		}
	}

	// 形象工坊：内部运营接口与素材外链前缀；素材默认与接口同源
	opsAPIBaseURL := strings.TrimRight(env("OPS_API_BASE_URL", "http://127.0.0.1:8787"), "/")
	opsAssetBaseURL := strings.TrimRight(env("OPS_ASSET_BASE_URL", opsAPIBaseURL), "/")

	return &Config{
		Port:               env("PORT", "8094"),
		ListenHost:         env("LISTEN_HOST", "127.0.0.1"),
		MysqlDSN:           os.Getenv("MYSQL_DSN"),
		JWTSecret:          os.Getenv("JWT_SECRET"),
		JWTTTL:             time.Duration(ttlHours) * time.Hour,
		AllowedIPs:         allowedIPs,
		CORSOrigins:        origins,
		BootstrapUsername:  os.Getenv("BOOTSTRAP_ADMIN_USERNAME"),
		BootstrapPassword:  os.Getenv("BOOTSTRAP_ADMIN_PASSWORD"),
		NodeAPIHealthURL:   env("NODE_API_HEALTH_URL", "http://127.0.0.1:8787/api/v1/health"),
		SecretsKey:         os.Getenv("SECRETS_KEY"),
		AssetsDir:          env("ASSETS_DIR", "/var/lib/openelf-admin/assets"),
		OpsAPIBaseURL:      opsAPIBaseURL,
		OpsToken:           strings.TrimSpace(os.Getenv("OPS_TOKEN")),
		OpsAssetBaseURL:    opsAssetBaseURL,
		WorkBuddyDir:       env("WORKBUDDY_DIR", "/opt/openelf-admin/workbuddy"),
		WorkBuddyMCPURL:    strings.TrimRight(env("WORKBUDDY_MCP_URL", opsAPIBaseURL+"/mcp"), "/"),
		InternalAPIBaseURL: strings.TrimRight(env("INTERNAL_API_BASE_URL", opsAPIBaseURL), "/"),
		InternalSecret:     strings.TrimSpace(os.Getenv("INTERNAL_CALLBACK_SECRET")),
		WorkBuddyLLMHosts:  hosts,
	}
}
