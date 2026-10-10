const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = __dirname;
const out = path.join(root, "dist");
const htmlPath = path.join(root, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");

// Catch inline JavaScript syntax errors before publishing the site.
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
if (!scripts.length) throw new Error("No inline JavaScript found in frontend/index.html");
scripts.forEach((match, index) => {
  if (match[1].trim()) new vm.Script(match[1], { filename: "frontend/index.html:inline-script-" + (index + 1) });
});
if (!/<html\b[^>]*lang=["']pt-BR["']/i.test(html)) {
  throw new Error("The frontend must declare lang=\"pt-BR\".");
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const file of ["index.html", "CNAME"]) {
  const src = path.join(root, file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, file));
}
console.log("Zeus frontend built and inline JavaScript syntax validated.");
