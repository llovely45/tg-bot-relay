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
        <input type="hidden" name="webrtc_ip" id="webrtc_ip" value="" />
        <input type="hidden" name="fingerprint_payload" id="fingerprint_payload" value="" />
        <div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}"></div>
        <button type="submit">完成验证</button>
      </form>
      <div class="footer">如果验证失败，本次会话会被加入黑名单。</div>
    </main>
    <script>
      (function collectSignals() {
        const input = document.getElementById("webrtc_ip");
        const fingerprintInput = document.getElementById("fingerprint_payload");
        const foundIps = new Set();

        function hashText(value) {
          if (!value || !window.crypto?.subtle || !window.TextEncoder) {
            return Promise.resolve("");
          }
          return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)))
            .then((buffer) => Array.from(new Uint8Array(buffer)).map((item) => item.toString(16).padStart(2, "0")).join("").slice(0, 24))
            .catch(() => "");
        }

        function detectOs() {
          const uaPlatform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "";
          const ua = String(uaPlatform).toLowerCase() + " " + String(navigator.userAgent || "").toLowerCase();
          if (ua.includes("android")) return "Android";
          if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return "iOS";
          if (ua.includes("win")) return "Windows";
          if (ua.includes("mac")) return "macOS";
          if (ua.includes("linux")) return "Linux";
          return "未知";
        }

        function collectCpu() {
          return {
            hardwareConcurrency: navigator.hardwareConcurrency || null,
            deviceMemory: navigator.deviceMemory || null,
            maxTouchPoints: navigator.maxTouchPoints || 0
          };
        }

        function collectScreen() {
          return {
            width: window.screen?.width || null,
            height: window.screen?.height || null,
            availWidth: window.screen?.availWidth || null,
            availHeight: window.screen?.availHeight || null,
            colorDepth: window.screen?.colorDepth || null,
            pixelDepth: window.screen?.pixelDepth || null,
            pixelRatio: window.devicePixelRatio || null
          };
        }

        function collectFonts() {
          const baseFonts = ["monospace", "sans-serif", "serif"];
          const candidates = [
            "Arial", "Helvetica", "Times New Roman", "Courier New", "Verdana",
            "Georgia", "Trebuchet MS", "Comic Sans MS", "Impact", "Segoe UI",
            "PingFang SC", "Microsoft YaHei", "Noto Sans", "Roboto"
          ];
          const probeText = "mmmmmmmmmmlli";
          const probeSize = "72px";
          const body = document.body;
          if (!body) {
            return [];
          }

          const defaultWidth = {};
          const defaultHeight = {};
          const span = document.createElement("span");
          span.style.position = "absolute";
          span.style.left = "-9999px";
          span.style.fontSize = probeSize;
          span.style.visibility = "hidden";
          span.textContent = probeText;

          for (const baseFont of baseFonts) {
            span.style.fontFamily = baseFont;
            body.appendChild(span);
            defaultWidth[baseFont] = span.offsetWidth;
            defaultHeight[baseFont] = span.offsetHeight;
            body.removeChild(span);
          }

          const detected = [];
          for (const font of candidates) {
            let matched = false;
            for (const baseFont of baseFonts) {
              span.style.fontFamily = "'" + font + "'," + baseFont;
              body.appendChild(span);
              const different = span.offsetWidth !== defaultWidth[baseFont]
                || span.offsetHeight !== defaultHeight[baseFont];
              body.removeChild(span);
              if (different) {
                matched = true;
                break;
              }
            }
            if (matched) {
              detected.push(font);
            }
          }

          return detected;
        }

        async function collectCanvasHash() {
          try {
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            if (!context) {
              return "";
            }
            canvas.width = 280;
            canvas.height = 80;
            context.fillStyle = "#f60";
            context.fillRect(10, 10, 100, 40);
            context.fillStyle = "#069";
            context.font = "16px Arial";
            context.fillText("tg-bot-fingerprint", 14, 38);
            context.strokeStyle = "rgba(120, 30, 200, 0.8)";
            context.beginPath();
            context.arc(180, 36, 20, 0, Math.PI * 2);
            context.stroke();
            return await hashText(canvas.toDataURL());
          } catch {
            return "";
          }
        }

        async function collectAudioHash() {
          try {
            const OfflineAudio = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            if (!OfflineAudio) {
              return "";
            }
            const context = new OfflineAudio(1, 44100, 44100);
            const oscillator = context.createOscillator();
            const compressor = context.createDynamicsCompressor();
            oscillator.type = "triangle";
            oscillator.frequency.value = 1000;
            oscillator.connect(compressor);
            compressor.connect(context.destination);
            oscillator.start(0);
            const rendered = await context.startRendering();
            const channel = rendered.getChannelData(0).slice(0, 128);
            oscillator.disconnect();
            compressor.disconnect();
            return await hashText(Array.from(channel).join(","));
          } catch {
            return "";
          }
        }

        async function collectWebGl() {
          try {
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
            if (!context) {
              return {};
            }
            const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
            const payload = {
              vendor: debugInfo ? context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : context.getParameter(context.VENDOR),
              renderer: debugInfo ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER),
              version: context.getParameter(context.VERSION),
              shadingLanguageVersion: context.getParameter(context.SHADING_LANGUAGE_VERSION)
            };
            const hash = await hashText(JSON.stringify(payload));
            return { ...payload, hash };
          } catch {
            return {};
          }
        }

        function isIpv4(value) {
          return /^(?:\\d{1,3}\\.){3}\\d{1,3}$/.test(value);
        }

        function isIpv6(value) {
          return /^[0-9a-f:]+$/i.test(value) && value.includes(":");
        }

        function isPrivateIpv4(value) {
          const parts = value.split(".").map(Number);
          return parts[0] === 10
            || parts[0] === 127
            || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
            || (parts[0] === 192 && parts[1] === 168)
            || (parts[0] === 169 && parts[1] === 254);
        }

        function isPrivateIpv6(value) {
          const lower = value.toLowerCase();
          return lower === "::1"
            || lower.startsWith("fc")
            || lower.startsWith("fd")
            || lower.startsWith("fe80:");
        }

        function storeIp(value) {
          if (!value || value === "0.0.0.0") {
            return;
          }
          if (isIpv4(value) && !isPrivateIpv4(value)) {
            foundIps.add(value);
          }
          if (isIpv6(value) && !isPrivateIpv6(value)) {
            foundIps.add(value);
          }
          input.value = Array.from(foundIps).join(", ");
        }

        function parseCandidate(candidate) {
          if (!candidate) {
            return;
          }
          const parts = candidate.trim().split(/\\s+/);
          if (parts.length >= 5) {
            storeIp(parts[4]);
          }
        }

        function collectWebRtcIp() {
          if (!input || typeof RTCPeerConnection === "undefined") {
            return;
          }

          const peer = new RTCPeerConnection({
            iceServers: [
              { urls: "stun:stun.miwifi.com:3478" }
            ]
          });

          peer.createDataChannel("ip");
          peer.onicecandidate = (event) => {
            if (event.candidate?.address) {
              storeIp(event.candidate.address);
            }
            if (event.candidate?.candidate) {
              parseCandidate(event.candidate.candidate);
            }
          };

          peer.createOffer()
            .then((offer) => peer.setLocalDescription(offer))
            .catch(() => {});

          setTimeout(() => {
            peer.close();
          }, 3000);
        }

        async function collectFingerprint() {
          if (!fingerprintInput) {
            return;
          }

          const [canvas, webgl, audio] = await Promise.all([
            collectCanvasHash(),
            collectWebGl(),
            collectAudioHash()
          ]);

          fingerprintInput.value = JSON.stringify({
            os: detectOs(),
            cpu: collectCpu(),
            screen: collectScreen(),
            fonts: collectFonts(),
            canvas,
            webgl,
            audio,
            browser: {
              language: navigator.language || "",
              languages: Array.isArray(navigator.languages) ? navigator.languages : [],
              platform: navigator.platform || "",
              userAgent: navigator.userAgent || ""
            }
          });
        }

        collectWebRtcIp();
        collectFingerprint().catch(() => {});
      })();
    </script>
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
