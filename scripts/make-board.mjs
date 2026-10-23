// Erzeugt die Holz-Textur für das Brett (public/boards/wood.png). Keine Abhängigkeiten.
// Wird bei "npm start" automatisch ausgeführt, wenn die Datei fehlt.
// Farben oder Stärke der Maserung unten ändern, dann die Datei public/boards/wood.png löschen
// und neu starten (oder: npm run board).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith('--')) ?? 'public/boards/wood.png';
if (args.includes('--if-missing') && fs.existsSync(OUT)) process.exit(0);
const SIZE = 960;                 // Pixel pro Brettseite (120 pro Feld)
const LIGHT = [200, 168, 116];    // helle Felder (R, G, B)
const DARK = [124, 84, 49];       // dunkle Felder
const GRAIN = 0.20;               // Stärke der Maserung

const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 1274126177) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; h ^= h >>> 16; return (h >>> 0) / 4294967296; };
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s) { let t = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { t += a * vnoise(x * f, y * f, s + i * 17); f *= 2; a *= 0.5; } return t / 0.9375; }

const S = SIZE / 8, raw = Buffer.alloc((1 + SIZE * 3) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (1 + SIZE * 3)] = 0;
  for (let x = 0; x < SIZE; x++) {
    const sx = Math.floor(x / S), sy = Math.floor(y / S), u = x - sx * S, v = y - sy * S;
    const ox = hash(sx, sy, 1) * 500, oy = hash(sx, sy, 2) * 500;           // jedes Feld ist ein anderes Stück Holz
    const warp = (vnoise(v * 0.012 + ox, 0.5 + oy, 3) - 0.5) * 5;
    const ring = fbm((u + warp) * 0.05 + ox, v * 0.003 + oy, 5);
    const fine = vnoise((u + warp) * 0.55 + ox, v * 0.02 + oy, 7);
    let b = 1 + (ring - 0.5) * GRAIN + (fine - 0.5) * GRAIN * 0.4;
    const pore = vnoise((u + warp) * 0.9 + ox * 3, v * 0.03 + oy, 9);
    if (pore > 0.74) b *= 1 - (pore - 0.74) * 0.7;
    const d = Math.min(u, v, S - 1 - u, S - 1 - v);
    if (d < 1.5) b *= 0.8 + d * 0.12;                                        // feine Fuge zwischen den Feldern
    const base = (sx + sy) % 2 === 0 ? LIGHT : DARK, o = y * (1 + SIZE * 3) + 1 + x * 3;
    for (let k = 0; k < 3; k++) raw[o + k] = Math.max(0, Math.min(255, Math.round(base[k] * b)));
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), cr = Buffer.alloc(4); len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log('Brett-Textur erzeugt:', OUT);
