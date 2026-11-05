#!/usr/bin/env bash
# Release gate: public boundary scan.
#
# This is a public-safe scanner. It must NOT hardcode internal hostnames,
# IPs, passwords, or operator-specific markers. Instead it runs a small set
# of generic patterns against tracked files and fails when something that
# looks like a real secret, a merge conflict, or a private network literal
# appears in committed/staged content.
#
# Implementation notes:
#   - Uses `git grep` so only tracked content is scanned; untracked files
#     (local-only notes, internal SOPs, .tmp/, sessions/, etc.) are out of scope
#     by construction and cannot reach a public push.
#   - One `git grep` per pattern, so the number of processes does not grow with
#     the number of files. Its output goes to a temporary file that is read
#     back with a plain redirect: the loops run in the current shell and the
#     counters stay correct.
#   - No per-file loops and no process substitution. With the macOS /bin/bash
#     (3.2) nested process substitutions were observed to make later passes read
#     no files at all, depending on the size of the environment, so a scan
#     reported zero findings on a tree that had some. A `git grep` that fails
#     is an error here, never an empty result.
#   - Uses POSIX ERE (`git grep -E`). No PCRE so no `\b` or `\d`.
#   - Per-pattern searches, not one big alternation, because long shell-quoted
#     alternations have been observed to silently match zero on some hosts.
#
# Exit codes:
#   0 - no hard-fail issues
#   1 - at least one hard-fail issue
#
# Usage:
#   bash scripts/check-public-boundary.sh

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v git >/dev/null 2>&1; then
  echo "::error::git is required."
  exit 1
fi

# The matches of the current search, one path:line:content record per line.
MATCHES="$(mktemp "${TMPDIR:-/tmp}/public-boundary.XXXXXX")" || {
  echo "::error::cannot create a temporary file."
  exit 1
}
trap 'rm -f "$MATCHES"' EXIT

# Exclude vendor/build/cache/session paths even though they are rarely
# tracked. Keep this list small and obvious.
SKIP_REGEX='^(node_modules|.*/node_modules|dist|.*/dist|build|.*/build|\.next|.*/\.next|\.turbo|.*/\.turbo|\.pnpm-store|coverage|.*/coverage|sessions|.*/sessions|apps/api/sessions|apps/api/\.wwebjs_cache|\.wwebjs_auth|\.wwebjs_cache|docs-site/build|docs-site/\.docusaurus|\.tmp)/'

# Files that legitimately contain pattern text (examples, docs, snapshots).
# Substring match against the file path.
ALLOWLIST_FILES=(
  'CHANGELOG.md'
  'README.md'
  'SECURITY.md'
  'docs/'
  'docs-site/docs/'
  '.env.example'
  '.env.docker'
  '.env.production.example'
  '.env.server.example'
  'docker-compose.yml'
  'docker-compose.dev.yml'
  'docker-compose.production.yml'
  'docker-compose.staging.yml'
  'docker/'
  'apps/api/src/'
  'apps/admin/src/'
  'apps/worker/src/'
  'apps/api/test/'
  'apps/admin/app/'
  'packages/'
  'scripts/'
  'tools/'
  '.github/'
  'plugins/'
)

# Tokens that mark a value as a known placeholder rather than a real secret.
PLACEHOLDER_REGEX='change|placeholder|example|todo|fixme|your-|here|dev-|test-|demo|xxx|<.*>|\$\{|process\.env|null|undefined|minio123|minioadmin'

EXIT=0
TOTAL_HITS=0
SCRIPT_NAME="$(basename "$0")"

is_allowlisted() {
  local p="$1"
  local entry
  for entry in "${ALLOWLIST_FILES[@]}"; do
    case "$p" in
      *"$entry"*) return 0 ;;
    esac
  done
  return 1
}

# is_placeholder reports whether its argument holds a placeholder token,
# ignoring case.
is_placeholder() {
  local rc
  shopt -s nocasematch
  [[ $1 =~ $PLACEHOLDER_REGEX ]]
  rc=$?
  shopt -u nocasematch
  return "$rc"
}

# search runs one git grep over the tracked files and leaves its matches in
# $MATCHES.
# Args: git grep option (-F, -E or -iE), pattern
# git grep exits 1 when nothing matches; a higher status means the search did
# not run, which must not read as a clean scan.
search() {
  local rc
  git -c core.quotePath=false grep -n -I --no-color "$1" -e "$2" > "$MATCHES"
  rc=$?
  if [ "$rc" -gt 1 ]; then
    echo "::error::git grep failed (exit $rc) while scanning for: $2"
    exit 1
  fi
}

# next_match reads the next path:line:content record from stdin into $file,
# $line_no and $content, passing over matches in SKIP_REGEX paths and in this
# script. It fails at the end of the input.
next_match() {
  local record rest
  while IFS= read -r record; do
    file="${record%%:*}"
    if [[ $file =~ $SKIP_REGEX ]]; then
      continue
    fi
    if [ "$file" = "scripts/$SCRIPT_NAME" ]; then
      continue
    fi
    rest="${record#*:}"
    line_no="${rest%%:*}"
    content="${rest#*:}"
    return 0
  done
  return 1
}

report() {
  local sev="$1" cat="$2" loc="$3" snippet="$4"
  TOTAL_HITS=$((TOTAL_HITS + 1))
  if [ "$sev" = "error" ]; then
    EXIT=1
    echo "::error file=${loc%%:*}::[$cat] $loc :: $snippet"
  else
    echo "::warning file=${loc%%:*}::[$cat] $loc :: $snippet"
  fi
}

scan_files_for_pattern() {
  # Args: git grep option (-F or -E), pattern, category, severity,
  #   allowlist_behavior
  #   allowlist_behavior = "downgrade" (warn instead of error) or "skip"
  local option="$1" pattern="$2" category="$3" severity="$4" allow="$5"
  search "$option" "$pattern"
  while next_match; do
    if is_allowlisted "$file"; then
      if [ "$allow" = "skip" ]; then
        continue
      fi
      report warning "${category}-in-docs" "$file:$line_no" "<allowlisted file; verify placeholder>"
      continue
    fi
    report "$severity" "$category" "$file:$line_no" "<redacted; investigate>"
  done < "$MATCHES"
}

echo "== Hard fail: PEM private key blocks =="
for pat in 'BEGIN RSA PRIVATE KEY' 'BEGIN OPENSSH PRIVATE KEY' 'BEGIN PRIVATE KEY' 'BEGIN ENCRYPTED PRIVATE KEY' 'BEGIN DSA PRIVATE KEY' 'BEGIN EC PRIVATE KEY'; do
  scan_files_for_pattern -F "$pat" "private-key-block" "error" "downgrade"
done

echo "== Hard fail: merge conflict markers =="
# Match the start markers <<<<<<< and >>>>>>>. We deliberately do NOT match
# '=======' alone because it is a common Markdown heading separator.
scan_files_for_pattern -F '<<<<<<<' 'conflict-marker' 'error' 'skip'
scan_files_for_pattern -F '>>>>>>>' 'conflict-marker' 'error' 'skip'

echo "== Hard fail: RFC1918 private IP literals (non-docs) =="
# POSIX ERE: \b is not portable; we anchor with surrounding non-digit using
# character classes. The pattern matches a.b.c.d where the prefix is private.
PRIV_IP_PATTERN='(^|[^0-9.])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})([^0-9.]|$)'
CIDR_REGEX='(10\.0\.0\.0/8|172\.16\.0\.0/12|192\.168\.0\.0/16)'
search -E "$PRIV_IP_PATTERN"
while next_match; do
  # Treat doc references to the standard /8, /12, /16 CIDR strings as harmless.
  if [[ $content =~ $CIDR_REGEX ]]; then
    continue
  fi
  if is_allowlisted "$file"; then
    report warning "private-ip-in-docs" "$file:$line_no" "<verify the IP is generic>"
    continue
  fi
  report error "private-ip-literal" "$file:$line_no" "<RFC1918 IP in non-doc tracked file>"
done < "$MATCHES"

echo "== Soft warn: credential-like assignments (non-allowlisted files) =="
CRED_PATTERN='(password|secret|token|api[_-]?key)[[:space:]]*[:=][[:space:]]*"?[A-Za-z0-9+/=._-]{16,}"?'
search -iE "$CRED_PATTERN"
while next_match; do
  if is_allowlisted "$file"; then
    continue
  fi
  if is_placeholder "$content"; then
    continue
  fi
  report warning "possible-credential-assignment" "$file:$line_no" "<value looks opaque>"
done < "$MATCHES"

echo "== Soft warn: .env-style assignments in non-env tracked files =="
ENV_LEAK_PATTERN='^[[:space:]]*[A-Z][A-Z0-9_]{3,}=[A-Za-z0-9+/=._:@-]{12,}[[:space:]]*$'
search -E "$ENV_LEAK_PATTERN"
while next_match; do
  case "$file" in
    *.env*|*/.env*) continue ;;
    *Dockerfile*|*docker-compose*|*.yml|*.yaml) continue ;;
  esac
  if is_allowlisted "$file"; then
    continue
  fi
  if is_placeholder "$content"; then
    continue
  fi
  report warning "env-style-leak" "$file:$line_no" "<KEY=value in non-env file>"
done < "$MATCHES"

echo ""
if [ "$EXIT" -eq 0 ]; then
  echo "Public boundary scan PASSED. ($TOTAL_HITS finding(s) reported, none are hard-fails.)"
else
  echo "Public boundary scan FAILED. ($TOTAL_HITS finding(s) reported, including at least one hard-fail.)"
fi

exit "$EXIT"
