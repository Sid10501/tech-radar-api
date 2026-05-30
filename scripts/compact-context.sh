#!/usr/bin/env bash
# compact-context.sh — print the session preservation brief for /compact.
#
# Usage (from repo root):
#   ./scripts/compact-context.sh
#
# In other repos onboarded via ai-memory:
#   ./scripts/compact-context.sh   # if onboard copied the script, or
#   cat .agents/session-context.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BRIEF="$REPO_ROOT/.agents/session-context.md"

if [[ ! -f "$BRIEF" ]]; then
  echo "compact-context: missing $BRIEF" >&2
  echo "Run ./onboard.sh from the project root, or copy:" >&2
  echo "  ~/.ai-memory/templates/PROJECT_SESSION_CONTEXT.md -> .agents/session-context.md" >&2
  exit 1
fi

cat "$BRIEF"
