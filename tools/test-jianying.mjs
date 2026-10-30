// 独立剪映检查：缺依赖、失败、跳过、取消和每文件零测试都不能成为绿灯。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run as runTests } from 'node:test';
import { requireDep } from '../plugin/engine/core/deps.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FILES = ['tests/integration/jianying.test.mjs', 'tests/integration/final-delivery.test.mjs', 'tests/unit/jianying-fonts.test.mjs'];
const browserCheck = async () => {
  const browser = await requireDep('playwright').chromium.launch({ timeout: 15000 });
  await browser.close();
};

export async function preflight({ run = spawnSync, browserCheck: checkBrowser = browserCheck } = {}) {
  const command = (name, args) => {
    const r = run(name, args, { encoding: 'utf8', timeout: 30000 });
    if (r.error || r.status !== 0) throw new Error(`${name} 不可用：${r.error?.message || r.stderr || r.status}`);
    return r.stdout;
  };
  command('ffmpeg', ['-version']); command('ffprobe', ['-version']);
  const info = JSON.parse(command('python3', ['-c', `import sys,json,importlib.metadata
import pyJianYingDraft
from pymediainfo import MediaInfo
assert MediaInfo.can_parse(), 'MediaInfo runtime unavailable'
print(json.dumps({'python':list(sys.version_info[:3]),'pyJianYingDraft':importlib.metadata.version('pyJianYingDraft')}))`]));
  if (!Array.isArray(info.python) || info.python[0] !== 3 || info.python[1] < 8) throw new Error('需要 Python >=3.8 且 <4');
  if (info.pyJianYingDraft !== '0.3.1') throw new Error(`需要 pyJianYingDraft==0.3.1，实际 ${info.pyJianYingDraft}`);
  await checkBrowser();
  return info;
}

const counts = () => ({ tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 });
/** files 仅供内部单测使用；生产 CLI 始终运行固定集合，不能从环境变量删减用例。 */
export async function runRequiredTests(files, { log = console.log, timeout = 600000 } = {}) {
  if (!files.length) throw new Error('必跑测试集合为空');
  const rows = files.map(file => ({ file: fs.realpathSync(path.resolve(file)), ...counts() }));
  for (const row of rows) if (!fs.statSync(row.file).isFile()) throw new Error(`测试文件不存在：${row.file}`);
  const byFile = new Map(rows.map(row => [row.file, row]));
  let unassignedFailure = false;
  for await (const { type, data: d } of runTests({ files: rows.map(row => row.file), concurrency: 1, timeout })) {
    if (['test:stdout', 'test:stderr'].includes(type)) { log(d.message.trimEnd()); continue; }
    if (!['test:pass', 'test:fail'].includes(type)) continue;
    const row = d.file && byFile.get(path.resolve(d.file));
    if (!row) { unassignedFailure = true; log(`无法归属的测试结果：${d.name}`); continue; }
    // Node 会把空文件包装成一个通过的 file test；它不是一个真实用例。
    const wrapper = d.line === 1 && d.column === 1 && path.resolve(d.name) === row.file;
    const suite = d.details?.type === 'suite';
    if (!wrapper && !suite) row.tests++;
    let outcome;
    if (d.skip !== undefined && d.skip !== false) outcome = 'skipped';
    else if (d.todo !== undefined && d.todo !== false) outcome = 'todo';
    else if (type === 'test:fail') outcome = ['cancelledByParent', 'testTimeoutFailure', 'testAborted'].includes(d.details?.error?.failureType) ? 'cancelled' : 'failed';
    else outcome = 'passed';
    if (outcome !== 'passed' || (!wrapper && !suite)) row[outcome]++;
    log(`${outcome.toUpperCase()} ${d.name}${d.details?.error ? '\n' + (d.details.error.cause?.stack || d.details.error.stack || d.details.error.message) : ''}`);
  }
  const total = counts();
  for (const row of rows) {
    for (const key of Object.keys(total)) total[key] += row[key];
    log(JSON.stringify(row));
  }
  const ok = !unassignedFailure && rows.every(row => row.tests > 0 && !row.failed && !row.cancelled && !row.skipped && !row.todo);
  return { ok, ...total, files: rows };
}

async function main() {
  process.chdir(ROOT);
  try { console.log('剪映依赖预检：', await preflight()); }
  catch (e) { throw new Error(`剪映预检失败：${e.message}`); }
  const report = await runRequiredTests(FILES);
  console.log('剪映必跑结果：' + JSON.stringify(report));
  process.exitCode = report.ok ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
}
