#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

PIDS="$(pgrep -f 'llama-server.*qwen2.5-0.5b-instruct-q4_0.gguf' || true)"
if [ -z "$PIDS" ]; then
  echo "Nenhum servidor Zeus Note20 encontrado."
  exit 0
fi

echo "$PIDS" | xargs -r kill
echo "Sinal de encerramento enviado ao servidor Zeus Note20."
