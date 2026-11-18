#!/bin/sh
# Clone the Effect source that matches the installed version into .repos/effect
# (git-ignored), so agents can read LLMS.md, ai-docs/ and the full repo source.
set -eu

cd "$(dirname "$0")/.."
version=$(node -p "require('./packages/business/package.json').dependencies.effect")
tag="effect@$version"
dir=.repos/effect
stamp=.repos/effect.version

if [ -d "$dir/.git" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$tag" ]; then
  echo "$dir is already at $tag"
  exit 0
fi

rm -rf "$dir"

mkdir -p .repos
git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$tag" \
  https://github.com/Effect-TS/effect "$dir"
echo "$tag" > "$stamp"
echo "Cloned $tag into $dir"
