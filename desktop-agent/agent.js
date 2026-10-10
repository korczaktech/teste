"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const HOST = "127.0.0.1";
const PORT = Number(process.env.ZEUS_AGENT_PORT || 47821);
const MAX_BODY = 1_100_000;
const MAX_TEXT_FILE = 1_000_000;
const ALLOWED_ORIGINS = new Set([
  "https://zeus.morok.korczaktech.com.br",
  "https://korczaktech.github.io",
  "http://localhost:3000",
  "http://localhost:5173"
]);
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log", ".yaml", ".yml",
  ".xml", ".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".py", ".java", ".c", ".h", ".cpp", ".hpp", ".go", ".rs", ".sql", ".toml",
  ".ini", ".sh", ".bat", ".ps1", ".env", ".conf", ".properties"
]);
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;
const requestCounts = new Map();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY"
  });
  res.end(body);
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
    if (req.headers["access-control-request-private-network"] === "true") {
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    return true;
  }
  return !origin;
}

function rateLimit(req) {
  const key = req.socket.remoteAddress || "loopback";
  const now = Date.now();
  const bucket = (requestCounts.get(key) || []).filter((time) => now - time < WINDOW_MS);
  if (bucket.length >= MAX_REQUESTS_PER_WINDOW) {
    requestCounts.set(key, bucket);
    return false;
  }
  bucket.push(now);
  requestCounts.set(key, bucket);
  return true;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

async function loadToken() {
  if (process.env.ZEUS_AGENT_TOKEN && process.env.ZEUS_AGENT_TOKEN.length >= 32) {
    return process.env.ZEUS_AGENT_TOKEN;
  }
  const directory = path.join(os.homedir(), ".zeus-agent");
  const tokenPath = path.join(directory, "token");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const token = (await fs.readFile(tokenPath, "utf8")).trim();
    if (token.length >= 32) return token;
  } catch { /* Create the first pairing token below. */ }
  const token = crypto.randomBytes(36).toString("base64url");
  await fs.writeFile(tokenPath, token + "\n", { mode: 0o600, flag: "wx" }).catch(async (error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const saved = (await fs.readFile(tokenPath, "utf8")).trim();
  if (saved === token) {
    console.log("\nZEUS LOCAL AGENT — copie este token para a sessão do Zeus no navegador:\n" + token + "\n");
  } else {
    console.log("Zeus Local Agent: token existente carregado de ~/.zeus-agent/token.");
  }
  return saved;
}

async function loadRoots() {
  const configured = String(process.env.ZEUS_AGENT_ALLOWED_DIRS || "")
    .split(path.delimiter).map((item) => item.trim()).filter(Boolean);
  const roots = [];
  for (const item of configured) {
    try {
      const real = await fs.realpath(path.resolve(item));
      const stat = await fs.stat(real);
      if (stat.isDirectory()) roots.push({ id: String(roots.length), name: path.basename(real) || real, path: real });
    } catch {
      console.warn("Zeus Local Agent: ignorando uma pasta permitida que não existe ou não pode ser lida.");
    }
  }
  return roots;
}

function rootFor(roots, value) {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= roots.length) return null;
  return roots[index];
}

function resolveRelative(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length > 1024 || relativePath.includes("\0")) {
    throw new Error("Caminho inválido.");
  }
  const normalized = relativePath.replace(/\\/g, path.sep);
  if (path.isAbsolute(normalized)) throw new Error("Use um caminho relativo à pasta autorizada.");
  const candidate = path.resolve(root.path, normalized || ".");
  const relative = path.relative(root.path, candidate);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("Acesso fora da pasta autorizada bloqueado.");
  }
  return candidate;
}

async function verifyWithinRoot(root, candidate) {
  const real = await fs.realpath(candidate);
  const relative = path.relative(root.path, real);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("O caminho aponta para fora da pasta autorizada.");
  }
  return real;
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("Corpo da solicitação excede o limite permitido.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("JSON inválido."); }
}

function requireAuth(req, res, token) {
  const header = String(req.headers.authorization || "");
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!safeEqual(supplied, token)) {
    json(res, 401, { error: "Agente local não pareado. Informe o token gerado no computador." });
    return false;
  }
  return true;
}

function allowedApps() {
  try {
    const parsed = JSON.parse(process.env.ZEUS_AGENT_ALLOWED_APPS || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch { return {}; }
}

async function createServer() {
  const token = await loadToken();
  const roots = await loadRoots();
  console.log("Zeus Local Agent iniciado em http://" + HOST + ":" + PORT + " · pastas autorizadas: " + roots.length);
  if (!roots.length) console.log("Configure ZEUS_AGENT_ALLOWED_DIRS com as pastas que o Zeus poderá acessar.");

  return http.createServer(async (req, res) => {
    try {
      if (!cors(req, res)) return json(res, 403, { error: "Origem não autorizada." });
      const host = String(req.headers.host || "");
      if (!["127.0.0.1:" + PORT, "localhost:" + PORT].includes(host)) {
        return json(res, 403, { error: "Host local não autorizado." });
      }
      if (req.method === "OPTIONS") return res.writeHead(204).end();
      if (!rateLimit(req)) return json(res, 429, { error: "Muitas solicitações. Aguarde um minuto." });
      const url = new URL(req.url || "/", "http://" + HOST + ":" + PORT);
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { service: "Zeus Local Agent", version: "0.1.0", status: "ok" });
      }
      if (!requireAuth(req, res, token)) return;
      if (req.method === "GET" && url.pathname === "/v1/system/info") {
        return json(res, 200, { platform: process.platform, architecture: process.arch, node: process.versions.node, allowedRoots: roots.length, writeEnabled: process.env.ZEUS_AGENT_ALLOW_WRITE === "true" });
      }
      if (req.method === "GET" && url.pathname === "/v1/files/roots") {
        return json(res, 200, { roots: roots.map((root) => ({ id: root.id, name: root.name, path: root.path })) });
      }
      if (req.method === "GET" && url.pathname === "/v1/files/list") {
        const root = rootFor(roots, url.searchParams.get("root"));
        if (!root) return json(res, 400, { error: "Pasta autorizada inválida." });
        const candidate = resolveRelative(root, url.searchParams.get("path") || "");
        const real = await verifyWithinRoot(root, candidate);
        const stat = await fs.stat(real);
        if (!stat.isDirectory()) return json(res, 400, { error: "O caminho informado não é uma pasta." });
        const entries = await fs.readdir(real, { withFileTypes: true });
        const items = [];
        for (const entry of entries.slice(0, 500)) {
          if (entry.isSymbolicLink()) continue;
          const fullPath = path.join(real, entry.name);
          try {
            const info = await fs.stat(fullPath);
            items.push({
              name: entry.name,
              type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
              size: entry.isFile() ? info.size : null,
              modifiedAt: info.mtime.toISOString(),
              relativePath: path.relative(root.path, fullPath).split(path.sep).join("/")
            });
          } catch { /* Skip entries that disappear or become unreadable during listing. */ }
        }
        items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1));
        return json(res, 200, { root: { id: root.id, name: root.name }, path: path.relative(root.path, real).split(path.sep).join("/"), items });
      }
      if (req.method === "GET" && url.pathname === "/v1/files/read") {
        const root = rootFor(roots, url.searchParams.get("root"));
        if (!root) return json(res, 400, { error: "Pasta autorizada inválida." });
        const candidate = resolveRelative(root, url.searchParams.get("path") || "");
        const real = await verifyWithinRoot(root, candidate);
        const stat = await fs.stat(real);
        if (!stat.isFile()) return json(res, 400, { error: "O caminho informado não é um arquivo." });
        if (!TEXT_EXTENSIONS.has(path.extname(real).toLowerCase())) return json(res, 415, { error: "Este tipo de arquivo ainda não pode ser lido como texto." });
        if (stat.size > MAX_TEXT_FILE) return json(res, 413, { error: "O arquivo excede o limite de 1 MB." });
        const content = await fs.readFile(real, "utf8");
        return json(res, 200, { name: path.basename(real), relativePath: path.relative(root.path, real).split(path.sep).join("/"), size: stat.size, content });
      }
      if (req.method === "POST" && url.pathname === "/v1/files/write") {
        if (process.env.ZEUS_AGENT_ALLOW_WRITE !== "true") return json(res, 403, { error: "A escrita local está desativada. Ative ZEUS_AGENT_ALLOW_WRITE somente se desejar permitir alterações." });
        const body = await readBody(req);
        if (body.confirm !== true) return json(res, 400, { error: "A escrita exige confirmação explícita." });
        const root = rootFor(roots, body.root);
        if (!root) return json(res, 400, { error: "Pasta autorizada inválida." });
        if (typeof body.content !== "string" || Buffer.byteLength(body.content, "utf8") > MAX_TEXT_FILE) return json(res, 413, { error: "Conteúdo inválido ou maior que 1 MB." });
        const candidate = resolveRelative(root, body.path);
        if (!TEXT_EXTENSIONS.has(path.extname(candidate).toLowerCase())) return json(res, 415, { error: "Extensão de arquivo não permitida para escrita." });
        await fs.mkdir(path.dirname(candidate), { recursive: true });
        const parent = await verifyWithinRoot(root, path.dirname(candidate));
        const target = path.join(parent, path.basename(candidate));
        let backup = null;
        try {
          const existing = await fs.stat(target);
          if (!existing.isFile() || existing.size > MAX_TEXT_FILE) return json(res, 400, { error: "Arquivo existente não pode ser substituído com segurança." });
          const previous = await fs.readFile(target);
          const backupDir = path.join(os.homedir(), ".zeus-agent", "backups");
          await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
          const backupName = Date.now() + "-" + crypto.createHash("sha256").update(root.id + ":" + body.path).digest("hex").slice(0, 16) + ".bak";
          backup = path.join(backupDir, backupName);
          await fs.writeFile(backup, previous, { mode: 0o600, flag: "wx" });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        const temp = target + ".zeus-tmp-" + crypto.randomBytes(6).toString("hex");
        await fs.writeFile(temp, body.content, { mode: 0o600, flag: "wx" });
        await fs.rename(temp, target);
        return json(res, 200, { ok: true, relativePath: path.relative(root.path, target).split(path.sep).join("/"), backupCreated: Boolean(backup) });
      }
      if (req.method === "POST" && url.pathname === "/v1/apps/launch") {
        const body = await readBody(req);
        const app = allowedApps()[String(body.appId || "")];
        if (!app || typeof app.command !== "string" || !Array.isArray(app.args) || app.args.some(arg => typeof arg !== "string")) {
          return json(res, 403, { error: "Este aplicativo não está na lista de aplicativos permitidos." });
        }
        const { spawn } = require("node:child_process");
        const child = spawn(app.command, app.args, { detached: true, stdio: "ignore", shell: false, windowsHide: true });
        child.unref();
        return json(res, 202, { ok: true, appId: String(body.appId) });
      }
      return json(res, 404, { error: "Rota não encontrada." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro local desconhecido.";
      const status = /fora da pasta|caminho inválido|acesso fora/i.test(message) ? 403 : 500;
      console.error("Zeus Local Agent request failed:", message);
      return json(res, status, { error: status === 403 ? message : "Não foi possível concluir a operação local." });
    }
  });
}

createServer().then((server) => {
  server.listen(PORT, HOST);
}).catch((error) => {
  console.error("Zeus Local Agent failed to start:", error.message);
  process.exitCode = 1;
});
