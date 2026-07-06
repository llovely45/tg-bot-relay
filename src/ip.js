import { resolveTxt } from "node:dns/promises";

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

function buildCymruOriginLookup(ip) {
  if (isIpv4(ip)) {
    return {
      host: `${ip.split(".").reverse().join(".")}.origin.asn.cymru.com`,
      family: "ipv4"
    };
  }

  if (isIpv6(ip)) {
    const segments = ip.toLowerCase().split("::");
    const left = segments[0] ? segments[0].split(":").filter(Boolean) : [];
    const right = segments[1] ? segments[1].split(":").filter(Boolean) : [];
    const missing = 8 - (left.length + right.length);
    const expanded = [
      ...left,
      ...Array.from({ length: Math.max(missing, 0) }, () => "0"),
      ...right
    ].map((part) => part.padStart(4, "0"));

    return {
      host: `${expanded.join("").split("").reverse().join(".")}.origin6.asn.cymru.com`,
      family: "ipv6"
    };
  }

  return null;
}

function flattenTxtRecords(records) {
  return records.map((parts) => parts.join("")).filter(Boolean);
}

function parseOriginResponse(value) {
  const [asn = ""] = value.split("|").map((item) => item.trim());
  return asn;
}

function parseAsnResponse(value) {
  const parts = value.split("|").map((item) => item.trim());
  return {
    asn: parts[0] || "",
    organization: parts[4] || ""
  };
}

export async function lookupIpMetadata(ip) {
  if (!isPublicIp(ip)) {
    return null;
  }

  try {
    const lookup = buildCymruOriginLookup(ip);
    if (!lookup) {
      return null;
    }

    const originRecords = flattenTxtRecords(await resolveTxt(lookup.host));
    const asn = parseOriginResponse(originRecords[0] || "");
    if (!asn) {
      return { ip, asn: "", organization: "" };
    }

    const asnRecords = flattenTxtRecords(await resolveTxt(`AS${asn}.asn.cymru.com`));
    const info = parseAsnResponse(asnRecords[0] || "");
    return {
      ip,
      asn: info.asn || asn,
      organization: info.organization || ""
    };
  } catch {
    return {
      ip,
      asn: "",
      organization: ""
    };
  }
}
