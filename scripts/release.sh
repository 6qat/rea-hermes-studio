#!/usr/bin/env bash
# Release helper — tags the current manifest version exactly (e.g. "0.6.11") and pushes it.
# Plain numeric tag, NO "v" prefix: Obsidian's plugin release check requires a GitHub
# release whose tag equals the manifest version exactly, so the tag is the version verbatim.
# Pushing the tag triggers .github/workflows/release.yml (vitest + build + release).
# Push exactly this one tag — extra duplicate tags fire duplicate runs/releases.
set -euo pipefail
cd "$(dirname "$0")/.."

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "release: must run on main (currently on $branch)" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "release: working tree is not clean — commit or stash first" >&2
  exit 1
fi

version=$(node -p "require('./manifest.json').version")
tag="$version"

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "release: tag $tag already exists" >&2
  exit 1
fi

git push origin main
git tag -a "$tag" -m "Release $tag"
git push origin "$tag"
echo "Released $tag — the release workflow is running."
