import { Telegraf } from "telegraf";

function formatUserInfo(user) {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  const username = user.username ? `@${user.username}` : "无";
  return [
    "新用户验证通过",
    `用户ID: ${user.id}`,
    `昵称: ${fullName || "未提供"}`,
    `用户名: ${username}`,
    `语言: ${user.language_code || "未知"}`
  ].join("\n");
}

function isForwardableMessage(message) {
  if (!message) {
    return false;
  }
  if (message.text?.startsWith("/")) {
    return false;
  }
  if (message.new_chat_members || message.left_chat_member || message.group_chat_created) {
    return false;
  }
  return true;
}

export function createTelegramBot({ config, store }) {
  const bot = new Telegraf(config.telegramToken);

  function isExpired(isoTime) {
    return new Date(isoTime).getTime() <= Date.now();
  }

  async function ensureVerificationSession(telegramUser) {
    const user = store.upsertTelegramUser(telegramUser);
    if (user.is_blacklisted) {
      return { user, status: "blacklisted" };
    }
    if (user.is_verified) {
      return { user, status: "verified" };
    }

    const pending = store.getLatestPendingSessionForUser(user.user_id);
    if (pending && !isExpired(pending.expires_at)) {
      const verificationUrl = `${config.appBaseUrl}/verify/${pending.session_id}`;
      return { user, status: "pending", verificationUrl };
    }
    const session = store.createVerificationSession(user.user_id, config.verificationTtlMinutes);
    const verificationUrl = `${config.appBaseUrl}/verify/${session.session_id}`;
    return { user, status: "pending", verificationUrl };
  }

  bot.start(async (ctx) => {
    const result = await ensureVerificationSession(ctx.from);

    if (result.status === "blacklisted") {
      await ctx.reply("你已被加入黑名单，消息不会被转发。");
      return;
    }

    if (result.status === "verified") {
      await ctx.reply("已通过验证，直接发送消息即可。");
      return;
    }

    await ctx.reply(
      `请先完成验证后再开始聊天：\n${result.verificationUrl}\n\n验证通过后，机器人会把你的资料发送到群组专属话题。`
    );
  });

  bot.on("message", async (ctx) => {
    const message = ctx.message;
    if (!message || !ctx.from) {
      return;
    }

    if (message.chat.type === "private") {
      if (!isForwardableMessage(message)) {
        return;
      }

      const result = await ensureVerificationSession(ctx.from);

      if (result.status === "blacklisted") {
        await ctx.reply("你已被加入黑名单，消息不会被转发。");
        return;
      }

      if (result.status === "pending") {
        await ctx.reply(
          `请先完成验证：\n${result.verificationUrl}\n\n验证通过后，后续消息会自动转发。`
        );
        return;
      }

      await ctx.telegram.copyMessage(config.groupId, ctx.chat.id, message.message_id, {
        message_thread_id: result.user.topic_thread_id
      });
      return;
    }

    if (message.chat.id !== config.groupId) {
      return;
    }

    if (!message.message_thread_id || !isForwardableMessage(message) || ctx.from?.is_bot) {
      return;
    }

    const user = store.getUserByThreadId(message.message_thread_id);
    if (!user || user.is_blacklisted) {
      return;
    }

    await ctx.telegram.copyMessage(user.user_id, config.groupId, message.message_id);
  });

  async function createTopicForUser(userId) {
    const user = store.getUser(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    if (user.topic_thread_id) {
      return user.topic_thread_id;
    }

    const label = user.username
      ? `${user.first_name || "User"} (@${user.username})`
      : `${user.first_name || "User"} (${user.user_id})`;
    const topic = await bot.telegram.createForumTopic(config.groupId, label.slice(0, 120));

    await bot.telegram.sendMessage(config.groupId, formatUserInfo({
      id: user.user_id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      language_code: user.language_code
    }), {
      message_thread_id: topic.message_thread_id
    });

    return topic.message_thread_id;
  }

  return {
    bot,
    stop(reason) {
      return bot.stop(reason);
    },
    async completeVerification(userId, sessionId) {
      const threadId = await createTopicForUser(userId);
      const user = store.markVerified(userId, threadId, sessionId);
      await bot.telegram.sendMessage(
        userId,
        "验证已通过。现在开始发送的消息会自动转发到群组专属话题。"
      );
      return user;
    },
    async notifyBlacklist(userId, reason) {
      const user = store.getUser(userId);
      if (!user) {
        return;
      }

      await bot.telegram.sendMessage(
        config.groupId,
        [
          "用户验证失败，已加入黑名单",
          `用户ID: ${user.user_id}`,
          `用户名: ${user.username ? `@${user.username}` : "无"}`,
          `原因: ${reason}`
        ].join("\n")
      );
    }
  };
}
