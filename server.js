const express = require("express");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { MongoClient, ObjectId } = require("mongodb");
const scrypt = promisify(crypto.scrypt);

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  const allowed = new Set([
    "https://korczaktech.github.io",
    "https://zeus.morok.korczaktech.com.br",
    "https://zeus.onrender.com"
  ]);
  const origin = req.headers.origin;
  if (origin && (allowed.has(origin) || /^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

let mongoClient;
let mongoState = "not_configured";
async function getDb() {
  if (!process.env.MONGODB_URI) {
    mongoState = "not_configured";
    return null;
  }
  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 5
    });
    try { await mongoClient.connect(); mongoState = "connected"; }
    catch (err) { mongoClient = null; mongoState = "unavailable"; throw err; }
  }
  return mongoClient.db(process.env.MONGODB_DATABASE || "todas");
}

function escapeXml(value) {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;"
  })[character]);
}

// Basic per-process guard for the paid neural TTS endpoint.
const ttsRequests = new Map();
function allowTtsRequest(req) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const previous = ttsRequests.get(key) || [];
  const recent = previous.filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= 10) {
    ttsRequests.set(key, recent);
    return false;
  }
  recent.push(now);
  ttsRequests.set(key, recent);
  if (ttsRequests.size > 1000) {
    for (const [ip, timestamps] of ttsRequests) {
      if (!timestamps.some((timestamp) => now - timestamp < 60_000)) ttsRequests.delete(ip);
    }
  }
  return true;
}


const AUTH_SESSION_MS = 12 * 60 * 60 * 1000;
let indexesReady;
function authSecret() {
  const secret = process.env.ZEUS_AUTH_SECRET || "";
  return secret.length >= 32 ? secret : null;
}
async function ensureFoundationIndexes(db) {
  if (!indexesReady) {
    indexesReady = Promise.all([
      db.collection("zeus_users").createIndex({ email: 1 }, { unique: true }),
      db.collection("zeus_sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection("zeus_sessions").createIndex({ userId: 1 }),
      db.collection("zeus_tasks").createIndex({ userId: 1, createdAt: -1 }),
      db.collection("zeus_audit").createIndex({ userId: 1, createdAt: -1 })
    ]).catch((error) => { indexesReady = null; throw error; });
  }
  return indexesReady;
}
function tokenFor(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return body + "." + signature;
}
async function createSession(user, req, res) {
  const secret = authSecret();
  if (!secret) return res.status(503).json({ error: "Autenticação não configurada. Defina ZEUS_AUTH_SECRET (mínimo de 32 caracteres) no Render." });
  const db = await getDb();
  if (!db) return res.status(503).json({ error: "Banco de dados ainda não configurado." });
  await ensureFoundationIndexes(db);
  const now = Date.now();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(now + AUTH_SESSION_MS);
  await db.collection("zeus_sessions").insertOne({
    _id: sessionId, userId: user._id, createdAt: new Date(now), expiresAt,
    ip: req.ip || "unknown", userAgent: String(req.headers["user-agent"] || "").slice(0, 240)
  });
  const token = tokenFor({ sub: String(user._id), sid: sessionId, iat: now, exp: expiresAt.getTime() }, secret);
  return res.json({ token, expiresAt: expiresAt.toISOString(), user: { id: String(user._id), email: user.email, displayName: user.displayName } });
}
async function audit(db, userId, action, detail = {}) {
  try {
    await db.collection("zeus_audit").insertOne({
      userId, action, detail, createdAt: new Date()
    });
  } catch (error) {
    // Audit failures must be visible in server logs, never silently reported as persisted.
    console.error("Zeus audit write failed:", error.message);
  }
}
async function requireAuth(req, res, next) {
  try {
    const secret = authSecret();
    if (!secret) return res.status(503).json({ error: "Autenticação não configurada no servidor." });
    const header = String(req.headers.authorization || "");
    if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Entre na sua conta Zeus para continuar." });
    const parts = header.slice(7).split(".");
    if (parts.length !== 2) return res.status(401).json({ error: "Sessão inválida. Entre novamente." });
    const expected = crypto.createHmac("sha256", secret).update(parts[0]).digest();
    let received;
    try { received = Buffer.from(parts[1], "base64url"); } catch { return res.status(401).json({ error: "Sessão inválida." }); }
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return res.status(401).json({ error: "Sessão inválida. Entre novamente." });
    let payload;
    try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return res.status(401).json({ error: "Sessão inválida." }); }
    if (!payload.sub || !payload.sid || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) return res.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Banco de dados indisponível." });
    await ensureFoundationIndexes(db);
    const session = await db.collection("zeus_sessions").findOne({ _id: payload.sid, userId: new ObjectId(payload.sub), expiresAt: { $gt: new Date() } });
    if (!session) return res.status(401).json({ error: "Sessão encerrada. Entre novamente." });
    const user = await db.collection("zeus_users").findOne({ _id: new ObjectId(payload.sub), status: "active" }, { projection: { email: 1, displayName: 1 } });
    if (!user) return res.status(401).json({ error: "Conta indisponível." });
    req.zeusUser = user;
    req.zeusDb = db;
    req.zeusSessionId = payload.sid;
    next();
  } catch (error) {
    console.error("Zeus authentication error:", error.message);
    return res.status(503).json({ error: "Não foi possível validar a sessão neste momento." });
  }
}
function requireAuthWhenConfigured(req, res, next) {
  if (!authSecret()) return next(); // Demonstration mode until the owner configures authentication.
  return requireAuth(req, res, next);
}
const aiAttempts = new Map();
function allowAiRequest(req) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const recent = (aiAttempts.get(key) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 20) { aiAttempts.set(key, recent); return false; }
  recent.push(now); aiAttempts.set(key, recent);
  if (aiAttempts.size > 1000) for (const [ip, times] of aiAttempts) if (!times.some((time) => now - time < 60_000)) aiAttempts.delete(ip);
  return true;
}
const authAttempts = new Map();
function allowAuthAttempt(req) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const recent = (authAttempts.get(key) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 8) { authAttempts.set(key, recent); return false; }
  recent.push(now); authAttempts.set(key, recent);
  if (authAttempts.size > 1000) for (const [ip, times] of authAttempts) if (!times.some((time) => now - time < 60_000)) authAttempts.delete(ip);
  return true;
}

app.get("/", (_req, res) => res.json({ name: "ZeusAPI", version: "0.2.0", status: "ok" }));
app.get("/health", (_req, res) => res.json({ status: "ok", service: "ZeusAPI" }));
app.get("/api/status", async (_req, res) => {
  let database = "not_configured";
  try {
    const db = await getDb();
    if (db) { await db.command({ ping: 1 }); database = "connected"; }
  } catch { database = "unavailable"; }
  res.json({
    api: "ok",
    mongodb: database,
    ollama: process.env.OLLAMA_BASE_URL ? "configured" : "not_configured",
    neuralTts: process.env.SPEECH_KEY && process.env.SPEECH_REGION ? "configured" : "not_configured",
    auth: authSecret() ? "configured" : "not_configured",
    voice: "pt-BR-AntonioNeural"
  });
});

app.post("/api/voice/tts", requireAuthWhenConfigured, async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text || text.length > 1200) {
    return res.status(400).json({ error: "Envie um texto entre 1 e 1.200 caracteres." });
  }
  if (!allowTtsRequest(req)) {
    return res.status(429).json({ error: "Muitas solicitações de voz. Aguarde um minuto e tente novamente." });
  }
  const key = process.env.SPEECH_KEY;
  const region = process.env.SPEECH_REGION;
  if (!key || !region) {
    return res.status(503).json({ error: "A voz neural ainda não foi configurada no servidor." });
  }
  if (!/^[a-z0-9-]+$/i.test(region)) {
    return res.status(500).json({ error: "A região do serviço de voz está configurada incorretamente." });
  }
  const ssml = "<speak version=\"1.0\" xml:lang=\"pt-BR\"><voice xml:lang=\"pt-BR\" name=\"pt-BR-AntonioNeural\"><prosody rate=\"-7%\" pitch=\"-2st\">" +
    escapeXml(text) + "</prosody></voice></speak>";
  try {
    const response = await fetch("https://" + region + ".tts.speech.microsoft.com/cognitiveservices/v1", {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "Zeus-Korczak-Voice"
      },
      body: ssml,
      signal: AbortSignal.timeout(25_000)
    });
    if (!response.ok) {
      console.error("Neural TTS provider returned HTTP", response.status);
      return res.status(502).json({ error: "O serviço de voz neural não respondeu. Confira a região e a chave Speech no Render." });
    }
    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length || audio.length > 8 * 1024 * 1024) {
      return res.status(502).json({ error: "O áudio retornado está vazio ou excede o limite permitido." });
    }
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(audio.length));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Zeus-Voice", "pt-BR-AntonioNeural");
    return res.status(200).send(audio);
  } catch {
    return res.status(502).json({ error: "Não foi possível acessar o serviço de voz neural." });
  }
});


app.get("/api/auth/config", (_req, res) => {
  res.json({
    configured: Boolean(authSecret()),
    registrationEnabled: process.env.ZEUS_SIGNUP_ENABLED !== "false",
    sessionHours: 12
  });
});
app.post("/api/auth/register", async (req, res) => {
  if (!allowAuthAttempt(req)) return res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto e tente novamente." });
  if (!authSecret()) return res.status(503).json({ error: "Defina ZEUS_AUTH_SECRET (mínimo de 32 caracteres) no Render para ativar contas." });
  if (process.env.ZEUS_SIGNUP_ENABLED === "false") return res.status(403).json({ error: "A criação de novas contas está desativada." });
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim().slice(0, 80) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Informe um e-mail válido." });
  if (password.length < 12 || password.length > 256) return res.status(400).json({ error: "A senha deve ter entre 12 e 256 caracteres." });
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Banco de dados ainda não configurado." });
    await ensureFoundationIndexes(db);
    const salt = crypto.randomBytes(16);
    const passwordHash = await scrypt(password, salt, 64);
    const user = { email, displayName: displayName || email.split("@")[0], passwordSalt: salt.toString("base64"), passwordHash: Buffer.from(passwordHash).toString("base64"), status: "active", createdAt: new Date(), updatedAt: new Date() };
    const result = await db.collection("zeus_users").insertOne(user);
    user._id = result.insertedId;
    await audit(db, user._id, "account.registered", { method: "password" });
    return await createSession(user, req, res);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "Já existe uma conta com esse e-mail." });
    console.error("Zeus registration failed:", error.message);
    return res.status(503).json({ error: "Não foi possível criar a conta. Verifique a conexão do banco." });
  }
});
app.post("/api/auth/login", async (req, res) => {
  if (!allowAuthAttempt(req)) return res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto e tente novamente." });
  if (!authSecret()) return res.status(503).json({ error: "A autenticação ainda não foi configurada no servidor." });
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password || password.length > 256) return res.status(400).json({ error: "Informe e-mail e senha." });
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Banco de dados ainda não configurado." });
    await ensureFoundationIndexes(db);
    const user = await db.collection("zeus_users").findOne({ email, status: "active" });
    if (!user?.passwordSalt || !user?.passwordHash) return res.status(401).json({ error: "E-mail ou senha incorretos." });
    const candidate = Buffer.from(await scrypt(password, Buffer.from(user.passwordSalt, "base64"), 64));
    const stored = Buffer.from(user.passwordHash, "base64");
    if (candidate.length !== stored.length || !crypto.timingSafeEqual(candidate, stored)) return res.status(401).json({ error: "E-mail ou senha incorretos." });
    user.updatedAt = new Date();
    await db.collection("zeus_users").updateOne({ _id: user._id }, { $set: { lastLoginAt: user.updatedAt } });
    await audit(db, user._id, "account.login", { method: "password" });
    return await createSession(user, req, res);
  } catch (error) {
    console.error("Zeus login failed:", error.message);
    return res.status(503).json({ error: "Não foi possível entrar neste momento." });
  }
});
app.get("/api/auth/me", requireAuth, (req, res) => res.json({
  user: { id: String(req.zeusUser._id), email: req.zeusUser.email, displayName: req.zeusUser.displayName }
}));
app.post("/api/auth/logout", requireAuth, async (req, res) => {
  await req.zeusDb.collection("zeus_sessions").deleteOne({ _id: req.zeusSessionId });
  await audit(req.zeusDb, req.zeusUser._id, "account.logout");
  return res.json({ ok: true });
});
app.get("/api/me/tasks", requireAuth, async (req, res) => {
  const tasks = await req.zeusDb.collection("zeus_tasks").find({ userId: req.zeusUser._id }).sort({ createdAt: -1 }).limit(200).toArray();
  return res.json({ tasks: tasks.map((task) => ({ id: String(task._id), title: task.title, category: task.category, details: task.details, done: task.done, createdAt: task.createdAt })) });
});
app.post("/api/me/tasks", requireAuth, async (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const category = typeof req.body?.category === "string" ? req.body.category.trim().slice(0, 40) : "Geral";
  const details = typeof req.body?.details === "string" ? req.body.details.trim().slice(0, 1000) : "";
  if (!title || title.length > 160) return res.status(400).json({ error: "O título deve ter entre 1 e 160 caracteres." });
  const task = { userId: req.zeusUser._id, title, category, details, done: false, createdAt: new Date(), updatedAt: new Date() };
  const result = await req.zeusDb.collection("zeus_tasks").insertOne(task);
  await audit(req.zeusDb, req.zeusUser._id, "task.created", { taskId: String(result.insertedId), title });
  return res.status(201).json({ task: { id: String(result.insertedId), title, category, details, done: false, createdAt: task.createdAt } });
});
app.patch("/api/me/tasks/:id", requireAuth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Identificador de tarefa inválido." });
  const update = {};
  if (typeof req.body?.done === "boolean") update.done = req.body.done;
  if (typeof req.body?.title === "string") {
    const title = req.body.title.trim();
    if (!title || title.length > 160) return res.status(400).json({ error: "O título deve ter entre 1 e 160 caracteres." });
    update.title = title;
  }
  if (!Object.keys(update).length) return res.status(400).json({ error: "Nenhuma alteração válida informada." });
  update.updatedAt = new Date();
  const result = await req.zeusDb.collection("zeus_tasks").updateOne({ _id: new ObjectId(req.params.id), userId: req.zeusUser._id }, { $set: update });
  if (!result.matchedCount) return res.status(404).json({ error: "Tarefa não encontrada." });
  await audit(req.zeusDb, req.zeusUser._id, "task.updated", { taskId: req.params.id, changes: Object.keys(update) });
  return res.json({ ok: true });
});
app.delete("/api/me/tasks/:id", requireAuth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Identificador de tarefa inválido." });
  const result = await req.zeusDb.collection("zeus_tasks").deleteOne({ _id: new ObjectId(req.params.id), userId: req.zeusUser._id });
  if (!result.deletedCount) return res.status(404).json({ error: "Tarefa não encontrada." });
  await audit(req.zeusDb, req.zeusUser._id, "task.deleted", { taskId: req.params.id });
  return res.json({ ok: true });
});
app.get("/api/me/activity", requireAuth, async (req, res) => {
  const entries = await req.zeusDb.collection("zeus_audit").find({ userId: req.zeusUser._id }).sort({ createdAt: -1 }).limit(100).toArray();
  return res.json({ entries: entries.map((entry) => ({ id: String(entry._id), action: entry.action, detail: entry.detail, createdAt: entry.createdAt })) });
});

app.post("/api/ai/chat", requireAuthWhenConfigured, async (req, res) => {
  if (!allowAiRequest(req)) return res.status(429).json({ error: "Muitas mensagens em pouco tempo. Aguarde um minuto." });
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message || message.length > 4000) return res.status(400).json({ error: "Envie uma mensagem de até 4.000 caracteres." });
  const base = (process.env.OLLAMA_BASE_URL || "").replace(/\/$/, "");
  if (!base) return res.status(503).json({ error: "O serviço Ollama ainda não foi configurado." });
  const model = process.env.OLLAMA_MODEL || "llama3.2:1b";
  try {
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{
          role: "system",
          content: "Você é Zeus, assistente central da Korczak Technologies. Responda em português brasileiro com clareza, autoridade serena, concisão e foco em resolver a solicitação. Ajude a planejar, pesquisar, resumir e coordenar tarefas entre serviços, mas nunca afirme que acessou uma conta, arquivo ou serviço externo sem uma integração real e autorização válida. Nunca invente execução, dados ou resultados. Antes de uma ação externa sensível, explique a ação e solicite confirmação. Respeite privacidade, permissões e políticas dos serviços."
        }, { role: "user", content: message }],
        stream: false
      }),
      signal: AbortSignal.timeout(90_000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ error: "Ollama não respondeu corretamente. Confira o modelo instalado e o serviço." });
    return res.json({ response: data.message?.content || "", model });
  } catch {
    return res.status(502).json({ error: "Não foi possível acessar Ollama. Verifique se o serviço está ativo e acessível." });
  }
});

const port = Number(process.env.PORT || 10000);
app.listen(port, "0.0.0.0", () => console.log("ZeusAPI listening on " + port));
