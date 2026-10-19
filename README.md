# AIGC Gallery

部署在 Cloudflare Workers 上的 AIGC 图片画廊。前端按文件夹组织图片(手机壁纸 / 海报设计 / AI Memes 等主题),后端用 Cloudflare KV 存元数据,图片本体代理上传到 Cloudflare ImgBed 图床,并支持视觉模型自动识别回填标题与描述。

## 特性

- 📁 **文件夹画廊** — 按主题组织作品,封面自动取最新图片
- 🔐 **认证码管理** — 单一入口解锁创建 / 上传 / 删除,localStorage 持久化
- ⭐ **AI 识别** — OpenAI 兼容视觉模型(glm-5.3-flash),上传时一键生成标题与描述
- 🖼 **两段式上传** — 原图 + 浏览器 canvas 生成的 512px 缩略图(逐级减半降采样避免锯齿),均经 Worker 代理上传图床
- 💡 **灯箱浏览** — ←/→ 切换、Esc 关闭,深色画廊风格
- 📱 **响应式** — 移动端文件夹 / 图片网格均为 2 列
- 🚀 **零构建** — 原生 HTML/CSS/JS 单页 + wrangler 直接打包,无框架依赖
- 🔄 **CI/CD** — 推送到 main 自动经 GitHub Actions 部署

## 架构

```
浏览器 ──▶ Cloudflare Worker (src/index.js)
              ├── 静态页面  public/index.html(hash 路由单页)
              ├── 元数据    Cloudflare KV
              ├── 图片上传  ─▶ Cloudflare ImgBed (aigc/<folderId>/)
              └── AI 识别   ─▶ OpenAI 兼容 chat/completions(视觉)
```

- **运行时**: Cloudflare Workers,无构建步骤
- **存储**: KV 键 `folders`(文件夹数组)与 `images:<folderId>`(图片数组,新图在前)
- **图片 `id`**: 时间戳 + 随机数;缩略图文件名固定为 `<id>__thumb.jpg`

## 目录结构

```
src/index.js          # Worker 入口:静态 HTML + 全部 API
public/index.html     # 前端单页(以 text module 内嵌打包)
wrangler.toml         # Worker 配置(KV binding + 非敏感 vars)
.github/workflows/    # push main 自动部署
```

## 环境变量

本地放 `.dev.vars`(或 `.env`,gitignored),线上用 `wrangler secret put` 或 CI secrets:

| 变量 | 说明 | 敏感 |
|---|---|---|
| `AUTH_KEY` | 应用认证码(解锁创建/上传/删除) | ✅ |
| `AI_KEY` | 视觉模型端点的 API Key | ✅ |
| `IMG_KEY` | 图床上传认证码 | ✅ |
| `AI_BASE` | OpenAI 兼容端点,如 `https://llmapi.ma.uy/v1` | ❌([vars]) |
| `AI_MODEL` | 视觉模型名,如 `glm-5.3-flash` | ❌([vars]) |
| `IMG_BASE` | 图床站点,如 `https://img.0525.eu` | ❌([vars]) |

## API

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/` | - | 前端页面 |
| GET | `/api/folders` | - | 文件夹列表(含封面) |
| POST | `/api/folders` | code | 创建文件夹 |
| DELETE | `/api/folders/:id` | X-Auth-Code | 删除文件夹(仅删 KV) |
| GET | `/api/folders/:id/images` | - | 图片列表 |
| POST | `/api/upload` | code | 上传原图(建记录)或缩略图(`imageId` 回填) |
| DELETE | `/api/folders/:id/images/:imageId` | X-Auth-Code | 删除图片记录 |
| POST | `/api/verify` | - | 校验认证码 |
| POST | `/api/ai-describe` | code | AI 识别,返回 `{title, description}` |

## 本地开发

```bash
npm install
cp .env .dev.vars        # 若已有 .env 可直接复制
npm run dev              # http://localhost:8787
```

> 修改 `.dev.vars` 后需重启 `wrangler dev` 才会生效。

## 部署

### 方式一:GitHub Actions(推荐)

1. Fork / 推送到 GitHub
2. 在仓库 Settings → Secrets and variables → Actions 配置:
   - `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`
   - `AUTH_KEY`、`AI_KEY`、`IMG_KEY`
3. 修改 `wrangler.toml` 中的 KV namespace id 为你自己的
4. 推送到 `main` 即自动部署

### 方式二:手动

```bash
npx wrangler secret put AUTH_KEY   # 以及 AI_KEY / IMG_KEY
npm run deploy
```

## 注意事项

- KV 读改写非原子,单管理员场景够用;避免并发批量上传同一文件夹
- 删除操作只清 KV 记录,不动图床文件
- 缩略图扩展名恒为 jpg,原图保留原扩展名

## License

MIT
