#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DOUBAO_RUNNER="$ROOT_DIR/packages/doubao/run_doubao_app.sh"

COMPANY_NAME=""
ORG_CODE=""
PERSON_VALUES=()
OUTPUT_ROOT=""
MODE="${POST_LOAN_INVESTIGATION_MODE:-}"
JUDICIAL_MODE="assisted"
INCLUDE_HEALTH="0"
SKIP_SEARCH="0"
JSON_OUTPUT="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --company|--company-name|-CompanyName) COMPANY_NAME="${2:-}"; shift 2 ;;
    --org-code|-OrgCode) ORG_CODE="${2:-}"; shift 2 ;;
    --person|-Person) PERSON_VALUES+=("${2:-}"); shift 2 ;;
    --output-root|-OutputRoot) OUTPUT_ROOT="${2:-}"; shift 2 ;;
    --mode|-Mode) MODE="${2:-}"; shift 2 ;;
    --judicial-mode|-JudicialMode) JUDICIAL_MODE="${2:-assisted}"; shift 2 ;;
    --include-health-commission|-IncludeHealthCommission) INCLUDE_HEALTH="1"; shift ;;
    --skip-search|-SkipSearch) SKIP_SEARCH="1"; shift ;;
    --json|-Json) JSON_OUTPUT="1"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$COMPANY_NAME" ]]; then
  echo "Missing --company" >&2
  exit 2
fi

args=("$DOUBAO_RUNNER" "--company" "$COMPANY_NAME" "--judicial-mode" "$JUDICIAL_MODE")
[[ -n "$MODE" ]] && args+=("--mode" "$MODE")
[[ -n "$ORG_CODE" ]] && args+=("--org-code" "$ORG_CODE")
for person in "${PERSON_VALUES[@]}"; do
  args+=("--person" "$person")
done
[[ -n "$OUTPUT_ROOT" ]] && args+=("--output-root" "$OUTPUT_ROOT")
[[ "$INCLUDE_HEALTH" == "1" ]] && args+=("--include-health-commission")
[[ "$SKIP_SEARCH" == "1" ]] && args+=("--skip-search")
[[ "$JSON_OUTPUT" == "1" ]] && args+=("--json")

bash "${args[@]}"
