#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CORE_DIR="$ROOT_DIR/packages/core-skill"

node_path="$(command -v node || true)"
python_path="$(command -v python3 || command -v python || true)"

if [[ -z "$node_path" ]]; then
  echo '{"ok":false,"reason":"node_not_found"}'
  exit 1
fi
if [[ -z "$python_path" ]]; then
  echo '{"ok":false,"reason":"python_not_found"}'
  exit 1
fi
if [[ ! -f "$CORE_DIR/assets/贷后查询模板.docx" ]]; then
  echo '{"ok":false,"reason":"template_not_found"}'
  exit 1
fi

playwright_ok="false"
if NODE_PATH="${POST_LOAN_NODE_MODULES:-$ROOT_DIR/node_modules}" "$node_path" -e 'require("playwright");' >/dev/null 2>&1; then
  playwright_ok="true"
fi

python_ok="false"
if "$python_path" - <<'PY' >/dev/null 2>&1
import PIL, lxml
PY
then
  python_ok="true"
fi

if [[ "$playwright_ok" != "true" ]]; then
  echo '{"ok":false,"reason":"playwright_not_found","hint":"Use Doubao office-task skill runtime or provide POST_LOAN_NODE_MODULES."}'
  exit 1
fi
if [[ "$python_ok" != "true" ]]; then
  echo '{"ok":false,"reason":"python_docx_dependencies_not_found","hint":"Need pillow and lxml; Doubao Python runtime normally includes them."}'
  exit 1
fi

printf '{"ok":true,"node":"%s","python":"%s","root":"%s"}\n' "$node_path" "$python_path" "$ROOT_DIR"
