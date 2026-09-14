#!/usr/bin/env bash
# Commit trailer policy check.
#
# POLICY
#   Attribution in this repository names people. Commit trailers and pull request
#   descriptions must credit human contributors only; machine-generated co-author
#   trailers and tool-generated "produced by X" footers are rejected.
#
#   This is a provenance rule, not a style rule. GitHub resolves a `Co-authored-by:`
#   trailer to a real account and counts it toward the repository's contributor
#   graph, so an inaccurate trailer misstates who wrote the code. Trailers are also
#   effectively permanent once published: a pull request's `refs/pull/N/head` cannot
#   be deleted by the repository owner, so a rewrite of a branch does not retract
#   one. Cheaper to refuse than to correct.
#
# WHAT IT SCANS
#   Any text: a commit message file, or a pull request title and body. Both matter.
#   The pull request description matters more than it looks — this repository
#   permits squash merges only, with `squash_merge_commit_message = PR_BODY`, so
#   GitHub copies the description verbatim into the commit message on `main`. A
#   footer in a description therefore becomes commit history automatically, and no
#   commit hook can see it.
#
# DESIGN NOTES
#   - Patterns are ANCHORED to the start of a line. A real trailer always stands
#     alone on its own line, so anchoring lets prose *about* these strings pass —
#     including this file, the hook, and commits that discuss the policy.
#   - Matching covers the EMAIL, not just the display name. GitHub attributes on the
#     address, so a trailer with an innocuous name and a tool's noreply address is
#     just as inaccurate as one that spells the tool out — and a name-only check
#     misses it entirely.
#   - Per-pattern loop, not one long alternation: see the note in
#     scripts/check-public-boundary.sh about long shell-quoted alternations
#     silently matching zero on some hosts.
#   - POSIX ERE only (grep -E). No PCRE, so no `\b` and no `\d`.
#   - Human co-authors are NEVER blocked. `Co-authored-by: Budi <budi@example.com>`
#     is a genuine pair-programming trailer and must keep working.
#
# Exit codes:
#   0 - clean
#   1 - at least one disallowed trailer or footer found
#
# Usage:
#   bash scripts/check-commit-trailers.sh [--strip-comments] [--label NAME] FILE...
#   ... | bash scripts/check-commit-trailers.sh [--label NAME]
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
  # 1. Co-author trailer naming a code-generation tool rather than a person.
  '^[[:space:]]*co-?authored-by:.*(claude|anthropic|copilot|cursor|codex|chatgpt|openai|gemini|devin|windsurf|tabnine|replit agent|amazon q|codewhisperer)'

  # 2. Co-author trailer carrying a tool vendor's email domain. This is the field
  #    GitHub resolves to an account, so it must be matched even when the display
  #    name is innocuous ("Assistant", "Bot", or a person's name).
  '^[[:space:]]*co-?authored-by:.*@(anthropic|openai|cursor|cognition|codeium)\.(com|ai)'

  # 3. GitHub Copilot's machine account, which uses a plain users.noreply address.
  '^[[:space:]]*co-?authored-by:.*copilot@users\.noreply\.github\.com'

  # 4. Generic non-human identity as co-author, vendor-neutral.
  '^[[:space:]]*co-?authored-by:.*(ai[ _-]?(assistant|agent|bot|pair)|assistant[ _-]?ai)'

  # 5. "Produced with/by <tool>" footers, including the robot-emoji form. Covers
  #    the near-misses: generated/created/written/authored/made/built, with/by/using,
  #    and an optional markdown link bracket.
  '^[[:space:]]*(:robot:|🤖)?[[:space:]]*(generated|created|written|authored|made|built|produced)[[:space:]]+(with|by|using)[[:space:]]+\[?(claude|anthropic|copilot|cursor|codex|chatgpt|gpt-|openai|gemini|devin|windsurf)'

  # 6. A robot-emoji line naming a tool in any phrasing not caught above.
  '^[[:space:]]*(:robot:|🤖).*(claude|anthropic|copilot|cursor|codex|chatgpt|openai|gemini)'

  # 7. Other trailer fields used to credit a non-human participant.
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

  # One offending line usually trips several patterns (a trailer matches both the
  # vendor-name rule and the email-domain rule). Report each line once, in file
  # order, so the output stays readable.
  echo "" >&2
  echo "Disallowed trailer in ${label}:" >&2
  printf '%s' "$all" | grep -v '^$' | sort -t: -k1,1n -u | sed 's/^/  line /' >&2
  return 1
}

status=0

if [ "${#FILES[@]}" -eq 0 ]; then
  scan_text "${LABEL:-stdin}" || status=1
else
  for f in "${FILES[@]}"; do
    if [ ! -f "$f" ]; then
      echo "::error::check-commit-trailers: no such file: $f" >&2
      status=1
      continue
    fi
    scan_text "${LABEL:-$f}" < "$f" || status=1
  done
fi

if [ "$status" -ne 0 ]; then
  cat >&2 <<'EOF'

Attribution in this repository names people. Remove the line(s) above.

  - In a commit message: edit it and commit again.
  - In a pull request description: edit it. This one matters — squash is the only
    merge mode here and the squash commit message is taken from the description,
    so the text would land in commit history on `main`.

Mentioning these strings inside prose is not blocked; only lines that begin with a
real trailer or footer are. Human co-author trailers are never blocked.
EOF
fi

exit "$status"
