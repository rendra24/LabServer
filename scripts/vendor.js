// Salin aset Ace dari node_modules ke renderer agar dimuat lokal (tanpa CDN, cocok dengan CSP ketat).
const fs = require("node:fs");
const path = require("node:path");

const src = path.join(__dirname, "..", "node_modules", "ace-builds");
const dest = path.join(__dirname, "..", "src", "renderer", "vendor", "ace");
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const f of ["ace.js", "mode-nginx.js", "mode-json.js", "mode-markdown.js", "mode-sh.js", "mode-text.js", "mode-javascript.js", "mode-css.js", "mode-html.js", "mode-yaml.js", "theme-tomorrow.js", "theme-tomorrow_night.js", "ext-searchbox.js"]) {
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
for (const [pkg, files] of [
  ["xterm", ["lib/xterm.js", "css/xterm.css", "LICENSE"]],
  ["addon-fit", ["lib/addon-fit.js", "LICENSE"]],
]) {
  const target = path.join(__dirname, "..", "src", "renderer", "vendor", "xterm");
  fs.mkdirSync(target, { recursive: true });
  for (const file of files) fs.copyFileSync(path.join(__dirname, "..", "node_modules", "@xterm", pkg, file), path.join(target, file === "LICENSE" ? `${pkg}-LICENSE` : path.basename(file)));
}
