import crypto from "node:crypto";

function normalizeString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function stableObject(value) {
  if (Array.isArray(value)) {
    return value.map(stableObject);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce((accumulator, key) => {
      accumulator[key] = stableObject(value[key]);
      return accumulator;
    }, {});
}

function normalizeIpInfo(info) {
  if (!info) {
    return {
      ip: "",
      asn: "",
      organization: ""
    };
  }

  return {
    ip: normalizeString(info.ip),
    asn: normalizeString(info.asn),
    organization: normalizeString(info.organization)
  };
}

function normalizeFingerprintDetails(fingerprint = {}, system = "") {
  return {
    os: normalizeString(fingerprint.os || system),
    cpu: normalizeObject(fingerprint.cpu),
    screen: normalizeObject(fingerprint.screen),
    fonts: Array.isArray(fingerprint.fonts) ? fingerprint.fonts.map(normalizeString).filter(Boolean) : [],
    canvas: normalizeString(fingerprint.canvas),
    webgl: normalizeObject(fingerprint.webgl),
    audio: normalizeString(fingerprint.audio),
    browser: normalizeObject(fingerprint.browser)
  };
}

function compareStrings(left, right) {
  if (!left || !right) {
    return 0;
  }
  return normalizeString(left) === normalizeString(right) ? 1 : 0;
}

function compareNumberLike(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return 0;
  }
  return Number(left) === Number(right) ? 1 : 0;
}

function compareObjectKeys(left, right, keys) {
  const comparisons = keys.map((key) => compareNumberLike(left?.[key], right?.[key]));
  if (comparisons.length === 0) {
    return 0;
  }
  return comparisons.reduce((sum, value) => sum + value, 0) / comparisons.length;
}

function compareFonts(left = [], right = []) {
  const a = new Set(left.map(normalizeString).filter(Boolean));
  const b = new Set(right.map(normalizeString).filter(Boolean));
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) {
      intersection += 1;
    }
  }
  const union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
}

function compareWebGl(left = {}, right = {}) {
  if (!left || !right) {
    return 0;
  }
  const parts = [
    compareStrings(left.hash, right.hash),
    compareStrings(left.vendor, right.vendor),
    compareStrings(left.renderer, right.renderer)
  ];
  return parts.reduce((sum, value) => sum + value, 0) / parts.length;
}

function compareCpu(left = {}, right = {}) {
  return compareObjectKeys(left, right, [
    "hardwareConcurrency",
    "deviceMemory",
    "maxTouchPoints"
  ]);
}

function compareScreen(left = {}, right = {}) {
  return compareObjectKeys(left, right, [
    "width",
    "height",
    "availWidth",
    "availHeight",
    "colorDepth",
    "pixelDepth",
    "pixelRatio"
  ]);
}

function weightedAverage(parts) {
  const totalWeight = parts.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0) {
    return 0;
  }
  return Math.round((parts.reduce((sum, item) => sum + (item.weight * item.value), 0) / totalWeight) * 100);
}

function isIpv4(ip) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip);
}

function subnetSimilarity(left, right) {
  if (!isIpv4(left) || !isIpv4(right)) {
    return compareStrings(left, right);
  }
  const a = left.split(".");
  const b = right.split(".");
  if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]) {
    return 1;
  }
  if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) {
    return 0.8;
  }
  if (a[0] === b[0] && a[1] === b[1]) {
    return 0.5;
  }
  if (a[0] === b[0]) {
    return 0.2;
  }
  return 0;
}

function subnetLabel(left, right) {
  if (!isIpv4(left) || !isIpv4(right)) {
    return compareStrings(left, right) ? "相同" : "";
  }
  const a = left.split(".");
  const b = right.split(".");
  if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]) {
    return "相同";
  }
  if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) {
    return "同C段";
  }
  if (a[0] === b[0] && a[1] === b[1]) {
    return "同B段";
  }
  if (a[0] === b[0]) {
    return "同A段";
  }
  return "";
}

function similarityStatus(score) {
  if (score >= 1) {
    return "相同";
  }
  if (score > 0) {
    return "部分相似";
  }
  return "";
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildSimilarityDetails(currentMeta, labeledMeta) {
  const currentWebrtc = currentMeta.webrtcIpInfos?.[0] || {};
  const labeledWebrtc = labeledMeta.webrtcIpInfos?.[0] || {};
  const details = [];

  const fields = [
    {
      key: "webrtc_ip",
      label: "webrtc ip",
      score: subnetSimilarity(currentWebrtc.ip, labeledWebrtc.ip),
      status: subnetLabel(currentWebrtc.ip, labeledWebrtc.ip),
      value: currentWebrtc.ip || ""
    },
    {
      key: "webrtc_asn",
      label: "webrtc asn",
      score: compareStrings(currentWebrtc.asn, labeledWebrtc.asn),
      status: similarityStatus(compareStrings(currentWebrtc.asn, labeledWebrtc.asn)),
      value: currentWebrtc.asn || ""
    },
    {
      key: "webrtc_isp",
      label: "webrtc isp",
      score: compareStrings(currentWebrtc.organization, labeledWebrtc.organization),
      status: similarityStatus(compareStrings(currentWebrtc.organization, labeledWebrtc.organization)),
      value: currentWebrtc.organization || ""
    },
    {
      key: "public_ip",
      label: "公网 ip",
      score: subnetSimilarity(currentMeta.publicIpInfo?.ip, labeledMeta.publicIpInfo?.ip),
      status: subnetLabel(currentMeta.publicIpInfo?.ip, labeledMeta.publicIpInfo?.ip),
      value: currentMeta.publicIpInfo?.ip || ""
    },
    {
      key: "public_asn",
      label: "公网 asn",
      score: compareStrings(currentMeta.publicIpInfo?.asn, labeledMeta.publicIpInfo?.asn),
      status: similarityStatus(compareStrings(currentMeta.publicIpInfo?.asn, labeledMeta.publicIpInfo?.asn)),
      value: currentMeta.publicIpInfo?.asn || ""
    },
    {
      key: "public_isp",
      label: "公网 isp",
      score: compareStrings(currentMeta.publicIpInfo?.organization, labeledMeta.publicIpInfo?.organization),
      status: similarityStatus(compareStrings(currentMeta.publicIpInfo?.organization, labeledMeta.publicIpInfo?.organization)),
      value: currentMeta.publicIpInfo?.organization || ""
    },
    {
      key: "canvas",
      label: "canvas指纹",
      score: compareStrings(currentMeta.details?.canvas, labeledMeta.details?.canvas),
      status: similarityStatus(compareStrings(currentMeta.details?.canvas, labeledMeta.details?.canvas)),
      value: currentMeta.details?.canvas || ""
    },
    {
      key: "webgl",
      label: "webgl指纹",
      score: compareWebGl(currentMeta.details?.webgl, labeledMeta.details?.webgl),
      status: similarityStatus(compareWebGl(currentMeta.details?.webgl, labeledMeta.details?.webgl)),
      value: currentMeta.details?.webgl?.hash || ""
    },
    {
      key: "audio",
      label: "audio指纹",
      score: compareStrings(currentMeta.details?.audio, labeledMeta.details?.audio),
      status: similarityStatus(compareStrings(currentMeta.details?.audio, labeledMeta.details?.audio)),
      value: currentMeta.details?.audio || ""
    },
    {
      key: "os",
      label: "系统",
      score: compareStrings(currentMeta.details?.os, labeledMeta.details?.os),
      status: similarityStatus(compareStrings(currentMeta.details?.os, labeledMeta.details?.os)),
      value: currentMeta.details?.os || ""
    },
    {
      key: "cpu",
      label: "cpu",
      score: compareCpu(currentMeta.details?.cpu, labeledMeta.details?.cpu),
      status: similarityStatus(compareCpu(currentMeta.details?.cpu, labeledMeta.details?.cpu)),
      value: JSON.stringify(currentMeta.details?.cpu || {})
    },
    {
      key: "screen",
      label: "screen",
      score: compareScreen(currentMeta.details?.screen, labeledMeta.details?.screen),
      status: similarityStatus(compareScreen(currentMeta.details?.screen, labeledMeta.details?.screen)),
      value: JSON.stringify(currentMeta.details?.screen || {})
    },
    {
      key: "fonts",
      label: "fonts",
      score: compareFonts(currentMeta.details?.fonts, labeledMeta.details?.fonts),
      status: similarityStatus(compareFonts(currentMeta.details?.fonts, labeledMeta.details?.fonts)),
      value: (currentMeta.details?.fonts || []).join(", ")
    }
  ];

  for (const field of fields) {
    if (field.score > 0) {
      details.push(field);
    }
  }
  return details;
}

export function parseFingerprintPayload(rawPayload) {
  if (!rawPayload) {
    return {};
  }

  try {
    const parsed = JSON.parse(String(rawPayload));
    return normalizeFingerprintDetails(parsed);
  } catch {
    return {};
  }
}

export function buildFingerprintMeta({
  system,
  publicIpInfo,
  webrtcIpInfos = [],
  fingerprint = {}
}) {
  const details = normalizeFingerprintDetails(fingerprint, system);
  const normalizedPublicIpInfo = normalizeIpInfo(publicIpInfo);
  const normalizedWebrtcIpInfos = webrtcIpInfos.map(normalizeIpInfo);

  const fingerprintSource = stableObject({
    publicIpInfo: normalizedPublicIpInfo,
    webrtcIpInfos: normalizedWebrtcIpInfos,
    details
  });

  return {
    id: crypto
      .createHash("sha256")
      .update(JSON.stringify(fingerprintSource))
      .digest("hex")
      .slice(0, 24),
    publicIpInfo: normalizedPublicIpInfo,
    webrtcIpInfos: normalizedWebrtcIpInfos,
    details
  };
}

export function serializeFingerprintMeta(meta = {}) {
  return JSON.stringify({
    id: normalizeString(meta.id),
    publicIpInfo: normalizeIpInfo(meta.publicIpInfo),
    webrtcIpInfos: Array.isArray(meta.webrtcIpInfos) ? meta.webrtcIpInfos.map(normalizeIpInfo) : [],
    details: normalizeFingerprintDetails(meta.details)
  });
}

export function parseStoredFingerprintMeta(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(String(rawValue));
    return {
      id: normalizeString(parsed.id),
      publicIpInfo: normalizeIpInfo(parsed.publicIpInfo),
      webrtcIpInfos: Array.isArray(parsed.webrtcIpInfos) ? parsed.webrtcIpInfos.map(normalizeIpInfo) : [],
      details: normalizeFingerprintDetails(parsed.details)
    };
  } catch {
    return null;
  }
}

export function computeFingerprintSimilarity(currentMeta, labeledMeta) {
  if (!currentMeta || !labeledMeta) {
    return 0;
  }

  const currentWebrtc = currentMeta.webrtcIpInfos?.[0] || {};
  const labeledWebrtc = labeledMeta.webrtcIpInfos?.[0] || {};

  const networkScore = weightedAverage([
    { weight: 40, value: subnetSimilarity(currentMeta.publicIpInfo?.ip, labeledMeta.publicIpInfo?.ip) },
    { weight: 10, value: compareStrings(currentMeta.publicIpInfo?.asn, labeledMeta.publicIpInfo?.asn) },
    { weight: 10, value: compareStrings(currentMeta.publicIpInfo?.organization, labeledMeta.publicIpInfo?.organization) },
    { weight: 20, value: subnetSimilarity(currentWebrtc.ip, labeledWebrtc.ip) },
    { weight: 10, value: compareStrings(currentWebrtc.asn, labeledWebrtc.asn) },
    { weight: 10, value: compareStrings(currentWebrtc.organization, labeledWebrtc.organization) }
  ]);

  const deviceScore = weightedAverage([
    { weight: 25, value: compareStrings(currentMeta.details?.canvas, labeledMeta.details?.canvas) },
    { weight: 20, value: compareWebGl(currentMeta.details?.webgl, labeledMeta.details?.webgl) },
    { weight: 15, value: compareStrings(currentMeta.details?.audio, labeledMeta.details?.audio) },
    { weight: 10, value: compareStrings(currentMeta.details?.os, labeledMeta.details?.os) },
    { weight: 10, value: compareCpu(currentMeta.details?.cpu, labeledMeta.details?.cpu) },
    { weight: 10, value: compareScreen(currentMeta.details?.screen, labeledMeta.details?.screen) },
    { weight: 10, value: compareFonts(currentMeta.details?.fonts, labeledMeta.details?.fonts) }
  ]);

  const blendedScore = Math.round((networkScore * 0.4) + (deviceScore * 0.6));
  return Math.max(networkScore, deviceScore, blendedScore);
}

export function computeFingerprintMatch(currentMeta, labeledMeta) {
  return {
    similarity: computeFingerprintSimilarity(currentMeta, labeledMeta),
    fields: buildSimilarityDetails(currentMeta, labeledMeta)
  };
}

export function findSimilarFingerprintLabels(currentMeta, labels = [], threshold = 60) {
  return labels
    .map((label) => {
      const match = computeFingerprintMatch(currentMeta, label.fingerprint_meta);
      return {
        ...label,
        similarity: match.similarity,
        matched_fields: match.fields
      };
    })
    .filter((label) => label.similarity >= threshold)
    .sort((left, right) => right.similarity - left.similarity);
}

export function listFingerprintFieldValues(meta = {}) {
  return uniqueBy([
    { key: "fingerprint_id", label: "指纹key", value: meta.id || "" },
    { key: "public_ip", label: "公网 ip", value: meta.publicIpInfo?.ip || "" },
    { key: "public_asn", label: "公网 asn", value: meta.publicIpInfo?.asn || "" },
    { key: "public_isp", label: "公网 isp", value: meta.publicIpInfo?.organization || "" },
    { key: "webrtc_ip", label: "webrtc ip", value: meta.webrtcIpInfos?.[0]?.ip || "" },
    { key: "webrtc_asn", label: "webrtc asn", value: meta.webrtcIpInfos?.[0]?.asn || "" },
    { key: "webrtc_isp", label: "webrtc isp", value: meta.webrtcIpInfos?.[0]?.organization || "" },
    { key: "canvas", label: "canvas指纹", value: meta.details?.canvas || "" },
    { key: "webgl", label: "webgl指纹", value: meta.details?.webgl?.hash || "" },
    { key: "audio", label: "audio指纹", value: meta.details?.audio || "" },
    { key: "os", label: "系统", value: meta.details?.os || "" },
    { key: "cpu", label: "cpu", value: JSON.stringify(meta.details?.cpu || {}) },
    { key: "screen", label: "screen", value: JSON.stringify(meta.details?.screen || {}) },
    { key: "fonts", label: "fonts", value: (meta.details?.fonts || []).join(", ") }
  ].filter((item) => item.value), (item) => item.key);
}
