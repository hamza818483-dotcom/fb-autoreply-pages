// Copy FFmpeg's module worker to a stable public URL so Next.js/Turbopack
// does not rewrite its internal dynamic imports.
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const source = path.join(root, "node_modules", "@ffmpeg", "ffmpeg", "dist", "esm", "worker.js");
const targetDir = path.join(root, "public", "ffmpeg");
const target = path.join(targetDir, "worker.js");

if (!fs.existsSync(source)) {
  throw new Error(`FFmpeg worker was not found at ${source}. Check @ffmpeg/ffmpeg installation.`);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log("Copied FFmpeg worker to public/ffmpeg/worker.js");
