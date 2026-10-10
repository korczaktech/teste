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
    "http://localhost:3000",
    "http://localhost:5173"
  ]);
  const origin = req.headers.origin;
  if (origin && allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), payment=()");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
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



function connectorEncryptionKey() {
  const raw = process.env.ZEUS_CONNECTOR_ENCRYPTION_KEY || "";
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  const decoded = Buffer.from(raw, "base64");
  return decoded.length === 32 ? decoded : null;
}
function encryptConnectorSecret(value) {
  const key = connectorEncryptionKey();
  if (!key) throw new Error("Connector encryption key is not configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
}
function decryptConnectorSecret(record) {
  const key = connectorEncryptionKey();
  if (!key || !record?.iv || !record?.tag || !record?.data) return null;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(record.data, "base64")), decipher.final()]).toString("utf8");
}
function oauthConfig(provider) {
  if (provider === "google") return {
    provider, clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid", "email", "profile",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/presentations",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/tasks.readonly"
    ]
  };
  if (provider === "microsoft") {
    const tenant = process.env.MICROSOFT_TENANT_ID || "common";
    return {
      provider, clientId: process.env.MICROSOFT_CLIENT_ID, clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      redirectUri: process.env.MICROSOFT_REDIRECT_URI,
      authorizeUrl: "https://login.microsoftonline.com/" + encodeURIComponent(tenant) + "/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/" + encodeURIComponent(tenant) + "/oauth2/v2.0/token",
      scopes: ["openid", "profile", "email", "offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send", "Files.ReadWrite.All", "Calendars.ReadWrite", "Contacts.ReadWrite", "Tasks.ReadWrite", "Sites.Read.All", "Team.ReadBasic.All"]
    };
  }
  return null;
}
function oauthConfigured(provider) {
  const config = oauthConfig(provider);
  return Boolean(config?.clientId && config?.clientSecret && config?.redirectUri && connectorEncryptionKey());
}
async function getConnectorAccessToken(db, userId, provider) {
  const connection = await db.collection("zeus_connections").findOne({ userId, provider, status: "connected" });
  if (!connection) return { error: "not_connected" };
  if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() > Date.now() + 120_000) {
    const accessToken = decryptConnectorSecret(connection.accessToken);
    if (accessToken) return { accessToken, connection };
  }
  if (!connection.refreshToken) return { error: "reauthorization_required" };
  const config = oauthConfig(provider);
  if (!config || !oauthConfigured(provider)) return { error: "provider_not_configured" };
  try {
    const form = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: decryptConnectorSecret(connection.refreshToken) || ""
    });
    const response = await fetch(config.tokenUrl, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(), signal: AbortSignal.timeout(20_000)
    });
    const tokens = await response.json().catch(() => ({}));
    if (!response.ok || !tokens.access_token) return { error: "reauthorization_required" };
    const update = {
      accessToken: encryptConnectorSecret(tokens.access_token),
      tokenExpiresAt: new Date(Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000),
      updatedAt: new Date()
    };
    if (tokens.refresh_token) update.refreshToken = encryptConnectorSecret(tokens.refresh_token);
    await db.collection("zeus_connections").updateOne({ _id: connection._id }, { $set: update });
    return { accessToken: tokens.access_token, connection: { ...connection, ...update } };
  } catch (error) {
    console.error("OAuth token refresh failed for", provider, error.message);
    return { error: "reauthorization_required" };
  }
}
async function providerJson(url, accessToken, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: { Authorization: "Bearer " + accessToken, Accept: "application/json", ...extraHeaders },
    signal: AbortSignal.timeout(25_000)
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
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
      db.collection("zeus_oauth_states").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection("zeus_tasks").createIndex({ userId: 1, createdAt: -1 }),
      db.collection("zeus_messages").createIndex({ userId: 1, conversationId: 1, createdAt: 1 }),
      db.collection("zeus_preferences").createIndex({ userId: 1 }, { unique: true }),
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
function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
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
app.post("/api/auth/logout", requireAuth, asyncRoute(async (req, res) => {
  await req.zeusDb.collection("zeus_sessions").deleteOne({ _id: req.zeusSessionId });
  await audit(req.zeusDb, req.zeusUser._id, "account.logout");
  return res.json({ ok: true });
}));
app.get("/api/me/tasks", requireAuth, asyncRoute(async (req, res) => {
  const tasks = await req.zeusDb.collection("zeus_tasks").find({ userId: req.zeusUser._id }).sort({ createdAt: -1 }).limit(200).toArray();
  return res.json({ tasks: tasks.map((task) => ({ id: String(task._id), title: task.title, category: task.category, details: task.details, done: task.done, createdAt: task.createdAt })) });
}));
app.post("/api/me/tasks", requireAuth, asyncRoute(async (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const category = typeof req.body?.category === "string" ? req.body.category.trim().slice(0, 40) : "Geral";
  const details = typeof req.body?.details === "string" ? req.body.details.trim().slice(0, 1000) : "";
  if (!title || title.length > 160) return res.status(400).json({ error: "O título deve ter entre 1 e 160 caracteres." });
  const task = { userId: req.zeusUser._id, title, category, details, done: false, createdAt: new Date(), updatedAt: new Date() };
  const result = await req.zeusDb.collection("zeus_tasks").insertOne(task);
  await audit(req.zeusDb, req.zeusUser._id, "task.created", { taskId: String(result.insertedId), title });
  return res.status(201).json({ task: { id: String(result.insertedId), title, category, details, done: false, createdAt: task.createdAt } });
}));
app.patch("/api/me/tasks/:id", requireAuth, asyncRoute(async (req, res) => {
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
}));
app.delete("/api/me/tasks/:id", requireAuth, asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Identificador de tarefa inválido." });
  const result = await req.zeusDb.collection("zeus_tasks").deleteOne({ _id: new ObjectId(req.params.id), userId: req.zeusUser._id });
  if (!result.deletedCount) return res.status(404).json({ error: "Tarefa não encontrada." });
  await audit(req.zeusDb, req.zeusUser._id, "task.deleted", { taskId: req.params.id });
  return res.json({ ok: true });
}));
app.get("/api/me/preferences", requireAuth, asyncRoute(async (req, res) => {
  const stored = await req.zeusDb.collection("zeus_preferences").findOne({ userId: req.zeusUser._id });
  return res.json({ preferences: {
    ttsEnabled: stored?.ttsEnabled !== false,
    sttEnabled: stored?.sttEnabled !== false,
    speechRate: [0.85, 1, 1.1].includes(stored?.speechRate) ? stored.speechRate : 1,
    confirmSensitiveActions: stored?.confirmSensitiveActions !== false,
    updatedAt: stored?.updatedAt || null
  } });
}));
app.patch("/api/me/preferences", requireAuth, asyncRoute(async (req, res) => {
  const allowed = ["ttsEnabled", "sttEnabled", "confirmSensitiveActions"];
  const update = {};
  for (const key of allowed) if (typeof req.body?.[key] === "boolean") update[key] = req.body[key];
  if (req.body?.speechRate !== undefined) {
    const rate = Number(req.body.speechRate);
    if (![0.85, 1, 1.1].includes(rate)) return res.status(400).json({ error: "Velocidade de fala inválida." });
    update.speechRate = rate;
  }
  if (!Object.keys(update).length) return res.status(400).json({ error: "Nenhuma preferência válida informada." });
  update.updatedAt = new Date();
  await req.zeusDb.collection("zeus_preferences").updateOne(
    { userId: req.zeusUser._id },
    { $set: update, $setOnInsert: { userId: req.zeusUser._id, createdAt: new Date() } },
    { upsert: true }
  );
  await audit(req.zeusDb, req.zeusUser._id, "preferences.updated", { keys: Object.keys(update).filter((key) => key !== "updatedAt") });
  return res.json({ ok: true, preferences: update });
}));
app.post("/api/connectors/:provider/start", requireAuth, asyncRoute(async (req, res) => {
  const provider = req.params.provider;
  const config = oauthConfig(provider);
  if (!config) return res.status(404).json({ error: "Provedor de conexão não reconhecido." });
  if (!oauthConfigured(provider)) return res.status(503).json({ error: "Configure client ID, client secret, URL de callback e chave de criptografia no Render antes de conectar este provedor." });
  const state = crypto.randomBytes(32).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await req.zeusDb.collection("zeus_oauth_states").insertOne({
    _id: state, provider, userId: req.zeusUser._id, codeVerifier: verifier, expiresAt, createdAt: new Date()
  });
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (provider === "google") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
  }
  return res.json({ url: url.toString(), provider });
}));
app.get("/api/connectors/:provider/callback", asyncRoute(async (req, res) => {
  const provider = req.params.provider;
  const config = oauthConfig(provider);
  const frontendUrl = "https://zeus.morok.korczaktech.com.br/";
  const redirectError = (reason) => res.redirect(frontendUrl + "?oauth=" + encodeURIComponent(provider) + "&status=error&reason=" + encodeURIComponent(reason));
  if (!config || !oauthConfigured(provider)) return redirectError("not_configured");
  if (typeof req.query.error === "string") return redirectError("consent_denied");
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!state || !code) return redirectError("invalid_callback");
  try {
    const db = await getDb();
    if (!db) return redirectError("database_unavailable");
    await ensureFoundationIndexes(db);
    const stateRecord = await db.collection("zeus_oauth_states").findOne({ _id: state, provider, expiresAt: { $gt: new Date() } });
    if (!stateRecord) return redirectError("state_expired");
    await db.collection("zeus_oauth_states").deleteOne({ _id: state });
    const form = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: stateRecord.codeVerifier
    });
    const tokenResponse = await fetch(config.tokenUrl, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(), signal: AbortSignal.timeout(20_000)
    });
    const tokens = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokens.access_token) {
      console.error("OAuth token exchange failed for", provider, "HTTP", tokenResponse.status);
      return redirectError("token_exchange_failed");
    }
    const previous = await db.collection("zeus_connections").findOne({ userId: stateRecord.userId, provider });
    const connection = {
      userId: stateRecord.userId, provider, status: "connected",
      accessToken: encryptConnectorSecret(tokens.access_token),
      refreshToken: tokens.refresh_token ? encryptConnectorSecret(tokens.refresh_token) : previous?.refreshToken || null,
      scopes: typeof tokens.scope === "string" ? tokens.scope.split(" ") : config.scopes,
      tokenExpiresAt: new Date(Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000),
      connectedAt: new Date(), updatedAt: new Date()
    };
    await db.collection("zeus_connections").updateOne({ userId: stateRecord.userId, provider }, { $set: connection }, { upsert: true });
    await audit(db, stateRecord.userId, "connector.connected", { provider, scopes: connection.scopes.length });
    return res.redirect(frontendUrl + "?oauth=" + encodeURIComponent(provider) + "&status=connected");
  } catch (error) {
    console.error("OAuth callback failed for", provider, error.message);
    return redirectError("callback_failed");
  }
}));
app.get("/api/me/connectors/:provider/resources/:resource", requireAuth, asyncRoute(async (req, res) => {
  const provider = req.params.provider;
  const resource = req.params.resource;
  if (!["google", "microsoft"].includes(provider)) return res.status(404).json({ error: "Provedor não suportado." });
  const allowedResources = ["profile", "drive-search", "mail-search", "mail-message", "calendar-events", "contacts", "tasks-list", "tasks", "document", "spreadsheet", "spreadsheet-values", "teams"];
  if (!allowedResources.includes(resource)) return res.status(404).json({ error: "Recurso não permitido pelo catálogo Zeus." });
  const tokenResult = await getConnectorAccessToken(req.zeusDb, req.zeusUser._id, provider);
  if (tokenResult.error) {
    const status = tokenResult.error === "not_connected" ? 409 : tokenResult.error === "reauthorization_required" ? 401 : 503;
    const message = tokenResult.error === "not_connected" ? "Conecte este serviço primeiro." : tokenResult.error === "reauthorization_required" ? "A autorização expirou. Reconecte a conta." : "O conector ainda não está configurado.";
    return res.status(status).json({ error: message });
  }
  const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 160) : "";
  const id = typeof req.query.id === "string" ? req.query.id : "";
  let url = "";
  let extraHeaders = {};
  if (provider === "google") {
    if (resource === "profile") url = "https://www.googleapis.com/oauth2/v2/userinfo";
    if (resource === "drive-search") {
      if (!query) return res.status(400).json({ error: "Informe q para pesquisar no Drive." });
      const safeQuery = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const driveQuery = "name contains '" + safeQuery + "' and trashed = false";
      url = "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(driveQuery) + "&pageSize=25&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress))";
    }
    if (resource === "mail-search") {
      if (!query) return res.status(400).json({ error: "Informe q para pesquisar e-mails." });
      url = "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=" + encodeURIComponent(query) + "&maxResults=25";
    }
    if (resource === "mail-message") {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return res.status(400).json({ error: "Informe um ID de mensagem válido." });
      url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + encodeURIComponent(id) + "?format=full";
    }
    if (resource === "calendar-events") {
      const now = new Date();
      const timeMin = typeof req.query.timeMin === "string" && !Number.isNaN(Date.parse(req.query.timeMin)) ? new Date(req.query.timeMin) : now;
      const timeMax = typeof req.query.timeMax === "string" && !Number.isNaN(Date.parse(req.query.timeMax)) ? new Date(req.query.timeMax) : new Date(now.getTime() + 7 * 86400000);
      url = "https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=" + encodeURIComponent(timeMin.toISOString()) + "&timeMax=" + encodeURIComponent(timeMax.toISOString());
    }
    if (resource === "contacts") url = "https://people.googleapis.com/v1/people/me/connections?pageSize=100&personFields=names,emailAddresses,phoneNumbers";
    if (resource === "tasks-list") url = "https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100";
    if (resource === "tasks") {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return res.status(400).json({ error: "Informe listId como id." });
      url = "https://tasks.googleapis.com/tasks/v1/lists/" + encodeURIComponent(id) + "/tasks?showCompleted=true&maxResults=100";
    }
    if (resource === "document") {
      if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) return res.status(400).json({ error: "Informe um ID de documento válido." });
      url = "https://docs.googleapis.com/v1/documents/" + encodeURIComponent(id);
    }
    if (resource === "spreadsheet") {
      if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) return res.status(400).json({ error: "Informe um ID de planilha válido." });
      url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(id) + "?includeGridData=false";
    }
    if (resource === "spreadsheet-values") {
      if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) return res.status(400).json({ error: "Informe um ID de planilha válido." });
      const range = typeof req.query.range === "string" ? req.query.range.slice(0, 120) : "A1:Z100";
      if (!/^[A-Za-z0-9_!:$ .-]+$/.test(range)) return res.status(400).json({ error: "Intervalo de planilha inválido." });
      url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(id) + "/values/" + encodeURIComponent(range);
    }
  } else {
    if (resource === "profile") url = "https://graph.microsoft.com/v1.0/me";
    if (resource === "drive-search") {
      if (!query) return res.status(400).json({ error: "Informe q para pesquisar no OneDrive." });
      const safeQuery = query.replace(/'/g, "''");
      url = "https://graph.microsoft.com/v1.0/me/drive/root/search(q='" + encodeURIComponent(safeQuery) + "')?$top=25&$select=id,name,file,folder,webUrl,lastModifiedDateTime,size";
    }
    if (resource === "mail-search") {
      if (!query) return res.status(400).json({ error: "Informe q para pesquisar e-mails." });
      url = "https://graph.microsoft.com/v1.0/me/messages?$top=25&$select=id,subject,from,receivedDateTime,isRead,webLink&$search=" + encodeURIComponent('"subject:' + query + '"');
      extraHeaders = { ConsistencyLevel: "eventual" };
    }
    if (resource === "mail-message") {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return res.status(400).json({ error: "Informe um ID de mensagem válido." });
      url = "https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(id);
    }
    if (resource === "calendar-events") url = "https://graph.microsoft.com/v1.0/me/events?$top=50&$select=id,subject,start,end,organizer,webLink&$orderby=start/dateTime";
    if (resource === "contacts") url = "https://graph.microsoft.com/v1.0/me/contacts?$top=100&$select=id,displayName,emailAddresses,businessPhones";
    if (resource === "tasks-list") url = "https://graph.microsoft.com/v1.0/me/todo/lists";
    if (resource === "tasks") {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return res.status(400).json({ error: "Informe listId como id." });
      url = "https://graph.microsoft.com/v1.0/me/todo/lists/" + encodeURIComponent(id) + "/tasks";
    }
    if (resource === "teams") url = "https://graph.microsoft.com/v1.0/me/joinedTeams";
  }
  if (!url) return res.status(400).json({ error: "Parâmetros insuficientes para este recurso." });
  const result = await providerJson(url, tokenResult.accessToken, extraHeaders);
  if (!result.ok) {
    if (result.status === 401) return res.status(401).json({ error: "O provedor recusou a autorização. Reconecte a conta." });
    console.error("Connector API error", provider, resource, result.status);
    return res.status(502).json({ error: "O provedor não conseguiu concluir a consulta. Verifique as permissões concedidas." });
  }
  await audit(req.zeusDb, req.zeusUser._id, "connector.resource.read", { provider, resource });
  return res.json({ provider, resource, data: result.data });
}));
app.post("/api/me/connectors/:provider/disconnect", requireAuth, asyncRoute(async (req, res) => {
  const provider = req.params.provider;
  if (!["google", "microsoft", "korczak", "other"].includes(provider)) return res.status(404).json({ error: "Conector não reconhecido." });
  const connection = await req.zeusDb.collection("zeus_connections").findOne({ userId: req.zeusUser._id, provider });
  if (connection && provider === "google" && connection.refreshToken) {
    try {
      const token = decryptConnectorSecret(connection.refreshToken);
      if (token) await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }).toString(), signal: AbortSignal.timeout(8000) });
    } catch { /* Local token deletion still proceeds; user can revoke access in provider settings. */ }
  }
  await req.zeusDb.collection("zeus_connections").deleteOne({ userId: req.zeusUser._id, provider });
  await audit(req.zeusDb, req.zeusUser._id, "connector.disconnected", { provider });
  return res.json({ ok: true, note: provider === "microsoft" ? "A conexão local foi removida. Para revogar o consentimento Microsoft, remova o acesso nas configurações da sua conta Microsoft." : "Conexão removida." });
}));
app.get("/api/me/connectors", requireAuth, asyncRoute(async (req, res) => {
  const catalog = [
    { id: "google", name: "Google Workspace", configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), capabilities: ["gmail", "drive", "docs", "sheets", "calendar", "contacts", "tasks"] },
    { id: "microsoft", name: "Microsoft 365", configured: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET), capabilities: ["outlook", "onedrive", "word", "excel", "calendar", "contacts", "tasks", "teams"] },
    { id: "korczak", name: "Korczak Technologies", configured: false, capabilities: ["hub", "nexus", "nexa", "kos", "morok-ai"] },
    { id: "other", name: "Outros serviços", configured: false, capabilities: ["official-api-connectors"] }
  ];
  const connections = await req.zeusDb.collection("zeus_connections").find({ userId: req.zeusUser._id }, { projection: { provider: 1, status: 1, connectedAt: 1 } }).toArray();
  const byProvider = new Map(connections.map((entry) => [entry.provider, entry]));
  return res.json({ connectors: catalog.map((connector) => {
    const connection = byProvider.get(connector.id);
    return { ...connector, status: connection?.status === "connected" ? "connected" : connector.configured ? "available" : "not_configured", connectedAt: connection?.connectedAt || null };
  }) });
}));
app.get("/api/me/messages", requireAuth, asyncRoute(async (req, res) => {
  const conversationId = typeof req.query.conversationId === "string" ? req.query.conversationId : "";
  if (!/^[a-z0-9-]{16,64}$/i.test(conversationId)) return res.status(400).json({ error: "Identificador de conversa inválido." });
  const entries = await req.zeusDb.collection("zeus_messages").find({ userId: req.zeusUser._id, conversationId }).sort({ createdAt: 1 }).limit(100).toArray();
  return res.json({ conversationId, messages: entries.map((entry) => ({ role: entry.role, content: entry.content, createdAt: entry.createdAt })) });
}));
app.get("/api/me/activity", requireAuth, asyncRoute(async (req, res) => {
  const entries = await req.zeusDb.collection("zeus_audit").find({ userId: req.zeusUser._id }).sort({ createdAt: -1 }).limit(100).toArray();
  return res.json({ entries: entries.map((entry) => ({ id: String(entry._id), action: entry.action, detail: entry.detail, createdAt: entry.createdAt })) });
}));

app.post("/api/ai/chat", requireAuthWhenConfigured, async (req, res) => {
  if (!allowAiRequest(req)) return res.status(429).json({ error: "Muitas mensagens em pouco tempo. Aguarde um minuto." });
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message || message.length > 4000) return res.status(400).json({ error: "Envie uma mensagem de até 4.000 caracteres." });
  const base = (process.env.OLLAMA_BASE_URL || "").replace(/\/$/, "");
  if (!base) return res.status(503).json({ error: "O serviço Ollama ainda não foi configurado." });
  const model = process.env.OLLAMA_MODEL || "llama3.2:1b";
  const conversationId = typeof req.body?.conversationId === "string" && /^[a-z0-9-]{16,64}$/i.test(req.body.conversationId)
    ? req.body.conversationId : crypto.randomUUID();
  const systemMessage = {
    role: "system",
    content: "Você é Zeus, assistente central da Korczak Technologies. Responda em português brasileiro com clareza, autoridade serena, concisão e foco em resolver a solicitação. Ajude a planejar, pesquisar, resumir e coordenar tarefas entre serviços, mas nunca afirme que acessou uma conta, arquivo ou serviço externo sem uma integração real e autorização válida. Nunca invente execução, dados ou resultados. Antes de uma ação externa sensível, explique a ação e solicite confirmação. Respeite privacidade, permissões e políticas dos serviços."
  };
  try {
    const messages = [systemMessage];
    if (req.zeusUser && req.zeusDb) {
      const previous = await req.zeusDb.collection("zeus_messages")
        .find({ userId: req.zeusUser._id, conversationId })
        .sort({ createdAt: -1 }).limit(12).toArray();
      previous.reverse().forEach((entry) => {
        if ((entry.role === "user" || entry.role === "assistant") && typeof entry.content === "string") {
          messages.push({ role: entry.role, content: entry.content.slice(0, 4000) });
        }
      });
      await req.zeusDb.collection("zeus_messages").insertOne({
        userId: req.zeusUser._id, conversationId, role: "user", content: message, createdAt: new Date()
      });
    }
    messages.push({ role: "user", content: message });
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: AbortSignal.timeout(90_000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ error: "Ollama não respondeu corretamente. Confira o modelo instalado e o serviço." });
    const answer = typeof data.message?.content === "string" ? data.message.content : "";
    if (req.zeusUser && req.zeusDb && answer) {
      await req.zeusDb.collection("zeus_messages").insertOne({
        userId: req.zeusUser._id, conversationId, role: "assistant", content: answer.slice(0, 12000), createdAt: new Date()
      });
      await audit(req.zeusDb, req.zeusUser._id, "assistant.response", { conversationId, model });
    }
    return res.json({ response: answer, model, conversationId });
  } catch (error) {
    console.error("Zeus AI request failed:", error.message);
    return res.status(502).json({ error: "Não foi possível acessar Ollama ou salvar a conversa. Verifique os serviços e tente novamente." });
  }
});

app.use((error, _req, res, next) => {
  console.error("Zeus API request failed:", error.message);
  if (res.headersSent) return next(error);
  return res.status(500).json({ error: "Ocorreu um erro interno. Tente novamente." });
});

const port = Number(process.env.PORT || 10000);
app.listen(port, "0.0.0.0", () => console.log("ZeusAPI listening on " + port));
 .-]+$/.test(range)) return res.status(400).json({ error: "Intervalo de planilha inválido." });
      url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(id) + "/values/" + encodeURIComponent(range);
    }
  } else {
    if (resource === "profile") url = "https://graph.microsoft.com/v1.0/me";
    if (resource === "drive-search") {
      if (!query) return res.status(400).json({ error: "Informe q para pesquisar no OneDrive." });
      const safeQuery = query.replace(/'/g, "''");
      url = "https://graph.microsoft.com/v1.0/me/drive/root/search(q='" + encodeURIComponent(safeQuery) + "')?$top=25&$select=id,name,file,folder,webUrl,lastModifiedDateTime,size";
    }
    if (resource === "mail-search") {
      if (!query) return res.status(400).json({ error: "Informe q para pesquisar e-mails." });
      url = "https://graph.microsoft.com/v1.0/me/messages?$top=25&$select=id,subject,from,receivedDateTime,isRead,webLink&$search=" + encodeURIComponent('"subject:' + query + '"');
      extraHeaders = { ConsistencyLevel: "eventual" };
    }
    if (resource === "mail-message") {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return res.status(400).json({ error: "Informe um ID de mensagem válido." });
      url = "https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(id);
    }
    if (resource === "calendar-events") url = "https://graph.microsoft.com/v1.0/me/events?$top=50&$select=id,subject,start,end,organizer,webLink&$orderby=start/dateTime";
    if (resource === "contacts") url = "https://graph.microsoft.com/v1.0/me/contacts?$top=100&$select=id,displayName,emailAddresses,businessPhones";
    if (resource === "tasks-list") url = "https://graph.microsoft.com/v1.0/me/todo/lists";
    if (resource === "tasks") {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return res.status(400).json({ error: "Informe listId como id." });
      url = "https://graph.microsoft.com/v1.0/me/todo/lists/" + encodeURIComponent(id) + "/tasks";
    }
    if (resource === "teams") url = "https://graph.microsoft.com/v1.0/me/joinedTeams";
  }
  if (!url) return res.status(400).json({ error: "Parâmetros insuficientes para este recurso." });
  const result = await providerJson(url, tokenResult.accessToken, extraHeaders);
  if (!result.ok) {
    if (result.status === 401) return res.status(401).json({ error: "O provedor recusou a autorização. Reconecte a conta." });
    console.error("Connector API error", provider, resource, result.status);
    return res.status(502).json({ error: "O provedor não conseguiu concluir a consulta. Verifique as permissões concedidas." });
  }
  await audit(req.zeusDb, req.zeusUser._id, "connector.resource.read", { provider, resource });
  return res.json({ provider, resource, data: result.data });
}));
app.post("/api/me/connectors/:provider/disconnect", requireAuth, asyncRoute(async (req, res) => {
  const provider = req.params.provider;
  if (!["google", "microsoft", "korczak", "other"].includes(provider)) return res.status(404).json({ error: "Conector não reconhecido." });
  const connection = await req.zeusDb.collection("zeus_connections").findOne({ userId: req.zeusUser._id, provider });
  if (connection && provider === "google" && connection.refreshToken) {
    try {
      const token = decryptConnectorSecret(connection.refreshToken);
      if (token) await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }).toString(), signal: AbortSignal.timeout(8000) });
    } catch { /* Local token deletion still proceeds; user can revoke access in provider settings. */ }
  }
  await req.zeusDb.collection("zeus_connections").deleteOne({ userId: req.zeusUser._id, provider });
  await audit(req.zeusDb, req.zeusUser._id, "connector.disconnected", { provider });
  return res.json({ ok: true, note: provider === "microsoft" ? "A conexão local foi removida. Para revogar o consentimento Microsoft, remova o acesso nas configurações da sua conta Microsoft." : "Conexão removida." });
}));
app.get("/api/me/connectors", requireAuth, asyncRoute(async (req, res) => {
  const catalog = [
    { id: "google", name: "Google Workspace", configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), capabilities: ["gmail", "drive", "docs", "sheets", "calendar", "contacts", "tasks"] },
    { id: "microsoft", name: "Microsoft 365", configured: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET), capabilities: ["outlook", "onedrive", "word", "excel", "calendar", "contacts", "tasks", "teams"] },
    { id: "korczak", name: "Korczak Technologies", configured: false, capabilities: ["hub", "nexus", "nexa", "kos", "morok-ai"] },
    { id: "other", name: "Outros serviços", configured: false, capabilities: ["official-api-connectors"] }
  ];
  const connections = await req.zeusDb.collection("zeus_connections").find({ userId: req.zeusUser._id }, { projection: { provider: 1, status: 1, connectedAt: 1 } }).toArray();
  const byProvider = new Map(connections.map((entry) => [entry.provider, entry]));
  return res.json({ connectors: catalog.map((connector) => {
    const connection = byProvider.get(connector.id);
    return { ...connector, status: connection?.status === "connected" ? "connected" : connector.configured ? "available" : "not_configured", connectedAt: connection?.connectedAt || null };
  }) });
}));
app.get("/api/me/messages", requireAuth, asyncRoute(async (req, res) => {
  const conversationId = typeof req.query.conversationId === "string" ? req.query.conversationId : "";
  if (!/^[a-z0-9-]{16,64}$/i.test(conversationId)) return res.status(400).json({ error: "Identificador de conversa inválido." });
  const entries = await req.zeusDb.collection("zeus_messages").find({ userId: req.zeusUser._id, conversationId }).sort({ createdAt: 1 }).limit(100).toArray();
  return res.json({ conversationId, messages: entries.map((entry) => ({ role: entry.role, content: entry.content, createdAt: entry.createdAt })) });
}));
app.get("/api/me/activity", requireAuth, asyncRoute(async (req, res) => {
  const entries = await req.zeusDb.collection("zeus_audit").find({ userId: req.zeusUser._id }).sort({ createdAt: -1 }).limit(100).toArray();
  return res.json({ entries: entries.map((entry) => ({ id: String(entry._id), action: entry.action, detail: entry.detail, createdAt: entry.createdAt })) });
}));

app.post("/api/ai/chat", requireAuthWhenConfigured, async (req, res) => {
  if (!allowAiRequest(req)) return res.status(429).json({ error: "Muitas mensagens em pouco tempo. Aguarde um minuto." });
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message || message.length > 4000) return res.status(400).json({ error: "Envie uma mensagem de até 4.000 caracteres." });
  const base = (process.env.OLLAMA_BASE_URL || "").replace(/\/$/, "");
  if (!base) return res.status(503).json({ error: "O serviço Ollama ainda não foi configurado." });
  const model = process.env.OLLAMA_MODEL || "llama3.2:1b";
  const conversationId = typeof req.body?.conversationId === "string" && /^[a-z0-9-]{16,64}$/i.test(req.body.conversationId)
    ? req.body.conversationId : crypto.randomUUID();
  const systemMessage = {
    role: "system",
    content: "Você é Zeus, assistente central da Korczak Technologies. Responda em português brasileiro com clareza, autoridade serena, concisão e foco em resolver a solicitação. Ajude a planejar, pesquisar, resumir e coordenar tarefas entre serviços, mas nunca afirme que acessou uma conta, arquivo ou serviço externo sem uma integração real e autorização válida. Nunca invente execução, dados ou resultados. Antes de uma ação externa sensível, explique a ação e solicite confirmação. Respeite privacidade, permissões e políticas dos serviços."
  };
  try {
    const messages = [systemMessage];
    if (req.zeusUser && req.zeusDb) {
      const previous = await req.zeusDb.collection("zeus_messages")
        .find({ userId: req.zeusUser._id, conversationId })
        .sort({ createdAt: -1 }).limit(12).toArray();
      previous.reverse().forEach((entry) => {
        if ((entry.role === "user" || entry.role === "assistant") && typeof entry.content === "string") {
          messages.push({ role: entry.role, content: entry.content.slice(0, 4000) });
        }
      });
      await req.zeusDb.collection("zeus_messages").insertOne({
        userId: req.zeusUser._id, conversationId, role: "user", content: message, createdAt: new Date()
      });
    }
    messages.push({ role: "user", content: message });
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: AbortSignal.timeout(90_000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ error: "Ollama não respondeu corretamente. Confira o modelo instalado e o serviço." });
    const answer = typeof data.message?.content === "string" ? data.message.content : "";
    if (req.zeusUser && req.zeusDb && answer) {
      await req.zeusDb.collection("zeus_messages").insertOne({
        userId: req.zeusUser._id, conversationId, role: "assistant", content: answer.slice(0, 12000), createdAt: new Date()
      });
      await audit(req.zeusDb, req.zeusUser._id, "assistant.response", { conversationId, model });
    }
    return res.json({ response: answer, model, conversationId });
  } catch (error) {
    console.error("Zeus AI request failed:", error.message);
    return res.status(502).json({ error: "Não foi possível acessar Ollama ou salvar a conversa. Verifique os serviços e tente novamente." });
  }
});

app.use((error, _req, res, next) => {
  console.error("Zeus API request failed:", error.message);
  if (res.headersSent) return next(error);
  return res.status(500).json({ error: "Ocorreu um erro interno. Tente novamente." });
});

const port = Number(process.env.PORT || 10000);
app.listen(port, "0.0.0.0", () => console.log("ZeusAPI listening on " + port));
