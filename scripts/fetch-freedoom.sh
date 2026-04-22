#!/usr/bin/env bash
# Fetch Freedoom 0.13.0 and extract freedoom1.wad into src/public/wads/.
# Idempotent: re-running after a successful fetch is a no-op.
#
# Freedoom is modified-BSD licensed and bundled as the default IWAD so the
# plugin can play immediately without any user-supplied assets. See NOTICE.
set -euo pipefail

FREEDOOM_VERSION="0.13.0"
ZIP_URL="https://github.com/freedoom/freedoom/releases/download/v${FREEDOOM_VERSION}/freedoom-${FREEDOOM_VERSION}.zip"
ZIP_SHA256="3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59"
WAD_SHA256="7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${ROOT_DIR}/.cache/freedoom"
OUT_DIR="${ROOT_DIR}/src/public/wads"
OUT_WAD="${OUT_DIR}/freedoom1.wad"
ZIP_PATH="${CACHE_DIR}/freedoom-${FREEDOOM_VERSION}.zip"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

mkdir -p "${CACHE_DIR}" "${OUT_DIR}"

# Short-circuit if output WAD already verifies.
if [[ -f "${OUT_WAD}" ]]; then
  have="$(sha256_of "${OUT_WAD}")"
  if [[ "${have}" == "${WAD_SHA256}" ]]; then
    echo "[fetch-freedoom] freedoom1.wad already present and verified (sha256 ok). Skipping."
    exit 0
  fi
  echo "[fetch-freedoom] freedoom1.wad present but sha256 mismatch; re-fetching."
  rm -f "${OUT_WAD}"
fi

# Download the ZIP if we don't already have a verified copy.
need_download=1
if [[ -f "${ZIP_PATH}" ]]; then
  have="$(sha256_of "${ZIP_PATH}")"
  if [[ "${have}" == "${ZIP_SHA256}" ]]; then
    need_download=0
    echo "[fetch-freedoom] Using cached ${ZIP_PATH}"
  fi
fi

if [[ "${need_download}" -eq 1 ]]; then
  echo "[fetch-freedoom] Downloading ${ZIP_URL}"
  curl --fail --location --silent --show-error -o "${ZIP_PATH}" "${ZIP_URL}"
  have="$(sha256_of "${ZIP_PATH}")"
  if [[ "${have}" != "${ZIP_SHA256}" ]]; then
    echo "[fetch-freedoom] ERROR: ZIP sha256 mismatch" >&2
    echo "  expected: ${ZIP_SHA256}" >&2
    echo "  got:      ${have}" >&2
    exit 1
  fi
  echo "[fetch-freedoom] ZIP sha256 ok."
fi

# Extract freedoom1.wad using python3 (portable, avoids unzip dep).
echo "[fetch-freedoom] Extracting freedoom1.wad -> ${OUT_WAD}"
python3 - "$ZIP_PATH" "$OUT_WAD" <<'PY'
import sys, zipfile, shutil
zip_path, out_path = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path) as z:
    with z.open(f"freedoom-0.13.0/freedoom1.wad") as src, open(out_path, "wb") as dst:
        shutil.copyfileobj(src, dst, 1 << 20)
PY

have="$(sha256_of "${OUT_WAD}")"
if [[ "${have}" != "${WAD_SHA256}" ]]; then
  echo "[fetch-freedoom] ERROR: extracted WAD sha256 mismatch" >&2
  echo "  expected: ${WAD_SHA256}" >&2
  echo "  got:      ${have}" >&2
  exit 1
fi

echo "[fetch-freedoom] OK: ${OUT_WAD} ($(wc -c < "${OUT_WAD}") bytes, sha256 ${WAD_SHA256})"
