// Serves dist/ locally, the way the host will: `npm run serve` → http://localhost:5100
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname, '..', 'dist');
const port = Number(process.env.PORT) || 5100;
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2'};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(dist, p);
  if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!p.endsWith('/')) { res.writeHead(301, {Location: p + '/'}).end(); return; }
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file)) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Serving ${dist} at http://localhost:${port}`));
