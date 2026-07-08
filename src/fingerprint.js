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
    { weight: 40, value: compareStrings(currentMeta.publicIpInfo?.ip, labeledMeta.publicIpInfo?.ip) },
    { weight: 10, value: compareStrings(currentMeta.publicIpInfo?.asn, labeledMeta.publicIpInfo?.asn) },
    { weight: 10, value: compareStrings(currentMeta.publicIpInfo?.organization, labeledMeta.publicIpInfo?.organization) },
    { weight: 20, value: compareStrings(currentWebrtc.ip, labeledWebrtc.ip) },
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

export function findSimilarFingerprintLabels(currentMeta, labels = [], threshold = 60) {
  return labels
    .map((label) => ({
      ...label,
      similarity: computeFingerprintSimilarity(currentMeta, label.fingerprint_meta)
    }))
    .filter((label) => label.similarity >= threshold)
    .sort((left, right) => right.similarity - left.similarity);
}
