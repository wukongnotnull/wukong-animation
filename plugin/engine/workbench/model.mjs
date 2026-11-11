export const noteKey = (film, item, version) => `note:${film}:${item}:${version}`;
export const stageKey = (film, step, revision) => `stage:${film}:${step}:${revision}`;
export function allItems(report) { return [...new Map(report.stages.flatMap(s => s.items).map(i => [i.id, i])).values()]; }
export function reviewRows(report, { query = '', filter = 'all', category = 'all' } = {}) {
  const term = query.trim().toLocaleLowerCase();
  return allItems(report).map(item => {
    const stage = report.stages.find(s => s.step === item.step), open = item.notes.filter(n => !n.resolved);
    const decisions = stage.decisions || [], outstanding = decisions.slice(decisions.findLastIndex(d => d.decision === 'approved') + 1).filter(d => d.decision === 'changes-requested');
    const decision = stage.items.find(i => i.category === 'formal')?.id === item.id ? outstanding.at(-1) : null;
    const flags = { blocking: !!decision || open.some(n => n.blocking), verification: !!decision?.repair || open.some(n => n.status === 'awaiting-review'), review: item.freshness === 'needs-review' };
    return { item, stage, flags, decision, priority: flags.blocking ? 0 : flags.verification ? 1 : flags.review ? 2 : 4 };
  }).filter(row => (category === 'all' || row.item.category === category) && (filter === 'all' || row.flags[filter]) &&
    (!term || [row.item.label, row.item.relativePath, row.stage?.label, row.decision?.note, ...row.item.notes.map(n => n.text)].join(' ').toLocaleLowerCase().includes(term)))
    .sort((a, b) => a.priority - b.priority || a.item.step - b.item.step || a.item.label.localeCompare(b.item.label));
}
function openDeliverable(report, extra = {}) {
  for (const stage of report.stages) {
    const file = stage.items.find(i => i.category === 'formal' && i.availability === 'present') || stage.items.find(i => i.availability === 'present') || stage.items[0];
    if (file) return { step: file.step, item: file.id, version: file.current?.id || null, ...extra };
  }
  return { step: report.stages[0]?.step ?? 2, item: null, version: null, ...extra };
}
export function restorePosition(report, saved) {
  if (!saved || saved.overview) return openDeliverable(report);
  const stage = report.stages.find(s => s.step === saved.step), item = allItems(report).find(i => i.id === saved.item);
  if (!stage || !item) return openDeliverable(report, { message: '上次的交付物已不可用，已打开当前可用成果。' });
  if (!item.versions.some(v => v.id === saved.version)) return { ...saved, step: item.step, version: item.current?.id, message: '上次查看的版本已不可用，请核对当前可用版本。' };
  return { ...saved, step: item.step };
}
export function formatClock(value) {
  const n = Math.max(0, Number(value) || 0), minutes = Math.floor(n / 60);
  return String(minutes).padStart(2, '0') + ':' + (n - minutes * 60).toFixed(2).padStart(5, '0');
}
export function parseClock(text) {
  const match = String(text ?? '').trim().match(/^(\d+):(\d{1,2})(?:\.(\d+))?$/);
  if (!match) return null;
  const seconds = Number(match[2]);
  if (seconds >= 60) return null;
  const fraction = match[3] ? Number('0.' + match[3]) : 0;
  return Math.round((Number(match[1]) * 60 + seconds + fraction) * 100) / 100;
}
export function formatSpan(start, end) {
  const from = formatClock(start);
  if (!Number.isFinite(Number(end)) || Math.abs(Number(end) - Number(start)) < 0.005) return from;
  return from + '–' + formatClock(end);
}
export const SEEK_TOLERANCE = 0.05;
export const inSpan = (time, start, end) => time >= start - SEEK_TOLERANCE && time < end - SEEK_TOLERANCE;
export function playbackContext(item, version) {
  if (!version?.context?.shots) return null;
  const shots = version.context.shots;
  if (/局部小样|局部原画质/.test(item.path)) {
    const shot = shots.find(s => item.path.split(/[\\/]/).at(-1).startsWith(s.id + '.'));
    return shot ? { ...version.context, shots: [{ ...shot, start: 0 }], duration: shot.duration } : null;
  }
  return version.context;
}
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validThreadId = value => typeof value === 'string' && THREAD_ID.test(value);
export function chatPrompt({ film, label, notes }) {
  const head = `处理工作台里的待办。影片：${film}；交付物：${label}。共 ${notes.length} 条批注：`;
  return [head, ...notes.map((note, index) => `${index + 1}. 【${note.where}】${note.text}`)].join('\n');
}
export function chatLink(thread, prompt) {
  return (validThreadId(thread) ? 'codex://threads/' + thread : 'codex://threads/new') + '?prompt=' + encodeURIComponent(prompt);
}
export const formatBytes = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
export function lineDiff(before, after) {
  const a = String(before).split('\n'), b = String(after).split('\n');
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const left = a.slice(start, endA), right = b.slice(start, endB);
  let common = 0;
  if (left.length * right.length > 4e6) {
    const counts = new Map();
    for (const line of left) counts.set(line, (counts.get(line) || 0) + 1);
    for (const line of right) if (counts.get(line) > 0) { counts.set(line, counts.get(line) - 1); common++; }
  } else {
    let row = new Uint32Array(right.length + 1);
    for (const line of left) {
      const next = new Uint32Array(right.length + 1);
      for (let j = 0; j < right.length; j++) next[j + 1] = line === right[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]);
      row = next;
    }
    common = row[right.length];
  }
  return { added: right.length - common, removed: left.length - common };
}
export const formatLineDiff = ({ added, removed }) => added || removed ? '文字内容：' + [added && '新增 ' + added + ' 行', removed && '删除 ' + removed + ' 行'].filter(Boolean).join('，') : '';
const seconds = value => (Math.round(value * 10) / 10).toFixed(1) + ' 秒';
export function versionChanges(version, previous) {
  const entries = version.snapshot.entries, total = entries.reduce((n, e) => n + e.size, 0);
  if (!previous) return ['首次保存 · ' + entries.length + ' 个文件 · ' + formatBytes(total)];
  const before = new Map(previous.snapshot.entries.map(e => [e.path, e])), after = new Map(entries.map(e => [e.path, e]));
  const added = entries.filter(e => !before.has(e.path)), removed = previous.snapshot.entries.filter(e => !after.has(e.path));
  const changed = entries.filter(e => before.has(e.path) && before.get(e.path).sha256 !== e.sha256);
  const lines = [], previousTotal = previous.snapshot.entries.reduce((n, e) => n + e.size, 0);
  if (!added.length && !removed.length && !changed.length) lines.push('文件内容没有变化，上游依赖已更新');
  else if (version.snapshot.kind === 'file' && previous.snapshot.kind === 'file') lines.push('内容已更新 · ' + formatBytes(previousTotal) + ' → ' + formatBytes(total));
  else {
    const names = list => list.slice(0, 3).map(e => e.path).join('、') + (list.length > 3 ? ' 等 ' + list.length + ' 个' : '');
    for (const [label, list] of [['新增', added], ['修改', changed], ['删除', removed]]) if (list.length) lines.push(label + ' ' + list.length + ' 个文件：' + names(list));
    lines.push('总大小 ' + formatBytes(previousTotal) + ' → ' + formatBytes(total));
  }
  if (Number.isFinite(version.duration) && Number.isFinite(previous.duration) && Math.abs(version.duration - previous.duration) >= 0.05) lines.push('时长 ' + seconds(previous.duration) + ' → ' + seconds(version.duration));
  const shots = version.context?.shots?.length, previousShots = previous.context?.shots?.length;
  if (shots !== undefined && previousShots !== undefined && shots !== previousShots) lines.push('镜头 ' + previousShots + ' → ' + shots + ' 个');
  return lines;
}
