# OpenElf 全球 AI 工具图鉴 · Web 版

基于 **Next.js（App Router）静态生成** 的纯静态站点。构建产物为 `out/` 目录下的纯静态文件，可直接部署到任意对象存储 + CDN（无服务器、无数据库、无登录）。

## 技术栈

- Next.js 15（App Router，`output: 'export'` 静态导出）
- React 19（服务端组件静态生成 + 客户端组件交互）
- 无运行时外部依赖：系统字体栈、内联 SVG 图标，国内部署零外部请求

## 本地开发

```bash
npm install
npm run dev        # 开发服务器 http://localhost:3000
```

## 构建

```bash
npm run build
```

构建完成后产物在 `out/` 目录：

- `/index.html` 首页
- `/tools/index.html` 工具列表页
- `/tools/<id>/index.html` 107 个工具详情页（每工具一个独立页面）
- `/sitemap.xml`、`/robots.txt` SEO 基建
- `_next/` 静态资源（JS/CSS）

## 部署（对象存储 + CDN）

`out/` 目录就是全部部署内容，等价于一个纯静态站点根目录：

1. 将 `out/` 内**全部内容**（含 `_next/`）上传到对象存储桶根目录
2. CDN 回源指向该桶，缓存策略建议：`_next/static/*` 长缓存（内容带 hash）、HTML 短缓存或不缓存
3. 站点域名配置：默认站点地址为 `https://openelf.com`，如实际域名不同，构建时通过环境变量覆盖：
   ```bash
   NEXT_PUBLIC_SITE_URL=https://你的域名 npm run build
   ```
   该变量影响 canonical、OG 标签与 sitemap.xml 中的绝对地址
4. 对象存储侧建议开启：默认首页 `index.html`、404 回退到 `/404.html`（Next 静态导出的 not-found 页）

## 数据更新（不发版流程）

工具数据独立存放在 `data/tools.json`（107 条记录），与页面代码完全解耦：

1. 修改 `data/tools.json`（新增/编辑工具条目，字段结构以现有记录为准）
2. 重新执行 `npm run build`
3. 将新的 `out/` 全量上传覆盖（或仅上传有变化的 HTML）

数据字段说明（13 个字段）：

| 字段 | 说明 |
| --- | --- |
| id | 唯一标识，用于 URL `/tools/<id>/` |
| name / short_desc / description | 工具名 / 一句话简介 / 详情介绍 |
| category | 分类（chat/agent/office/creative/dev/data 六大类） |
| region | `domestic` 国内 / `overseas` 海外 |
| tags | 标签数组 |
| logo_url | 图标地址（当前数据均为空，页面以首字印章代替） |
| status | `active` 生效；构建期仅收录 active 且入口链接齐备的条目 |
| listed_at | 收录日期（YYYY-MM），用于"最新"排序与 sitemap lastModified |
| is_featured | 是否精选（首页精选区） |
| download_url | 国内工具下载入口（按钮文案"下载应用"） |
| official_url | 海外工具官网入口（按钮文案"访问官网"） |

## SEO 设计

- 每个工具独立详情页，`generateMetadata` 生成 title / meta description / keywords / canonical / OG / Twitter Card
- 结构化数据（JSON-LD）：首页 `WebSite + SearchAction`；详情页 `SoftwareApplication + BreadcrumbList`
- `sitemap.xml`：首页 + 列表页 + 107 详情页（lastModified 取 listed_at）
- `robots.txt`：全站允许 + sitemap 指引
- 首页搜索为原生 GET 表单（`/tools/?q=...`），无 JS 环境亦可搜索

## 品牌色

| 用途 | 色值 |
| --- | --- |
| 主色（精灵绿） | `#2E7A58` |
| 深绿（悬停/强调） | `#1F5740` |
| 浅绿（背景/分区） | `#E8F3ED` |
| 琥珀金（行动按钮点缀） | `#F5B841` |

用户可在应用内偏好面板自行调节主题色，品牌色为默认值；国内（朱砂）/海外（靛青）语义色仅用于印章与徽章，不受主题色影响。

## 原有功能

- 分类浏览（六大门类，chip 动态计数）
- 搜索（name/short_desc 子串匹配，350ms 防抖，URL query 为唯一事实源）
- 偏好调节面板：信息密度（舒适/紧凑）、默认排序（最新/名称）、主题色（三预设 + 自定义），localStorage 持久化
- 无登录、无注册、无任何用户数据上报
