// Generates src/styles/tokens.css from docs/design/tokens.json (run: node scripts/generate-tokens.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, '../../../docs/design/tokens.json'), 'utf8'));
const vars = (palette) =>
  Object.entries(palette)
    .map(([k, v]) => `  --color-${k}: ${v};`)
    .join('\n');

const css = `/* Generated from docs/design/tokens.json by scripts/generate-tokens.mjs. Do not edit by hand. */
:root {
${vars(tokens.color.light)}
  --shadow-sm: ${tokens.shadow.sm};
  --shadow-md: ${tokens.shadow.md};
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root {
${vars(tokens.color.dark).replace(/^/gm, '  ')}
    --shadow-sm: none;
    --shadow-md: 0 4px 20px rgba(0, 0, 0, 0.5);
    color-scheme: dark;
  }
}
`;
writeFileSync(join(here, '../src/styles/tokens.css'), css);
console.log('tokens.css written');
