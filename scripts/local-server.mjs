import './runtime.mjs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openLocalDatabase } from './local-db.mjs';
import { handleStandaloneRequest } from '../server/standalone-http.mjs';

/** Loopback-only preview, using no production environment or provider secrets.
 * It never creates a player, issues a test cookie, or simulates a provider login.
 */
export async function createLocalServer({ db } = {}) {
  const assetsRoot = await realpath(fileURLToPath(new URL('../public/game/', import.meta.url)));
  const files = new Map([
    ['/', fileURLToPath(new URL('../local/index.html', import.meta.url))],
    ['/local-boot.js', fileURLToPath(new URL('../local/boot.js', import.meta.url))],
  ]);
  for (const entry of await readdir(assetsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(js|css|svg)$/.test(entry.name)) continue;
    const resolved = await realpath(path.join(assetsRoot, entry.name));
    if (path.dirname(resolved) === assetsRoot) files.set(`/game/${entry.name}`, resolved);
  }
  const database = db || openLocalDatabase();
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  const server = createServer(async (incoming, outgoing) => {
    try {
      const host = `127.0.0.1:${server.address().port}`;
      if (incoming.headers.host !== host || !incoming.url?.startsWith('/') || incoming.url.startsWith('//')) {
        outgoing.writeHead(421, { 'Cache-Control': 'no-store' }); outgoing.end(); return;
      }
      const origin = `http://${host}`;
      const headers = new Headers();
      for (let i = 0; i < incoming.rawHeaders.length; i += 2) headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
      const request = new Request(new URL(incoming.url, origin), {
        method: incoming.method, headers,
        ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}),
      });
      const pathname = new URL(request.url).pathname;
      let response;
      if (files.has(pathname)) {
        response = ['GET', 'HEAD'].includes(request.method)
          ? new Response(request.method === 'HEAD' ? null : await readFile(files.get(pathname)), {
            headers: { 'Content-Type': `${types[path.extname(files.get(pathname))]}; charset=utf-8`,
              'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
          })
          : new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
      } else {
        response = await handleStandaloneRequest(request, { db: database, env: {} });
      }
      outgoing.statusCode = response.status;
      for (const [key, value] of response.headers) if (key !== 'set-cookie') outgoing.setHeader(key, value);
      if (response.headers.getSetCookie().length) outgoing.setHeader('Set-Cookie', response.headers.getSetCookie());
      if (response.body && incoming.method !== 'HEAD') await pipeline(Readable.fromWeb(response.body), outgoing);
      else outgoing.end();
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(503, { 'Cache-Control': 'no-store' });
      outgoing.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  if (!db) server.once('close', () => database.close());
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.HARU_LOCAL_PORT || 5174);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('HARU_LOCAL_PORT must be 1024–65535.');
  const server = await createLocalServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`하루다섯 로컬 화면: http://127.0.0.1:${port}`);
    console.log('별도 로컬 DB 사용. 실제 로그인·어린이 가입·외부 배포는 연결하지 않았습니다.');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close(); server.closeAllConnections();
  });
}
