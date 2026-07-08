import express from "express";
import { buildFingerprintMeta, parseFingerprintPayload } from "./fingerprint.js";
import { lookupIpMetadata, normalizePublicIpList } from "./ip.js";
import { renderResultPage, renderVerificationPage } from "./templates.js";
import { verifyTurnstileToken } from "./turnstile.js";

function isExpired(session) {
  return new Date(session.expires_at).getTime() <= Date.now();
}

function getRequestIp(req) {
  return req.get("cf-connecting-ip")
    || req.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.ip
    || "";
}

function detectClientSystem(req) {
  const ua = String(req.get("user-agent") || "").toLowerCase();
  if (ua.includes("android")) {
    return "Android";
  }
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) {
    return "iOS";
  }
  if (ua.includes("windows nt")) {
    return "Windows";
  }
  if (ua.includes("mac os x") || ua.includes("macintosh")) {
    return "macOS";
  }
  if (ua.includes("linux")) {
    return "Linux";
  }
  return "未知";
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

  app.use(config.webhookPath, telegram.bot.webhookCallback());

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
        remoteIp: getRequestIp(req)
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

      const publicIp = getRequestIp(req);
      const webrtcIps = normalizePublicIpList(req.body.webrtc_ip || "");
      const uniqueIps = Array.from(new Set([publicIp, ...webrtcIps].filter(Boolean)));
      const metadataList = await Promise.all(uniqueIps.map((ip) => lookupIpMetadata(ip)));
      const metadataByIp = new Map(
        metadataList
          .filter(Boolean)
          .map((item) => [item.ip, item])
      );
      const fingerprintPayload = parseFingerprintPayload(req.body.fingerprint_payload);
      const fingerprintMeta = buildFingerprintMeta({
        system: detectClientSystem(req),
        publicIpInfo: metadataByIp.get(publicIp) || null,
        webrtcIpInfos: webrtcIps
          .map((ip) => metadataByIp.get(ip))
          .filter(Boolean),
        fingerprint: fingerprintPayload
      });

      await telegram.completeVerification(session.user_id, session.session_id, {
        system: detectClientSystem(req),
        publicIp,
        publicIpInfo: metadataByIp.get(publicIp) || null,
        webrtcIps,
        webrtcIpInfos: webrtcIps
          .map((ip) => metadataByIp.get(ip))
          .filter(Boolean),
        fingerprint: fingerprintMeta
      });
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
