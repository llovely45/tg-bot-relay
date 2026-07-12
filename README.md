# Telegram 双向转发机器人

这个项目提供一个基于 `Telegram Webhook + Cloudflare Turnstile + SQLite` 的双向聊天机器人：

- 新用户先在独立网页完成 Cloudflare 人机验证
- 验证通过后，机器人在开启了话题模式的群组里为该用户创建独立话题
- 机器人把用户资料发到对应话题，并双向转发私聊与群话题消息
- 验证失败时，用户会被加入黑名单，不再转发
- 未验证用户会收到带按钮的验证提示，且验证前消息不会转发
- 群管理员可在用户对应话题中使用 `/admin`，执行通过验证、取消验证、拉黑、取消拉黑、获取用户名
- 验证页面会在后台静默采集设备指纹、网络信息与 WebRTC 公网地址
- 管理员可为某次验证得到的指纹添加标签和备注，并分页查看、删除标签
- 后续验证会自动与已标记指纹做相似度匹配，命中阈值后在群话题提示相似标签
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

### 0. 生成混淆代码

本地维护原始源码在 `src/`，发布和镜像运行使用混淆后的 `dist/index.js`。

每次修改本地源码后先执行：

```bash
npm run build
```

然后提交 `dist/index.js`。仓库和 Docker 镜像都以 `dist` 为运行入口。

### 1. 准备 `.env`

```bash
cp .env.example .env
```

### 2. 启动

```bash
docker compose up -d --build
```

或直接使用已发布镜像：

```bash
docker run -d --name tg-bot-relay --restart unless-stopped -p 3000:3000 -e TG_BOT_TOKEN='你的_bot_token' -e TG_GROUP_ID='-1001234567890' -e APP_BASE_URL='https://你的域名' -e TURNSTILE_SITE_KEY='你的_turnstile_site_key' -e TURNSTILE_SECRET_KEY='你的_turnstile_secret_key' -e TG_WEBHOOK_PATH='/telegram/webhook' -e TG_WEBHOOK_SECRET='请替换为长随机字符串' -e PORT='3000' -e SQLITE_PATH='/app/data/bot.db' -e VERIFICATION_TTL_MINUTES='30' -v /opt/tg-bot/data:/app/data ghcr.io/llovely45/tg-bot-relay:latest
```

如需自行构建：

```bash
docker build -t tg-bot-relay . && docker run -d --name tg-bot-relay --restart unless-stopped -p 3000:3000 -e TG_BOT_TOKEN='你的_bot_token' -e TG_GROUP_ID='-1001234567890' -e APP_BASE_URL='https://你的域名' -e TURNSTILE_SITE_KEY='你的_turnstile_site_key' -e TURNSTILE_SECRET_KEY='你的_turnstile_secret_key' -e TG_WEBHOOK_PATH='/telegram/webhook' -e TG_WEBHOOK_SECRET='请替换为长随机字符串' -e PORT='3000' -e SQLITE_PATH='/app/data/bot.db' -e VERIFICATION_TTL_MINUTES='30' -v "$(pwd)/data:/app/data" tg-bot-relay
```

### 3. Telegram 群权限要求

机器人需要在目标群组中具备这些能力：

- 可读取群消息
- 可发送消息
- 可创建话题
- 可删除自己发送的管理消息

同时群组必须开启 `Topics` / `Forum` 模式，并使用正确的 `supergroup` ID，通常形如 `-100xxxxxxxxxx`。

如果旧群曾被升级为超级群，请务必填写升级后的新 ID。

## 工作流

1. 用户私聊机器人并发送 `/start` 或任意消息
2. 机器人返回带按钮的独立验证入口
3. 用户在网页完成 Cloudflare Turnstile 验证
4. Telegram 通过 Webhook 把消息回调到本服务
5. 验证页后台静默采集设备指纹与 WebRTC 公网地址
6. 验证成功后，机器人在群组创建或复用该用户专属话题
7. 机器人把本次验证信息发送到话题，包括设备系统、公网 IP、WebRTC IP、ASN / ISP、指纹 ID
8. 后续用户私聊消息会转发到该话题
9. 群里在该话题发送的消息会回传给对应用户
10. 验证失败时，用户会被标记为黑名单
11. 群管理员可在用户对应话题中发送 `/admin`，通过按钮执行管理操作
12. 管理员可给当前指纹打标签和备注；后续相似验证会自动提示命中的标签

## 指纹与标签

- 指纹采集在验证页后台静默执行，不向用户展示采集说明
- 当前会采集的信号包括：
  - `Canvas`
  - `WebGL`
  - `Audio`
  - `OS`
  - `CPU`
  - `Screen`
  - `Fonts`
  - 公网 `IP / ASN / ISP`
  - `WebRTC` 公网 `IP / ASN / ISP`
- `WebRTC` 探测当前使用：
  - `stun:stun.miwifi.com:3478`
- 只保留公网 `WebRTC IP`，会排除私网和本地地址
- 管理员可在 `/admin` 中点击 `标记指纹`，然后发送：

```text
标签|备注
```

- 管理员可在 `/admin` 中点击 `指纹标签`，分页查看当前用户的标签并删除
- 相似度命中阈值当前为 `60%`
- 相似度比较会综合两类信号：
  - 网络相似：公网 `IP / ASN / ISP` 与 `WebRTC IP / ASN / ISP`
  - 设备相似：`Canvas / WebGL / Audio / OS / CPU / Screen / Fonts`

## 路由

- `GET /health`: 健康检查
- `POST /telegram/webhook`: Telegram Webhook 回调地址
- `GET /verify/:sessionId`: 验证页面
- `POST /api/verify/:sessionId`: 提交 Turnstile 验证结果

如果你修改了 `TG_WEBHOOK_PATH`，请同步修改反向代理路径。

## 反向代理要求

- 外部必须能通过 `HTTPS` 访问 `APP_BASE_URL`
- 反向代理需要把 `TG_WEBHOOK_PATH` 转发到容器内的 `PORT`
- 若启用 Cloudflare，需保证回源正常，避免 `525` / `502`
- 建议透传：
  - `Host`
  - `X-Forwarded-For`
  - `X-Forwarded-Proto`
  - `cf-connecting-ip`

## 目录结构

```text
src/
  本地原始源码，默认不提交
dist/
  index.js
scripts/
  build-obfuscated.mjs
```
