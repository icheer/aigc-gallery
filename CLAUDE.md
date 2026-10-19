# AIGC Gallery

部署在 Cloudflare Workers 上的 AIGC 图片画廊。前端按文件夹组织图片(手机壁纸 / 海报设计 / AI Memes 等主题),后端用 KV 存元数据、代理上传到 Cloudflare ImgBed 图床。参考站: https://hermes.ma.uy

## 架构

- **运行时**: Cloudflare Workers,无构建步骤(wrangler 直接打包),无前端框架(原生 HTML/CSS/JS 单页,hash 路由)
- **存储**: Cloudflare KV(文件夹与图片的元数据;图片本体在图床)
- **图床**: `IMG_BASE`(Cloudflare ImgBed),`uploadChannel=cfr2`、`uploadNameType=origin`、`uploadFolder=aigc/<folderId>`
- **AI 识别**: OpenAI 兼容的 chat/completions 视觉模型(`AI_BASE` / `AI_MODEL`),前端压缩到 max 1024px 的 JPEG 以 data URL 发给后端代理调用

## 目录结构

```
src/index.js          # Worker 入口:静态 HTML 响应 + 全部 API
public/index.html     # 前端单页(由 Worker 以 text module 内嵌打包)
wrangler.toml         # Worker 配置(含 KV binding: KV)
.env                  # 本机密钥(不提交 git;wrangler dev 用 .dev.vars)
```

## 环境变量(密钥,本地放 .dev.vars,线上 `wrangler secret put`)

| 变量 | 说明 |
|---|---|
| `AUTH_KEY` | 应用认证码(解锁创建/上传/删除;与图床认证码共用值) |
| `AI_BASE` | OpenAI 兼容端点,如 `https://llmapi.ma.uy/v1` |
| `AI_KEY` | 该端点的 API Key |
| `AI_MODEL` | 视觉模型名,如 `buddy/glm-5.3-flash` |
| `IMG_BASE` | 图床站点,如 `https://img.0525.eu` |
| `IMG_KEY` | 图床上传认证码 |

## KV 数据模型

- `folders` → JSON 数组 `{ id, title, description, createdAt, count, coverUrl, coverThumb }`
- `images:<folderId>` → JSON 数组(新图在前)`{ id, title, description, prompt, url, thumbUrl, width, height, createdAt }`

图片 `id` 即文件名去扩展名(时间戳+随机);缩略图文件名固定为 `<id>__thumb.jpg`(浏览器 canvas 生成,max 边 512px JPEG,逐级减半降采样避免锯齿)。

## API

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/`, `/index.html` | - | 前端页面 |
| GET | `/api/folders` | - | 文件夹列表(含封面) |
| GET | `/api/folders/:id/images` | - | 文件夹内图片列表 |
| POST | `/api/verify` | - | 校验认证码 `{code}` |
| POST | `/api/folders` | code | 创建文件夹 `{code,title,description}` |
| DELETE | `/api/folders/:id` | X-Auth-Code | 删除文件夹(仅删 KV,不动图床) |
| POST | `/api/upload` | code(multipart) | 传原图(带 title 等元数据,建 KV 记录)或传缩略图(带 `imageId`,回填 thumbUrl) |
| DELETE | `/api/folders/:id/images/:imageId` | X-Auth-Code | 删除图片记录 |
| POST | `/api/ai-describe` | code(multipart) | 传压缩图+prompt 提示,返回 `{title,description}` 回填表单 |

## 前端要点

- 认证码单一入口(页头解锁框),验证通过后 localStorage 持久化并露出 创建文件夹/上传图片/删除 入口
- 上传流程:选图(预览+取原始宽高)→ 可选 ⭐ AI 识别回填 → 提交时先 POST 原图、成功后 POST 512px 缩略图(两次 /api/upload)
- 灯箱浏览:←/→ 切换、Esc 关闭,只展示标题与描述(不显示 Prompt)
- 界面为深色画廊风格;图标用 lucide(CDN,动态渲染后需调 `lucide.createIcons()`);移动端文件夹/图片网格均为 2 列

## 常用命令

```bash
npx wrangler dev        # 本地开发 (读 .dev.vars)
npx wrangler deploy     # 部署
npx wrangler kv key list --binding KV   # 查看 KV 数据
```

## 注意事项

- `.env` / `.dev.vars` 含真实密钥,已在 .gitignore 中,绝不提交
- KV 读改写非原子,单管理员场景够用;不要并发批量上传同一文件夹
- 缩略图扩展名恒为 jpg(浏览器 canvas.toBlob),原图保留原扩展名
