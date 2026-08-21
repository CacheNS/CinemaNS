import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env['PORT'] ?? 3000);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  let pathname: string;
  try {
    // Malformed percent-encoding (a lone "%") throws URIError; a bad request
    // must not be able to take the whole preview server down with it.
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Loš zahtev');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.join(DIST, path.normalize(pathname).replace(/^([/\\])+/, ''));
  // Never serve outside dist/, even if the request tries to escape it. The
  // separator check matters: without it, "dist-evil" would pass a plain
  // startsWith(DIST) test the same as a genuine subpath would.
  const withinDist = file === DIST || file.startsWith(DIST + path.sep);
  if (!withinDist || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Nije pronađeno');
    return;
  }

  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(file).pipe(res);
});

if (!existsSync(DIST)) {
  console.error('dist/ ne postoji — pokrenite prvo `npm run build`.');
  process.exit(1);
}

// Loopback only. This is a preview server with no auth, and binding it to every
// interface would publish the build to whatever network the laptop is on.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Sajt je dostupan na http://localhost:${PORT}`);
});
