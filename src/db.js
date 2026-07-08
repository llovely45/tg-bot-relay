import crypto from "node:crypto";
import Database from "better-sqlite3";
import { parseStoredFingerprintMeta, serializeFingerprintMeta } from "./fingerprint.js";

export function createDb(sqlitePath) {
  const db = new Database(sqlitePath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      language_code TEXT,
      is_verified INTEGER NOT NULL DEFAULT 0,
      is_blacklisted INTEGER NOT NULL DEFAULT 0,
      topic_thread_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_topic_thread_id
      ON users(topic_thread_id)
      WHERE topic_thread_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS verification_sessions (
      session_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      fail_reason TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_verification_user_id
      ON verification_sessions(user_id);

    CREATE TABLE IF NOT EXISTS fingerprint_labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label_name TEXT NOT NULL,
      note TEXT,
      fingerprint_id TEXT NOT NULL,
      fingerprint_payload TEXT NOT NULL,
      source_user_id INTEGER NOT NULL,
      created_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  for (const statement of [
    "ALTER TABLE users ADD COLUMN verification_prompt_chat_id INTEGER",
    "ALTER TABLE users ADD COLUMN verification_prompt_message_id INTEGER",
    "ALTER TABLE users ADD COLUMN latest_fingerprint_id TEXT",
    "ALTER TABLE users ADD COLUMN latest_fingerprint_payload TEXT",
    "ALTER TABLE users ADD COLUMN latest_fingerprint_at TEXT"
  ]) {
    try {
      db.exec(statement);
    } catch (error) {
      if (!String(error.message).includes("duplicate column name")) {
        throw error;
      }
    }
  }

  const statements = {
    upsertUser: db.prepare(`
      INSERT INTO users (
        user_id, username, first_name, last_name, language_code,
        is_verified, is_blacklisted, created_at, updated_at
      ) VALUES (
        @user_id, @username, @first_name, @last_name, @language_code,
        COALESCE(@is_verified, 0), COALESCE(@is_blacklisted, 0), @timestamp, @timestamp
      )
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        language_code = excluded.language_code,
        updated_at = excluded.updated_at
    `),
    getUser: db.prepare("SELECT * FROM users WHERE user_id = ?"),
    getUserByThreadId: db.prepare("SELECT * FROM users WHERE topic_thread_id = ?"),
    setTopicThreadId: db.prepare(`
      UPDATE users
      SET topic_thread_id = ?, updated_at = ?
      WHERE user_id = ?
    `),
    setVerificationPrompt: db.prepare(`
      UPDATE users
      SET verification_prompt_chat_id = ?, verification_prompt_message_id = ?, updated_at = ?
      WHERE user_id = ?
    `),
    clearVerificationPrompt: db.prepare(`
      UPDATE users
      SET verification_prompt_chat_id = NULL, verification_prompt_message_id = NULL, updated_at = ?
      WHERE user_id = ?
    `),
    setLatestFingerprint: db.prepare(`
      UPDATE users
      SET latest_fingerprint_id = ?, latest_fingerprint_payload = ?, latest_fingerprint_at = ?, updated_at = ?
      WHERE user_id = ?
    `),
    verifyUser: db.prepare(`
      UPDATE users
      SET is_verified = 1, is_blacklisted = 0, topic_thread_id = ?, verification_prompt_chat_id = NULL, verification_prompt_message_id = NULL, updated_at = ?
      WHERE user_id = ?
    `),
    approveUser: db.prepare(`
      UPDATE users
      SET is_verified = 1, is_blacklisted = 0, verification_prompt_chat_id = NULL, verification_prompt_message_id = NULL, updated_at = ?
      WHERE user_id = ?
    `),
    cancelVerification: db.prepare(`
      UPDATE users
      SET is_verified = 0, updated_at = ?
      WHERE user_id = ?
    `),
    blacklistUser: db.prepare(`
      UPDATE users
      SET is_blacklisted = 1, updated_at = ?
      WHERE user_id = ?
    `),
    clearBlacklist: db.prepare(`
      UPDATE users
      SET is_blacklisted = 0, updated_at = ?
      WHERE user_id = ?
    `),
    getUsersByState: db.prepare(`
      SELECT *
      FROM users
      WHERE
        CASE
          WHEN ? = 'pending' THEN is_verified = 0 AND is_blacklisted = 0
          WHEN ? = 'verified' THEN is_verified = 1
          WHEN ? = 'blacklisted' THEN is_blacklisted = 1
        END
      ORDER BY updated_at DESC
      LIMIT ?
    `),
    getDashboardCounts: db.prepare(`
      SELECT
        SUM(CASE WHEN is_verified = 0 AND is_blacklisted = 0 THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) AS verified_count,
        SUM(CASE WHEN is_blacklisted = 1 THEN 1 ELSE 0 END) AS blacklisted_count
      FROM users
    `),
    createSession: db.prepare(`
      INSERT INTO verification_sessions (
        session_id, user_id, status, created_at, expires_at
      ) VALUES (
        @session_id, @user_id, 'pending', @created_at, @expires_at
      )
    `),
    getSession: db.prepare(`
      SELECT vs.*, u.username, u.first_name, u.last_name, u.language_code, u.is_verified, u.is_blacklisted, u.topic_thread_id
      FROM verification_sessions vs
      JOIN users u ON u.user_id = vs.user_id
      WHERE vs.session_id = ?
    `),
    getLatestPendingSessionForUser: db.prepare(`
      SELECT * FROM verification_sessions
      WHERE user_id = ? AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `),
    markSessionPassed: db.prepare(`
      UPDATE verification_sessions
      SET status = 'passed', consumed_at = ?
      WHERE session_id = ?
    `),
    markSessionFailed: db.prepare(`
      UPDATE verification_sessions
      SET status = 'failed', fail_reason = ?, consumed_at = ?
      WHERE session_id = ?
    `),
    createFingerprintLabel: db.prepare(`
      INSERT INTO fingerprint_labels (
        label_name, note, fingerprint_id, fingerprint_payload, source_user_id, created_by_user_id, created_at
      ) VALUES (
        @label_name, @note, @fingerprint_id, @fingerprint_payload, @source_user_id, @created_by_user_id, @created_at
      )
    `),
    listFingerprintLabels: db.prepare(`
      SELECT *
      FROM fingerprint_labels
      ORDER BY created_at DESC
    `),
    getFingerprintLabelsByUserId: db.prepare(`
      SELECT *
      FROM fingerprint_labels
      WHERE source_user_id = ?
      ORDER BY created_at DESC
    `)
  };

  function hydrateUser(user) {
    if (!user) {
      return user;
    }
    return {
      ...user,
      latest_fingerprint_meta: parseStoredFingerprintMeta(user.latest_fingerprint_payload)
    };
  }

  function hydrateFingerprintLabel(label) {
    return {
      ...label,
      fingerprint_meta: parseStoredFingerprintMeta(label.fingerprint_payload)
    };
  }

  return {
    upsertTelegramUser(telegramUser) {
      const timestamp = new Date().toISOString();
      statements.upsertUser.run({
        user_id: telegramUser.id,
        username: telegramUser.username ?? null,
        first_name: telegramUser.first_name ?? "",
        last_name: telegramUser.last_name ?? null,
        language_code: telegramUser.language_code ?? null,
        is_verified: 0,
        is_blacklisted: 0,
        timestamp
      });
      return hydrateUser(statements.getUser.get(telegramUser.id));
    },

    getUser(userId) {
      return hydrateUser(statements.getUser.get(userId));
    },

    getUserByThreadId(threadId) {
      return hydrateUser(statements.getUserByThreadId.get(threadId));
    },

    setTopicThreadId(userId, threadId) {
      const now = new Date().toISOString();
      statements.setTopicThreadId.run(threadId, now, userId);
      return hydrateUser(statements.getUser.get(userId));
    },

    setVerificationPrompt(userId, chatId, messageId) {
      const now = new Date().toISOString();
      statements.setVerificationPrompt.run(chatId, messageId, now, userId);
      return hydrateUser(statements.getUser.get(userId));
    },

    clearVerificationPrompt(userId) {
      const now = new Date().toISOString();
      statements.clearVerificationPrompt.run(now, userId);
      return hydrateUser(statements.getUser.get(userId));
    },

    setLatestFingerprint(userId, fingerprintMeta) {
      const now = new Date().toISOString();
      statements.setLatestFingerprint.run(
        fingerprintMeta?.id ?? null,
        serializeFingerprintMeta(fingerprintMeta),
        now,
        now,
        userId
      );
      return hydrateUser(statements.getUser.get(userId));
    },

    createVerificationSession(userId, ttlMinutes) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
      const sessionId = crypto.randomUUID();

      statements.createSession.run({
        session_id: sessionId,
        user_id: userId,
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString()
      });

      return statements.getSession.get(sessionId);
    },

    getLatestPendingSessionForUser(userId) {
      return statements.getLatestPendingSessionForUser.get(userId);
    },

    getSession(sessionId) {
      return statements.getSession.get(sessionId);
    },

    createFingerprintLabel({ labelName, note, fingerprintMeta, sourceUserId, createdByUserId }) {
      const now = new Date().toISOString();
      statements.createFingerprintLabel.run({
        label_name: labelName,
        note: note || null,
        fingerprint_id: fingerprintMeta.id,
        fingerprint_payload: serializeFingerprintMeta(fingerprintMeta),
        source_user_id: sourceUserId,
        created_by_user_id: createdByUserId,
        created_at: now
      });
    },

    listFingerprintLabels() {
      return statements.listFingerprintLabels.all().map(hydrateFingerprintLabel);
    },

    getFingerprintLabelsByUserId(userId) {
      return statements.getFingerprintLabelsByUserId.all(userId).map(hydrateFingerprintLabel);
    },

    getUsersByState(state, limit = 10) {
      return statements.getUsersByState.all(state, state, state, limit);
    },

    getDashboardCounts() {
      return statements.getDashboardCounts.get();
    },

    markVerified(userId, threadId, sessionId) {
      const now = new Date().toISOString();
      const tx = db.transaction(() => {
        statements.verifyUser.run(threadId, now, userId);
        statements.markSessionPassed.run(now, sessionId);
      });
      tx();
      return hydrateUser(statements.getUser.get(userId));
    },

    approveUser(userId) {
      const now = new Date().toISOString();
      statements.approveUser.run(now, userId);
      return hydrateUser(statements.getUser.get(userId));
    },

    blacklistUser(userId, sessionId, reason) {
      const now = new Date().toISOString();
      const tx = db.transaction(() => {
        statements.blacklistUser.run(now, userId);
        statements.markSessionFailed.run(reason, now, sessionId);
      });
      tx();
      return hydrateUser(statements.getUser.get(userId));
    },

    blacklistUserDirect(userId) {
      const now = new Date().toISOString();
      statements.blacklistUser.run(now, userId);
      return hydrateUser(statements.getUser.get(userId));
    },

    clearBlacklist(userId) {
      const now = new Date().toISOString();
      statements.clearBlacklist.run(now, userId);
      return hydrateUser(statements.getUser.get(userId));
    },

    cancelVerification(userId) {
      const now = new Date().toISOString();
      statements.cancelVerification.run(now, userId);
      return hydrateUser(statements.getUser.get(userId));
    }
  };
}
