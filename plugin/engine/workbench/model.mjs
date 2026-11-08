export const noteKey = (film, item, version) => `note:${film}:${item}:${version}`;
export const stageKey = (film, step, revision) => `stage:${film}:${step}:${revision}`;
export function allItems(report) { return [...new Map(report.stages.flatMap(s => s.items).map(i => [i.id, i])).values()]; }
export function reviewRows(report, { query = '', filter = 'all', category = 'all' } = {}) {
  const term = query.trim().toLocaleLowerCase();
  return allItems(report).map(item => {
    const stage = report.stages.find(s => s.step === item.step), open = item.notes.filter(n => !n.resolved);
    const decisions = stage.decisions || [], outstanding = decisions.slice(decisions.findLastIndex(d => d.decision === 'approved') + 1).filter(d => d.decision === 'changes-requested');
    const decision = stage.items.find(i => i.category === 'formal')?.id === item.id ? outstanding.at(-1) : null;
    const flags = { blocking: !!decision || open.some(n => n.blocking), verification: !!decision?.repair || open.some(n => n.status === 'awaiting-review'), review: item.freshness === 'needs-review', unchecked: item.category !== 'history' && item.required && !item.checked };
    return { item, stage, flags, decision, priority: flags.blocking ? 0 : flags.verification ? 1 : flags.review ? 2 : flags.unchecked ? 3 : 4 };
  }).filter(row => (category === 'all' || row.item.category === category) && (filter === 'all' || row.flags[filter]) &&
    (!term || [row.item.label, row.item.relativePath, row.stage?.label, row.decision?.note, ...row.item.notes.map(n => n.text)].join(' ').toLocaleLowerCase().includes(term)))
    .sort((a, b) => a.priority - b.priority || a.item.step - b.item.step || a.item.label.localeCompare(b.item.label));
}
export function restorePosition(report, saved) {
  if (!saved || saved.overview) return { overview: true, step: 2, item: null, version: null };
  const stage = report.stages.find(s => s.step === saved.step), item = allItems(report).find(i => i.id === saved.item);
  if (!stage || !item) return { overview: true, step: 2, item: null, version: null, message: '上次的交付物已不可用，已返回待审总览。' };
  if (!item.versions.some(v => v.id === saved.version)) return { ...saved, step: item.step, version: item.current?.id, message: '上次查看的版本已不可用，请核对当前可用版本。' };
  return { ...saved, step: item.step };
}
export function playbackContext(item, version) {
  if (!version?.context?.shots) return null;
  const shots = version.context.shots;
  if (/局部小样|局部原画质/.test(item.path)) {
    const shot = shots.find(s => item.path.split(/[\\/]/).at(-1).startsWith(s.id + '.'));
    return shot ? { ...version.context, shots: [{ ...shot, start: 0 }], duration: shot.duration } : null;
  }
  return version.context;
}
