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
    voice: "pt-BR-AntonioNeural"
  });
});

app.post("/api/voice/tts", async (req, res) => {
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
