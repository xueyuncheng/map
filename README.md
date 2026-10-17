# Travel Map

旅行记录网站：上传机票、火车票、酒店等订单截图，由 Claude 识别出行程，展示在可缩放的世界地图上，并按年份统计行程、城市和国家/地区数量。

## 结构

- `backend/`：Go（标准库 `net/http`）+ SQLite，截图识别在 `internal/extract`
- `frontend/`：Next.js 16（App Router）+ MapLibre GL

## 运行

需要 Go 1.27+、Node.js 和 pnpm。

后端：

```bash
cd backend
cat > .env <<'ENV'
ANTHROPIC_API_KEY=你的 key
# ANTHROPIC_BASE_URL=https://api.anthropic.com
ENV
go test ./...
go run ./cmd/server
```

前端：

```bash
cd frontend
pnpm install
pnpm dev
```

打开 <http://localhost:3000>。

## 配置

后端（环境变量或 `backend/.env`，`.env` 已被 git 忽略）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 无，必填 | Claude API key |
| `ANTHROPIC_BASE_URL` | 官方地址 | 自定义 API 网关 |
| `CLAUDE_MODEL` | `claude-opus-5` | 识别用的模型 |
| `ADDR` | `127.0.0.1:8080` | 监听地址 |
| `DB_PATH` | `travelmap.db` | SQLite 文件路径 |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS 允许的来源，逗号分隔 |

前端：`NEXT_PUBLIC_API_URL`，默认 `http://127.0.0.1:8080`。浏览器直接请求后端，不经过 Next 代理，避免较长的识别请求被代理超时打断。

## 注意

- API 没有鉴权，只应监听本机地址，不要暴露到公网。
- 国家字段统一存 ISO 3166-1 两位代码（如 `CN`、`JP`）。保存时会把常见的中英文国家名自动转成代码，后端启动时也会修正旧数据。
