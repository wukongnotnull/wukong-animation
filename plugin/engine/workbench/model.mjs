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
