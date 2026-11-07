const $ = id => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem('workbench-token');
if (token) { sessionStorage.setItem('workbench-token', token); history.replaceState(null, '', '/'); }
const ui = { film: null, report: null, step: 2, item: null, version: null, anchor: { type: 'general' }, media: null, render: 0 };
const labels = { pending: '待审阅', approved: '已通过', 'changes-requested': '需要修改', 'needs-review': '需要复核', 'not-applicable': '不适用', present: '已生成', missing: '文件缺失', 'not-generated': '尚未生成', unreadable: '无法读取', historical: '历史交付物' };
const kinds = { text: '文档', image: '图片', audio: '音频', video: '视频', directory: '专用软件工程', file: '附件' };
const icons = { text: '▤', image: '▧', audio: '♫', video: '▶', directory: '▱', file: '◇' };
const time = value => { const n = Math.max(0, Number(value) || 0); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(Math.floor(n % 60)).padStart(2, '0')}`; };
const bytes = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
const date = at => new Date(at).toLocaleString('zh-CN', { hour12: false });
function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function button(text, onClick, className) { const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', onClick); return node; }
let noticeTimer;
function notice(text, error = false) { $('notice').textContent = text; $('notice').className = error ? 'error' : ''; $('notice').hidden = false; clearTimeout(noticeTimer); if (!error) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6500); }
async function api(route, body) {
  let response;
  try { response = await fetch(route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify({ film: ui.film, ...body }) } : {}) }); }
  catch { throw new Error('工作台连接已断开。请重新启动工作台，再使用新的完整链接打开；意见已保存到本地的部分不会丢失。'); }
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '操作失败'); return data;
}
async function action(fn) { try { return await fn(); } catch (error) { notice(error.message, true); } }
function stage() { return ui.report?.stages.find(s => s.step === ui.step); }
function item() { return stage()?.items.find(i => i.id === ui.item); }
function version() { return item()?.versions.find(v => v.id === ui.version); }
function mediaUrl(artifact = item(), v = version()) { return `/api/file?${new URLSearchParams({ film: ui.film, artifact: artifact.id, version: v.id, token })}`; }
function current() { return item()?.current?.id === ui.version; }
function anchorText(anchor) {
  if (anchor.type === 'text') return `文字 · “${anchor.quote.slice(0, 35)}${anchor.quote.length > 35 ? '…' : ''}”`;
  if (anchor.type === 'image') return `画面位置 · ${Math.round(anchor.x * 100)}%, ${Math.round(anchor.y * 100)}%`;
  if (anchor.type === 'time') return `时间 · ${time(anchor.start)}${anchor.end !== anchor.start ? ' — ' + time(anchor.end) : ''}`;
  return '整份交付物';
}
function setAnchor(anchor) {
  ui.anchor = anchor; $('anchor-label').textContent = anchorText(anchor); $('time-anchor').hidden = anchor.type !== 'time';
  if (anchor.type === 'time') { $('time-start').value = anchor.start.toFixed(2); $('time-end').value = (anchor.end ?? anchor.start).toFixed(2); }
  document.querySelectorAll('.pin').forEach(n => n.remove());
  if (anchor.type === 'image') {
    const wrap = document.querySelector('.image-wrap');
    if (wrap) { const pin = el('span', undefined, 'pin'); pin.style.left = anchor.x * 100 + '%'; pin.style.top = anchor.y * 100 + '%'; wrap.append(pin); }
  }
}
async function loadReport(reset = false) {
  const selection = ui.film, report = await api('/api/report?film=' + encodeURIComponent(selection));
  if (selection !== ui.film) return;
  ui.report = report;
  if (reset) { ui.step = report.stages.find(s => s.items.some(i => i.availability === 'present') && s.status !== 'approved')?.step || 2; ui.item = null; ui.version = null; }
  await render();
}
function renderStages() {
  $('stages').replaceChildren();
  const gates = ui.report.stages.filter(s => s.gate && s.status !== 'not-applicable');
  $('progress').textContent = `${gates.filter(s => s.status === 'approved').length}/${gates.length} 已通过`;
  for (const row of ui.report.stages) {
    const node = button('', () => action(async () => { ui.step = row.step; ui.item = null; ui.version = null; await render(); }), `stage ${row.status} ${row.step === ui.step ? 'active' : ''}`);
    node.title = row.label + ' · ' + labels[row.status]; node.setAttribute('aria-current', row.step === ui.step ? 'step' : 'false');
    node.append(el('span', String(row.step).padStart(2, '0'), 'number'), el('span', row.label, 'label'), el('span', row.status === 'approved' ? '✓' : row.status === 'needs-review' ? '↻' : row.status === 'not-applicable' ? '—' : '·', 'stage-dot'));
    $('stages').append(node);
  }
}
function renderFiles() {
  const chosen = stage();
  if (!chosen.items.some(i => i.id === ui.item)) { ui.item = chosen.items.find(i => i.availability === 'present')?.id || chosen.items[0]?.id || null; ui.version = null; }
  const file = item(); if (!file?.versions.some(v => v.id === ui.version)) ui.version = file?.current?.id || null;
  $('file-count').textContent = chosen.items.length + ' 项'; $('files').replaceChildren();
  for (const row of chosen.items) {
    const node = button('', () => action(async () => { ui.item = row.id; ui.version = row.current?.id; await render(); }), 'file ' + (ui.item === row.id ? 'active' : ''));
    const copy = el('span', undefined, 'file-copy');
    copy.append(el('strong', row.label), el('small', `${row.current ? 'v' + row.current.number + ' · ' : ''}${row.checked ? '已检查' : labels[row.availability]}`));
    node.append(el('span', icons[row.kind], 'file-icon'), copy); $('files').append(node);
  }
  if (!chosen.items.length) $('files').append(el('p', chosen.status === 'not-applicable' ? '本片不需要此工序' : '暂无登记交付物', 'empty-notes'));
}
async function renderViewer(serial) {
  const file = item(), v = version();
  const key = file?.id + '/' + v?.id;
  const previous = ui.media && ui.viewKey === key ? { time: ui.media.currentTime, rate: ui.media.playbackRate } : null;
  ui.media?.pause(); ui.media = null; ui.viewKey = key; $('viewer').replaceChildren(); $('timeline').hidden = true; setAnchor({ type: 'general' });
  $('stage-name').textContent = `第 ${ui.step} 道 · ${stage().label}`; $('file-name').textContent = file?.label || stage().label;
  $('file-path').textContent = file?.path || '本地素材 · 只读预览'; $('locate').disabled = !file || file.availability !== 'present';
  $('view-state').textContent = v ? current() ? (file.availability === 'present' ? '当前版本 · v' : '最近保存 · v') + v.number : '历史版本 · v' + v.number : '尚无交付物';
  $('view-state').className = 'tag ' + (!current() && v ? 'warn' : '');
  if (!file || !v) {
    const empty = el('div', undefined, 'empty'); empty.append(el('span', icons[file?.kind] || '◈', 'empty-symbol'), el('h2', stage().status === 'not-applicable' ? '本片不需要此工序' : '等待这一阶段的成果'), el('p', file?.error || '在对话中完成或登记交付物后，点击“刷新交付物”即可查看。'));
    $('viewer').append(empty); return;
  }
  const url = mediaUrl(file, v);
  if (file.kind === 'text') {
    const response = await fetch(url); if (!response.ok) { const e = await response.json(); throw new Error(e.error); }
    const text = await response.text(); if (serial !== ui.render) return;
    const pre = el('pre', text, 'document'); pre.id = 'document'; pre.tabIndex = 0; pre.setAttribute('aria-label', '只读文档'); $('viewer').append(pre);
  } else if (file.kind === 'image') {
    const wrap = el('div', undefined, 'image-wrap'), img = el('img'); img.src = url; img.alt = file.label;
    img.addEventListener('error', () => notice('图片无法预览，请检查文件或定位原文件。', true));
    img.addEventListener('click', event => { const rect = img.getBoundingClientRect(); setAnchor({ type: 'image', x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }); $('note-text').focus(); });
    wrap.append(img); $('viewer').append(wrap);
  } else if (['audio', 'video'].includes(file.kind)) {
    const media = document.createElement(file.kind); media.controls = true; media.preload = 'metadata'; media.src = url; media.setAttribute('aria-label', file.label); ui.media = media;
    media.addEventListener('error', () => notice('浏览器无法播放此媒体，请定位原文件检查格式；未记录为播放成功。', true));
    if (file.kind === 'audio') {
      const wrap = el('div', undefined, 'audio-view'), art = el('div', undefined, 'audio-art');
      for (let i = 0; i < 39; i++) { const bar = el('span'); bar.style.height = (18 + (Math.sin(i * 2.3) + 1) * 25 + Math.sin(i / 38 * Math.PI) * 45) + 'px'; art.append(bar); }
      art.setAttribute('aria-hidden', 'true'); wrap.append(art, el('h2', file.label), el('p', '聆听完整声音，也留意每一次转场'), media); $('viewer').append(wrap);
    } else $('viewer').append(media);
    $('timeline').hidden = false;
    const update = () => {
      const duration = Number.isFinite(media.duration) ? media.duration : v.duration || ui.report.duration || 1;
      $('seek').max = duration; $('seek').value = media.currentTime; $('play-time').textContent = time(media.currentTime) + ' / ' + time(duration);
      document.querySelectorAll('.clip').forEach(clip => clip.classList.toggle('active', media.currentTime >= Number(clip.dataset.start) && media.currentTime < Number(clip.dataset.end)));
    };
    media.addEventListener('loadedmetadata', () => { if (previous) { media.currentTime = Math.min(previous.time, media.duration || previous.time); media.playbackRate = previous.rate; $('speed').value = String(previous.rate); } });
    for (const name of ['loadedmetadata', 'timeupdate', 'seeking', 'seeked']) media.addEventListener(name, update); update();
    const localShot = /局部小样|局部原画质/.test(file.path) ? ui.report.shots.find(s => file.path.includes('/' + s.id + '.')) : null;
    const shots = localShot ? [{ ...localShot, start: 0 }] : ui.report.shots;
    $('shot-track').replaceChildren();
    for (const shot of shots) {
      const clip = button('', () => { media.currentTime = shot.start; }, 'clip'); clip.style.flexGrow = Math.max(1, shot.duration); clip.dataset.start = shot.start; clip.dataset.end = shot.start + shot.duration;
      clip.append(el('span', shot.id), el('small', time(shot.start))); $('shot-track').append(clip);
    }
    if (!shots.length) $('shot-track').append(el('span', '此项目尚未登记镜头，可使用上方进度条定位。', 'hint'));
  } else {
    const wrapper = el('div', undefined, 'directory'); wrapper.append(el('h2', file.label), el('p', '此交付物需要专用软件检查。下方为保存的版本内容；“定位原文件”只打开当前文件所在位置。'));
    const list = el('ul'); for (const entry of v.snapshot.entries) { const row = el('li'); row.append(el('span', entry.path), el('small', bytes(entry.size))); list.append(row); } wrapper.append(list); $('viewer').append(wrapper);
  }
}
async function goToNote(note) {
  if (ui.version !== note.versionId) { ui.version = note.versionId; await render(); }
  setAnchor(note.anchor);
  if (note.anchor.type === 'time' && ui.media) {
    const target = ui.media, seek = () => { target.currentTime = note.anchor.start; };
    if (target.readyState) seek(); else target.addEventListener('loadedmetadata', seek, { once: true });
  }
  if (note.anchor.type === 'text' && $('document')?.firstChild) {
    const range = document.createRange(); range.setStart($('document').firstChild, note.anchor.start); range.setEnd($('document').firstChild, note.anchor.end);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const rect = range.getBoundingClientRect(), box = $('document').getBoundingClientRect(); $('document').scrollTop += rect.top - box.top - 80;
  }
}
function renderInspector() {
  const file = item(), v = version(), selectedStage = stage();
  $('kind-label').textContent = kinds[file?.kind] || ''; $('versions').replaceChildren();
  for (const row of [...(file?.versions || [])].reverse()) { const option = el('option', `v${row.number} · ${date(row.at)}${row.id === file.current.id ? ' · 当前' : ' · 历史'}`); option.value = row.id; $('versions').append(option); }
  $('versions').value = ui.version || ''; $('versions').disabled = !v;
  $('version-detail').textContent = v ? `${v.snapshot.entries.length} 个文件 · ${bytes(v.snapshot.entries.reduce((n, e) => n + e.size, 0))} · ${v.provenance === 'produced' ? '制作完成时登记' : '从现有文件登记'}` : '尚无已保存版本';
  $('checks').replaceChildren();
  if (file) {
    const messages = [file.availability !== 'present' ? labels[file.availability] : null, file.freshness === 'needs-review' ? '来源已变化，请复核当前成果' : null, file.problem, file.checked && current() ? '✓ 当前版本已检查' : null].filter(Boolean);
    for (const message of messages) $('checks').append(el('p', message, 'status-line ' + (message.startsWith('✓') ? 'good' : 'warn')));
  }
  $('checked').disabled = !file || !v || !current() || file.availability !== 'present' || file.checked;
  $('checked').textContent = file?.checked && current() ? '✓ 当前版本已检查' : '✓ 已检查当前版本';
  $('note-form').hidden = !v; $('notes').replaceChildren();
  const notes = file?.notes || []; $('note-count').textContent = notes.filter(n => !n.resolved).length + ' 条待处理';
  for (const note of notes) {
    const card = el('article', undefined, 'note-card ' + (note.resolved ? 'resolved' : ''));
    const vn = file.versions.find(row => row.id === note.versionId)?.number;
    card.append(button(`v${vn} · ${anchorText(note.anchor)}`, () => action(() => goToNote(note))), el('p', note.text));
    const foot = el('footer'); foot.append(el('span', note.resolved ? '已解决' : note.blocking ? '阻塞意见' : '建议'), button(note.resolved ? '重新打开' : '标为已解决', () => action(async () => { await api('/api/resolve', { id: note.id, resolved: !note.resolved }); await loadReport(); })));
    card.append(foot); $('notes').append(card);
  }
  if (!notes.length) $('notes').append(el('div', '还没有意见，检查后在下方记录。', 'empty-notes'));
  $('stage-status').textContent = labels[selectedStage.status]; $('stage-status').className = 'tag ' + (selectedStage.status === 'approved' ? 'good' : selectedStage.status === 'needs-review' ? 'warn' : '');
  $('stage-blocks').replaceChildren();
  if (!selectedStage.gate) $('stage-blocks').append(el('p', '此工序不单独签批，检查结果保留到相关审片节点。'));
  else for (const block of selectedStage.blocks) $('stage-blocks').append(el('p', '· ' + block));
  $('approve').disabled = !selectedStage.gate || selectedStage.blocks.length > 0 || selectedStage.status === 'approved';
  $('request-changes').disabled = !selectedStage.gate; $('decision-note').disabled = !selectedStage.gate;
  $('draft-confirm').hidden = ui.step !== 15;
  $('decision-history').replaceChildren();
  for (const d of [...selectedStage.decisions].reverse()) $('decision-history').append(el('p', `${date(d.at)} · ${labels[d.decision]}${d.revision !== selectedStage.revision ? ' · 历史版本' : ''}\n${d.note}`));
  if (!selectedStage.decisions.length) $('decision-history').append(el('p', '尚无阶段结论'));
}
async function render() {
  if (!ui.report) return;
  const serial = ++ui.render; renderStages(); renderFiles(); renderInspector(); await renderViewer(serial);
}
document.addEventListener('selectionchange', () => {
  const doc = $('document'), selection = window.getSelection();
  if (!doc || !selection.rangeCount || selection.isCollapsed || !doc.contains(selection.anchorNode) || !doc.contains(selection.focusNode)) return;
  const range = selection.getRangeAt(0), prefix = document.createRange(); prefix.selectNodeContents(doc); prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length, quote = range.toString(); if (quote.length <= 10000) setAnchor({ type: 'text', start, end: start + quote.length, quote });
});
$('films').addEventListener('change', () => action(async () => { ui.film = $('films').value; await loadReport(true); }));
$('refresh').addEventListener('click', () => action(async () => { const b = $('refresh'); b.disabled = true; try { await loadReport(); notice('交付物已刷新，正在查看的版本保留不变。'); } finally { b.disabled = false; } }));
$('versions').addEventListener('change', () => action(async () => { ui.version = $('versions').value; await render(); }));
$('clear-anchor').addEventListener('click', () => setAnchor({ type: 'general' }));
$('mark-time').addEventListener('click', () => { if (ui.media) { setAnchor({ type: 'time', start: ui.media.currentTime, end: ui.media.currentTime }); $('note-text').focus(); } });
for (const name of ['time-start', 'time-end']) $(name).addEventListener('change', () => { ui.anchor = { type: 'time', start: Number($('time-start').value), end: Number($('time-end').value) }; $('anchor-label').textContent = anchorText(ui.anchor); });
$('seek').addEventListener('input', () => { if (ui.media) ui.media.currentTime = Number($('seek').value); });
$('speed').addEventListener('change', () => { if (ui.media) ui.media.playbackRate = Number($('speed').value); });
$('fullscreen').addEventListener('click', () => action(() => document.fullscreenElement ? document.exitFullscreen() : $('viewer').requestFullscreen()));
$('locate').addEventListener('click', () => action(async () => { const result = await api('/api/locate', { artifactId: ui.item }); notice(result.message); }));
$('checked').addEventListener('click', () => action(async () => { const file = item(); await api('/api/check', { artifactId: file.id, versionId: ui.version, revision: file.revision }); await loadReport(); }));
$('note-form').addEventListener('submit', event => { event.preventDefault(); action(async () => {
  const submit = $('note-form').querySelector('[type=submit]'); submit.disabled = true;
  try { await api('/api/note', { artifactId: ui.item, versionId: ui.version, text: $('note-text').value, anchor: ui.anchor, blocking: $('blocking').checked }); $('note-text').value = ''; await loadReport(); notice('意见已保存。审阅完成后，可回到对话统一处理。'); }
  finally { submit.disabled = false; }
}); });
async function decision(value) {
  const note = $('decision-note').value.trim() || (value === 'approved' ? '已逐项检查，通过当前阶段及版本' : '');
  if (!note) throw new Error('请填写需要修改的内容');
  const selected = stage(); $('approve').disabled = true; $('request-changes').disabled = true;
  try {
    const result = await api('/api/decision', { step: selected.step, revision: selected.revision, decision: value, note, ...(ui.step === 15 && $('draft-opened').checked ? { openStatus: 'opened' } : {}) });
    $('decision-note').value = ''; await loadReport();
    notice(value === 'approved' ? result.archive?.git === 'not-confirmed' ? '审阅通过已记录；Git 存档未确认，请在对话中核实。' : '本阶段已通过，结论已同步到制作流程。' : '返修要求已保存，回到对话后可统一发起处理。');
  } finally { renderInspector(); }
}
$('approve').addEventListener('click', () => action(() => decision('approved')));
$('request-changes').addEventListener('click', () => action(() => decision('changes-requested')));
$('pending').addEventListener('click', () => action(async () => {
  const data = await api('/api/pending?film=' + ui.film); $('pending-list').replaceChildren();
  for (const n of data.notes) $('pending-list').append(el('p', `第 ${n.step} 道 · v${n.version}${n.historical ? '（历史版本）' : ''} · ${anchorText(n.anchor)}\n${n.text}\n${n.path}`));
  for (const d of data.decisions) $('pending-list').append(el('p', `第 ${d.step} 道 · 阶段返修\n${d.note}`));
  if (!data.notes.length && !data.decisions.length) $('pending-list').append(el('p', '目前没有待处理意见。'));
  $('pending-dialog').showModal();
}));
$('close-pending').addEventListener('click', () => $('pending-dialog').close());
action(async () => {
  if (!token) throw new Error('请使用插件启动工作台时提供的完整链接打开。');
  const listing = await api('/api/films');
  for (const f of listing.films) { const option = el('option', f.name); option.value = f.id; $('films').append(option); }
  if (!listing.films.length) throw new Error('此目录没有可用影片，请先在对话中创建制作简报或选择已有片目录。');
  ui.film = listing.films[0].id; await loadReport(true);
});
