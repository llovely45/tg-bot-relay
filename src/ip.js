function isIpv4(ip) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip);
}

function isIpv6(ip) {
  return /^[0-9a-f:]+$/i.test(ip) && ip.includes(":");
}

function isPrivateIpv4(ip) {
  const [a, b] = ip.split(".").map(Number);
  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254);
}

function isPrivateIpv6(ip) {
  const lower = ip.toLowerCase();
  return lower === "::1"
    || lower.startsWith("fc")
    || lower.startsWith("fd")
    || lower.startsWith("fe80:");
}

export function isPublicIp(ip) {
  if (!ip) {
    return false;
  }
  if (isIpv4(ip)) {
    return !isPrivateIpv4(ip) && ip !== "0.0.0.0";
  }
  if (isIpv6(ip)) {
    return !isPrivateIpv6(ip);
  }
  return false;
}

export function normalizePublicIpList(value) {
  return Array.from(new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => isPublicIp(item))
  ));
}

export async function lookupIpMetadata(ip) {
  if (!isPublicIp(ip)) {
    return null;
  }

  const response = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    return {
      ip,
      asn: "",
      organization: ""
    };
  }

  const data = await response.json();
  return {
    ip,
    asn: data.asn || "",
    organization: data.org || data.org_name || ""
  };
}
