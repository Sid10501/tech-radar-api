#!/bin/bash
# Project preCompact hook — reminds you to paste the preservation brief into /compact.
# Installed by ~/.ai-memory/onboard.sh as .cursor/hooks/pre-compact.sh

set -euo pipefail

dir="${CURSOR_PROJECT_DIR:-$(pwd)}"
brief="${dir}/.agents/session-context.md"
script="${dir}/scripts/compact-context.sh"

if [[ ! -f "$brief" && ! -x "$script" ]]; then
  echo '{}'
  exit 0
fi

input=$(cat)
trigger=$(echo "$input" | grep -o '"trigger":"[^"]*"' | head -1 | cut -d'"' -f4)
pct=$(echo "$input" | grep -o '"context_usage_percent":[0-9]*' | head -1 | cut -d: -f2)
pct_note=""
[[ -n "$pct" ]] && pct_note=" (~${pct}% of context window)"

if [[ -x "$script" ]]; then
  msg="Context compaction (${trigger:-compact}${pct_note}). Run ./scripts/compact-context.sh, copy the output, and paste it into /compact as the preservation instruction."
else
  msg="Context compaction (${trigger:-compact}${pct_note}). Open .agents/session-context.md, copy the full brief, and paste it into /compact as the preservation instruction."
fi

python3 -c 'import json,sys; print(json.dumps({"user_message": sys.argv[1]}))' "$msg"
exit 0
