#!/usr/bin/env node
// A tiny static server for running Calendont locally: `npm start`.
// No dependencies. PORT and HOST environment variables override the defaults;
// HOST=0.0.0.0 lets other devices on your network try it (installing as an
// app and offline mode need HTTPS there, or localhost).

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../app/', import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) throw Object.assign(new Error('outside root'), { code: 'ENOENT' });
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    const missing = err.code === 'ENOENT' || err.code === 'ENOTDIR' || err instanceof URIError;
    res.writeHead(missing ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(missing ? 'Not found' : 'Server error');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is busy. Try: PORT=8081 npm start`);
  else console.error(err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Calendont is running at http://${shown}:${PORT}  (Ctrl+C to stop)`);
});
