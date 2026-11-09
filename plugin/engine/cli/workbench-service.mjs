// One user-owned local service; only CLI invocations can expand its project scope.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HOME } from '../core/paths.mjs';
import { startWorkbench, normalizeWorkbenchDirectories } from './workbench-server.mjs';

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
function read(file, validate) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('工作台记录损坏，不会覆盖：' + file); }
  if (!validate(value)) throw new Error('工作台记录损坏或版本较新，不会覆盖：' + file);
  return value;
}
function save(file, value) {
  const temp = file + '.' + crypto.randomUUID() + '.part';
  try { fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}
const validPort = value => Number.isInteger(value) && value > 0 && value <= 65535;
const validCatalog = value => value?.version === 1 && validPort(value.port) && typeof value.root === 'string' && path.isAbsolute(value.root) && Array.isArray(value.directories) && value.directories.length > 0 && value.directories.every(dir => typeof dir === 'string' && path.isAbsolute(dir));
const validRuntime = value => value?.version === 1 && Number.isInteger(value.pid) && value.pid > 0 && /^http:\/\/127\.0\.0\.1:\d+$/.test(value.origin) && validPort(Number(value.origin.split(':').at(-1))) && /^[a-f0-9]{64}$/.test(value.token) && typeof value.instanceId === 'string';
async function lock(file) {
  const owner = { pid: process.pid, id: crypto.randomUUID() };
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
      return () => { try { if (JSON.parse(fs.readFileSync(file)).id === owner.id) fs.rmSync(file); } catch {} };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let previous;
      try { previous = JSON.parse(fs.readFileSync(file)); } catch {}
      if (Number.isInteger(previous?.pid) && previous.pid > 0 && !alive(previous.pid)) {
        try { if (JSON.parse(fs.readFileSync(file)).id === previous.id) fs.rmSync(file); } catch {}
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  throw new Error('另一个启动命令正在接入工作台，请稍后重试');
}
async function controlRequest(runtime, route, body) {
  const response = await fetch(runtime.origin + route, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(2000),
    headers: { 'X-Wka-Control': runtime.token, Connection: 'close', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '工作台控制响应无效');
  return data;
}
function projectUrl(origin, listing, directories) {
  const film = directories.flatMap(dir => listing.films.filter(f => f.dir === dir || path.dirname(path.dirname(f.dir)) === dir))[0];
  return origin + '/' + (film ? '?film=' + encodeURIComponent(film.id) : '');
}
export async function openWorkbench(directory, { directories = [], port = null, home = HOME } = {}) {
  if (port !== null && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error('端口应为 0–65535 的整数');
  const requested = normalizeWorkbenchDirectories([directory, ...directories]);
  if (port === 0) return { ...await startWorkbench(requested[0], { directories: requested.slice(1), port }), reused: false };
  const folder = path.join(home, 'workbench'), catalogFile = path.join(folder, 'catalog.json'), runtimeFile = path.join(folder, 'runtime.json');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 }); fs.chmodSync(folder, 0o700);
  const unlock = await lock(path.join(folder, 'startup.lock'));
  try {
    let catalog = read(catalogFile, validCatalog);
    const runtime = read(runtimeFile, validRuntime);
    if (runtime) {
      let status;
      try { status = await controlRequest(runtime, '/_workbench/status'); }
      catch (error) {
        // Never replace a live but unresponsive service, or send paths to an unknown listener.
        if (alive(runtime.pid) || error.cause?.code !== 'ECONNREFUSED') throw new Error('无法验证已有工作台连接，请检查原服务：' + runtime.origin);
      }
      if (status) {
        if (status.service !== 'wka-workbench' || status.protocol !== 1 || status.instanceId !== runtime.instanceId) throw new Error('端口响应身份不符，不会接入项目或停止该服务');
        if (port !== null && port !== Number(runtime.origin.split(':').at(-1))) throw new Error('已有工作台运行在 ' + runtime.origin + '；去掉 --port 复用，或先停止原服务再更换端口');
        const listing = await controlRequest(runtime, '/_workbench/projects', { directories: requested });
        return { reused: true, origin: runtime.origin, url: projectUrl(runtime.origin, listing, requested) };
      }
    }
    const all = [...new Set([...(catalog?.directories || []), ...requested])], available = all.filter(dir => fs.existsSync(dir) && fs.statSync(dir).isDirectory());
    const chosen = port ?? catalog?.port ?? 63711, root = catalog?.root || requested[0];
    const uiDirectory = path.join(folder, 'workspace'); fs.mkdirSync(uiDirectory, { recursive: true, mode: 0o700 });
    const token = crypto.randomBytes(32).toString('hex'), instanceId = crypto.randomUUID();
    const app = await startWorkbench(available[0], { directories: available.slice(1), port: chosen, identityRoot: root, uiDirectory,
      control: { token, instanceId, onDirectories(next) {
        const updated = { ...catalog, directories: [...new Set([...catalog.directories, ...next])] };
        save(catalogFile, updated); catalog = updated;
      } } });
    try {
      catalog = { version: 1, root, port: chosen, directories: all }; save(catalogFile, catalog);
      save(runtimeFile, { version: 1, pid: process.pid, origin: app.origin, instanceId, token });
    } catch (error) { await app.close(); throw error; }
    app.server.once('close', () => { try { if (read(runtimeFile, validRuntime)?.instanceId === instanceId) fs.rmSync(runtimeFile); } catch {} });
    return { ...app, reused: false, url: projectUrl(app.origin, app.listing(), requested) };
  } finally { unlock(); }
}
