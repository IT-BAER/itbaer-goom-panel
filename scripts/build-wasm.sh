#!/usr/bin/env bash
# Build cloudflare/doom-wasm via the official emscripten/emsdk Docker image.
# Outputs src/wasm/doom.js + src/wasm/doom.wasm.
#
# Upstream (`cloudflare/doom-wasm`) is GPL-2.0-or-later; we redistribute its
# built artifacts under GPL-3.0-or-later (compatible upgrade). See NOTICE.
#
# Usage:   scripts/build-wasm.sh [--emsdk-tag 3.1.56] [--clean]
set -euo pipefail

EMSDK_TAG="3.1.56"        # pinned: last known to work with this 5-year-old tree
DO_CLEAN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --emsdk-tag) EMSDK_TAG="$2"; shift 2 ;;
    --clean)     DO_CLEAN=1; shift ;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="${ROOT_DIR}/vendor/doom-wasm"
OUT_DIR="${ROOT_DIR}/src/wasm"

if [[ ! -d "${VENDOR_DIR}" ]]; then
  echo "[build-wasm] vendor/doom-wasm missing. Run: git submodule update --init --recursive" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[build-wasm] Docker is required (Path 3a). Install Docker Desktop or adjust to a host build." >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

IMAGE="emscripten/emsdk:${EMSDK_TAG}"
echo "[build-wasm] Using ${IMAGE}"

# Portable path for -v on Windows Git Bash (MSYS) path -> WSL-style /c/...
if [[ "${OSTYPE:-}" == "msys" || "${OSTYPE:-}" == "cygwin" ]]; then
  MOUNT_SRC="$(cygpath -m "${VENDOR_DIR}")"
else
  MOUNT_SRC="${VENDOR_DIR}"
fi

# Build inside container. apt deps (autoconf/automake/libtool) are already in
# emscripten/emsdk images; we install defensively in case of a slim variant.
# MSYS_NO_PATHCONV=1 prevents Git Bash on Windows from rewriting /src into C:\...
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "${MOUNT_SRC}:/src" \
  -w /src \
  "${IMAGE}" \
  bash -lc "
    set -euo pipefail
    if ! command -v autoreconf >/dev/null 2>&1; then
      apt-get update -qq
      DEBIAN_FRONTEND=noninteractive apt-get install -yqq --no-install-recommends autoconf automake libtool pkg-config dos2unix
    elif ! command -v dos2unix >/dev/null 2>&1; then
      apt-get update -qq
      DEBIAN_FRONTEND=noninteractive apt-get install -yqq --no-install-recommends dos2unix
    fi
    # Normalize line endings for ALL files in the source tree. dos2unix
    # auto-skips binary files (PNG, WAD, object files) so this is safe.
    # Windows git clone frequently injects CRLF into every text file (C, H,
    # Makefile, shell, python, shebang-only scripts like textscreen/convert-font).
    find . -type f -print0 | xargs -0 -r dos2unix -q 2>/dev/null || true
    if [[ '${DO_CLEAN}' == '1' ]] || [[ ! -f configure ]]; then
      emmake make clean 2>/dev/null || true
    fi
    emconfigure autoreconf -fiv
    ac_cv_exeext='.html' emconfigure ./configure --host=none-none-none
    emmake make -j\"\$(nproc)\"
  "

# Locate build outputs. Upstream Makefile.am sets
#   execgames_PROGRAMS = @PROGRAM_PREFIX@doom
# and the current configure.ac hardcodes PROGRAM_PREFIX=websockets-, so the
# artifacts land at vendor/doom-wasm/src/websockets-doom.{js,wasm}.
CAND_DIR="${VENDOR_DIR}/src"
JS_SRC="${CAND_DIR}/websockets-doom.js"
WASM_SRC="${CAND_DIR}/websockets-doom.wasm"

if [[ ! -f "${JS_SRC}" || ! -f "${WASM_SRC}" ]]; then
  echo "[build-wasm] ERROR: expected outputs not found:" >&2
  echo "  ${JS_SRC}" >&2
  echo "  ${WASM_SRC}" >&2
  echo "  (showing contents of ${CAND_DIR})" >&2
  ls -la "${CAND_DIR}" >&2 || true
  exit 1
fi

cp -f "${JS_SRC}"   "${OUT_DIR}/doom.js"
cp -f "${WASM_SRC}" "${OUT_DIR}/doom.wasm"

echo "[build-wasm] OK:"
ls -lh "${OUT_DIR}/doom.js" "${OUT_DIR}/doom.wasm"
