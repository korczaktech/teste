#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="$HOME/zeus-inference-j8"
SRC="$ROOT/llama.cpp"
BUILD="$SRC/build"
MODEL_DIR="$ROOT/models"
MODEL="$MODEL_DIR/qwen2.5-1.5b-instruct-q4_k_m.gguf"
MODEL_URL="https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"

echo "== Zeus / Galaxy J8 — Qwen2.5 1.5B Instruct Q4_K_M =="
echo "Recomendado: 4–5 GB livres, energia conectada e aplicativos pesados fechados."
pkg update -y
pkg install -y git cmake ninja clang make pkg-config curl termux-tools

mkdir -p "$ROOT" "$MODEL_DIR" "$ROOT/logs"

if [ ! -d "$SRC/.git" ]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$SRC"
else
  git -C "$SRC" pull --ff-only
fi

echo "== Compilando llama-server para CPU, sem OpenMP =="
cmake -S "$SRC" -B "$BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_OPENMP=OFF \
  -DGGML_NATIVE=OFF \
  -DLLAMA_BUILD_SERVER=ON \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF
cmake --build "$BUILD" --target llama-server -j 2

if [ ! -s "$MODEL" ]; then
  echo "== Baixando Qwen2.5 1.5B Instruct Q4_K_M (aprox. 1,1 GB) =="
  curl -fL --retry 3 --retry-delay 2 "$MODEL_URL" -o "$MODEL.part"
  mv "$MODEL.part" "$MODEL"
fi

if [ ! -x "$BUILD/bin/llama-server" ]; then
  echo "ERRO: llama-server não foi encontrado em $BUILD/bin/llama-server" >&2
  exit 1
fi
if [ ! -s "$MODEL" ]; then
  echo "ERRO: arquivo do modelo ausente ou vazio: $MODEL" >&2
  exit 1
fi

echo
echo "Preparação concluída."
echo "Binário: $BUILD/bin/llama-server"
echo "Modelo:  $MODEL"
echo "Próximo passo: cd ~/teste/mobile-inference/j8 && bash start.sh"
