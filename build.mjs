/**
 * Inline lib/suggest.js into the browser bundle.
 *
 * The client module loader only resolves package IDs, so a plugin bundle must
 * be self-contained. Keeping the heuristics in suggest.js lets Node tests and
 * the Host share the exact same text rules.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const template = await readFile(join(here, 'lib/client.template.js'), 'utf8');
let suggest = await readFile(join(here, 'lib/suggest.js'), 'utf8');
suggest = suggest.replace(/^export\s+/gmu, '');
const wrapped = `const Suggest = (() => {\n${suggest}\nreturn { analyzeEntries, buildSuggestion, sanitizeSuggestion, detectLanguage };\n})();`;
if (!template.includes('/*__SUGGEST_MODULE__*/')) {
  throw new Error('client.template.js is missing the suggest placeholder');
}
await writeFile(join(here, 'lib/client.js'), template.replace('/*__SUGGEST_MODULE__*/', wrapped));
console.log('built lib/client.js');
