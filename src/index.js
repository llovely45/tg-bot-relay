import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { createTelegramBot } from "./bot.js";
import { createDb } from "./db.js";
import { createWebApp } from "./web.js";

const sqliteDir = path.dirname(config.sqlitePath);
fs.mkdirSync(sqliteDir, { recursive: true });

const store = createDb(config.sqlitePath);
const telegram = createTelegramBot({ config, store });
const app = createWebApp({ config, store, telegram });
const webhookUrl = `${config.appBaseUrl}${config.webhookPath}`;

const server = app.listen(config.port, async () => {
  console.log(`Web server listening on :${config.port}`);
  try {
    await telegram.bot.telegram.setWebhook(webhookUrl, {
      secret_token: config.webhookSecret || undefined,
      drop_pending_updates: false
    });
    console.log(`Telegram webhook registered: ${webhookUrl}`);
  } catch (error) {
    console.error("Failed to register Telegram webhook", error);
    process.exit(1);
  }
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down`);
  telegram.stop(signal);
  server.close(() => {
    console.log("HTTP server stopped");
    process.exit(0);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
