#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

PIDS="$(pgrep -f 'llama-server.*qwen2.5-1.5b-instruct-q4_k_m.gguf' || true)"
if [ -z "$PIDS" ]; then
  echo "Nenhum servidor Zeus J8 encontrado."
else
  echo "$PIDS" | xargs -r kill
  echo "Sinal de encerramento enviado ao servidor Zeus J8."
fi

if command -v termux-wake-unlock >/dev/null 2>&1; then
  termux-wake-unlock || true
fi
