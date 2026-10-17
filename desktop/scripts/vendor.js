// Salin aset Ace dari node_modules ke renderer agar dimuat lokal (tanpa CDN, cocok dengan CSP ketat).
const fs = require("node:fs");
const path = require("node:path");

const src = path.join(__dirname, "..", "node_modules", "ace-builds");
const dest = path.join(__dirname, "..", "src", "renderer", "vendor", "ace");
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const f of ["ace.js", "mode-nginx.js", "theme-tomorrow.js", "theme-tomorrow_night.js", "ext-searchbox.js"]) {
  fs.copyFileSync(path.join(src, "src-min-noconflict", f), path.join(dest, f));
}
fs.cpSync(path.join(src, "css"), path.join(dest, "css"), { recursive: true });
fs.copyFileSync(path.join(src, "LICENSE"), path.join(dest, "LICENSE"));
const uplotDest = path.join(__dirname, "..", "src", "renderer", "vendor", "uplot");
fs.mkdirSync(uplotDest, { recursive: true });
const uplotSrc = path.join(__dirname, "..", "node_modules", "uplot");
fs.copyFileSync(path.join(uplotSrc, "dist", "uPlot.iife.min.js"), path.join(uplotDest, "uPlot.iife.min.js"));
fs.copyFileSync(path.join(uplotSrc, "dist", "uPlot.min.css"), path.join(uplotDest, "uPlot.min.css"));
fs.copyFileSync(path.join(uplotSrc, "LICENSE"), path.join(uplotDest, "LICENSE"));
console.log(`Ace disalin ke ${path.relative(process.cwd(), dest)}`);
