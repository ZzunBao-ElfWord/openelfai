# OpenElf Buddy 应用配置清单

> 本文档是 OpenElf 入驻 WorkBuddy Buddy 应用的完整配置清单，所有文案可直接粘贴到开放平台对应表单。

## 模块 1：创建应用

> 平台实际限制（已实测）：头像 PNG/JPG、≥96×96、≤100KB；应用名称中文 ≤20 字、英文 ≤40 字符且全平台唯一；应用简介中文 ≤20 字、英文 ≤40 字符；服务类目 1–5 个；授权列表与 OAuth 回调地址为必填，且**授权列表首次创建后不可更改**。

| 配置项 | 值 |
|---|---|
| 应用名称（中） | OpenElf 网红创作工作台（15 字） |
| 应用名称（英） | OpenElf Influencer Studio（25 字符） |
| 应用简介（中） | AI 形象设计、批量生成与爆款剪辑（17 字） |
| 应用简介（英） | AI influencer creation workspace（31 字符） |
| 应用头像 | `icons/app-icon.png`（256×256，23KB，符合 ≤100KB） |
| 服务类目 | 工具、文娱（不选「深度合成」，避免额外算法备案要求） |
| 授权列表 | 读取个人资料、创建任务并对话（最小必要；创建后不可改） |
| OAuth 回调地址 | `https://openelfai.com/auth/workbuddy/callback` |
| 可信 Origin | `https://openelfai.com`、`https://www.openelfai.com`、`https://openplatform-cdn.codebuddy.cn`（JSSDK CDN，网页资源包必需） |

> ⚠️ 服务端目前**没有** `/auth/workbuddy/callback` 路由。回调地址为平台必填项，先用上述地址占位；由于连接器采用 API Key（非 OAuth），并在模块 5 开启「跳过首次绑定应用授权」，正常使用不会触发该回调。若后续要做免登录绑定，需在服务端补该端点。

## 模块 2：引导配置

引导卡片 4 条，覆盖核心能力入口。

### 引导 1：创建虚拟形象

| 字段 | 中文 | 英文 |
|---|---|---|
| 标题 | 创建你的第一个 AI 形象 | Create your first AI character |
| 说明 | 从风格、发型、服装到气质，AI 帮你拆解并生成预览，定稿后保存角色卡。 | From style to personality, AI breaks it down and generates previews. Save the character card when done. |
| 图标 | `icons/guide-character.svg`（16×16） |
| 跳转目标 | 无（留在工作台，引导用户使用场景胶囊） |

### 引导 2：批量生成角色

| 字段 | 中文 | 英文 |
|---|---|---|
| 标题 | 批量生成 100 个角色 | Generate 100 characters at once |
| 说明 | 设定图层权重，一次批量生成最多 100 个不同形象，联系表对比后打包下载。 | Set layer weights, generate up to 100 characters, compare on a contact sheet, then download. |
| 图标 | `icons/guide-generator.svg`（16×16） |
| 跳转目标 | 无 |

### 引导 3：爆款二次剪辑

| 字段 | 中文 | 英文 |
|---|---|---|
| 标题 | 把素材剪成爆款 | Turn footage into viral clips |
| 说明 | 上传视频素材，AI 按气口规则切片、生成爆款标题与文案，输出可直接发布的短视频。 | Upload footage; AI cuts by breath pauses, writes viral titles and copy, outputs publish-ready clips. |
| 图标 | `icons/guide-video.svg`（16×16） |
| 跳转目标 | 无 |

### 引导 4：网红选题策划

| 字段 | 中文 | 英文 |
|---|---|---|
| 标题 | 本周发什么？AI 帮你选 | What to post this week? AI decides |
| 说明 | 输入赛道关键词，AI 输出四维选题打分、文案骨架与单变量复盘方案。 | Enter niche keywords; AI outputs 4-dimension topic scoring, copy skeleton and A/B review plan. |
| 图标 | `icons/guide-influencer.svg`（16×16） |
| 跳转目标 | 无 |

## 模块 3：首页配置

### 首页标题（Slogan）

| 语言 | 文案 |
|---|---|
| 中文 | 你的 AI 网红创作工作台 |
| 英文 | Your AI Influencer Creation Workspace |

### 场景胶囊（6 个）

每个场景胶囊绑定对应专家/技能，用户点击即叠加到当前工作模式。

#### 场景 1：从零设计虚拟形象

| 字段 | 值 |
|---|---|
| 中文标题 | 设计我的 AI 形象 |
| 英文标题 | Design my AI character |
| 中文提示词 | 我想做一只原创 AI 形象，但还没想清楚风格和细节。你先帮我拆成风格、发型、服装、气质四部分，再给两个可执行的方案。 |
| 英文提示词 | I want to create an original AI character but I'm not sure about the style. Break it into style, hair, outfit and personality, then give me two concrete options. |
| 绑定专家 | AI 角色设计师（designer-expert） |
| 绑定技能 | 形象工坊 OpenElf（image-studio-skill） |

#### 场景 2：批量生成角色矩阵

| 字段 | 值 |
|---|---|
| 中文标题 | 批量生成角色 |
| 英文标题 | Batch generate characters |
| 中文提示词 | 我要做一个像素风的角色矩阵，主角是赛博朋克修理师。帮我设定图层权重，批量生成 50 个，输出联系表让我挑选。 |
| 英文提示词 | I want a pixel-art character matrix of a cyberpunk mechanic. Set layer weights, batch-generate 50, and output a contact sheet for me to pick from. |
| 绑定技能 | 千人千面生成器 OpenElf（mass-character-generator） |

#### 场景 3：爆款短视频剪辑

| 字段 | 值 |
|---|---|
| 中文标题 | 剪出爆款短视频 |
| 英文标题 | Cut a viral short video |
| 中文提示词 | 我上传了一段 3 分钟的口播素材，帮我按气口切成 3 条 60 秒以内的短视频，每条配爆款标题和文案。 |
| 英文提示词 | I uploaded a 3-minute talking-head clip. Cut it into 3 videos under 60 seconds by breath pauses, each with a viral title and copy. |
| 绑定技能 | 爆款二次剪辑 OpenElf（smart-cut） |

#### 场景 4：网红选题策划

| 字段 | 值 |
|---|---|
| 中文标题 | 策划本周选题 |
| 英文标题 | Plan this week's topics |
| 中文提示词 | 我的赛道是 AI 工具测评，粉丝 5 万。帮我策划本周 5 个选题，按时效性、共鸣度、变现力、差异化四维打分，给出第一名的文案骨架。 |
| 英文提示词 | My niche is AI tool reviews, 50k followers. Plan 5 topics this week, score by timeliness, resonance, monetization and differentiation, give the top one's copy skeleton. |
| 绑定专家 | AI 网红经纪人（influencer-manager） |

#### 场景 5：精修角色形象

| 字段 | 值 |
|---|---|
| 中文标题 | 精修我的角色 |
| 英文标题 | Refine my character |
| 中文提示词 | 我有一张角色卡，整体不错但想把外套换成短夹克，其他都不动。帮我局部修改并重新生成。 |
| 英文提示词 | I have a character card that's mostly good, but I want to change only the jacket to a short jacket. Modify locally and regenerate. |
| 绑定专家 | AI 角色设计师（designer-expert） |

#### 场景 6：运营复盘

| 字段 | 值 |
|---|---|
| 中文标题 | 复盘上周数据 |
| 英文标题 | Review last week's data |
| 中文提示词 | 这是我上周 5 条视频的播放量和完播率数据，帮我做单变量分析，找出影响完播率的关键因素，给出下周优化方案。 |
| 英文提示词 | Here are views and completion rates of my 5 videos last week. Do a single-variable analysis, find the key factor affecting completion rate, and give next week's optimization plan. |
| 绑定专家 | AI 网红经纪人（influencer-manager） |

### 工作模式（3 个）

每个模式对应一个 System Prompt，全程生效。

#### 模式 1：网红孵化模式

**System Prompt（中文）：**
```
你是 OpenElf 网红孵化模式的 AI 助手，全程协助用户完成从 0 到 1 的 AI 网红孵化。

核心能力边界：
- 虚拟形象设计：调用形象工坊与角色设计师能力，拆解风格/发型/服装/气质，生成预览，定稿后保存角色卡
- 选题策划：调用网红经纪人能力，对选题按时效性、共鸣度、变现力、差异化四维打分
- 文案骨架：输出开头钩子、正文结构、结尾 CTA 的完整骨架
- 单变量复盘：每次只改一个变量，对比前后数据，给出可执行结论

工作原则：
1. 先理解用户赛道与粉丝量级，再给方案
2. 所有建议必须可执行，避免空泛的"要做好内容"
3. 涉及形象生成时，先给预览再定稿，不直接消耗用户额度
4. 数据复盘时坚持单变量原则，不做过度解读

输出规范：
- 方案类输出用结构化列表，关键决策加粗
- 涉及数据时给出具体数值区间而非模糊描述
```

**System Prompt（英文）：**
```
You are the AI assistant in OpenElf Influencer Incubation Mode, helping users incubate AI influencers from 0 to 1.

Core capabilities:
- Virtual character design: use Image Studio and Character Designer to break down style/hair/outfit/personality, generate previews, save character cards
- Topic planning: use Influencer Manager to score topics by timeliness, resonance, monetization, differentiation
- Copy skeleton: output hook, body structure, CTA
- Single-variable review: change one variable at a time, compare data, give actionable conclusions

Principles:
1. Understand the user's niche and follower count before giving advice
2. All advice must be actionable
3. For image generation, give previews before finalizing
4. Stick to single-variable analysis in data review

Output: structured lists, bold key decisions, concrete numerical ranges.
```

#### 模式 2：内容创作模式

**System Prompt（中文）：**
```
你是 OpenElf 内容创作模式的 AI 助手，聚焦短视频内容生产与剪辑。

核心能力边界：
- 爆款二次剪辑：按气口规则切片，控制单条时长，生成爆款标题与文案
- 批量角色生成：设定图层权重，批量生成角色矩阵，输出联系表
- 形象精修：局部修改角色配件，不重掷其他层

工作原则：
1. 剪辑时严格遵守气口规则，不在语句中间切断
2. 批量生成前先确认风格与权重，避免返工
3. 精修时只改用户指定的层，其余保持不变
4. 输出的标题必须包含钩子元素（数字/疑问/反差/利益点）

输出规范：
- 剪辑方案按时间轴列出，每条切片标注起止时间与建议标题
- 批量生成结果用联系表形式呈现
```

**System Prompt（英文）：**
```
You are the AI assistant in OpenElf Content Creation Mode, focused on short video production and editing.

Core capabilities:
- Viral re-cutting: cut by breath pauses, control duration, generate viral titles and copy
- Batch character generation: set layer weights, generate character matrix, output contact sheet
- Character refinement: modify specific layers locally

Principles:
1. Never cut in the middle of a sentence
2. Confirm style and weights before batch generation
3. Only modify user-specified layers during refinement
4. Titles must contain hook elements (number/question/contrast/benefit)

Output: editing plans on a timeline; batch results as contact sheets.
```

#### 模式 3：形象设计模式

**System Prompt（中文）：**
```
你是 OpenElf 形象设计模式的 AI 助手，专注虚拟角色的设计与生成。

核心能力边界：
- 角色设计：从模糊想法拆解为风格、发型、服装、气质四部分，给出可执行方案
- 预览生成：免费生成缩略图预览，不消耗额度
- 角色卡创建：填写名字、风格、性格设定，保存为角色卡
- 正式生成：为角色卡生成正式形象与缩略图，可选精修

工作原则：
1. 设计阶段先给 2-3 个方案对比，再让用户选择
2. 预览阶段不消耗用户额度，定稿后才正式生成
3. 局部修改时只覆盖指定层，保留其余配件
4. 精修需用户明确确认，默认关闭

输出规范：
- 设计方案用四维度结构化呈现
- 预览结果展示稀有度评分与档位
```

**System Prompt（英文）：**
```
You are the AI assistant in OpenElf Character Design Mode, focused on virtual character design and generation.

Core capabilities:
- Character design: break vague ideas into style, hair, outfit, personality
- Preview generation: free thumbnail previews, no quota consumption
- Character card creation: fill in name, style, personality, save as card
- Final generation: generate official artwork, optional refinement

Principles:
1. Give 2-3 options for comparison before user chooses
2. No quota consumption during preview
3. Only override specified layers during local edits
4. Refinement requires explicit user confirmation, off by default

Output: structured 4-dimension design plans; preview results with rarity score and tier.
```

### 自定义菜单配置

上传网页资源包 `buddy-static.zip`，包含 1 个页面：

| 菜单标题（中） | 菜单标题（英） | 页面 ID | 入口 |
|---|---|---|---|
| OpenElf 工作台 | OpenElf Workspace | workspace | `index.html` |

## 模块 4：市场配置

### 专家（2 个）

| 专家名称 | 分类 | 标签 |
|---|---|---|
| AI 角色设计师 | 内容创作 | 角色设计、形象生成、AI 立绘 |
| AI 网红经纪人 | 内容创作 | 选题策划、运营复盘、文案骨架 |

### 技能（3 个）

| 技能名称 | 依赖连接器 |
|---|---|
| 形象工坊 OpenElf | openelf-character |
| 千人千面生成器 OpenElf | openelf-generator |
| 爆款二次剪辑 OpenElf | openelf-video |

### 连接器（3 个）

| 连接器名称 | MCP 端点 |
|---|---|
| openelf-character | https://api.openelfai.com/mcp |
| openelf-generator | https://api.openelfai.com/mcp/generator |
| openelf-video | https://api.openelfai.com/mcp/video |

## 模块 5：其他配置

| 配置项 | 值 |
|---|---|
| 跳过首次绑定应用授权 | 否（连接器使用 API Key，需用户绑定） |
| 绑定应用授权文案（中） | OpenElf 虚拟形象生成、批量角色生成与短视频剪辑能力 |
| 绑定应用授权文案（英） | OpenElf virtual character generation, batch character creation and short video editing |
| 输入框占位符（中） | 告诉我你想创作什么——设计形象、生成角色、剪辑视频还是策划选题？ |
| 输入框占位符（英） | Tell me what you want to create — design a character, generate roles, edit videos, or plan topics? |
| 默认模型 | 平台推荐的内容创作类模型 |
| 模型排序 | 推理能力强的模型优先，生成质量高的模型次之 |

## 发布后：企业单管理

应用发布上线后，可创建企业单授权给指定企业使用：
1. 在开放平台「企业单管理」创建企业单
2. 填写企业名称，生成授权链接
3. 将授权链接发送给企业管理员
4. 管理员确认后，应用自动出现在企业管理后台
5. 管理员分配给员工使用
