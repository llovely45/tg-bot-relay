import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import JavaScriptObfuscator from "javascript-obfuscator";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const bundlePath = path.join(distDir, "index.bundle.js");
const outputPath = path.join(distDir, "index.js");

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(distDir, { recursive: true });

await build({
  entryPoints: [path.join(rootDir, "src/index.js")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  external: [
    "better-sqlite3",
    "dotenv",
    "express",
    "telegraf"
  ]
});

const bundledCode = await fs.readFile(bundlePath, "utf8");
const result = JavaScriptObfuscator.obfuscate(bundledCode, {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.85,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.35,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 6,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.75,
  stringArrayEncoding: ["base64"],
  stringArrayIndexesType: ["hexadecimal-number"],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.85,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
});

await fs.writeFile(outputPath, result.getObfuscatedCode());
await fs.rm(bundlePath, { force: true });
