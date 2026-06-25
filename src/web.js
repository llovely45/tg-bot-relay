import express from "express";
import { renderResultPage, renderVerificationPage } from "./templates.js";
import { verifyTurnstileToken } from "./turnstile.js";

function isExpired(session) {
  return new Date(session.expires_at).getTime() <= Date.now();
}

export function createWebApp({ config, store, telegram }) {
  const app = express();
  app.set("trust proxy", true);

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  if (config.webhookSecret) {
    app.use(config.webhookPath, (req, res, next) => {
      const token = req.get("x-telegram-bot-api-secret-token");
      if (token !== config.webhookSecret) {
        res.status(403).json({ ok: false, error: "invalid webhook secret" });
        return;
      }
      next();
    });
  }

  app.use(config.webhookPath, telegram.bot.webhookCallback(config.webhookPath));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/verify/:sessionId", (req, res) => {
    const session = store.getSession(req.params.sessionId);
    if (!session) {
      res.status(404).send(renderResultPage({
        title: "链接无效",
        description: "该验证链接不存在。"
      }));
      return;
    }

    if (session.is_blacklisted) {
      res.status(403).send(renderResultPage({
        title: "已拒绝访问",
        description: "该用户已被加入黑名单。"
      }));
      return;
    }

    if (session.status === "passed" || session.is_verified) {
      res.send(renderResultPage({
        title: "已验证",
        description: "你已经通过验证，现在可以回到 Telegram 继续聊天。"
      }));
      return;
    }

    if (session.status !== "pending" || isExpired(session)) {
      res.status(410).send(renderResultPage({
        title: "链接已过期",
        description: "请重新在 Telegram 中发送消息，获取新的验证链接。"
      }));
      return;
    }

    res.send(renderVerificationPage({
      siteKey: config.turnstileSiteKey,
      sessionId: session.session_id
    }));
  });

  app.post("/api/verify/:sessionId", async (req, res) => {
    const session = store.getSession(req.params.sessionId);
    if (!session) {
      res.status(404).send(renderResultPage({
        title: "链接无效",
        description: "该验证链接不存在。"
      }));
      return;
    }

    if (session.status !== "pending" || isExpired(session)) {
      res.status(410).send(renderResultPage({
        title: "链接已过期",
        description: "请重新在 Telegram 中获取新的验证链接。"
      }));
      return;
    }

    const token = req.body["cf-turnstile-response"];
    if (!token) {
      res.status(400).send(renderVerificationPage({
        siteKey: config.turnstileSiteKey,
        sessionId: session.session_id,
        errorMessage: "缺少 Turnstile 验证结果，请重试。"
      }));
      return;
    }

    try {
      const result = await verifyTurnstileToken({
        secretKey: config.turnstileSecretKey,
        token,
        remoteIp: req.ip
      });

      if (!result.success) {
        store.blacklistUser(session.user_id, session.session_id, JSON.stringify(result["error-codes"] ?? []));
        await telegram.notifyBlacklist(session.user_id, `Turnstile failed: ${(result["error-codes"] ?? []).join(", ") || "unknown"}`);
        res.status(403).send(renderResultPage({
          title: "验证失败",
          description: "验证未通过，当前用户已加入黑名单。"
        }));
        return;
      }

      await telegram.completeVerification(session.user_id, session.session_id);
      res.send(renderResultPage({
        title: "验证成功",
        description: "验证已通过，请回到 Telegram 继续聊天。"
      }));
    } catch (error) {
      res.status(500).send(renderVerificationPage({
        siteKey: config.turnstileSiteKey,
        sessionId: session.session_id,
        errorMessage: `验证服务异常：${error.message}`
      }));
    }
  });

  return app;
}
