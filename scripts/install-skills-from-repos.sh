#!/usr/bin/env bash
# install-skills-from-repos.sh — Pullt zusätzliche Agent-Skills aus public GitHub-Repos
# Stratex-AI Swarm Phase 3 (v4)
#
# WICHTIG: Alle Skills kommen 1:1 aus echten GitHub-Repos — keine self-written Skills.
# Das VPS hat bereits 24 Kategorien aus Hermes-Agent shipped (mcp/, github/, devops/,
# software-development/, creative/, autonomous-ai-agents/, productivity/, research/, …).
# Dieses Skript holt OPTIONALE zusätzliche Skills die im shipped-Set fehlen — wird von
# Mirror via Approval-PR-Workflow auch genutzt um neue Skill-Vorschläge einzubauen.
#
# Usage (auf VPS):
#   bash scripts/install-skills-from-repos.sh
#
# Idempotent: skipt Skills die schon installiert sind.

set -euo pipefail

SKILLS_DIR="${SKILLS_DIR:-/opt/data/skills}"
TMP_DIR="${TMP_DIR:-/tmp/stratex-skill-fetch}"

if [ ! -d "$SKILLS_DIR" ]; then
  echo "ERROR: $SKILLS_DIR existiert nicht. Sind wir auf dem VPS?" >&2
  exit 1
fi

mkdir -p "$TMP_DIR"

# Format: <local-name>|<github-org>/<repo>|<src-subpath-or-empty>|<target-subdir>
# - <local-name>: name unter $SKILLS_DIR/<target-subdir>/<local-name>/
# - <github-org>/<repo>: Source-Repo (read-only clone)
# - <src-subpath>: Pfad innerhalb des Repos zur Skill-Source (leer = root)
# - <target-subdir>: welcher Skill-Bereich (z.B. external/ damit shipped-Skills nicht überschrieben werden)
SKILLS_TO_INSTALL=(
  # UI/UX-Pro-Max: 71k★ Designer-Power-Skill
  "ui-ux-pro-max|nextlevelbuilder/ui-ux-pro-max-skill||external"
  # Awesome-design-skills: 67 DESIGN.md skills (Bergside)
  "awesome-design-skills|bergside/awesome-design-skills||external"
  # Playwright-Skill: für QA E2E
  "playwright-skill|lackeyjb/playwright-skill||external"
  # Code-Review-Skill: 4-Phasen-Review für Reviewer
  "code-review-skill|awesome-skills/code-review-skill||external"
  # Vercel-Labs Agent-Skills: für DevOps
  "vercel-agent-skills|vercel-labs/agent-skills||external"
  # Anthropic offizielle Skills: brand-guidelines, mcp-builder
  "anthropic-skills|anthropics/skills||external"
  # Trail of Bits Security-Skills für Reviewer
  "trailofbits-skills|trailofbits/skills||external"
)

installed=0
skipped=0
failed=0

for entry in "${SKILLS_TO_INSTALL[@]}"; do
  IFS='|' read -r name repo subpath target <<<"$entry"
  target_path="$SKILLS_DIR/$target/$name"

  if [ -d "$target_path" ]; then
    echo "SKIP $name (existiert)"
    skipped=$((skipped + 1))
    continue
  fi

  echo "FETCH $name from github.com/$repo ..."

  clone_dir="$TMP_DIR/$name"
  rm -rf "$clone_dir"

  if git clone --depth=1 --quiet "https://github.com/$repo.git" "$clone_dir" 2>&1; then
    mkdir -p "$SKILLS_DIR/$target"
    if [ -n "$subpath" ] && [ -d "$clone_dir/$subpath" ]; then
      cp -r "$clone_dir/$subpath" "$target_path"
    else
      cp -r "$clone_dir" "$target_path"
      # remove .git to keep skill dir clean (we're not sub-modeling these)
      rm -rf "$target_path/.git"
    fi
    installed=$((installed + 1))
    echo "  -> installed to $target_path"
  else
    echo "  FAILED to clone $repo"
    failed=$((failed + 1))
  fi
done

# Cleanup tmp
rm -rf "$TMP_DIR"

echo ""
echo "Summary: installed=$installed, skipped=$skipped, failed=$failed"
echo "External skills are now in $SKILLS_DIR/external/"
echo ""
echo "To make a worker load an external skill, add it to swarm.yaml as:"
echo "  skills:"
echo "    - external/<skill-name>"

if [ $failed -gt 0 ]; then
  exit 2
fi
