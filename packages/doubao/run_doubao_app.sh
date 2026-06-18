#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CORE_DIR="$ROOT_DIR/packages/core-skill"
SCRIPT_DIR="$CORE_DIR/scripts"

COMPANY_NAME=""
ORG_CODE=""
OUTPUT_ROOT="${POST_LOAN_OUTPUT_ROOT:-$ROOT_DIR/outputs/doubao-app}"
JUDICIAL_MODE="assisted"
INCLUDE_HEALTH="0"
SKIP_JUDICIAL="0"
SKIP_SEARCH="0"
JSON_OUTPUT="0"
MAX_SECONDS="${POST_LOAN_MAX_SECONDS:-540}"
CHUNK_SIZE="${POST_LOAN_BATCH_CHUNK_SIZE:-3}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --company|--company-name) COMPANY_NAME="${2:-}"; shift 2 ;;
    --org-code) ORG_CODE="${2:-}"; shift 2 ;;
    --output-root) OUTPUT_ROOT="${2:-}"; shift 2 ;;
    --judicial-mode) JUDICIAL_MODE="${2:-assisted}"; shift 2 ;;
    --include-health-commission) INCLUDE_HEALTH="1"; shift ;;
    --skip-judicial) SKIP_JUDICIAL="1"; shift ;;
    --skip-search) SKIP_SEARCH="1"; shift ;;
    --json) JSON_OUTPUT="1"; shift ;;
    --max-seconds) MAX_SECONDS="${2:-540}"; shift 2 ;;
    --chunk-size) CHUNK_SIZE="${2:-3}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$COMPANY_NAME" ]]; then
  echo "Missing --company" >&2
  exit 2
fi

NODE_BIN="${POST_LOAN_NODE_EXE:-$(command -v node)}"
PYTHON_BIN="${POST_LOAN_PYTHON_EXE:-$(command -v python3 || command -v python)}"
export POST_LOAN_SKILL_ROOT="$CORE_DIR"
export PYTHONUTF8=1
export NODE_PATH="${POST_LOAN_NODE_MODULES:-$ROOT_DIR/node_modules}"
mkdir -p "$OUTPUT_ROOT"

json_escape() {
  "$PYTHON_BIN" -c 'import json,sys; print(json.dumps(sys.argv[1], ensure_ascii=False)[1:-1])' "$1"
}

normalize_list() {
  "$PYTHON_BIN" - "$1" <<'PY'
import re, sys
items=[x.strip() for x in re.split(r"[,，、\n\r]+", sys.argv[1]) if x.strip()]
print("\n".join(items))
PY
}

mapfile -t COMPANIES < <(normalize_list "$COMPANY_NAME")
mapfile -t CODES < <(normalize_list "$ORG_CODE")

run_single() {
  local company="$1"
  local code="${2:-}"
  local stamp run_dir manifest report args log_file
  stamp="$(date +%Y%m%d-%H%M%S)"
  run_dir="$OUTPUT_ROOT/${company}-${stamp}"
  mkdir -p "$run_dir"
  log_file="$run_dir/run.log"

  args=("$SCRIPT_DIR/capture_template_slots.js" "--company" "$company" "--out-dir" "$run_dir" "--judicial-mode" "$JUDICIAL_MODE")
  [[ -n "$code" ]] && args+=("--org-code" "$code")
  [[ "$INCLUDE_HEALTH" == "1" ]] && args+=("--include-health-commission")
  [[ "$SKIP_JUDICIAL" == "1" ]] && args+=("--skip-judicial")
  [[ "$SKIP_SEARCH" == "1" ]] && args+=("--skip-search")
  if [[ "$SKIP_JUDICIAL" == "1" ]]; then
    args+=("--headless")
  fi

  timeout "${MAX_SECONDS}s" "$NODE_BIN" "${args[@]}" >"$log_file" 2>&1
  manifest="$run_dir/template-slots-manifest.json"
  timeout 60s "$PYTHON_BIN" "$SCRIPT_DIR/build_report.py" --manifest "$manifest" --allow-unverified >>"$log_file" 2>&1
  report="$(find "$run_dir" -maxdepth 1 -name '*.docx' -type f | sort | tail -n 1)"
  if [[ -z "$report" ]]; then
    cat "$log_file" >&2 || true
    echo "Report not found for $company" >&2
    return 1
  fi
  printf '%s\n' "$report"
}

if [[ "${#COMPANIES[@]}" -le 1 ]]; then
  report="$(run_single "${COMPANIES[0]}" "${CODES[0]:-}")"
  if [[ "$JSON_OUTPUT" == "1" ]]; then
    printf '{"ok":true,"mode":"doubao-app-office-task","reportPath":"%s","outputDir":"%s"}\n' "$(json_escape "$report")" "$(json_escape "$(dirname "$report")")"
  else
    echo "DONE $report"
  fi
  exit 0
fi

batch_root="$OUTPUT_ROOT/batch-post-loan-$(date +%Y%m%d-%H%M%S)-$$"
reports_root="$batch_root/reports"
evidence_root="$batch_root/evidence"
mkdir -p "$reports_root" "$evidence_root"
summary="$batch_root/batch-summary.jsonl"
start_epoch="$(date +%s)"

for i in "${!COMPANIES[@]}"; do
  if (( i >= CHUNK_SIZE )); then
    break
  fi
  now_epoch="$(date +%s)"
  if (( now_epoch - start_epoch > MAX_SECONDS )); then
    break
  fi
  company="${COMPANIES[$i]}"
  code="${CODES[$i]:-}"
  company_output="$evidence_root"
  old_root="$OUTPUT_ROOT"
  OUTPUT_ROOT="$company_output"
  ok="true"
  error=""
  report=""
  if report="$(run_single "$company" "$code" 2>&1)"; then
    cp "$report" "$reports_root/"
  else
    ok="false"
    error="$report"
    report=""
  fi
  OUTPUT_ROOT="$old_root"
  printf '{"company":"%s","orgCode":"%s","ok":%s,"report":"%s","error":"%s"}\n' \
    "$(json_escape "$company")" "$(json_escape "$code")" "$ok" "$(json_escape "$report")" "$(json_escape "$error")" >> "$summary"
done

"$PYTHON_BIN" - "$summary" "$batch_root/batch-summary.json" <<'PY'
import json, sys
src, dst = sys.argv[1:3]
rows = [json.loads(line) for line in open(src, encoding="utf-8") if line.strip()]
open(dst, "w", encoding="utf-8").write(json.dumps(rows, ensure_ascii=False, indent=2))
PY
rm -f "$summary"

if [[ "$JSON_OUTPUT" == "1" ]]; then
  printf '{"ok":true,"mode":"doubao-app-office-task","reportsFolder":"%s","batchRoot":"%s"}\n' "$(json_escape "$reports_root")" "$(json_escape "$batch_root")"
else
  echo "BATCH_DONE $reports_root"
fi
