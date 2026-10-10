#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

BASE_URL="${ZEUS_J8_URL:-http://127.0.0.1:8080}"
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
curl -fsS --max-time 240 "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "zeus-j8-qwen25-1.5b",
    "messages": [
      {
        "role": "system",
        "content": "Responda em português brasileiro, de forma direta e curta. Siga exatamente a solicitação."
      },
      {
        "role": "user",
        "content": "Responda apenas: Servidor J8 com Qwen2.5 funcionando."
      }
    ],
    "temperature": 0.1,
    "max_tokens": 32,
    "stream": false
  }'
echo
