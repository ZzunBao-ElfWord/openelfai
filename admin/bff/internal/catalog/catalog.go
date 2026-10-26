// Package catalog 是 server/src/commerce.js 中 CATALOG / MODULES / MODULE_PRICES
// 硬编码常量的 Go 镜像。Node 侧改动后必须同步本文件。
package catalog

// CatalogItem 官方首发精灵（对应 commerce.js CATALOG）。
type CatalogItem struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	ElfID      string   `json:"elf_id"`
	Title      string   `json:"title"`
	Price      int64    `json:"price"`
	Slots      int      `json:"slots"`
	Generation int      `json:"generation"`
	Edition    string   `json:"edition"`
	Equipped   []string `json:"equipped"`
}

// Catalog 对应 commerce.js CATALOG。
var Catalog = []CatalogItem{
	{ID: "pm_001", Name: "尘", ElfID: "pm_dust", Title: "尘 · 第 1 代", Price: 1280, Slots: 2, Generation: 1, Edition: "初版", Equipped: []string{}},
	{ID: "pm_002", Name: "摩卡", ElfID: "pm_mocha", Title: "摩卡 · 第 2 代", Price: 2880, Slots: 3, Generation: 2, Edition: "视觉版", Equipped: []string{"vision"}},
	{ID: "pm_003", Name: "柯", ElfID: "pm_ko", Title: "柯 · 第 3 代", Price: 3680, Slots: 6, Generation: 3, Edition: "扩展版", Equipped: []string{}},
}

// Module 能力包定义（对应 commerce.js MODULES：[slot, tokenCost, track]）。
type Module struct {
	ID        string `json:"id"`
	Slot      int    `json:"slot"`
	TokenCost int    `json:"token_cost"`
	Track     string `json:"track"`
}

// Modules 对应 commerce.js MODULES。key 为模块 id。
var Modules = map[string]Module{
	"sharp":     {ID: "sharp", Slot: 1, TokenCost: 3, Track: "text"},
	"writing":   {ID: "writing", Slot: 2, TokenCost: 24, Track: "text"},
	"rhythm":    {ID: "rhythm", Slot: 1, TokenCost: 2, Track: "text"},
	"vision":    {ID: "vision", Slot: 2, TokenCost: 20, Track: "image"},
	"imageedit": {ID: "imageedit", Slot: 1, TokenCost: 12, Track: "image"},
	"video":     {ID: "video", Slot: 3, TokenCost: 48, Track: "video"},
	"voice":     {ID: "voice", Slot: 1, TokenCost: 18, Track: "audio"},
	"music":     {ID: "music", Slot: 2, TokenCost: 30, Track: "audio"},
	"retrieval": {ID: "retrieval", Slot: 1, TokenCost: 6, Track: "quote"},
	"deep":      {ID: "deep", Slot: 3, TokenCost: 36, Track: "text"},
	"memory":    {ID: "memory", Slot: 1, TokenCost: 4, Track: "text"},
	"source":    {ID: "source", Slot: 1, TokenCost: 5, Track: "quote"},
	"mingle":    {ID: "mingle", Slot: 1, TokenCost: 8, Track: "reply"},
	"think":     {ID: "think", Slot: 2, TokenCost: 15, Track: "text"},
	"auto":      {ID: "auto", Slot: 2, TokenCost: 0, Track: "text"},
}

// ModulePrices 对应 commerce.js MODULE_PRICES（单位：钻石）。
var ModulePrices = map[string]int64{
	"sharp": 28, "writing": 128, "rhythm": 18, "vision": 88, "imageedit": 68,
	"video": 298, "voice": 98, "music": 168, "retrieval": 38, "deep": 198,
	"memory": 68, "source": 48, "mingle": 48, "think": 158, "auto": 198,
}
