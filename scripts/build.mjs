import { build } from 'esbuild';
import fs from 'node:fs';
fs.mkdirSync('public/css', { recursive: true });
for (const f of ['base', 'brown', 'cburnett']) fs.copyFileSync(`node_modules/chessground/assets/chessground.${f}.css`, `public/css/chessground.${f}.css`);
await build({ entryPoints: ['src/client/app.ts'], bundle: true, format: 'esm', outfile: 'public/app.js', minify: true, target: 'es2020', logLevel: 'info' });
