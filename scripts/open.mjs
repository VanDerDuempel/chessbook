// Öffnet Chessbook im Browser, sobald der Server antwortet.
// node scripts/open.mjs [port] [--check]: mit --check nur prüfen (Exit 0 = lief schon, Browser offen), sonst bis zu 2 min warten.
import http from 'node:http';
import { spawn } from 'node:child_process';

const port = Number(process.argv[2] || process.env.PORT || 3000);
const check = process.argv.includes('--check');
const url = `http://localhost:${port}`;

const alive = () => new Promise(res => {
  const req = http.get({ host: '127.0.0.1', port, path: '/api/state/white', timeout: 1500 }, r => { r.resume(); res(r.statusCode === 200); });
  req.on('error', () => res(false));
  req.on('timeout', () => { req.destroy(); res(false); });
});

function open() {
  if (process.env.CHESSBOOK_NO_BROWSER) return console.log(url);
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

if (check) process.exit((await alive()) ? (open(), 0) : 1);
for (let i = 0; i < 120; i++) {
  if (await alive()) { open(); process.exit(0); }
  await new Promise(r => setTimeout(r, 1000));
}
process.exit(1);
