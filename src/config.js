import dotenv from "dotenv";

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function toNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }
  return value;
}

export const config = {
  telegramToken: required("TG_BOT_TOKEN"),
  groupId: Number(required("TG_GROUP_ID")),
  appBaseUrl: required("APP_BASE_URL").replace(/\/$/, ""),
  turnstileSiteKey: required("TURNSTILE_SITE_KEY"),
  turnstileSecretKey: required("TURNSTILE_SECRET_KEY"),
  port: toNumber("PORT", 3000),
  sqlitePath: process.env.SQLITE_PATH || "/app/data/bot.db",
  verificationTtlMinutes: toNumber("VERIFICATION_TTL_MINUTES", 30),
  webhookPath: (process.env.TG_WEBHOOK_PATH || "/telegram/webhook").replace(/\/$/, "") || "/telegram/webhook",
  webhookSecret: process.env.TG_WEBHOOK_SECRET || ""
};

if (Number.isNaN(config.groupId)) {
  throw new Error("TG_GROUP_ID must be a valid number");
}
