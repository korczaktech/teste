#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

BASE_URL="${ZEUS_NOTE20_URL:-http://127.0.0.1:8080}"
BASE_URL="${BASE_URL%/}"

echo "== Health =="
curl -fsS --max-time 10 "$BASE_URL/health"
echo
echo
echo "== Model listing =="
curl -fsS --max-time 15 "$BASE_URL/v1/models"
echo
echo
echo "== Chat completion =="
curl -fsS --max-time 180 "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "zeus-note20",
    "messages": [
      {
        "role": "system",
        "content": "Responda somente em português brasileiro, de forma direta. Não gere código quando não for solicitado."
      },
      {
        "role": "user",
        "content": "Responda apenas: Servidor Note20 funcionando."
      }
    ],
    "temperature": 0.2,
    "max_tokens": 48,
    "stream": false
  }'
echo
