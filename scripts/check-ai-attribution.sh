#!/usr/bin/env bash
# AI-attribution scanner — the single source of truth for what counts as an
# AI authorship credit in this repo.
#
# WHY THIS EXISTS
#   A `Co-Authored-By:` trailer naming an AI once reached `main` and produced an
#   AI entry in this repo's GitHub contributor list. Removing it cost a history
#   rewrite, a force-push of `main`, and temporarily relaxing branch protection —
#   and even that could not remove everything: GitHub's `refs/pull/N/head` refs
#   are permanent, so the pre-rewrite commits are still served by SHA forever.
#   The only affordable defence is refusing the text before it lands.
#
# WHAT IT SCANS
#   Any text: a commit message file, or a pull request body. Both matter.
#   The PR body matters MORE than it looks: this repo allows squash merges only,
#   with `squash_merge_commit_message = PR_BODY`, so GitHub copies the pull
#   request description verbatim into the commit message on `main`. An attribution
#   footer in a PR body therefore becomes attribution in git history automatically.
#   That is exactly how it leaked the first time.
#
# DESIGN NOTES
#   - Patterns are ANCHORED to the start of a line. A real trailer always stands
#     alone on its own line, so anchoring lets prose *about* these strings pass —
#     including this file, the hook, AGENTS.md, and commits that discuss the rule.
#   - Matching covers the EMAIL, not just the display name. GitHub builds the
#     contributor list from the co-author's email address, so
#     `Co-authored-by: AI Assistant <noreply@anthropic.com>` is exactly as harmful
#     as one that spells out "Claude" — and a name-only check misses it.
#   - Per-pattern loop, not one long alternation: see the note in
#     scripts/check-public-boundary.sh about long shell-quoted alternations
#     silently matching zero on some hosts.
#   - POSIX ERE only (grep -E). No PCRE, so no `\b` and no `\d`.
#   - Human co-authors are NOT blocked. `Co-authored-by: Budi <budi@example.com>`
#     is a genuine pair-programming trailer and must keep working.
#
# Exit codes:
#   0 - clean
#   1 - at least one AI attribution line found
#
# Usage:
#   bash scripts/check-ai-attribution.sh [--strip-comments] [--label NAME] FILE...
#   ... | bash scripts/check-ai-attribution.sh [--label NAME]
#
#   --strip-comments  drop lines beginning with '#' before scanning (commit
#                     message templates legitimately mention anything)

set -uo pipefail

STRIP_COMMENTS=0
LABEL=""
FILES=()

while [ $# -gt 0 ]; do
  case "$1" in
    --strip-comments) STRIP_COMMENTS=1; shift ;;
    --label) LABEL="${2:-}"; shift 2 ;;
    --) shift; while [ $# -gt 0 ]; do FILES+=("$1"); shift; done ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) FILES+=("$1"); shift ;;
  esac
done

# Each entry is one anchored ERE. Kept separate and commented so the reason for
# every pattern survives the next person who reads this.
PATTERNS=(
  # 1. Co-author trailer naming an AI assistant by vendor/product name.
  '^[[:space:]]*co-?authored-by:.*(claude|anthropic|copilot|cursor|codex|chatgpt|openai|gemini|devin|windsurf|tabnine|replit agent|amazon q|codewhisperer)'

  # 2. Co-author trailer carrying an AI vendor email domain. This is the field
  #    GitHub actually resolves to an account, so it must be matched even when
  #    the display name is innocuous ("AI Assistant", "Bot", a person's name).
  '^[[:space:]]*co-?authored-by:.*@(anthropic|openai|cursor|cognition|codeium)\.(com|ai)'

  # 3. GitHub Copilot's machine account, which uses a plain users.noreply address.
  '^[[:space:]]*co-?authored-by:.*copilot@users\.noreply\.github\.com'

  # 4. Generic AI identity as co-author, vendor-neutral.
  '^[[:space:]]*co-?authored-by:.*(ai[ _-]?(assistant|agent|bot|pair)|assistant[ _-]?ai)'

  # 5. "Generated with/by <AI>" footers, including the robot-emoji form. Covers
  #    the near-misses of the original pattern: generated/created/written/
  #    authored/made/built, with/by, and an optional markdown link bracket.
  '^[[:space:]]*(:robot:|🤖)?[[:space:]]*(generated|created|written|authored|made|built|produced)[[:space:]]+(with|by|using)[[:space:]]+\[?(claude|anthropic|copilot|cursor|codex|chatgpt|gpt-|openai|gemini|devin|windsurf)'

  # 6. A robot-emoji line that names an AI in any phrasing not caught above.
  '^[[:space:]]*(:robot:|🤖).*(claude|anthropic|copilot|cursor|codex|chatgpt|openai|gemini)'

  # 7. Other trailer fields used to credit a non-author participant.
  '^[[:space:]]*(assisted-by|on-behalf-of|signed-off-by|reviewed-by):.*(claude|anthropic|copilot@|cursor|chatgpt|@anthropic\.com|@openai\.com)'
)

scan_text() {
  # $1 = label for messages, stdin = text
  local label="$1" text pattern hits all=""
  text="$(cat)"
  if [ "$STRIP_COMMENTS" -eq 1 ]; then
    text="$(printf '%s\n' "$text" | grep -v '^#')"
  fi
  for pattern in "${PATTERNS[@]}"; do
    hits="$(printf '%s\n' "$text" | grep -inE "$pattern" || true)"
    [ -n "$hits" ] && all="${all}${hits}"$'\n'
  done
  [ -z "${all//[$'\n']/}" ] && return 0

  # One offending line usually trips several patterns (a Claude trailer matches
  # both the vendor-name rule and the email-domain rule). Report each line once,
  # in file order, so the output stays readable.
  echo "" >&2
  echo "AI attribution found in ${label}:" >&2
  printf '%s' "$all" | grep -v '^$' | sort -t: -k1,1n -u | sed 's/^/  line /' >&2
  return 1
}

status=0

if [ "${#FILES[@]}" -eq 0 ]; then
  scan_text "${LABEL:-stdin}" || status=1
else
  for f in "${FILES[@]}"; do
    if [ ! -f "$f" ]; then
      echo "::error::check-ai-attribution: no such file: $f" >&2
      status=1
      continue
    fi
    scan_text "${LABEL:-$f}" < "$f" || status=1
  done
fi

if [ "$status" -ne 0 ]; then
  cat >&2 <<'EOF'

This repository does not use AI attribution. Remove the line(s) above.

  - In a commit message: edit it and commit again.
  - In a pull request body: edit the description. This one matters — squash is
    the only merge mode here and the squash commit message is taken from the PR
    body, so the text would land in git history on `main`.

Mentioning these strings inside prose is not blocked; only lines that begin with
a real trailer or footer are. Human co-authors are never blocked.
EOF
fi

exit "$status"
