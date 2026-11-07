import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { digest, fileDigest, atomicJson } from './evidence.mjs';
import { assertCompatibleProgress, PRODUCTION_STEPS, REVIEW_GATES } from './state.mjs';
import { lockProduction } from './operations.mjs';
import { workbenchCatalog, workbenchDependencies, workbenchJson, scopedPath } from './workbench-catalog.mjs';

const ledgerPath = dir => scopedPath(dir, '.wka/workbench.json');
const now = () => new Date().toISOString();
function rootOf(dir) {
  dir = fs.realpathSync(path.resolve(dir));
  scopedPath(dir, '.wka/workbench/objects'); scopedPath(dir, '.cache/operation.lock');
  assertCompatibleProgress(dir);
  return dir;
}
function ledger(dir) {
  const data = workbenchJson(ledgerPath(dir), { version: 1, registrations: [], artifacts: [], notes: [], checks: [], decisions: [] });
  if (data.version !== 1 || !['registrations', 'artifacts', 'notes', 'checks', 'decisions'].every(k => Array.isArray(data[k])) ||
      !data.artifacts.every(a => typeof a.id === 'string' && typeof a.path === 'string' && Array.isArray(a.versions))) throw new Error('工作台账本损坏或版本较新，请核实备份或升级；不会覆盖');
  return data;
}
function save(dir, data) { atomicJson(ledgerPath(dir), data); }
function locked(dir, fn) {
  dir = rootOf(dir); const release = lockProduction(dir);
  try { return fn(dir); } finally { release(); }
}
export function hasWorkbench(dir) { return fs.existsSync(path.join(dir, '.wka/workbench.json')); }

function snapshot(dir, item) {
  const entries = [], directory = fs.lstatSync(item.path).isDirectory();
  const store = scopedPath(dir, '.wka/workbench/objects');
  if (item.path === dir || item.path === store || store.startsWith(item.path + path.sep) || item.path.startsWith(store + path.sep)) throw new Error('不能将工作台自身存储登记为交付物');
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(scopedPath(dir, '.wka/workbench/objects/.gitignore'), '*\n!.gitignore\n');
  const walk = (file, rel) => {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) throw new Error(`不保存链接或特殊文件：${file}`);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) walk(path.join(file, name), rel ? rel + '/' + name : name);
      return;
    }
    const sha256 = fileDigest(file), object = scopedPath(dir, '.wka/workbench/objects/' + sha256);
    if (!fs.existsSync(object)) {
      const temp = object + '.' + crypto.randomUUID() + '.part';
      try {
        fs.copyFileSync(file, temp);
        if (fileDigest(temp) !== sha256 || fileDigest(file) !== sha256) throw new Error(`保存期间文件变化，请重试：${file}`);
        fs.renameSync(temp, object);
      } finally { fs.rmSync(temp, { force: true }); }
    } else if (fileDigest(object) !== sha256) throw new Error(`历史快照损坏，请从备份恢复：${sha256}`);
    entries.push({ path: rel || path.basename(file), sha256, size: st.size });
  };
  walk(item.path, '');
  if (!entries.length || !entries.some(e => e.size)) throw new Error('交付文件为空');
  return { kind: directory ? 'directory' : 'file', entries, digest: digest(entries) };
}
function mediaDuration(item) {
  if (!['audio', 'video'].includes(item.kind)) return null;
  const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', item.path], { encoding: 'utf8', timeout: 10000 });
  const n = Number(p.stdout); return p.status === 0 && n > 0 && Number.isFinite(n) ? n : null;
}

// Caller holds the production lock; repeated capture never rewrites the film or migrates state.
function capture(dir, { producedPaths = [] } = {}) {
  const data = ledger(dir), before = digest(data), catalog = workbenchCatalog(dir, data.registrations);
  for (const item of catalog.items) {
    let artifact = data.artifacts.find(a => a.id === item.id);
    if (!artifact) { artifact = { ...item, versions: [] }; data.artifacts.push(artifact); }
    Object.assign(artifact, item);
    artifact.dependencies = workbenchDependencies(dir, item, catalog.film);
    artifact.error = null;
    if (!fs.existsSync(item.path)) { artifact.availability = artifact.versions.length ? 'missing' : 'not-generated'; continue; }
    try {
      const snap = snapshot(dir, item), old = artifact.versions.at(-1);
      const produced = producedPaths.some(file => path.resolve(dir, file) === item.path);
      if (!old || old.snapshot.digest !== snap.digest || (produced && old.dependencies !== artifact.dependencies)) {
        artifact.versions.push({ id: crypto.randomUUID(), number: artifact.versions.length + 1, at: now(), snapshot: snap,
          dependencies: artifact.dependencies, duration: mediaDuration(item), provenance: produced ? 'produced' : 'observed' });
      }
      artifact.availability = 'present';
    } catch (error) {
      // A failed archive is not a successfully registered current version.
      artifact.availability = 'unreadable'; artifact.error = error.message;
    }
  }
  // Keep earlier records even when configuration no longer lists them.
  for (const artifact of data.artifacts) if (!catalog.items.some(i => i.id === artifact.id)) artifact.availability = 'historical';
  if (digest(data) !== before || !fs.existsSync(ledgerPath(dir))) save(dir, data);
  return report(dir, data, catalog);
}

function report(dir, data, catalog) {
  const items = data.artifacts.map(a => {
    const current = a.versions.at(-1) || null;
    const revision = digest({ id: a.id, version: current?.id, dependencies: a.dependencies, availability: a.availability });
    const checked = data.checks.some(c => c.artifactId === a.id && c.revision === revision);
    const notes = data.notes.filter(n => n.artifactId === a.id);
    let problem = a.error;
    if (a.technical?.status === 'hard-error') problem = (a.technical.errors || ['技术检查失败']).join('；');
    if (a.availability === 'present' && /(?:QC报告|字幕预检).*\.json$/.test(a.path)) {
      const result = workbenchJson(a.path, {});
      if ((result.unresolved?.length || result.needsFix?.length) || (result.ok === false && !Array.isArray(result.accepted))) problem = '检查报告存在未解决问题，请回到对话处理';
    }
    return { ...a, current, revision, checked, notes, problem,
      freshness: current && current.dependencies !== a.dependencies ? 'needs-review' : 'current' };
  });
  const stages = Object.entries(PRODUCTION_STEPS).map(([number, label]) => {
    const step = Number(number), chosen = items.filter(i => i.availability !== 'historical' && (i.step === step || (step === 12 && i.step === 13)));
    const revision = digest({ step, items: chosen.map(i => i.revision), contract: step >= 13 ? catalog.contract?.id : null,
      blockingNotes: chosen.flatMap(i => i.notes.filter(n => n.blocking && n.versionId === i.current?.id).map(n => [n.id, n.resolved])) });
    const decisions = data.decisions.filter(d => d.step === step), latest = decisions.at(-1);
    const blocks = [];
    for (const item of chosen.filter(i => i.required)) {
      if (item.availability !== 'present') blocks.push(`${item.label}：${item.error || '交付物尚未生成或已缺失'}`);
      else if (!item.checked) blocks.push(`${item.label}：尚未检查当前版本`);
      if (item.problem) blocks.push(`${item.label}：${item.problem}`);
      if (item.notes.some(n => n.versionId === item.current?.id && n.blocking && !n.resolved)) blocks.push(`${item.label}：有未解决的阻塞意见`);
    }
    if (!chosen.length && !catalog.notApplicable.has(step)) blocks.push('尚无登记的交付物，请在对话中补齐或登记');
    if (step >= 13 && !catalog.notApplicable.has(step)) blocks.push(...catalog.warnings);
    let status = catalog.notApplicable.has(step) && !chosen.length ? 'not-applicable' : 'pending';
    if (latest?.decision === 'approved') status = latest.revision === revision && !blocks.length ? 'approved' : 'needs-review';
    else if (latest?.decision === 'changes-requested' && latest.revision === revision) status = 'changes-requested';
    if (status === 'pending' && chosen.some(i => i.freshness === 'needs-review')) status = 'needs-review';
    return { step, label, gate: REVIEW_GATES[step] || null, revision, status, items: chosen, blocks, decisions };
  });
  return { version: 1, ok: !items.some(i => i.availability === 'unreadable'), dir, title: catalog.film.title || path.basename(dir), stages, shots: catalog.shots,
    duration: catalog.duration, warnings: catalog.warnings, notes: data.notes, history: items.filter(i => i.availability === 'historical') };
}

export function captureWorkbench(dir, options = {}) { return locked(dir, root => capture(root, options)); }
export function assertWorkbenchScope(dir) { return rootOf(dir); }
// Only the CLI pipeline can use this while it already owns the same production lock.
export function captureWorkbenchLocked(dir, options = {}) {
  const view = capture(rootOf(dir), options);
  if (!view.ok) throw new Error('交付版本未能完整保存：' + [...new Set(view.stages.flatMap(s => s.items).filter(i => i.availability === 'unreadable').map(i => i.error))].join('；'));
  return view;
}

export function registerWorkbenchArtifact(dir, { file, step, label, depends, required = true }) {
  return locked(dir, root => {
    if (!file || !Number.isInteger(step) || !PRODUCTION_STEPS[step]) throw new Error('登记需要文件路径及 1–15 的工序');
    if (depends !== undefined && (!Array.isArray(depends) || depends.some(d => typeof d !== 'string'))) throw new Error('来源应为路径列表');
    for (const rel of depends || []) scopedPath(root, rel);
    const absolute = path.resolve(root, file), relative = path.relative(root, absolute);
    const external = relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
    if (!external) scopedPath(root, absolute);
    if (!fs.existsSync(absolute)) throw new Error('待登记的文件不存在');
    if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error('不登记文件链接');
    const relativePath = external ? null : relative.split(path.sep).join('/');
    const data = ledger(root), value = { path: absolute, relativePath, step, label: label || path.basename(absolute), external, required: !!required, ...(depends ? { depends } : {}) };
    const i = data.registrations.findIndex(r => external ? r.path === absolute : r.relativePath === relativePath);
    if (i < 0) data.registrations.push(value); else data.registrations[i] = value;
    save(root, data); return capture(root, { producedPaths: [absolute] });
  });
}

function versionFor(data, artifactId, versionId) {
  const artifact = data.artifacts.find(a => a.id === artifactId), version = artifact?.versions.find(v => v.id === versionId);
  if (!artifact || !version) throw new Error('找不到登记的交付版本');
  return { artifact, version };
}
export function workbenchFile(dir, artifactId, versionId, entry = null) {
  dir = rootOf(dir); const data = ledger(dir), { artifact, version } = versionFor(data, artifactId, versionId);
  if (version.snapshot.kind === 'directory' && !entry) throw new Error('请选择目录中的具体文件');
  const selected = entry ? version.snapshot.entries.find(e => e.path === entry) : version.snapshot.entries[0];
  if (!selected || !/^[a-f0-9]{64}$/.test(selected.sha256)) throw new Error('文件未登记或超出版本范围');
  const file = scopedPath(dir, '.wka/workbench/objects/' + selected.sha256);
  if (!fs.existsSync(file) || fileDigest(file) !== selected.sha256) throw new Error('历史文件缺失或损坏');
  return { file, name: selected.path, size: selected.size, kind: artifact.kind };
}
export function workbenchOriginal(dir, artifactId) {
  dir = rootOf(dir); const data = ledger(dir);
  const item = workbenchCatalog(dir, data.registrations).items.find(i => i.id === artifactId);
  if (!item || !fs.existsSync(item.path)) throw new Error('当前登记的原文件已不存在');
  return item.path;
}

function validateAnchor(root, artifact, version, anchor) {
  if (!anchor || anchor.type === 'general') return { type: 'general' };
  if (anchor.type === 'text' && artifact.kind === 'text') {
    const { start, end, quote } = anchor;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end - start > 10000) throw new Error('文字选段范围无效');
    const text = fs.readFileSync(workbenchFile(root, artifact.id, version.id).file, 'utf8');
    if (end > text.length || text.slice(start, end) !== quote) throw new Error('文字选段与该版本不一致');
    return { type: 'text', start, end, quote };
  }
  if (anchor.type === 'image' && artifact.kind === 'image') {
    if (![anchor.x, anchor.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('图片位置必须在画面内');
    return { type: 'image', x: anchor.x, y: anchor.y };
  }
  if (anchor.type === 'time' && ['audio', 'video'].includes(artifact.kind)) {
    const { start, end = start } = anchor;
    if (![start, end].every(Number.isFinite) || start < 0 || end < start || end > (version.duration || 86400)) throw new Error('时间区间无效或超过媒体长度');
    return { type: 'time', start, end };
  }
  throw new Error('批注定位与交付物类型不匹配');
}
export function addWorkbenchNote(dir, { artifactId, versionId, text, anchor, blocking = true }) {
  return locked(dir, root => {
    const data = ledger(root), { artifact, version } = versionFor(data, artifactId, versionId);
    if (typeof text !== 'string' || !text.trim() || text.length > 10000) throw new Error('请填写 1–10000 字的审阅意见');
    const note = { id: crypto.randomUUID(), artifactId, versionId, text: text.trim(), anchor: validateAnchor(root, artifact, version, anchor), blocking: !!blocking, resolved: false, at: now() };
    data.notes.push(note); save(root, data); return note;
  });
}
export function resolveWorkbenchNote(dir, { id, resolved }) {
  return locked(dir, root => {
    const data = ledger(root), note = data.notes.find(n => n.id === id);
    if (!note || typeof resolved !== 'boolean') throw new Error('意见不存在或状态无效');
    note.resolved = resolved; note.updatedAt = now(); save(root, data); return note;
  });
}
export function checkWorkbenchArtifact(dir, { artifactId, versionId, revision }) {
  return locked(dir, root => {
    const view = capture(root), item = view.stages.flatMap(s => s.items).find(i => i.id === artifactId);
    if (!item || item.current?.id !== versionId || item.revision !== revision || item.availability !== 'present') throw new Error('交付版本已变化，请重新打开并检查');
    const data = ledger(root);
    if (!data.checks.some(c => c.artifactId === artifactId && c.revision === revision)) data.checks.push({ artifactId, versionId, revision, at: now() });
    save(root, data); return { checked: true };
  });
}
export async function decideWorkbenchStage(dir, request, signoff) {
  dir = rootOf(dir); const release = lockProduction(dir);
  try {
    const { step, revision, decision, note } = request;
    const stage = capture(dir).stages.find(s => s.step === step);
    if (!stage || !stage.gate) throw new Error('本工序没有正式审片节点');
    if (stage.revision !== revision) throw new Error('阶段内容或来源已变化，请刷新并重新审阅');
    if (!['approved', 'changes-requested'].includes(decision) || typeof note !== 'string' || !note.trim() || note.length > 10000) throw new Error('请填写明确的审阅结论');
    if (decision === 'approved' && stage.blocks.length) throw new Error(stage.blocks.join('；'));
    if (stage.status === 'approved' && decision === 'approved') return stage.decisions.at(-1);
    const id = crypto.randomUUID(); let result = null;
    if (decision === 'approved') {
      if (typeof signoff !== 'function') throw new Error('签批服务不可用，未批准');
      result = await signoff({ dir, step, note, id, openStatus: request.openStatus });
      if (capture(dir).stages.find(s => s.step === step).revision !== revision) throw new Error('存档期间版本变化，请核实后重新审阅');
    }
    const data = ledger(dir), record = { id, step, revision, decision, note: note.trim(), at: now(), bindings: stage.items.map(i => ({ artifactId: i.id, versionId: i.current?.id, revision: i.revision })) };
    data.decisions.push(record); save(dir, data);
    const archive = result?.archive ? result.archive() : result;
    return { ...record, archive };
  } finally { release(); }
}
export function workbenchPending(dir) {
  dir = rootOf(dir); const data = ledger(dir);
  return { dir, instruction: '仅为待办，收到用户在对话中的执行要求后处理；视频生成每批另行确认。',
    notes: data.notes.filter(n => !n.resolved).map(n => {
      const { artifact, version } = versionFor(data, n.artifactId, n.versionId);
      return { ...n, path: artifact.path, step: artifact.step, version: version.number, historical: artifact.versions.at(-1).id !== version.id };
    }),
    decisions: data.decisions.filter((d, i) => d.decision === 'changes-requested' && !data.decisions.slice(i + 1).some(later => later.step === d.step && later.decision === 'approved')) };
}
