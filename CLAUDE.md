# Travel Map

旅行记录网站：上传订单截图 → Claude 视觉识别出行程 → 展示在可缩放的世界地图上。

- `backend/` — Go (stdlib `net/http`) + SQLite (`modernc.org/sqlite`)，Claude 调用在 `internal/extract`
- `frontend/` — Next.js 16 (App Router) + MapLibre GL；写代码前先读 `frontend/AGENTS.md`

## 常用命令

- 后端：`cd backend && go test ./... && go run ./cmd/server`（需要 `ANTHROPIC_API_KEY`）
- 前端：`cd frontend && pnpm dev` / `pnpm build` / `pnpm lint`

## 配置

- `backend/.env`（已 gitignore，勿提交、勿在输出中回显）：`ANTHROPIC_BASE_URL`、`ANTHROPIC_API_KEY`，启动时自动加载
- 后端其他环境变量：`ADDR`（默认 `127.0.0.1:8080`）、`DB_PATH`（默认 `travelmap.db`）、`CLAUDE_MODEL`、`ALLOWED_ORIGINS`（CORS，默认 `http://localhost:3000`）
- 前端：`NEXT_PUBLIC_API_URL`（默认 `http://127.0.0.1:8080`）。浏览器直连后端（不经 Next 代理），避免长时间识别请求被代理超时打断
- API 没有鉴权，只应监听本机地址

## 注意事项

- MapLibre 在 Turbopack 下自动推断的 worker 地址是错的，`WorldMap.tsx` 里用 `setWorkerUrl` 显式指定，不要删
- MapLibre 的 CSS 会给地图容器加 `position: relative`，绝对定位要放在外层 wrapper 上

## 网络代理

遇到网络问题（go get、pnpm install、npx、访问 Anthropic API 等超时或失败）时，使用本机代理 `127.0.0.1:7890`（同时支持 HTTP 和 SOCKS5）：

```bash
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890
```

单条命令可用 `curl -x socks5h://127.0.0.1:7890 ...`。Go 后端通过 `HTTPS_PROXY` 环境变量走代理。

`ANTHROPIC_BASE_URL` 指向局域网网关 `192.168.3.98`，访问它时必须绕过代理：设置 `NO_PROXY=192.168.3.98`，curl 用 `--noproxy 192.168.3.98`。
