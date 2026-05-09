#!/usr/bin/env bash
# Stratex-Patches-Übersicht: zeigt was sich seit dem letzten upstream-merge
# unterscheidet, was upstream geändert hat, und wo Konflikt-Zonen liegen.
#
# Usage:
#   scripts/dev/diff-from-upstream.sh           # default: vs upstream/main
#   scripts/dev/diff-from-upstream.sh v2.4.0    # vs specific upstream tag
#   scripts/dev/diff-from-upstream.sh --short   # ohne file-by-file diff stats
#
# Ersetzt das frühere manuelle Pflegen einer "patches.md" Liste.
# Die Wahrheit lebt im git-tree, nicht im Memory.
set -euo pipefail

UPSTREAM_REF="${1:-upstream/main}"

# Skip the first arg if it's a flag (e.g. "--short")
case "${1:-}" in
  --short|-s)
    UPSTREAM_REF="upstream/main"
    SHORT=1
    ;;
  --help|-h)
    sed -n '2,11p' "$0"
    exit 0
    ;;
  *)
    SHORT=0
    ;;
esac

cd "$(git rev-parse --show-toplevel)"

# Ensure upstream-Ref ist abrufbar — fetch wenn upstream remote existiert
if git remote | grep -q '^upstream$'; then
  git fetch upstream --tags --quiet 2>/dev/null || true
fi

if ! git rev-parse --verify "$UPSTREAM_REF" >/dev/null 2>&1; then
  echo "Error: '$UPSTREAM_REF' not found. Have you run 'git remote add upstream …'?" >&2
  exit 1
fi

MB=$(git merge-base HEAD "$UPSTREAM_REF")
HEAD_SHA=$(git rev-parse --short HEAD)
UP_SHA=$(git rev-parse --short "$UPSTREAM_REF")

echo "=========================================="
echo "Stratex Workspace — Patches vs $UPSTREAM_REF"
echo "  HEAD:        $HEAD_SHA  ($(git symbolic-ref --short -q HEAD || echo detached))"
echo "  Upstream:    $UP_SHA"
echo "  Merge-base:  ${MB:0:7}"
echo "=========================================="
echo ""

OUR_AHEAD=$(git rev-list --count "$MB..HEAD")
UP_AHEAD=$(git rev-list --count "$MB..$UPSTREAM_REF")
echo "Commits ahead of merge-base:"
echo "  ours:     $OUR_AHEAD"
echo "  upstream: $UP_AHEAD"
echo ""

echo "=== OUR commits since merge-base ==="
git log --oneline --reverse "$MB..HEAD" | head -50
TOTAL=$(git log --oneline "$MB..HEAD" | wc -l)
if [ "$TOTAL" -gt 50 ]; then
  echo "  …and $((TOTAL - 50)) more commits"
fi
echo ""

echo "=== UPSTREAM commits since merge-base ==="
git log --oneline --reverse "$MB..$UPSTREAM_REF" | head -50
TOTAL=$(git log --oneline "$MB..$UPSTREAM_REF" | wc -l)
if [ "$TOTAL" -gt 50 ]; then
  echo "  …and $((TOTAL - 50)) more commits"
fi
echo ""

echo "=== OVERLAP — files we both touched (potential conflict zone) ==="
OURS_FILES=$(git diff --name-only "$MB..HEAD" | sort)
UPSTREAM_FILES=$(git diff --name-only "$MB..$UPSTREAM_REF" | sort)
OVERLAP=$(comm -12 <(echo "$OURS_FILES") <(echo "$UPSTREAM_FILES"))
if [ -z "$OVERLAP" ]; then
  echo "  (none — clean merge expected)"
else
  echo "$OVERLAP" | sed 's/^/  /'
fi
echo ""

if [ "$SHORT" -eq 0 ]; then
  echo "=== File stats: OUR changes ==="
  git diff --stat "$MB..HEAD" | tail -50
  echo ""

  echo "=== File stats: UPSTREAM changes ==="
  git diff --stat "$MB..$UPSTREAM_REF" | tail -50
  echo ""
fi

echo "=== @stratex-patch markers in code ==="
MARKERS=$(grep -rn "@stratex-patch:" src/ scripts/ .github/ 2>/dev/null \
          | grep -v "diff-from-upstream.sh" || true)
if [ -z "$MARKERS" ]; then
  echo "  (none yet — add marker comments at custom edit-sites:"
  echo "   // @stratex-patch: <one-line-reason>"
  echo "   so they're greppable for the next upstream-merge.)"
else
  echo "$MARKERS" | sed 's/^/  /'
fi
echo ""

echo "=== Done. ==="
echo "Next upstream-merge cheatsheet:"
echo "  1. Review the OVERLAP list above — those files need hand-merging"
echo "  2. Cherry-pick non-overlap upstream commits selectively"
echo "  3. After merge, re-run this script to verify patches survived"
