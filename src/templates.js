function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderVerificationPage({ siteKey, sessionId, errorMessage = "" }) {
  const safeError = escapeHtml(errorMessage);
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>身份验证</title>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe7;
        --panel: #fff9f0;
        --ink: #1e1a16;
        --accent: #d26a2f;
        --accent-dark: #9f4719;
        --line: #e6d4bf;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Segoe UI", "PingFang SC", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, #ffe5c8 0, transparent 32%),
          radial-gradient(circle at bottom right, #ffd7b5 0, transparent 28%),
          var(--bg);
        display: grid;
        place-items: center;
        padding: 20px;
      }
      .card {
        width: min(100%, 460px);
        background: rgba(255, 249, 240, 0.92);
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 22px 70px rgba(76, 44, 19, 0.12);
        backdrop-filter: blur(8px);
      }
      h1 {
        margin: 0 0 10px;
        font-size: 28px;
      }
      p {
        margin: 0 0 18px;
        line-height: 1.6;
      }
      .error {
        padding: 12px 14px;
        border-radius: 14px;
        background: #fff0eb;
        color: #a13d17;
        border: 1px solid #f2c1af;
        margin-bottom: 16px;
      }
      button {
        width: 100%;
        margin-top: 18px;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, var(--accent), var(--accent-dark));
        color: white;
        font-size: 16px;
        padding: 14px 18px;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .footer {
        margin-top: 14px;
        font-size: 13px;
        opacity: 0.8;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>继续聊天前需要验证</h1>
      <p>此页面使用 Cloudflare Turnstile 进行人机验证。验证通过后，机器人会为你建立独立话题并转发后续消息。</p>
      ${safeError ? `<div class="error">${safeError}</div>` : ""}
      <form method="post" action="/api/verify/${sessionId}">
        <div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}"></div>
        <button type="submit">完成验证</button>
      </form>
      <div class="footer">如果验证失败，本次会话会被加入黑名单。</div>
    </main>
  </body>
</html>`;
}

export function renderResultPage({ title, description }) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 20px;
        background: #f7f1ea;
        color: #241a11;
        font-family: "Segoe UI", "PingFang SC", sans-serif;
      }
      .box {
        width: min(100%, 440px);
        padding: 28px;
        border-radius: 24px;
        background: white;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.08);
      }
      h1 { margin: 0 0 12px; }
      p { margin: 0; line-height: 1.6; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
    </div>
  </body>
</html>`;
}
