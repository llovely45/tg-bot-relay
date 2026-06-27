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

function buildVerificationText() {
  return [
    "请先完成验证后再开始聊天。",
    "验证通过前，你发送的消息不会被转发。"
  ].join("\n");
}

function verificationKeyboard(verificationUrl) {
  return Markup.inlineKeyboard([
    [Markup.button.url("打开验证页面", verificationUrl)]
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
  return topicAdminKeyboardForUser({
    user_id: userId,
    is_verified: false,
    is_blacklisted: false
  });
}

function topicAdminKeyboardForUser(user) {
  const verifyButton = user.is_verified
    ? Markup.button.callback("取消验证", `topicadmin:cancel:${user.user_id}`)
    : Markup.button.callback("通过验证", `topicadmin:approve:${user.user_id}`);
  const blacklistButton = user.is_blacklisted
    ? Markup.button.callback("取消拉黑", `topicadmin:unban:${user.user_id}`)
    : Markup.button.callback("拉黑", `topicadmin:ban:${user.user_id}`);

  return Markup.inlineKeyboard([
    [verifyButton],
    [blacklistButton],
    [Markup.button.callback("获取用户名", `topicadmin:username:${user.user_id}`)]
  ]);
}

export function createTelegramBot({ config, store }) {
  const bot = new Telegraf(config.telegramToken);

  function isThreadNotFoundError(error) {
    return error?.response?.description === "Bad Request: message thread not found";
  }

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
    const user = store.getUser(ctx.from.id);
    if (user?.verification_prompt_chat_id && user?.verification_prompt_message_id) {
      try {
        await ctx.telegram.deleteMessage(
          user.verification_prompt_chat_id,
          user.verification_prompt_message_id
        );
      } catch {}
    }

    const sentMessage = await ctx.reply(
      buildVerificationText(),
      verificationKeyboard(verificationUrl)
    );
    store.setVerificationPrompt(ctx.from.id, sentMessage.chat.id, sentMessage.message_id);
  }

  async function createTopicForUser(userId, options = {}) {
    const user = store.getUser(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    if (user.topic_thread_id && !options.forceNew) {
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

    store.setTopicThreadId(userId, topic.message_thread_id);
    return topic.message_thread_id;
  }

  async function forwardPrivateMessageToTopic(ctx, user, messageId) {
    try {
      await ctx.telegram.copyMessage(config.groupId, ctx.chat.id, messageId, {
        message_thread_id: user.topic_thread_id
      });
    } catch (error) {
      if (!isThreadNotFoundError(error)) {
        throw error;
      }

      const threadId = await createTopicForUser(user.user_id, { forceNew: true });
      await ctx.telegram.copyMessage(config.groupId, ctx.chat.id, messageId, {
        message_thread_id: threadId
      });
    }
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
        ...topicAdminKeyboardForUser(user)
      }
    );
  });

  bot.action(/^topicadmin:(approve|cancel|ban|unban|username):(\d+)$/, async (ctx) => {
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

    if (action === "approve") {
      store.approveUser(userId);
      await bot.telegram.sendMessage(
        userId,
        "管理员已为你通过验证。你现在发送的消息会转发到原话题。"
      );
      await ctx.answerCbQuery("已通过验证");
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

    if (action === "unban") {
      store.clearBlacklist(userId);
      await bot.telegram.sendMessage(
        userId,
        "管理员已取消你的拉黑状态。"
      );
      await ctx.answerCbQuery("已取消拉黑");
    }

    if (action === "username") {
      const username = topicUser.username ? `@${topicUser.username}` : "无";
      await ctx.answerCbQuery(`用户名：${username}`, { show_alert: true });
      return;
    }

    await ctx.deleteMessage();
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

      await forwardPrivateMessageToTopic(ctx, result.user, message.message_id);
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
      const existingUser = store.getUser(userId);
      if (existingUser?.verification_prompt_chat_id && existingUser?.verification_prompt_message_id) {
        try {
          await bot.telegram.deleteMessage(
            existingUser.verification_prompt_chat_id,
            existingUser.verification_prompt_message_id
          );
        } catch {}
      }

      const threadId = await createTopicForUser(userId);
      const user = store.markVerified(userId, threadId, sessionId);
      await bot.telegram.sendMessage(
        userId,
        "验证已通过。"
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
