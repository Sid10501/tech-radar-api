#!/bin/bash
# Project PreCompact hook for Codex — reminds you to paste the preservation brief.
# Installed by ~/.ai-memory/onboard.sh as .codex/hooks/pre-compact.sh

set -euo pipefail

AI_MEMORY="${HOME}/.ai-memory"
# shellcheck source=/dev/null
source "${AI_MEMORY}/tools/compact/_compact-common.sh"

input=$(cat)
dir="${PWD}"
if parsed=$(compact_project_dir "$input" 2>/dev/null); then
  dir="$parsed"
fi

if ! compact_has_brief "$dir"; then
  exit 0
fi

trigger=$(echo "$input" | python3 -c 'import json,sys
try:
  print(json.load(sys.stdin).get("trigger") or "")
except Exception:
  print("")' 2>/dev/null || true)
[[ -z "$trigger" ]] && trigger="compact"

msg=$(compact_pre_compact_user_message "$dir" "$trigger" "")
python3 -c 'import json,sys; print(json.dumps({"systemMessage": sys.argv[1]}))' "$msg"
exit 0
