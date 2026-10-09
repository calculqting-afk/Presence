const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end(); return; }
  if (pathname === '/') pathname = '/index.html';
  if (!/^\/(?:index\.html|(?:pages|assets|config)\/)/.test(pathname)) { response.writeHead(404).end(); return; }
  const filename = path.resolve(root, '.' + pathname);
  if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  fs.readFile(filename, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  });
}).listen(4173, '127.0.0.1', () => console.log('Presence preview: http://127.0.0.1:4173 (Firebase uses the configured project).'));
