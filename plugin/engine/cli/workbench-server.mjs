import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { digest } from '../core/evidence.mjs';
import { parseArgs } from '../core/command-args.mjs';
import { commandContext } from './context.mjs';
import { reviewCommands } from './commands/review.mjs';
import { commitSnapshot } from '../core/project.mjs';
import { finalDeliveryReport } from '../core/final-delivery.mjs';
import { scopedPath } from '../core/workbench-catalog.mjs';
import { captureWorkbench, workbenchFile, workbenchOriginal, workbenchPending, addWorkbenchNote, recordWorkbenchRepair, resolveWorkbenchNote, checkWorkbenchArtifact, decideWorkbenchStage } from '../core/workbench.mjs';
import { readWorkbenchUI, writeWorkbenchUI, workbenchStatus } from '../core/workbench-ui.mjs';

const assets = fileURLToPath(new URL('../workbench/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/plain; charset=utf-8' };
function send(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
function streamFile(req, res, file, name, size) {
  const mime = MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  let start = 0, end = size - 1, status = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
    status = 206;
  }
  res.writeHead(status, { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Content-Length': Math.max(0, end - start + 1), ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  if (req.method === 'HEAD' || !size) { res.end(); return; }
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
}
async function bodyOf(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new Error('审阅操作只接受 JSON');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new Error('提交内容过大'); chunks.push(chunk); }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('请求格式无效');
  return body;
}
function filmsAt(root) {
  const films = scopedPath(root, 'films');
  const dirs = fs.existsSync(films) && fs.statSync(films).isDirectory()
    ? fs.readdirSync(films, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => scopedPath(root, path.join('films', e.name)))
    : [root];
  return dirs.filter(dir => ['film.json', 'brief.md', '.wka/state.json'].some(f => fs.existsSync(scopedPath(dir, f))))
    .map(dir => ({ id: digest(path.relative(root, dir).split(path.sep).join('/') || '.').slice(0, 24), name: path.basename(dir), dir }));
}
function runOpen(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', shell: false });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('系统无法打开，请使用页面显示的文件路径')));
  });
}
export function openWorkbenchUrl(url) {
  return process.platform === 'darwin' ? runOpen('open', [url]) : process.platform === 'win32'
    ? runOpen('rundll32', ['url.dll,FileProtocolHandler', url]) : runOpen('xdg-open', [url]);
}
function reveal(file) {
  return process.platform === 'darwin' ? runOpen('open', ['-R', file]) : process.platform === 'win32'
    ? runOpen('explorer.exe', ['/select,' + file]) : runOpen('xdg-open', [fs.statSync(file).isDirectory() ? file : path.dirname(file)]);
}
async function signoffExisting({ dir, step, note, id, openStatus }) {
  const args = ['signoff', dir, note, '--step', String(step), '--approval-id', id], logs = [];
  if ([13, 14, 15].includes(step)) {
    const report = finalDeliveryReport(dir), set = report.reviewSets[step];
    if (set?.bindings.length) args.push('--delivery-revision', set.deliveryRevision);
    if (openStatus) args.push('--open-status', openStatus);
  }
  await reviewCommands(commandContext(parseArgs(args), line => logs.push(line))).signoff();
  return { archive: () => {
    const sha = commitSnapshot(dir, '工作台审阅记录：' + note, { log: line => logs.push(line) });
    return { git: sha ? 'committed' : 'not-confirmed', sha, logs };
  } };
}

export async function startWorkbench(directory, { port = 0, signoff = signoffExisting, locate = reveal } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口应为 0–65535 的整数');
  const root = fs.realpathSync(path.resolve(directory)), token = crypto.randomBytes(32).toString('hex');
  let origin;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) { send(res, 403, { error: '仅接受本机工作台的同源请求' }); return; }
      const url = new URL(req.url, origin), route = url.pathname;
      if (['/', '/app.js', '/app.css', '/model.mjs', '/document.mjs', '/session.mjs'].includes(route) && ['GET', 'HEAD'].includes(req.method)) {
        const file = path.join(assets, route === '/' ? 'index.html' : route.slice(1));
        streamFile(req, res, file, file.endsWith('.mjs') ? file + '.js' : file, fs.statSync(file).size); return;
      }
      const supplied = req.headers.authorization === 'Bearer ' + token || (route === '/api/file' && url.searchParams.get('token') === token);
      if (!supplied) { send(res, 401, { error: '工作台连接已失效，请使用启动时提供的完整链接重新打开' }); return; }
      const films = filmsAt(root);
      if (route === '/api/films' && req.method === 'GET') { send(res, 200, { films, workspaceId: digest(root).slice(0, 24) }); return; }
      const body = req.method === 'POST' ? await bodyOf(req) : {};
      if (route === '/api/ui' && ['GET', 'POST'].includes(req.method)) { send(res, 200, req.method === 'GET' ? readWorkbenchUI(root) : writeWorkbenchUI(root, body)); return; }
      const film = films.find(f => f.id === (body.film || url.searchParams.get('film')));
      if (!film) throw new Error('影片不在本次工作台授权范围内');
      if (route === '/api/report' && req.method === 'GET') { send(res, 200, captureWorkbench(film.dir)); return; }
      if (route === '/api/status' && req.method === 'GET') { send(res, 200, workbenchStatus(film.dir)); return; }
      if (route === '/api/pending' && req.method === 'GET') { send(res, 200, workbenchPending(film.dir)); return; }
      if (route === '/api/file' && ['GET', 'HEAD'].includes(req.method)) {
        const file = workbenchFile(film.dir, url.searchParams.get('artifact'), url.searchParams.get('version'), url.searchParams.get('entry'));
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        streamFile(req, res, file.file, file.name, file.size); return;
      }
      if (req.method !== 'POST') { send(res, 404, { error: '未找到工作台入口' }); return; }
      let result;
      if (route === '/api/note') result = addWorkbenchNote(film.dir, body);
      else if (route === '/api/repair') result = recordWorkbenchRepair(film.dir, body);
      else if (route === '/api/resolve') result = resolveWorkbenchNote(film.dir, body);
      else if (route === '/api/check') result = checkWorkbenchArtifact(film.dir, body);
      else if (route === '/api/decision') result = await decideWorkbenchStage(film.dir, body, signoff);
      else if (route === '/api/locate') { const file = workbenchOriginal(film.dir, body.artifactId); await locate(file); result = { located: true, path: file, message: '已请求系统定位文件，未登记专用软件打开或验收' }; }
      else { send(res, 404, { error: '未找到工作台操作' }); return; }
      send(res, 200, result);
    } catch (error) { if (!res.headersSent) send(res, /工程正在写入|工程忙/.test(error.message) ? 423 : 400, { error: error.message }); else res.destroy(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = 'http://127.0.0.1:' + server.address().port;
  return { server, origin, token, url: origin + '/#' + token,
    close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }) };
}
