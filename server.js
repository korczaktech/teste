const express = require("express");
const { MongoClient } = require("mongodb");

const app = express();
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

app.get("/", (_req, res) => res.json({ name: "ZeusAPI", version: "0.1.0", status: "ok" }));
app.get("/health", (_req, res) => res.json({ status: "ok", service: "ZeusAPI" }));
app.get("/api/status", async (_req, res) => {
  let database = "not_configured";
  try {
    const db = await getDb();
    if (db) { await db.command({ ping: 1 }); database = "connected"; }
  } catch { database = "unavailable"; }
  res.json({ api: "ok", mongodb: database, ollama: process.env.OLLAMA_BASE_URL ? "configured" : "not_configured" });
});
app.post("/api/ai/chat", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message || message.length > 4000) return res.status(400).json({ error: "Envie uma mensagem de até 4.000 caracteres." });
  const base = (process.env.OLLAMA_BASE_URL || "").replace(/\/$/, "");
  if (!base) return res.status(503).json({ error: "O serviço Ollama ainda não foi configurado." });
  const model = process.env.OLLAMA_MODEL || "llama3.2:1b";
  try {
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: "Você é Zeus, assistente de planejamento e análise de redes sociais. Responda em português brasileiro. Não recomende spam, engajamento falso, contas falsas ou violação de políticas de plataformas. Não afirme que executou ações externas." }, { role: "user", content: message }], stream: false }),
      signal: AbortSignal.timeout(90000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ error: "Ollama não respondeu corretamente. Confira o modelo instalado e o serviço." });
    return res.json({ response: data.message?.content || "", model });
  } catch (err) {
    return res.status(502).json({ error: "Não foi possível acessar Ollama. Verifique se o serviço está ativo e acessível." });
  }
});

const port = Number(process.env.PORT || 10000);
app.listen(port, "0.0.0.0", () => console.log("ZeusAPI listening on " + port));
