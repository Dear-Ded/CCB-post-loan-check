#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CORE_DIR="$ROOT_DIR/packages/core-skill"
SCRIPT_DIR="$CORE_DIR/scripts"

COMPANY_NAME=""
ORG_CODE=""
PERSON_VALUES=()
OUTPUT_ROOT="${POST_LOAN_OUTPUT_ROOT:-$ROOT_DIR/outputs/doubao-app}"
JUDICIAL_MODE="assisted"
MODE="${POST_LOAN_INVESTIGATION_MODE:-}"
INCLUDE_HEALTH="0"
SMOKE_QUICK="0"
NO_PROMPT="0"
SKIP_SEARCH="0"
JSON_OUTPUT="0"
MAX_SECONDS="${POST_LOAN_MAX_SECONDS:-540}"
CHUNK_SIZE="${POST_LOAN_BATCH_CHUNK_SIZE:-3}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --company|--company-name) COMPANY_NAME="${2:-}"; shift 2 ;;
    --org-code) ORG_CODE="${2:-}"; shift 2 ;;
    --person) PERSON_VALUES+=("${2:-}"); shift 2 ;;
    --output-root) OUTPUT_ROOT="${2:-}"; shift 2 ;;
    --judicial-mode) JUDICIAL_MODE="${2:-assisted}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --include-health-commission) INCLUDE_HEALTH="1"; shift ;;
    --smoke-quick) SMOKE_QUICK="1"; shift ;;
    --no-prompt) NO_PROMPT="1"; shift ;;
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

RUNTIME_ROOT="${POST_LOAN_RUNTIME_ROOT:-$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies}"
NODE_BIN="${POST_LOAN_NODE_EXE:-}"
PYTHON_BIN="${POST_LOAN_PYTHON_EXE:-}"

node_works() {
  local candidate="$1"
  [[ -n "$candidate" ]] && "$candidate" -e "process.exit(0)" >/dev/null 2>&1
}

python_works() {
  local candidate="$1"
  [[ -n "$candidate" ]] && "$candidate" -c "import sys; sys.exit(0)" >/dev/null 2>&1
}

resolve_working_runtime() {
  local kind="$1"
  shift
  local candidate
  for candidate in "$@"; do
    [[ -z "$candidate" ]] && continue
    if [[ "$kind" == "node" ]]; then
      if node_works "$candidate"; then printf '%s\n' "$candidate"; return 0; fi
    else
      if python_works "$candidate"; then printf '%s\n' "$candidate"; return 0; fi
    fi
  done
  return 1
}

NODE_CANDIDATES=(
  "$NODE_BIN"
  "$RUNTIME_ROOT/node/bin/node"
  "$RUNTIME_ROOT/node/bin/node.exe"
)
if command -v node >/dev/null 2>&1; then NODE_CANDIDATES+=("$(command -v node)"); fi

PYTHON_CANDIDATES=(
  "$PYTHON_BIN"
  "$RUNTIME_ROOT/python/bin/python3"
  "$RUNTIME_ROOT/python/bin/python"
  "$RUNTIME_ROOT/python/python.exe"
  "$RUNTIME_ROOT/python/python"
)
if command -v python3 >/dev/null 2>&1; then PYTHON_CANDIDATES+=("$(command -v python3)"); fi
if command -v python >/dev/null 2>&1; then PYTHON_CANDIDATES+=("$(command -v python)"); fi

NODE_BIN="$(resolve_working_runtime node "${NODE_CANDIDATES[@]}" || true)"
PYTHON_BIN="$(resolve_working_runtime python "${PYTHON_CANDIDATES[@]}" || true)"
if [[ -z "$NODE_BIN" || -z "$PYTHON_BIN" ]]; then
  echo "Missing runtime: node=$NODE_BIN python=$PYTHON_BIN" >&2
  exit 2
fi

export POST_LOAN_SKILL_ROOT="$CORE_DIR"
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
export NODE_PATH="${POST_LOAN_NODE_MODULES:-$ROOT_DIR/node_modules}"
export POST_LOAN_BROWSER_ENGINE="${POST_LOAN_BROWSER_ENGINE:-playwright}"
export POST_LOAN_BROWSER_PERSISTENCE="${POST_LOAN_BROWSER_PERSISTENCE:-ephemeral}"
export POST_LOAN_MANAGED_CONFIRMATION_WAIT_MS="${POST_LOAN_MANAGED_CONFIRMATION_WAIT_MS:-3000}"
export POST_LOAN_JUDGMENT_FAST_FAIL_AUTH_REQUIRED="${POST_LOAN_JUDGMENT_FAST_FAIL_AUTH_REQUIRED:-1}"
export POST_LOAN_JUDGMENT_HOME_FAST_FAIL_TIMEOUT_MS="${POST_LOAN_JUDGMENT_HOME_FAST_FAIL_TIMEOUT_MS:-8000}"
mkdir -p "$OUTPUT_ROOT"

json_escape() {
  "$NODE_BIN" -e 'process.stdout.write(JSON.stringify(process.argv[1] || "").slice(1, -1))' "$1"
}

write_failure_summary() {
  local run_dir="$1"
  local company="$2"
  local code="$3"
  local phase="$4"
  local reason="$5"
  "$PYTHON_BIN" - "$run_dir" "$company" "$code" "$MODE" "$JUDICIAL_MODE" "$phase" "$reason" <<'PY'
import json, os, sys
from datetime import datetime, timezone

run_dir, company, code, mode, judicial_mode, phase, reason = sys.argv[1:8]
payload = {
    "ok": False,
    "finalReportGenerated": False,
    "company": company,
    "orgCode": code,
    "mode": mode,
    "judicialMode": judicial_mode,
    "phase": phase,
    "reason": reason,
    "runDir": run_dir,
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "screenshots": [],
    "missingEvidence": [],
    "nextAction": "Required official result evidence was not confirmed. Re-run when the source is reachable; supplemental sources cannot replace formal evidence."
}
os.makedirs(run_dir, exist_ok=True)
with open(os.path.join(run_dir, "failure-summary.json"), "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
with open(os.path.join(run_dir, "failure-summary.md"), "w", encoding="utf-8") as handle:
    handle.write("# Query Failure Diagnostics\n\n")
    handle.write(f"- Company: {company}\n")
    handle.write(f"- Mode: {mode}\n")
    handle.write(f"- Phase: {phase}\n")
    handle.write(f"- Reason: {reason}\n")
    handle.write("- Formal report: not generated\n")
PY
}

normalize_list() {
  "$NODE_BIN" -e '
const input = process.argv[1] || "";
const items = input.split(/[,\uFF0C\u3001\n\r]+/).map((x) => x.trim()).filter(Boolean);
process.stdout.write(items.join("\n"));
' "$1"
}

mapfile -t COMPANIES < <(normalize_list "$COMPANY_NAME")
mapfile -t CODES < <(normalize_list "$ORG_CODE")
if [[ "${#PERSON_VALUES[@]}" -gt 0 ]]; then
  mapfile -t PERSONS < <(normalize_list "$(printf '%s\n' "${PERSON_VALUES[@]}")")
else
  PERSONS=()
fi
if [[ "${#COMPANIES[@]}" -eq 0 ]]; then
  COMPANIES=("$COMPANY_NAME")
fi
if [[ "${#COMPANIES[@]}" -gt 1 && "${#PERSONS[@]}" -gt 0 ]]; then
  echo "Person queries are only supported for single-company runs." >&2
  exit 2
fi

run_single() {
  local company="$1"
  local code="${2:-}"
  local stamp run_dir manifest report args log_file report_name template_path
  stamp="$(date +%Y%m%d-%H%M%S)"
  run_dir="$OUTPUT_ROOT/${company}-${stamp}"
  mkdir -p "$run_dir"
  log_file="$run_dir/run.log"
  printf 'runtime node=%s python=%s mode=%s\n' "$NODE_BIN" "$PYTHON_BIN" "${MODE:-settings}" >>"$log_file"

  args=("$SCRIPT_DIR/capture_template_slots.js" "--company" "$company" "--out-dir" "$run_dir" "--judicial-mode" "$JUDICIAL_MODE" "--headless" "--no-prompt")
  [[ -n "$MODE" ]] && args+=("--mode" "$MODE")
  [[ -n "$code" ]] && args+=("--org-code" "$code")
  [[ "$INCLUDE_HEALTH" == "1" ]] && args+=("--include-health-commission")
  [[ "$SMOKE_QUICK" == "1" ]] && args+=("--smoke-quick")
  [[ "$SKIP_SEARCH" == "1" ]] && args+=("--skip-search")
  for person in "${PERSONS[@]}"; do
    args+=("--person" "$person")
  done

  manifest="$run_dir/template-slots-manifest.json"
  set +e
  timeout "${MAX_SECONDS}s" "$NODE_BIN" "${args[@]}" >>"$log_file" 2>&1
  local capture_status=$?
  set -e
  if [[ "$capture_status" -ne 0 && ! -f "$manifest" ]]; then
    cat "$log_file" >&2 || true
    write_failure_summary "$run_dir" "$company" "$code" "portal_capture" "Capture failed before manifest was created for $company. See run.log."
    echo "Capture failed before manifest was created for $company" >&2
    return "$capture_status"
  fi
  if [[ "$capture_status" -ne 0 ]]; then
    cat "$log_file" >&2 || true
    write_failure_summary "$run_dir" "$company" "$code" "portal_capture" "Capture failed for $company. See run.log."
    echo "Capture failed for $company" >&2
    return "$capture_status"
  fi

  report_prefix=$'\u8d37\u540e\u67e5\u8be2'
  report_name="${report_prefix}-${company}-$(date +%Y%m%d).docx"
  template_name=$'\u8d37\u540e\u67e5\u8be2\u6a21\u677f.docx'
  template_path="$CORE_DIR/assets/$template_name"
  set +e
  timeout 60s "$PYTHON_BIN" "$SCRIPT_DIR/build_report.py" --manifest "$manifest" --template "$template_path" --out "$run_dir/$report_name" >>"$log_file" 2>&1
  local build_status=$?
  set -e
  if [[ "$build_status" -ne 0 ]]; then
    cat "$log_file" >&2 || true
    write_failure_summary "$run_dir" "$company" "$code" "report_build" "Report build failed for $company. See run.log."
    echo "Report build failed for $company" >&2
    return "$build_status"
  fi
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
    printf '{"ok":true,"mode":"doubao-app-office-task","queryMode":"%s","reportPath":"%s","outputDir":"%s"}\n' "$(json_escape "$MODE")" "$(json_escape "$report")" "$(json_escape "$(dirname "$report")")"
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
partial="false"
remaining=0

for i in "${!COMPANIES[@]}"; do
  if (( i >= CHUNK_SIZE )); then
    partial="true"
    remaining=$((${#COMPANIES[@]} - i))
    break
  fi
  now_epoch="$(date +%s)"
  if (( now_epoch - start_epoch > MAX_SECONDS )); then
    partial="true"
    remaining=$((${#COMPANIES[@]} - i))
    break
  fi
  company="${COMPANIES[$i]}"
  code="${CODES[$i]:-}"
  old_root="$OUTPUT_ROOT"
  OUTPUT_ROOT="$evidence_root"
  ok="true"
  error=""
  report=""
  delivered_report=""
  if report="$(run_single "$company" "$code" 2>&1)"; then
    delivered_report="$reports_root/$(basename "$report")"
    cp "$report" "$delivered_report"
  else
    ok="false"
    error="$report"
    report=""
  fi
  OUTPUT_ROOT="$old_root"
  printf '{"company":"%s","orgCode":"%s","ok":%s,"report":"%s","error":"%s"}\n' \
    "$(json_escape "$company")" "$(json_escape "$code")" "$ok" "$(json_escape "$delivered_report")" "$(json_escape "$error")" >> "$summary"
done

"$PYTHON_BIN" - "$summary" "$batch_root/batch-summary.json" "$partial" "$remaining" "$MODE" <<'PY'
import json, sys
src, dst, partial, remaining, mode = sys.argv[1:6]
rows = [json.loads(line) for line in open(src, encoding="utf-8") if line.strip()]
payload = {
    "ok": all(row.get("ok") for row in rows) and partial != "true",
    "partial": partial == "true",
    "remainingCompanies": int(remaining or 0),
    "queryMode": mode,
    "items": rows
}
open(dst, "w", encoding="utf-8").write(json.dumps(payload, ensure_ascii=False, indent=2))
PY
rm -f "$summary"

if [[ "$JSON_OUTPUT" == "1" ]]; then
  if [[ "$partial" == "true" ]]; then ok_json="false"; else ok_json="true"; fi
  printf '{"ok":%s,"partial":%s,"remainingCompanies":%s,"mode":"doubao-app-office-task","queryMode":"%s","reportsFolder":"%s","batchRoot":"%s"}\n' "$ok_json" "$partial" "$remaining" "$(json_escape "$MODE")" "$(json_escape "$reports_root")" "$(json_escape "$batch_root")"
else
  echo "BATCH_DONE $reports_root"
fi
