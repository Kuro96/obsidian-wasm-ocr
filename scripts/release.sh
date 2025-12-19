#!/bin/bash
set -e

# Usage: ./scripts/release.sh <new_version>
# Example: ./scripts/release.sh 0.1.1

if [ -z "$1" ]; then
  echo "Error: Please provide a version number."
  echo "Usage: ./scripts/release.sh <version>"
  exit 1
fi

# Strip leading 'v' if present (e.g. v0.2.0 -> 0.2.0)
NEW_VERSION="${1#v}"

# 1. Update version in src/plugin (using npm version --no-git-tag-version to only modify files)
echo "-> Updating version to $NEW_VERSION..."
cd src/plugin
npm version "$NEW_VERSION" --no-git-tag-version

# 2. Sync manifest.json (our hook script handles this, but since we used --no-git-tag-version, the hook might not run automatically depending on npm version. Let's run it explicitly to be safe)
node scripts/update-manifest-version.js

cd ../..

# 3. Commit and Tag
echo "-> Committing and Tagging $NEW_VERSION..."
git add src/plugin/package.json manifest.json
git commit -m "chore(release): $NEW_VERSION"
git tag "$NEW_VERSION"

echo "SUCCESS! Version updated to $NEW_VERSION."
echo "Run 'git push && git push --tags' to trigger the release workflow."
