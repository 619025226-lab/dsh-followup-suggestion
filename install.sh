#!/bin/sh
# Install dsh-followup-suggestion into a DSH profile.
#
# The profile's package manager prunes anything under node_modules that is not
# a declared dependency, so the plugin lives in a stable directory and the
# profile declares a `link:` dependency to it. Later plugin installs keep it.
#
#   ./install.sh
#   DSH_PROFILE=web ./install.sh
#   DSH_PROFILE="$HOME/.dsh/profiles/other" ./install.sh
#
# With HMR enabled the profile recomposes immediately; otherwise quit and
# reopen DeepSeek Harness (or reload the page once) so the row is composed.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DSH_HOME=${DSH_HOME:-"$HOME/.dsh"}
PLUGIN_HOME=${DSH_FOLLOWUP_SUGGESTION_HOME:-"$DSH_HOME/plugins/dsh-followup-suggestion"}

if [ -n "${DSH_PROFILE:-}" ]; then
  case "$DSH_PROFILE" in
    */*) PROFILE="$DSH_PROFILE" ;;
    *) PROFILE="$DSH_HOME/profiles/$DSH_PROFILE" ;;
  esac
elif [ -n "${DSH_PROFILE_DIR:-}" ]; then
  PROFILE="$DSH_PROFILE_DIR"
else
  PROFILE="$DSH_HOME/profiles/desktop"
fi

PATCH="$PROFILE/cordis.patch.yml"

if [ ! -d "$PROFILE" ]; then
  echo "error: DSH profile not found at $PROFILE" >&2
  echo "hint: set DSH_PROFILE to the profile directory you want to extend" >&2
  exit 1
fi

if [ ! -f "$HERE/lib/client.js" ]; then
  echo "error: lib/client.js is missing; run 'node build.mjs' first" >&2
  exit 1
fi

# 1. Copy the plugin to a stable directory outside node_modules.
mkdir -p "$PLUGIN_HOME"
rm -rf "$PLUGIN_HOME/lib"
cp -R "$HERE/lib" "$PLUGIN_HOME/lib"
cp "$HERE/package.json" "$PLUGIN_HOME/package.json"
cp "$HERE/cordis.patch.yml" "$PLUGIN_HOME/cordis.patch.yml"
cp "$HERE/README.md" "$PLUGIN_HOME/README.md"
[ -f "$HERE/preview.png" ] && cp "$HERE/preview.png" "$PLUGIN_HOME/preview.png"
[ -f "$HERE/preview-polish.png" ] && cp "$HERE/preview-polish.png" "$PLUGIN_HOME/preview-polish.png"
chmod -R u+rwX "$PLUGIN_HOME"

# 2. Declare it as a link dependency so every later pnpm install keeps it.
node - "$PROFILE/package.json" "$PLUGIN_HOME" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const target = process.argv[3];
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
pkg.dependencies ??= {};
pkg.dependencies['dsh-followup-suggestion'] = `link:${target}`;
fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
NODE

# 3. Make the symlink immediately available for this boot. A later
#    `pnpm install` recreates the same link from the declared dependency.
mkdir -p "$PROFILE/node_modules"
DEST="$PROFILE/node_modules/dsh-followup-suggestion"
rm -rf "$DEST"
ln -s "$PLUGIN_HOME" "$DEST"

# 4. Load the row from the profile patch.
node - "$PATCH" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
if (text.trim() === '[]') text = '';
if (text.length > 0 && !text.endsWith('\n')) text += '\n';
if (!/^\s*-\s*id:\s*followup-suggestion\s*$/m.test(text)) {
  text += '\n- insert:\n    - id: followup-suggestion\n      name: dsh-followup-suggestion\n      config:\n        suppressOnComplete: true\n';
  fs.writeFileSync(file, text);
}
NODE

echo "installed dsh-followup-suggestion -> $PLUGIN_HOME"
echo "profile: $PROFILE"
echo
echo "Restart DeepSeek Harness if the hint does not appear, or reload the page once."
