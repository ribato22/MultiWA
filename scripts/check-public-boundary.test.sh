#!/usr/bin/env bash
# Self-test for scripts/check-public-boundary.sh.
#
# Builds a throwaway git repository, commits a copy of the scanner and one
# fixture per kind of finding, runs the scanner there and checks the exact
# findings, the error and warning counts, and the exit code. A scanner that
# silently matches nothing fails this test.
#
# The text the scanner looks for is assembled while the fixtures are written,
# so this file does not contain it and does not trip the scan itself. All
# addresses in the fixtures are generic and live only in the temporary repo.
#
# Usage:
#   bash scripts/check-public-boundary.test.sh

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCANNER="$HERE/check-public-boundary.sh"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required."
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/public-boundary-test.XXXXXX")" || exit 1
TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/scratch" "$TMP/plain"

CHECKS=0
FAILED=0

# show prints text with a prefix, so scanner annotations are not read as
# workflow commands when a check fails in CI.
show() {
  printf '%s\n' "$1" | sed 's/^/    | /'
}

check() {
  # Args: name, expected, actual
  CHECKS=$((CHECKS + 1))
  if [ "$2" != "$3" ]; then
    FAILED=$((FAILED + 1))
    echo "FAIL: $1"
    echo "  expected:"
    show "$2"
    echo "  actual:"
    show "$3"
  fi
}

# Text the scanner looks for, built from parts.
pem() { printf -- '-----BEGIN %s KEY-----\n' "$*"; }
marker() {
  local m="" i
  for i in 1 2 3 4 5 6 7; do
    m="$m$1"
  done
  printf '%s' "$m"
}
ip() { printf '%s.%s.%s.%s' "$@"; }

g() {
  git -c user.name=selftest -c user.email=selftest@example.invalid \
    -c commit.gpgsign=false -c core.hooksPath=/dev/null "$@"
}

# scan runs the scanner copy found in directory $1 and keeps its output in
# $OUT and its exit status in $RC. The scanner gets its own TMPDIR so that a
# temporary file left behind is noticed.
scan() {
  OUT="$( (cd "$1" && TMPDIR="$TMP/scratch" bash scripts/check-public-boundary.sh) 2>&1)"
  RC=$?
}

# findings prints the sorted annotation lines of a scanner output.
findings() {
  printf '%s\n' "$1" | sed -n '/^::/p' | LC_ALL=C sort
}

# count prints how many lines of a scanner output start with $2.
count() {
  printf '%s\n' "$1" | sed -n "/^$2/p" | wc -l | tr -d ' '
}

summary() {
  printf '%s\n' "$1" | sed -n '/^Public boundary scan /p'
}

REPO="$TMP/repo"
mkdir -p "$REPO/scripts" "$REPO/app" "$REPO/docs" "$REPO/dist"
cd "$REPO" || exit 1
g -c init.defaultBranch=main init -q
cp "$SCANNER" scripts/check-public-boundary.sh

# Soft findings, and cases the scan must pass over.
printf 'gateway %s is the default\n' "$(ip 10 0 0 2)" > docs/network.md
pem PRIVATE > docs/keys.md
printf '%s HEAD\n' "$(marker '<')" > docs/merge.md
printf 'reserved %s/8 range\n' "$(ip 10 0 0 0)" > docs/cidr.md
printf 'allow %s/16\n' "$(ip 192 168 0 0)" > app/cidr.conf
printf 'host %s\nhost %s\nhost 8.8.8.8\n' "$(ip 110 0 0 1)" "$(ip 172 32 0 1)" > app/public.txt
printf 'api_key = "opaque0123456789abcdef"\n' > app/credentials.txt
printf 'api_key = "changeme0123456789abcdef"\n' > app/placeholder.txt
printf 'SERVICE_LABEL=abcdefghijklmnop\n' > app/settings.txt
printf 'SERVICE_LABEL=abcdefghijklmnop\n' > app/settings.yml
printf 'SERVICE_LABEL=abcdefghijklmnop\n' > app/local.env
printf 'SERVICE_LABEL=changeme0123456789\n' > app/defaults.txt
{ pem RSA PRIVATE; ip 10 0 0 3; echo; } > dist/bundle.js
{ printf 'x\0'; pem PRIVATE; } > app/blob.bin
g add scripts app docs dist
g commit -q -m "soft fixtures"

# Untracked, so the scan must not see it.
pem RSA PRIVATE > app/untracked.txt

scan "$REPO"
check "soft: exit status" "0" "$RC"
check "soft: errors" "0" "$(count "$OUT" '::error ')"
check "soft: warnings" "4" "$(count "$OUT" '::warning ')"
check "soft: findings" "::warning file=app/credentials.txt::[possible-credential-assignment] app/credentials.txt:1 :: <value looks opaque>
::warning file=app/settings.txt::[env-style-leak] app/settings.txt:1 :: <KEY=value in non-env file>
::warning file=docs/keys.md::[private-key-block-in-docs] docs/keys.md:1 :: <allowlisted file; verify placeholder>
::warning file=docs/network.md::[private-ip-in-docs] docs/network.md:1 :: <verify the IP is generic>" "$(findings "$OUT")"
check "soft: summary" "Public boundary scan PASSED. (4 finding(s) reported, none are hard-fails.)" "$(summary "$OUT")"
check "soft: temporary file removed" "" "$(ls "$TMP/scratch")"

# Hard fails: one fixture per category.
{ pem RSA PRIVATE; pem OPENSSH PRIVATE; pem PRIVATE; pem ENCRYPTED PRIVATE; pem DSA PRIVATE; pem EC PRIVATE; } > app/keys.txt
{ printf '%s HEAD\n' "$(marker '<')"; echo '======='; printf '%s topic\n' "$(marker '>')"; } > app/conflict.txt
{ printf 'server %s:8080\n' "$(ip 10 0 0 1)"; printf 'peer %s\n' "$(ip 172 16 5 4)"; printf 'lan %s\n' "$(ip 192 168 1 10)"; } > app/net.conf
g add app/keys.txt app/conflict.txt app/net.conf
g commit -q -m "hard-fail fixtures"

scan "$REPO"
check "hard: exit status" "1" "$RC"
check "hard: errors" "11" "$(count "$OUT" '::error ')"
check "hard: warnings" "4" "$(count "$OUT" '::warning ')"
check "hard: findings" "::error file=app/conflict.txt::[conflict-marker] app/conflict.txt:1 :: <redacted; investigate>
::error file=app/conflict.txt::[conflict-marker] app/conflict.txt:3 :: <redacted; investigate>
::error file=app/keys.txt::[private-key-block] app/keys.txt:1 :: <redacted; investigate>
::error file=app/keys.txt::[private-key-block] app/keys.txt:2 :: <redacted; investigate>
::error file=app/keys.txt::[private-key-block] app/keys.txt:3 :: <redacted; investigate>
::error file=app/keys.txt::[private-key-block] app/keys.txt:4 :: <redacted; investigate>
::error file=app/keys.txt::[private-key-block] app/keys.txt:5 :: <redacted; investigate>
::error file=app/keys.txt::[private-key-block] app/keys.txt:6 :: <redacted; investigate>
::error file=app/net.conf::[private-ip-literal] app/net.conf:1 :: <RFC1918 IP in non-doc tracked file>
::error file=app/net.conf::[private-ip-literal] app/net.conf:2 :: <RFC1918 IP in non-doc tracked file>
::error file=app/net.conf::[private-ip-literal] app/net.conf:3 :: <RFC1918 IP in non-doc tracked file>
::warning file=app/credentials.txt::[possible-credential-assignment] app/credentials.txt:1 :: <value looks opaque>
::warning file=app/settings.txt::[env-style-leak] app/settings.txt:1 :: <KEY=value in non-env file>
::warning file=docs/keys.md::[private-key-block-in-docs] docs/keys.md:1 :: <allowlisted file; verify placeholder>
::warning file=docs/network.md::[private-ip-in-docs] docs/network.md:1 :: <verify the IP is generic>" "$(findings "$OUT")"
check "hard: summary" "Public boundary scan FAILED. (15 finding(s) reported, including at least one hard-fail.)" "$(summary "$OUT")"
check "hard: temporary file removed" "" "$(ls "$TMP/scratch")"

# Outside a git work tree the scan cannot run, and must say so instead of
# reporting a clean tree.
mkdir "$TMP/plain/scripts"
cp "$SCANNER" "$TMP/plain/scripts/check-public-boundary.sh"
OUT="$( (cd "$TMP/plain" && GIT_CEILING_DIRECTORIES="$TMP" TMPDIR="$TMP/scratch" bash scripts/check-public-boundary.sh) 2>&1)"
RC=$?
check "no repo: exit status" "1" "$RC"
check "no repo: no clean report" "0" "$(count "$OUT" 'Public boundary scan PASSED')"
check "no repo: temporary file removed" "" "$(ls "$TMP/scratch")"

if [ "$FAILED" -ne 0 ]; then
  echo "check-public-boundary self-test FAILED ($FAILED of $CHECKS checks)."
  exit 1
fi
echo "check-public-boundary self-test passed ($CHECKS checks)."
