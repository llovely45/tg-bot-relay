# Telegram 双向转发机器人

这个项目提供一个基于 `Telegram Webhook + Cloudflare Turnstile + SQLite` 的双向聊天机器人：

- 新用户先在独立网页完成 Cloudflare 人机验证
- 验证通过后，机器人在开启了话题模式的群组里为该用户创建独立话题
- 机器人把用户资料发到对应话题，并双向转发私聊与群话题消息
- 验证失败时，用户会被加入黑名单，不再转发
- 未验证用户会收到带按钮的验证提示，且验证前消息不会转发
- 群管理员可在用户对应话题中使用 `/admin`，显示当前用户操作按钮
- 数据使用 SQLite 持久化

## 环境变量

复制 `.env.example` 为 `.env`，至少填写以下参数：

- `TG_BOT_TOKEN`: Telegram Bot Token
- `TG_GROUP_ID`: 开启了话题模式的群组 ID，通常形如 `-100xxxxxxxxxx`
- `APP_BASE_URL`: 验证网页对外访问地址，例如 `https://bot.example.com`
- `TURNSTILE_SITE_KEY`: Cloudflare Turnstile 前端 Site Key
- `TURNSTILE_SECRET_KEY`: Cloudflare Turnstile 后端 Secret Key
- `TG_WEBHOOK_SECRET`: Telegram Webhook Header 校验密钥，建议使用长随机字符串

可选参数：

- `PORT`: Web 服务端口，默认 `3000`
- `SQLITE_PATH`: SQLite 文件路径，默认 `/app/data/bot.db`
- `VERIFICATION_TTL_MINUTES`: 验证链接有效期，默认 `30`
- `TG_WEBHOOK_PATH`: Webhook 路径，默认 `/telegram/webhook`

## 部署

### 1. 准备 `.env`

```bash
cp .env.example .env
```

### 2. 启动

```bash
docker compose up -d --build
```

或使用单行 `docker run`：

```bash
docker build -t tg-bot-relay . && docker run -d --name tg-bot-relay --restart unless-stopped -p 3000:3000 -e TG_BOT_TOKEN='你的_bot_token' -e TG_GROUP_ID='-1001234567890' -e APP_BASE_URL='https://你的域名' -e TURNSTILE_SITE_KEY='你的_turnstile_site_key' -e TURNSTILE_SECRET_KEY='你的_turnstile_secret_key' -e TG_WEBHOOK_PATH='/telegram/webhook' -e TG_WEBHOOK_SECRET='请替换为长随机字符串' -e PORT='3000' -e SQLITE_PATH='/app/data/bot.db' -e VERIFICATION_TTL_MINUTES='30' -v "$(pwd)/data:/app/data" tg-bot-relay
```

### 3. Telegram 群权限要求

机器人需要在目标群组中具备这些能力：

- 可读取群消息
- 可发送消息
- 可创建话题

同时群组必须开启 `Topics` / `Forum` 模式。

## 工作流

1. 用户私聊机器人并发送 `/start` 或任意消息
2. 机器人返回独立验证链接
3. 用户在网页完成 Cloudflare Turnstile 验证
4. Telegram 通过 Webhook 把消息回调到本服务
5. 验证成功后，机器人在群组创建该用户专属话题
6. 后续用户私聊消息会转发到该话题
7. 群里在该话题发送的消息会回传给对应用户
8. 验证失败时，用户会被标记为黑名单
9. 群管理员可在用户对应话题中发送 `/admin`，通过按钮拉黑或取消验证

## 路由

- `GET /health`: 健康检查
- `POST /telegram/webhook`: Telegram Webhook 回调地址
- `GET /verify/:sessionId`: 验证页面
- `POST /api/verify/:sessionId`: 提交 Turnstile 验证结果

## 目录结构

```text
src/
  bot.js
  config.js
  db.js
  index.js
  templates.js
  turnstile.js
  web.js
```
