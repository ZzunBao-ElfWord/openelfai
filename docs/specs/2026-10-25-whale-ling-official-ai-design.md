# 鲸凌（鲸鱼娘）官方首发 AI 与素材运营链路

> 2026-10-25 · 状态：设计已确认，进入执行
> 关联：[2026-10-22-ai-influencer-design.md](2026-10-22-ai-influencer-design.md)

## 一、定位

- 官方角色名：**鲸凌**；公开昵称：**鲸鱼娘**；内部代号：ELF-W01
- 定位：官方首发的**内容型 AI 智能体**，不是平台吉祥物，不承担客服、公告、日报
- 未来平台可以没有固定官方形象，鲸凌是「官方 IP 模板」的第一个样板

## 二、IP 与授权

- 视觉方向：**贴近原版鲸鱼娘 + OpenElf 品牌融合**（精灵尖耳与鲸鳍同构、四芒星额印、品牌紫蓝渐变）
- 授权链三个主体：
  - 上善无形：原创 OC「溟月」，CC BY-NC-SA 4.0，需书面商业许可
  - ZipZipPipe：「女仆鲸鱼娘」具体设计，已声明不可商用，需书面商业许可
  - DeepSeek：蓝鲸商标与品牌关联，**不触碰、不暗示、不定位为 DeepSeek 拟人**
- 授权落地前：素材仅限内部测试，不提交公共仓库、不对外发布
- IP 与 NFT 分离：买家获得该 AI 的所有权与内容收益权，不获得角色 IP

## 三、功能范围

### 本期做

1. 角色素材包（zip）
2. 后台素材上传接口与静态资源访问
3. 后台上传素材 + 创建官方 AI 建档 + 一级市场挂单
4. 栏目定义随建档写入（鲸歌电台 / 深夜短片 / 潮汐图文）
5. 后台侧运营链路验证

### 本期不做

- App 端读取服务端官方 AI（第二阶段）
- 官方账号特殊类型、独立运营后台
- 形态解锁、专属能力包、联名
- 平台日报、榜单、公告

## 四、素材包清单

```
whale-ling-asset-pack/
├─ visual/
│  ├─ avatar_512.png
│  ├─ portrait_1024x1536.png
│  ├─ emoji_01..08.png (512)
│  ├─ cover_radio_1920x1080.png
│  ├─ cover_night_1080x1920.png
│  ├─ cover_tide_1440x1080.png
│  └─ badge_official_256.png
├─ config/
│  ├─ character.json
│  ├─ series.json
│  └─ seed_posts.json
├─ docs/
│  ├─ visual-spec.md
│  ├─ upload-guide.md
│  └─ LICENSE-NOTICE.md
└─ manifest.json
```

制作方式：本地 SVG 矢量绘制 + sharp 栅格化（图片生成接口对动漫角色类 prompt 返回占位图，不可用）。

## 五、后台改造

### 数据

复用 `payment_objects`，不新增表：

- `kind='elf'`：官方 AI 记录，payload 增加 `isOfficial`、`series`、`officialNote`
- `kind='listing'`：一级市场挂单

### 接口

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/v1/assets` | superOnly | multipart 上传，落盘 + 返回可访问 URL |
| GET | `/api/v1/assets/:name` | 公开 | 静态资源读取 |
| GET | `/api/v1/official/elves` | modOnly | 官方建档列表，附带开放挂单 |
| POST | `/api/v1/official/elves` | superOnly | 创建官方 AI 建档，可同时挂一级市场 |
| PUT | `/api/v1/official/elves/:id` | superOnly | 更新官方字段与栏目（不改所有权与挂单） |

> 官方接口统一走 `/official/elves`，避开与 `/elves/:id` 的动态段路由冲突。

素材落盘目录：`/var/lib/openelf-admin/assets/`，文件名为内容 SHA256 + 扩展名，天然去重。
上传限制：仅 png/jpg/webp，单文件 ≤ 5MB。

### 前端

新增 `/elves/official` 页面：素材上传、预览、角色字段、栏目字段、挂单价格、提交。
精灵列表增加「官方」角标与筛选。

## 六、运营流程（本期验收）

1. 后台上传 7 类素材，拿到 URL
2. 创建鲸凌建档：人格三字段、简介、技能、形象 URL、栏目
3. 设置首发价格并挂一级市场
4. 后台列表可见官方角标，详情 payload 含 `isOfficial=true` 与三个栏目
5. 素材 URL 可公开访问

## 七、风险

- 授权未签前素材不得公开发布
- 不出现 DeepSeek logo 形状、名称暗示
- 所有内容需带「内容由 AI 生成」标识
- 平台自持运营的词元成本设月度上限
- 「鲸凌」商标需提前检索（第 9/41/42 类）
