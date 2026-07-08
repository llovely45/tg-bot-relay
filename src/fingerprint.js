import crypto from "node:crypto";

const VECTOR_WEIGHTS = {
  webrtc: {
    ip: 15,
    asn: 5,
    isp: 15
  },
  ip: {
    ip: 10,
    asn: 5,
    isp: 10
  },
  hardware: {
    canvas: 7,
    webgl: 7,
    audio: 6,
    os: 4,
    cpu: 4,
    screen: 6,
    fonts: 6
  }
};

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

function hasValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value && typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return Boolean(normalizeString(value));
}

function scorePart(weight, present) {
  return {
    score: present ? weight : 0,
    max: weight
  };
}

function sumScores(parts) {
  return Object.values(parts).reduce((total, item) => total + item.score, 0);
}

function sumMax(parts) {
  return Object.values(parts).reduce((total, item) => total + item.max, 0);
}

export function parseFingerprintPayload(rawPayload) {
  if (!rawPayload) {
    return {};
  }

  try {
    const parsed = JSON.parse(String(rawPayload));
    return {
      os: normalizeString(parsed.os),
      cpu: normalizeObject(parsed.cpu),
      screen: normalizeObject(parsed.screen),
      fonts: Array.isArray(parsed.fonts) ? parsed.fonts.map(normalizeString).filter(Boolean) : [],
      canvas: normalizeString(parsed.canvas),
      webgl: normalizeObject(parsed.webgl),
      audio: normalizeString(parsed.audio),
      browser: normalizeObject(parsed.browser)
    };
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
  const normalizedFingerprint = {
    os: normalizeString(fingerprint.os || system),
    cpu: normalizeObject(fingerprint.cpu),
    screen: normalizeObject(fingerprint.screen),
    fonts: Array.isArray(fingerprint.fonts) ? fingerprint.fonts.filter(Boolean) : [],
    canvas: normalizeString(fingerprint.canvas),
    webgl: normalizeObject(fingerprint.webgl),
    audio: normalizeString(fingerprint.audio),
    browser: normalizeObject(fingerprint.browser)
  };

  const firstWebrtcInfo = webrtcIpInfos[0] || null;
  const vectorAParts = {
    ip: scorePart(VECTOR_WEIGHTS.webrtc.ip, Boolean(firstWebrtcInfo?.ip)),
    asn: scorePart(VECTOR_WEIGHTS.webrtc.asn, Boolean(firstWebrtcInfo?.asn)),
    isp: scorePart(VECTOR_WEIGHTS.webrtc.isp, Boolean(firstWebrtcInfo?.organization))
  };
  const vectorBParts = {
    ip: scorePart(VECTOR_WEIGHTS.ip.ip, Boolean(publicIpInfo?.ip)),
    asn: scorePart(VECTOR_WEIGHTS.ip.asn, Boolean(publicIpInfo?.asn)),
    isp: scorePart(VECTOR_WEIGHTS.ip.isp, Boolean(publicIpInfo?.organization))
  };
  const vectorCParts = {
    canvas: scorePart(VECTOR_WEIGHTS.hardware.canvas, hasValue(normalizedFingerprint.canvas)),
    webgl: scorePart(VECTOR_WEIGHTS.hardware.webgl, hasValue(normalizedFingerprint.webgl)),
    audio: scorePart(VECTOR_WEIGHTS.hardware.audio, hasValue(normalizedFingerprint.audio)),
    os: scorePart(VECTOR_WEIGHTS.hardware.os, hasValue(normalizedFingerprint.os)),
    cpu: scorePart(VECTOR_WEIGHTS.hardware.cpu, hasValue(normalizedFingerprint.cpu)),
    screen: scorePart(VECTOR_WEIGHTS.hardware.screen, hasValue(normalizedFingerprint.screen)),
    fonts: scorePart(VECTOR_WEIGHTS.hardware.fonts, hasValue(normalizedFingerprint.fonts))
  };

  const vectors = {
    webrtc: {
      score: sumScores(vectorAParts),
      max: sumMax(vectorAParts),
      parts: vectorAParts
    },
    ip: {
      score: sumScores(vectorBParts),
      max: sumMax(vectorBParts),
      parts: vectorBParts
    },
    hardware: {
      score: sumScores(vectorCParts),
      max: sumMax(vectorCParts),
      parts: vectorCParts
    }
  };

  const score = vectors.webrtc.score + vectors.ip.score + vectors.hardware.score;
  const max = vectors.webrtc.max + vectors.ip.max + vectors.hardware.max;

  const fingerprintSource = stableObject({
    publicIp: publicIpInfo?.ip || "",
    publicAsn: publicIpInfo?.asn || "",
    publicOrg: publicIpInfo?.organization || "",
    webrtc: webrtcIpInfos.map((item) => ({
      ip: item.ip || "",
      asn: item.asn || "",
      organization: item.organization || ""
    })),
    fingerprint: normalizedFingerprint
  });

  return {
    id: crypto
      .createHash("sha256")
      .update(JSON.stringify(fingerprintSource))
      .digest("hex")
      .slice(0, 24),
    score,
    max,
    vectors,
    details: normalizedFingerprint
  };
}
