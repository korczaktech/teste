const fs = require("node:fs");
const path = require("node:path");
const root = __dirname;
const out = path.join(root, "dist");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const file of ["index.html", "CNAME"]) {
  const src = path.join(root, file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, file));
}
console.log("Zeus frontend built into frontend/dist");
