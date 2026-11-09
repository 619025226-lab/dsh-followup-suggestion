#!/bin/sh
# Remove dsh-followup-suggestion from a DSH profile.
set -eu

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
DEST="$PROFILE/node_modules/dsh-followup-suggestion"

rm -f "$DEST"

if [ -f "$PROFILE/package.json" ]; then
  node - "$PROFILE/package.json" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
if (pkg.dependencies !== undefined) {
  delete pkg.dependencies['dsh-followup-suggestion'];
  if (Object.keys(pkg.dependencies).length === 0) delete pkg.dependencies;
}
fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
NODE
fi

if [ -f "$PATCH" ]; then
  node - "$PATCH" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
let text = fs.readFileSync(file, 'utf8');
text = text.replace(/\n?- insert:\n {4}- id: followup-suggestion\n {6}name: dsh-followup-suggestion\n(?: {6}config:\n(?: {8}.*\n)*)?/g, '\n');
text = text.replace(/\n?- id: followup-suggestion\n(?: {2}name: dsh-followup-suggestion\n)?(?: {2}config:\n(?: {4}.*\n)*)?/g, '\n');
if (text.trim() === '') text = '[]\n';
fs.writeFileSync(file, text);
NODE
fi

case "$PLUGIN_HOME" in
  "$DSH_HOME"/plugins/dsh-followup-suggestion) rm -rf "$PLUGIN_HOME" ;;
  *) echo "note: leaving $PLUGIN_HOME in place because it is outside $DSH_HOME/plugins" ;;
esac

echo "removed dsh-followup-suggestion from $PROFILE"
echo "Restart DeepSeek Harness to unload the plugin."
