#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="$HOME/zeus-inference"
SRC="$ROOT/llama.cpp"
BUILD="$SRC/build"
MODEL_DIR="$ROOT/models"
MODEL="$MODEL_DIR/qwen2.5-0.5b-instruct-q4_0.gguf"
MODEL_URL="https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_0.gguf"

echo "== Zeus / Note20 — preparação do servidor local =="
echo "Este script compila llama.cpp no próprio celular; mantenha-o carregando e com espaço livre."
pkg update -y
pkg install -y git cmake ninja clang make pkg-config curl

mkdir -p "$ROOT" "$MODEL_DIR" "$ROOT/logs"

if [ ! -d "$SRC/.git" ]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$SRC"
else
  git -C "$SRC" pull --ff-only
fi

echo "== Compilando llama-server (CPU, sem dependência de OpenMP) =="
cmake -S "$SRC" -B "$BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_OPENMP=OFF \
  -DGGML_NATIVE=OFF \
  -DLLAMA_BUILD_SERVER=ON \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF
cmake --build "$BUILD" --target llama-server -j 2

if [ ! -s "$MODEL" ]; then
  echo "== Baixando modelo Qwen2.5 0.5B Instruct (quantização Q4_0, ~430 MB) =="
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
echo "Próximo passo: cd ~/teste/mobile-inference/note20 && bash start.sh"
