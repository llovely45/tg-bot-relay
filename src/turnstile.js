export async function verifyTurnstileToken({ secretKey, token, remoteIp }) {
  const formData = new URLSearchParams();
  formData.set("secret", secretKey);
  formData.set("response", token);
  if (remoteIp) {
    formData.set("remoteip", remoteIp);
  }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Turnstile verify request failed with status ${response.status}`);
  }

  return response.json();
}
