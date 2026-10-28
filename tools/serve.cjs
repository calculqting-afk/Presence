const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif' };
function publicFile(pathname) {
  const filename=path.resolve(root,'.'+pathname),relative=path.relative(root,filename).split(path.sep);
  if(relative.some(part=>part.startsWith('.')))return null;
  if(relative.join('/')==='index.html'||relative.join('/')==='config/firebase-config.js'||['pages','assets'].includes(relative[0]))return filename;
  return null;
}
module.exports={publicFile};
if(require.main===module){
http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end(); return; }
  if (pathname === '/') pathname = '/index.html';
  if (!/^\/(?:index\.html|(?:pages|assets|config)\/)/.test(pathname)) { response.writeHead(404).end(); return; }
  const filename = publicFile(pathname);
  if (!filename) { response.writeHead(404).end(); return; }
  fs.readFile(filename, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'strict-origin-when-cross-origin' });
    response.end(data);
  });
}).listen(4173, '127.0.0.1', () => console.log('Presence preview: http://127.0.0.1:4173 (Firebase uses the configured project).'));
}
