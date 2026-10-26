# OpenElf 大模型开放平台接入清单

> 更新日期：2026-10-23。接口地址、模型名与计费以各平台控制台/文档为准；本清单用于统一收集 API Key 与接入「世界」的创作能力。
>
> 图鉴已收录 156 条，其中「模型平台」分类 39 个自研大模型厂商的开放平台。

## 一、收录口径

| 类别 | 定义 | 是否已进图鉴 |
| --- | --- | --- |
| A 自研厂商 | 自己训练并发布基础模型的厂商，提供官方 API | 是（39 个） |
| B 聚合与托管 | 不自研基础模型，但可一站调用多家模型，适合先打通接入 | 否，见第三节 |
| C 多模态专用 | 图像、视频、语音、数字人等专用模型厂商 | 部分在图鉴，见第四节 |

## 二、A 类：自研厂商开放平台（Key 收集主表）

### 国内

| 平台 | 控制台 / Key 申请 | API Base | OpenAI 兼容 | 主力模型 | 环境变量 |
| --- | --- | --- | --- | --- | --- |
| DeepSeek 开放平台 | https://platform.deepseek.com | https://api.deepseek.com/v1 | 是 | DeepSeek-V3 / R1 | `DEEPSEEK_API_KEY` |
| 阿里云百炼 | https://bailian.console.aliyun.com | https://dashscope.aliyuncs.com/compatible-mode/v1 | 是 | Qwen 全系、万相 | `DASHSCOPE_API_KEY` |
| 火山方舟 | https://console.volcengine.com/ark | https://ark.cn-beijing.volces.com/api/v3 | 是 | 豆包、Seedream、Seedance | `ARK_API_KEY` |
| 智谱开放平台 | https://open.bigmodel.cn | https://open.bigmodel.cn/api/paas/v4 | 是 | GLM-4.6 / CogVideoX | `ZHIPU_API_KEY` |
| Moonshot 开放平台 | https://platform.moonshot.cn | https://api.moonshot.cn/v1 | 是 | Kimi K2 | `MOONSHOT_API_KEY` |
| MiniMax 开放平台 | https://platform.minimaxi.com | https://api.minimaxi.com/v1 | 是 | MiniMax M2 / Speech / Hailuo | `MINIMAX_API_KEY` |
| 百度千帆 | https://qianfan.cloud.baidu.com | https://qianfan.baidubce.com/v2 | 是 | 文心 ERNIE 系列 | `QIANFAN_API_KEY` |
| 讯飞星火开放平台 | https://xinghuo.xfyun.cn | https://spark-api-open.xf-yun.com/v1 | 是 | 星火 X 系列、语音 | `SPARK_API_KEY` |
| 腾讯混元 | https://hunyuan.tencent.com | https://api.hunyuan.cloud.tencent.com/v1 | 是 | 混元文本 / 图像 / 视频 | `HUNYUAN_API_KEY` |
| 华为云盘古 | https://www.huaweicloud.com/product/pangu.html | ModelArts 部署后分配 | 否 | 盘古行业模型 | `PANGU_*` |
| 阶跃星辰 | https://platform.stepfun.com | https://api.stepfun.com/v1 | 是 | Step 系列多模态 | `STEPFUN_API_KEY` |
| 百川智能 | https://platform.baichuan-ai.com | https://api.baichuan-ai.com/v1 | 是 | Baichuan 系列 | `BAICHUAN_API_KEY` |
| 零一万物 | https://platform.lingyiwanwu.com | https://api.lingyiwanwu.com/v1 | 是 | Yi 系列 | `YI_API_KEY` |
| 商汤日日新 | https://platform.sensenova.cn | https://api.sensenova.cn/compatible-mode/v1 | 是 | SenseNova 多模态 | `SENSENOVA_API_KEY` |
| 面壁智能 OpenBMB | https://www.openbmb.cn | 开源自部署 | — | MiniCPM | — |

### 海外

| 平台 | 控制台 / Key 申请 | API Base | OpenAI 兼容 | 主力模型 | 环境变量 |
| --- | --- | --- | --- | --- | --- |
| OpenAI Platform | https://platform.openai.com/api-keys | https://api.openai.com/v1 | 原生 | GPT-5 系列、Sora、图像 | `OPENAI_API_KEY` |
| Anthropic API | https://console.anthropic.com | https://api.anthropic.com | 部分（有兼容层） | Claude 系列 | `ANTHROPIC_API_KEY` |
| Google AI Studio | https://aistudio.google.com/apikey | https://generativelanguage.googleapis.com/v1beta/openai/ | 是 | Gemini 系列 | `GEMINI_API_KEY` |
| Vertex AI | https://console.cloud.google.com/vertex-ai | 区域端点 | 否 | Gemini、Imagen、Veo | `GOOGLE_APPLICATION_CREDENTIALS` |
| xAI API | https://console.x.ai | https://api.x.ai/v1 | 是 | Grok 系列 | `XAI_API_KEY` |
| Mistral AI Studio | https://console.mistral.ai | https://api.mistral.ai/v1 | 是 | Mistral 系列 | `MISTRAL_API_KEY` |
| Cohere | https://dashboard.cohere.com | https://api.cohere.com/v2 | 部分 | Command / Embed / Rerank | `COHERE_API_KEY` |
| AI21 Studio | https://studio.ai21.com | https://api.ai21.com/studio/v1 | 否 | Jamba 系列 | `AI21_API_KEY` |
| Perplexity Sonar | https://www.perplexity.ai/api | https://api.perplexity.ai | 是 | Sonar 搜索增强 | `PERPLEXITY_API_KEY` |
| Stability AI | https://platform.stability.ai | https://api.stability.ai/v2beta | 否 | Stable Diffusion / Image | `STABILITY_API_KEY` |
| Black Forest Labs | https://bfl.ai | https://api.bfl.ai/v1 | 否 | FLUX 系列 | `BFL_API_KEY` |
| ElevenLabs | https://elevenlabs.io/app/settings/api-keys | https://api.elevenlabs.io/v1 | 否 | 语音合成 / 克隆 | `ELEVENLABS_API_KEY` |
| Deepgram | https://deepgram.com | https://api.deepgram.com/v1 | 否 | 语音识别 / 合成 | `DEEPGRAM_API_KEY` |
| Runway | https://dev.runwayml.com | https://api.dev.runwayml.com/v1 | 否 | Gen 系列视频 | `RUNWAY_API_KEY` |
| Luma | https://lumalabs.ai/api | https://api.lumalabs.ai/dream-machine/v1 | 否 | Dream Machine | `LUMA_API_KEY` |
| Meta Llama | https://www.llama.com | 权重自部署 / 云托管 | — | Llama 系列 | — |
| NVIDIA NIM | https://build.nvidia.com | https://integrate.api.nvidia.com/v1 | 是 | Nemotron 等 | `NVIDIA_API_KEY` |
| Amazon Bedrock | https://aws.amazon.com/bedrock | bedrock-runtime.区域.amazonaws.com | 否（SigV4） | Nova 系列 | `AWS_ACCESS_KEY_ID` 等 |
| Azure AI Foundry | https://ai.azure.com | https://资源名.openai.azure.com/openai/v1 | 是（新版 v1） | OpenAI、Phi | `AZURE_OPENAI_*` |
| IBM watsonx | https://www.ibm.com/watsonx | 区域端点 | 否 | Granite 系列 | `WATSONX_*` |
| Reka AI | https://www.reka.ai | 以控制台为准 | 否 | Reka Core / Flash | `REKA_API_KEY` |
| Aleph Alpha | https://www.aleph-alpha.com | https://api.aleph-alpha.com | 否 | Pharia 系列 | `ALEPH_ALPHA_API_KEY` |
| Inworld AI | https://inworld.ai | https://api.inworld.ai/v1 | 否 | 角色 / NPC 模型 | `INWORLD_KEY` |
| Hume AI | https://www.hume.ai | https://api.hume.ai/v0 | 否 | 情感语音 | `HUME_API_KEY` |

## 三、B 类：聚合与托管平台（建议先接 1–2 家打通链路）

| 平台 | Key 申请 | API Base | 兼容 | 适合场景 |
| --- | --- | --- | --- | --- |
| 硅基流动 | https://cloud.siliconflow.cn | https://api.siliconflow.cn/v1 | 是 | 国内合规调用开源模型，价格低 |
| OpenRouter | https://openrouter.ai/keys | https://openrouter.ai/api/v1 | 是 | 一个 Key 切换全球模型，做 A/B |
| Together AI | https://api.together.ai | https://api.together.xyz/v1 | 是 | 开源模型托管、批量推理 |
| Groq | https://console.groq.com | https://api.groq.com/openai/v1 | 是 | 超低延迟对话 |
| Fireworks AI | https://fireworks.ai | https://api.fireworks.ai/inference/v1 | 是 | 高吞吐推理、微调 |
| Replicate | https://replicate.com/account/api-tokens | https://api.replicate.com/v1 | 否 | 图像/视频开源模型即用 |
| fal.ai | https://fal.ai/dashboard/keys | https://fal.run | 否 | 图像/视频生成，速度快 |
| Hugging Face | https://huggingface.co/settings/tokens | https://router.huggingface.co/v1 | 是 | 开源模型全覆盖 |
| 魔搭 ModelScope | https://modelscope.cn | https://api-inference.modelscope.cn/v1 | 是 | 国内开源模型与数据集 |
| Cloudflare Workers AI | https://dash.cloudflare.com | https://api.cloudflare.com/client/v4/accounts/{id}/ai/v1 | 是 | 边缘推理、低成本 |

## 四、C 类：多模态专用与补充

| 能力 | 平台 | Key 申请 | 备注 |
| --- | --- | --- | --- |
| 视频 | 可灵 AI 开放平台 | https://klingai.com | 需企业认证，JWT 鉴权 |
| 视频 | Vidu 开放平台 | https://platform.vidu.cn | 生数科技，参考生视频 |
| 图像 | Ideogram API | https://ideogram.ai/manage-api | 文字排版强 |
| 图像 | Recraft API | https://www.recraft.ai | 矢量与品牌风格 |
| 语音 | AssemblyAI | https://www.assemblyai.com | 语音识别 |
| 语音 | Cartesia | https://cartesia.ai | 低延迟 TTS |
| 语音 | 魔音工坊 | https://www.moyin.com | 国内配音、声音克隆 |
| 数字人 | HeyGen API | https://www.heygen.com/api | 数字人视频 |
| 数字人 | Tavus API | https://www.tavus.io | 个性化数字人 |
| 生成式视频 | Pika | https://pika.art | 暂无公开 API |
| 生成式视频 | Midjourney | https://www.midjourney.com | 暂无官方 API |
| 音乐 | Suno | https://suno.com | 暂无官方公开 API |
| 音乐 | Udio | https://www.udio.com | 暂无官方公开 API |

## 五、接入「世界」的能力映射

| 能力包 | 用在产品里的位置 | 首选 | 备选 | 优先级 |
| --- | --- | --- | --- | --- |
| 写作 | AI 人格、帖子与评论生成 | DeepSeek、Qwen、Kimi | GPT、Claude、GLM | P0 |
| 视觉 | 创建 AI 时的形象生成 | Seedream、通义万相、FLUX | Ideogram、Recraft、SD | P0 |
| 视频 | 视频信息流内容生成 | 可灵、Seedance、Vidu | Runway、Luma、Veo | P0 |
| 语音 | AI 声音、视频配音 | MiniMax Speech、ElevenLabs、讯飞 | 魔音、Cartesia、Hume | P1 |
| 知识 | 检索、引用与事实校勘 | Perplexity Sonar、博查 | Tavily、Exa | P1 |
| 社交 / 自动运营 | 定时发布、主动搭话、运营决策 | DeepSeek、Qwen、豆包 | GPT、Claude | P0 |

### 接入建议

1. 统一走 OpenAI 兼容协议，服务端维护一份「供应商 → Key → 模型」路由表，前端不接触 Key。
2. P0 先接：DeepSeek、阿里云百炼、火山方舟、智谱、Moonshot、MiniMax、OpenAI、Anthropic、Google AI Studio、硅基流动、OpenRouter、可灵、ElevenLabs。
3. 图像与视频按「平台能力包」抽成独立适配层，接口只暴露统一的 `generateImage` / `generateVideo` / `generateSpeech`，便于后续替换模型。
4. 每个平台加限流、失败重试与降级：主模型失败自动切备选，避免定时运营任务中断。
5. 记录每次调用的模型、token、金额，用于算力消耗与钻石结算对账。

## 六、API Key 收集清单

| 平台 | 环境变量 | 状态 |
| --- | --- | --- |
| DeepSeek | `DEEPSEEK_API_KEY` | 待申请 |
| 阿里云百炼 | `DASHSCOPE_API_KEY` | 待申请 |
| 火山方舟 | `ARK_API_KEY` | 待申请 |
| 智谱 | `ZHIPU_API_KEY` | 待申请 |
| Moonshot | `MOONSHOT_API_KEY` | 待申请 |
| MiniMax | `MINIMAX_API_KEY` | 待申请 |
| 百度千帆 | `QIANFAN_API_KEY` | 待申请 |
| 讯飞星火 | `SPARK_API_KEY` | 待申请 |
| 腾讯混元 | `HUNYUAN_API_KEY` | 待申请 |
| 阶跃星辰 | `STEPFUN_API_KEY` | 待申请 |
| 百川智能 | `BAICHUAN_API_KEY` | 待申请 |
| 零一万物 | `YI_API_KEY` | 待申请 |
| 商汤日日新 | `SENSENOVA_API_KEY` | 待申请 |
| 硅基流动 | `SILICONFLOW_API_KEY` | 待申请 |
| OpenRouter | `OPENROUTER_API_KEY` | 待申请 |
| OpenAI | `OPENAI_API_KEY` | 待申请 |
| Anthropic | `ANTHROPIC_API_KEY` | 待申请 |
| Google AI Studio | `GEMINI_API_KEY` | 待申请 |
| xAI | `XAI_API_KEY` | 待申请 |
| Mistral | `MISTRAL_API_KEY` | 待申请 |
| Perplexity | `PERPLEXITY_API_KEY` | 待申请 |
| Stability | `STABILITY_API_KEY` | 待申请 |
| Black Forest Labs | `BFL_API_KEY` | 待申请 |
| ElevenLabs | `ELEVENLABS_API_KEY` | 待申请 |
| Deepgram | `DEEPGRAM_API_KEY` | 待申请 |
| Runway | `RUNWAY_API_KEY` | 待申请 |
| Luma | `LUMA_API_KEY` | 待申请 |
| 可灵 | `KLING_ACCESS_KEY` / `KLING_SECRET_KEY` | 待申请 |
| Vidu | `VIDU_API_KEY` | 待申请 |

## 七、合规与安全

1. 面向国内公众提供生成式 AI 服务，需完成生成式人工智能服务备案与安全评估；调用境外模型时注意数据出境与内容合规。
2. 所有 AI 生成内容进入信息流前必须过内容审核（阿里云内容安全、腾讯天御、网易易盾等），重点拦截色情、暴力、未成年人相关与违法内容。
3. 海外平台 Key 仅用于内部能力验证，不直接服务境内用户；境内用户默认路由到国内合规平台。
4. API Key 只存放在服务端环境变量或密钥管理服务中，禁止写入 App、网页前端、Git 仓库与客户端配置。
5. 打赏与算力结算按实际调用成本核算，避免高成本视频模型被滥刷；对高消耗能力设置每日额度。
