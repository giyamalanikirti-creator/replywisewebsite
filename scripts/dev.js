import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import generate from '../api/generate-reply.js';
import stats from '../api/stats.js';
import models from '../api/models.js';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const root = path.resolve('public');
export const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/generate-reply') return await generate(req, res);
    if (pathname === '/api/stats') return await stats(req, res);
    if (pathname === '/api/models') return await models(req, res);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.info('ReplyWise development server started.'));
