import { Markup, Telegraf } from "telegraf";

function formatUserName(user) {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return fullName || user.username || `User ${user.user_id ?? user.id}`;
}

function formatUserInfo(user) {
  const username = user.username ? `@${user.username}` : "无";
  return [
    "新用户验证通过",
    `用户ID: ${user.id ?? user.user_id}`,
    `昵称: ${formatUserName(user)}`,
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

function buildVerificationText(verificationUrl) {
  return [
    "请先完成验证后再开始聊天。",
    "验证通过前，你发送的消息不会被转发。",
    "",
    `验证链接：${verificationUrl}`
  ].join("\n");
}

function verificationKeyboard(verificationUrl) {
  return Markup.inlineKeyboard([
    [Markup.button.url("打开验证页面", verificationUrl)],
    [Markup.button.callback("重新获取验证链接", "verify:refresh")]
  ]);
}

function topicAdminText(user) {
  return [
    "用户管理",
    `用户ID：${user.user_id}`,
    `昵称：${formatUserName(user)}`,
    `用户名：${user.username ? `@${user.username}` : "无"}`,
    `当前状态：${user.is_blacklisted ? "已拉黑" : user.is_verified ? "已验证" : "待验证"}`
  ].join("\n");
}

function topicAdminKeyboard(userId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("取消验证", `topicadmin:cancel:${userId}`)],
    [Markup.button.callback("拉黑", `topicadmin:ban:${userId}`)]
  ]);
}

export function createTelegramBot({ config, store }) {
  const bot = new Telegraf(config.telegramToken);

  function isExpired(isoTime) {
    return new Date(isoTime).getTime() <= Date.now();
  }

  async function isGroupAdmin(userId) {
    const member = await bot.telegram.getChatMember(config.groupId, userId);
    return member.status === "creator" || member.status === "administrator";
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

  async function replyVerificationPrompt(ctx, verificationUrl) {
    await ctx.reply(
      buildVerificationText(verificationUrl),
      verificationKeyboard(verificationUrl)
    );
  }

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

    await bot.telegram.sendMessage(
      config.groupId,
      formatUserInfo({
        id: user.user_id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        language_code: user.language_code
      }),
      {
        message_thread_id: topic.message_thread_id
      }
    );

    return topic.message_thread_id;
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

    await replyVerificationPrompt(ctx, result.verificationUrl);
  });

  bot.command("admin", async (ctx) => {
    if (ctx.chat.id !== config.groupId || !ctx.message?.message_thread_id) {
      return;
    }

    if (!(await isGroupAdmin(ctx.from.id))) {
      await ctx.reply("你没有管理员权限。", {
        message_thread_id: ctx.message.message_thread_id
      });
      return;
    }

    const user = store.getUserByThreadId(ctx.message.message_thread_id);
    if (!user) {
      await ctx.reply("当前话题没有绑定用户。", {
        message_thread_id: ctx.message.message_thread_id
      });
      return;
    }

    await ctx.reply(
      topicAdminText(user),
      {
        message_thread_id: ctx.message.message_thread_id,
        ...topicAdminKeyboard(user.user_id)
      }
    );
  });

  bot.action("verify:refresh", async (ctx) => {
    const result = await ensureVerificationSession(ctx.from);
    if (result.status !== "pending") {
      await ctx.answerCbQuery("当前无需重新验证");
      return;
    }

    await ctx.editMessageText(
      buildVerificationText(result.verificationUrl),
      verificationKeyboard(result.verificationUrl)
    );
    await ctx.answerCbQuery("验证链接已刷新");
  });

  bot.action(/^topicadmin:(cancel|ban):(\d+)$/, async (ctx) => {
    if (ctx.chat?.id !== config.groupId || !ctx.callbackQuery.message?.message_thread_id) {
      await ctx.answerCbQuery("只能在群话题中使用");
      return;
    }

    if (!(await isGroupAdmin(ctx.from.id))) {
      await ctx.answerCbQuery("无权限");
      return;
    }

    const [, action, userIdRaw] = ctx.match;
    const userId = Number(userIdRaw);
    const topicUser = store.getUserByThreadId(ctx.callbackQuery.message.message_thread_id);
    if (!topicUser || topicUser.user_id !== userId) {
      await ctx.answerCbQuery("话题用户不匹配");
      return;
    }

    if (action === "cancel") {
      store.cancelVerification(userId);
      await bot.telegram.sendMessage(
        userId,
        "管理员已取消你的验证状态。重新完成验证前，你发送的消息不会被转发。"
      );
      await ctx.answerCbQuery("已取消验证");
    }

    if (action === "ban") {
      store.blacklistUserDirect(userId);
      await bot.telegram.sendMessage(
        userId,
        "管理员已将你加入黑名单，后续消息不会被转发。"
      );
      await ctx.answerCbQuery("已拉黑");
    }

    const updatedUser = store.getUser(userId);
    await ctx.editMessageText(
      topicAdminText(updatedUser),
      topicAdminKeyboard(updatedUser.user_id)
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
        await replyVerificationPrompt(ctx, result.verificationUrl);
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
