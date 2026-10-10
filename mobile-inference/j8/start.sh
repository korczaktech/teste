#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="$HOME/zeus-inference-j8"
SERVER="$ROOT/llama.cpp/build/bin/llama-server"
MODEL="$ROOT/models/qwen2.5-1.5b-instruct-q4_k_m.gguf"
LOG="$ROOT/logs/llama-server.log"

if [ ! -x "$SERVER" ]; then
  echo "llama-server não encontrado. Execute primeiro install.sh." >&2
  exit 1
fi
if [ ! -s "$MODEL" ]; then
  echo "Modelo não encontrado. Execute primeiro install.sh." >&2
  exit 1
fi
if curl -fsS --max-time 2 http://127.0.0.1:8080/health >/dev/null 2>&1; then
  echo "Já existe um servidor respondendo em http://127.0.0.1:8080"
  exit 0
fi

mkdir -p "$ROOT/logs"
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || true
fi

echo "Iniciando Zeus J8 somente em localhost; não exposto à rede..."
nohup "$SERVER" \
  --model "$MODEL" \
  --alias zeus-j8-qwen25-1.5b \
  --host 127.0.0.1 \
  --port 8080 \
  --ctx-size 1024 \
  --threads 4 \
  --parallel 1 \
  >"$LOG" 2>&1 </dev/null &

for i in $(seq 1 90); do
  if curl -fsS --max-time 2 http://127.0.0.1:8080/health >/dev/null 2>&1; then
    echo "Servidor pronto: http://127.0.0.1:8080"
    echo "Health: http://127.0.0.1:8080/health"
    echo "Log: $LOG"
    exit 0
  fi
  sleep 2
done

echo "O servidor não ficou pronto em 180 segundos. Últimas linhas do log:" >&2
tail -n 100 "$LOG" >&2 || true
exit 1
