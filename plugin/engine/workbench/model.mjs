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
// 只有 Codex 内启动的工作台带 thread 参数，才能用 codex:// 回到原对话；
// 其他宿主（如 Claude 桌面端的浏览器面板）会拦截该协议，返回 null 由调用方改走剪贴板。
export function chatLink(thread, prompt) {
  return validThreadId(thread) ? 'codex://threads/' + thread + '?prompt=' + encodeURIComponent(prompt) : null;
}
export const formatBytes = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
const MATRIX_LIMIT = 4e6;
export function lineChanges(before, after) {
  const a = String(before).split('\n'), b = String(after).split('\n');
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const left = a.slice(start, endA), right = b.slice(start, endB), width = right.length + 1;
  const addedLines = [], removedLines = [];
  if (left.length * right.length > MATRIX_LIMIT) {
    const counts = new Map();
    for (const line of left) counts.set(line, (counts.get(line) || 0) + 1);
    for (const line of right) { if (counts.get(line) > 0) counts.set(line, counts.get(line) - 1); else addedLines.push(line); }
    for (const line of left) { if (counts.get(line) > 0) { counts.set(line, counts.get(line) - 1); removedLines.push(line); } }
    return { addedLines, removedLines };
  }
  const table = new Uint32Array((left.length + 1) * width);
  for (let i = 1; i <= left.length; i++) for (let j = 1; j <= right.length; j++) table[i * width + j] = left[i - 1] === right[j - 1] ? table[(i - 1) * width + j - 1] + 1 : Math.max(table[(i - 1) * width + j], table[i * width + j - 1]);
  let i = left.length, j = right.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && left[i - 1] === right[j - 1]) { i--; j--; }
    else if (j > 0 && (i === 0 || table[i * width + j - 1] >= table[(i - 1) * width + j])) addedLines.push(right[--j]);
    else removedLines.push(left[--i]);
  }
  return { addedLines: addedLines.reverse(), removedLines: removedLines.reverse() };
}
export function lineDiff(before, after) {
  const { addedLines, removedLines } = lineChanges(before, after);
  return { added: addedLines.length, removed: removedLines.length };
}
const EXCERPT_LIMIT = 3, EXCERPT_WIDTH = 24;
const excerptLine = (label, lines) => {
  const shown = lines.map(line => line.trim()).filter(Boolean);
  if (!shown.length) return '';
  const quote = line => '「' + (line.length > EXCERPT_WIDTH ? line.slice(0, EXCERPT_WIDTH) + '…' : line) + '」';
  return label + '：' + shown.slice(0, EXCERPT_LIMIT).map(quote).join('') + (shown.length > EXCERPT_LIMIT ? '等 ' + shown.length + ' 行' : '');
};
export const formatChangeExcerpts = ({ addedLines, removedLines }) => [excerptLine('新增', addedLines), excerptLine('删除', removedLines)].filter(Boolean);
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
