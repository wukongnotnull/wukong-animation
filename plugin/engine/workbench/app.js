import { allItems, reviewRows, restorePosition, noteKey, stageKey, playbackContext } from './model.mjs';
import { renderDocument, documentAnchor, revealDocumentAnchor } from './document.mjs';
import { createSession } from './session.mjs';

const $ = id => document.getElementById(id);
if (location.hash) history.replaceState(null, '', '/');
const ui = { film: null, report: null, step: 2, item: null, version: null, anchor: { type: 'general' }, media: null, render: 0, overview: true, panel: 'preview', raw: false, mediaStates: new Map(), pendingReport: null, fingerprint: null, busy: false, lastSync: null };
let session, draftTimer, noticeTimer, resolving, pollTimer, openedContext = null;
const labels = { archived: '历史档案 · 只读', pending: '待审阅', approved: '已通过', 'changes-requested': '需要修改', 'needs-review': '需要复核', 'not-applicable': '不适用', present: '已生成', missing: '文件缺失', 'not-generated': '尚未生成', unreadable: '无法读取', historical: '历史交付物' };
const categories = { formal: '正式交付物', reference: '参考资料', history: '历史交付物' };
const noteLabels = { pending: '待处理', 'awaiting-review': '已返修，待复验', resolved: '已解决', dismissed: '无需修改，已关闭' };
const kinds = { text: '文档', image: '图片', audio: '音频', video: '视频', directory: '专用软件工程', file: '附件' };
const icons = { text: '▤', image: '▧', audio: '♫', video: '▶', directory: '▱', file: '◇' };
const time = value => { const n = Math.max(0, Number(value) || 0); return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(Math.floor(n % 60)).padStart(2, '0'); };
const bytes = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
const date = at => !at ? '日期未记录' : new Date(at).toLocaleString('zh-CN', { hour12: false });
function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function button(text, fn, className) { const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', () => action(fn)); return node; }
function notice(text, error = false) { $('notice').textContent = text; $('notice').className = error ? 'error' : ''; $('notice').hidden = false; clearTimeout(noticeTimer); if (!error) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6500); }
function connection(text, error = false) { $('connection').textContent = text; $('connection').className = error ? 'warn' : 'good'; $('last-sync').textContent = ui.lastSync ? '最后同步 ' + date(ui.lastSync) : '尚未同步'; }
async function api(route, body) {
  let response;
  try { response = await fetch(route, { method: body ? 'POST' : 'GET', mode: 'same-origin', credentials: 'omit', headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify({ film: ui.film, ...body }) } : {}) }); }
  catch { connection('连接已断开 · 已加载内容可查看，正式提交暂不可用', true); throw new Error('工作台连接已断开，请重新启动后打开当前本机地址。未同步草稿保留在此浏览器原地址。'); }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 403) connection('连接被拒绝 · 请检查浏览器扩展是否改写请求', true);
    if (response.status === 423) { connection('制作进行中 · 正式意见与签批暂不可提交', true); throw new Error('制作正在写入工程，暂时不能提交正式意见或签批。草稿已保留，请等待制作结束后再提交。'); }
    throw new Error(data.error || '操作失败');
  }
  return data;
}
async function action(fn) { try { return await fn(); } catch (error) { notice(error.message, true); } }
function stage() { return ui.report?.stages.find(s => s.step === ui.step); }
function item() { return ui.report && allItems(ui.report).find(i => i.id === ui.item); }
function version() { return item()?.versions.find(v => v.id === ui.version); }
function current() { return item()?.current?.id === ui.version && item()?.availability !== 'historical'; }
function mediaUrl(file = item(), v = version()) { return '/api/file?' + new URLSearchParams({ film: ui.film, artifact: file.id, version: v.id }); }
function anchorText(a) {
  if (a.type === 'text') return '文字 · “' + a.quote.slice(0, 35) + (a.quote.length > 35 ? '…' : '') + '”';
  if (a.type === 'image') return '画面位置 · ' + Math.round(a.x * 100) + '%, ' + Math.round(a.y * 100) + '%';
  if (a.type === 'time') return '时间 · ' + time(a.start) + (a.end !== a.start ? ' — ' + time(a.end) : '');
  return '整份交付物';
}
function setAnchor(anchor) {
  ui.anchor = anchor; $('anchor-label').textContent = anchorText(anchor); $('time-anchor').hidden = anchor.type !== 'time';
  if (anchor.type === 'time') { $('time-start').value = anchor.start.toFixed(2); $('time-end').value = (anchor.end ?? anchor.start).toFixed(2); }
  document.querySelectorAll('.pin').forEach(n => n.remove());
  showImageAnchor(anchor);
}
function showImageAnchor(anchor, review = false) {
  const wrap = document.querySelector('.image-wrap');
  if (anchor.type !== 'image' || !wrap) return;
  const pin = el('span', undefined, review ? 'pin review-pin' : 'pin'); pin.title = review ? '原意见位置' : '当前草稿位置';
  pin.style.left = anchor.x * 100 + '%'; pin.style.top = anchor.y * 100 + '%'; wrap.append(pin);
}
function scheduleDrafts() { clearTimeout(draftTimer); draftTimer = setTimeout(() => session?.flush(), 500); }
function storeValue(key, value) { if (ui.report?.readonly) return; session?.set(key, value); scheduleDrafts(); }
function captureDrafts() {
  if (!session || !ui.report || ui.report.readonly || ui.overview) return;
  if (ui.noteDraftKey) {
    const text = $('note-text').value, old = session.get(ui.noteDraftKey);
    const value = text || ui.anchor.type !== 'general' ? { text, anchor: ui.anchor, blocking: $('blocking').checked } : null;
    if (value) {
      const unchanged = old && old.text === text && JSON.stringify(old.anchor) === JSON.stringify(ui.anchor) && old.blocking === value.blocking;
      value.requestId = unchanged && old.requestId ? old.requestId : crypto.randomUUID();
    }
    storeValue(ui.noteDraftKey, value);
  }
  if (ui.stageDraftKey) storeValue(ui.stageDraftKey, $('decision-note').value ? { text: $('decision-note').value } : null);
}
function rememberPosition() {
  if (!session || !ui.film) return;
  const key = ui.film + '/' + ui.item + '/' + ui.version;
  if (ui.media && ui.viewKey === key) ui.mediaStates.set(key, { time: ui.media.currentTime, rate: ui.media.playbackRate });
  storeValue('position:' + ui.film, { overview: ui.overview, step: ui.step, item: ui.item, version: ui.version, panel: ui.panel, raw: ui.raw, reviewNote: ui.reviewNote, media: ui.mediaStates.get(key) || null });
  storeValue('film', ui.film);
}
function stash() { captureDrafts(); rememberPosition(); }
function restoreDrafts() {
  ui.noteDraftKey = ui.item && ui.version ? noteKey(ui.film, ui.item, ui.version) : null;
  ui.stageDraftKey = stage() ? stageKey(ui.film, ui.step, stage().revision) : null;
  const draft = ui.noteDraftKey && session?.get(ui.noteDraftKey);
  $('note-text').value = draft?.text || ''; $('blocking').checked = draft?.blocking !== false; setAnchor(draft?.anchor || { type: 'general' });
  $('decision-note').value = session?.get(ui.stageDraftKey)?.text || '';
  const context = [ui.film, ui.step, stage()?.revision, ui.item, ui.version].join('/');
  if (openedContext !== context) { $('draft-opened').checked = false; openedContext = context; }
}
async function loadReport(reset = false, nextVersion = false) {
  const film = ui.film, report = await api('/api/report?film=' + encodeURIComponent(film));
  if (film !== ui.film) return;
  ui.report = report; ui.pendingReport = null; $('apply-update').hidden = true;
  ui.lastSync = new Date().toISOString(); connection('已连接 · 素材保留本机');
  if (reset) {
    const position = restorePosition(report, session?.get('position:' + film)); Object.assign(ui, position);
    if (position.message) notice(position.message, true);
    if (position.media) ui.mediaStates.set(film + '/' + ui.item + '/' + ui.version, position.media);
  } else if (nextVersion && item()?.current) ui.version = item().current.id;
  await render(); rememberPosition();
  const status = await api('/api/status?film=' + encodeURIComponent(film));
  if (film === ui.film) { ui.fingerprint = status.revision; ui.busy = status.busy; }
}
async function choose(file, v = file.current?.id, reviewNote = null) {
  stash(); ui.step = file.step; ui.item = file.id; ui.version = v; ui.overview = false; ui.reviewNote = reviewNote; ui.panel = 'preview'; await render(); rememberPosition();
}
async function chooseStage(row) {
  const file = row.items.find(i => i.category === 'formal' && i.availability === 'present') || row.items[0];
  if (file) return choose(file);
  stash(); ui.step = row.step; ui.item = null; ui.version = null; ui.overview = false; ui.reviewNote = null; await render(); rememberPosition();
}
function showPanel(panel) {
  ui.panel = panel; document.querySelector('.workspace').dataset.panel = panel;
  document.querySelectorAll('[data-panel]').forEach(node => { if (node.tagName === 'BUTTON') node.setAttribute('aria-pressed', String(node.dataset.panel === panel)); });
  rememberPosition();
}
function renderOverview() {
  document.querySelector('#overview h1').textContent = ui.report.readonly ? '历史档案' : '待审总览';
  document.querySelector('#overview .eyebrow').textContent = ui.report.readonly ? '查看原有成果与记录' : '继续你的审阅';
  document.querySelector('#overview .overview-heading p').textContent = ui.report.readonly ? '保留原文件与审阅结论，仅供查看。' : '找到问题，查看对应版本，再确认处理结果。';
  $('overview-counts').hidden = ui.report.readonly;
  const rows = reviewRows(ui.report, { query: $('search').value, filter: $('queue-filter').value, category: $('queue-category').value });
  $('overview-list').replaceChildren(); $('overview-counts').replaceChildren();
  for (const [filter, label] of [['blocking', '阻塞'], ['verification', '待复验'], ['review', '需复核'], ['unchecked', '未检查']]) $('overview-counts').append(button(reviewRows(ui.report, { filter }).length + ' ' + label, () => { $('queue-filter').value = filter; renderOverview(); }, 'count-button'));
  for (const row of rows) {
    const card = el('article', undefined, 'queue-row'), copy = el('div'), { item: file, stage: s, flags } = row;
    copy.append(el('small', '第 ' + file.step + ' 道 · ' + s.label + ' · ' + categories[file.category]), el('h2', file.label), el('p', ui.report.readonly ? '历史记录 · 只读' : [flags.blocking ? '有阻塞意见' : '', flags.verification ? '返修待复验' : '', flags.review ? '来源变化，需复核' : '', !file.current ? '等待成果' : file.checked ? '当前已检查' : '尚未检查'].filter(Boolean).join(' · ')));
    const controls = el('div', undefined, 'queue-actions'), note = file.notes.find(n => !n.resolved);
    controls.append(button(file.category === 'history' ? '查看历史' : '查看交付物', () => choose(file)));
    if (note) controls.append(button(note.repair && !note.resolved ? '查看返修' : '定位意见', () => note.repair && !note.resolved ? goToRepair(note) : goToNote(note), 'primary'));
    if (row.decision) controls.append(button(row.decision.repair ? '查看阶段返修' : '查看阶段要求', async () => { if (row.decision.repair) await goToRepair(row.decision); else await choose(file); showPanel('checks'); }, 'primary'));
    card.append(copy, controls); $('overview-list').append(card);
  }
  if (!rows.length) $('overview-list').append(el('p', '没有匹配的交付物或意见。', 'empty-notes'));
}
function renderStages() {
  $('stages').replaceChildren(); const gates = ui.report.stages.filter(s => s.gate && s.status !== 'not-applicable');
  $('progress').textContent = ui.report.readonly ? '历史档案 · 只读' : gates.filter(s => s.status === 'approved').length + '/' + gates.length + ' 已通过';
  for (const row of ui.report.stages) {
    const node = button('', () => chooseStage(row), 'stage ' + row.status + (row.step === ui.step ? ' active' : ''));
    node.title = row.label + ' · ' + labels[row.status]; node.setAttribute('aria-current', row.step === ui.step ? 'step' : 'false');
    node.append(el('span', String(row.step).padStart(2, '0'), 'number'), el('span', row.label, 'label'), el('span', row.status === 'approved' ? '✓' : row.status === 'needs-review' ? '↻' : row.status === 'not-applicable' ? '—' : '·', 'stage-dot')); $('stages').append(node);
  }
}
function renderFiles() {
  const selected = stage();
  if (!selected.items.some(i => i.id === ui.item)) { ui.item = selected.items.find(i => i.availability === 'present')?.id || selected.items[0]?.id || null; ui.version = item()?.current?.id || null; }
  if (ui.item && !item().versions.some(v => v.id === ui.version)) ui.version = item().current?.id;
  $('files').replaceChildren(); $('file-count').textContent = selected.items.length + ' 项';
  for (const category of ['formal', 'reference', 'history']) {
    const group = selected.items.filter(i => i.category === category); if (!group.length) continue;
    $('files').append(el('p', categories[category], 'category-label'));
    for (const file of group) {
      const node = button('', () => choose(file), 'file' + (ui.item === file.id ? ' active' : '')), copy = el('span', undefined, 'file-copy');
      copy.append(el('strong', file.label), el('small', (file.current ? 'v' + file.current.number + ' · ' : '') + (file.checked ? '已检查' : labels[file.availability])));
      node.append(el('span', icons[file.kind], 'file-icon'), copy); $('files').append(node);
    }
  }
}
async function renderViewer(serial) {
  const file = item(), v = version(), key = ui.film + '/' + ui.item + '/' + ui.version;
  if (ui.media && ui.viewKey) { ui.mediaStates.set(ui.viewKey, { time: ui.media.currentTime, rate: ui.media.playbackRate }); ui.media.pause(); }
  ui.media = null; ui.viewKey = key; ui.documentText = null; $('viewer').replaceChildren(); $('timeline').hidden = true; $('read-mode').hidden = true; $('shot-jump').hidden = true;
  $('stage-name').textContent = '第 ' + ui.step + ' 道 · ' + stage().label; $('file-name').textContent = file?.label || stage().label;
  $('file-path').textContent = file?.relativePath || file?.path || '本地素材 · 只读预览'; $('file-path').title = file?.path || ''; $('locate').disabled = !file || file.availability !== 'present';
  $('view-state').textContent = v ? (current() ? file.availability === 'present' ? '当前版本 · v' : '最近保存 · v' : '历史版本 · v') + v.number : '尚无交付物';
  $('view-state').className = 'tag ' + (!current() && v ? 'warn' : '');
  if (!file || !v) { const empty = el('div', undefined, 'empty'); empty.append(el('h2', stage().status === 'not-applicable' ? '本片不需要此工序' : '等待这一阶段的成果'), el('p', file?.error || '在对话中完成或登记交付物后，这里会提示更新。')); $('viewer').append(empty); return; }
  const url = mediaUrl(file, v);
  if (file.kind === 'text') {
    const response = await fetch(url); if (!response.ok) throw new Error((await response.json()).error || '文档读取失败');
    const raw = await response.text(); if (serial !== ui.render) return; ui.documentText = raw;
    const markdown = /\.md$/i.test(file.path); $('read-mode').hidden = !markdown; $('read-mode').textContent = ui.raw ? '排版阅读' : '查看原文';
    const doc = renderDocument(raw, markdown && !ui.raw); $('viewer').append(doc);
    const shots = [...doc.querySelectorAll('[data-shot]')]; $('shot-jump').replaceChildren(); $('shot-jump').hidden = !shots.length;
    if (shots.length) { const first = el('option', '定位镜号…'); first.value = ''; $('shot-jump').append(first); for (const shot of shots) { const option = el('option', shot.dataset.shot); option.value = shot.dataset.shot; $('shot-jump').append(option); } }
    if (ui.anchor.type === 'text') revealDocumentAnchor(doc, ui.anchor);
  } else if (file.kind === 'image') {
    const wrap = el('div', undefined, 'image-wrap'), img = el('img'); img.src = url; img.alt = file.label; img.tabIndex = 0; img.setAttribute('aria-label', file.label + '，方向键调整批注位置，回车记录');
    img.addEventListener('error', () => notice('图片无法预览，请检查原文件。', true));
    img.addEventListener('click', event => { const r = img.getBoundingClientRect(); setAnchor({ type: 'image', x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height }); captureDrafts(); showPanel('notes'); $('note-text').focus(); });
    img.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) { event.preventDefault(); const a = ui.anchor.type === 'image' ? { ...ui.anchor } : { type: 'image', x: 0.5, y: 0.5 }; a.x = Math.max(0, Math.min(1, a.x + (event.key === 'ArrowLeft' ? -0.02 : event.key === 'ArrowRight' ? 0.02 : 0))); a.y = Math.max(0, Math.min(1, a.y + (event.key === 'ArrowUp' ? -0.02 : event.key === 'ArrowDown' ? 0.02 : 0))); setAnchor(a); captureDrafts(); if (event.key === 'Enter') { showPanel('notes'); $('note-text').focus(); } } });
    wrap.append(img); $('viewer').append(wrap); setAnchor(ui.anchor);
  } else if (['audio', 'video'].includes(file.kind)) {
    const media = el(file.kind), previous = ui.mediaStates.get(key); media.controls = true; media.preload = 'metadata'; media.src = url; media.setAttribute('aria-label', file.label); ui.media = media;
    media.playbackRate = previous?.rate || 1; $('speed').value = String(media.playbackRate);
    media.addEventListener('error', () => notice('浏览器无法播放此媒体，请定位原文件检查格式。', true));
    if (file.kind === 'audio') { const wrap = el('div', undefined, 'audio-view'); wrap.append(el('h2', file.label), el('p', '聆听声音与每一次转场'), media); $('viewer').append(wrap); } else $('viewer').append(media);
    $('timeline').hidden = false; const context = playbackContext(file, v);
    const update = () => {
      const duration = Number.isFinite(media.duration) ? media.duration : v.duration || context?.duration || 1;
      $('seek').max = duration; $('seek').value = media.currentTime; $('play-time').textContent = time(media.currentTime) + ' / ' + time(duration);
      document.querySelectorAll('.clip').forEach(clip => clip.classList.toggle('active', media.currentTime >= Number(clip.dataset.start) && media.currentTime < Number(clip.dataset.end)));
    };
    media.addEventListener('loadedmetadata', () => { if (previous) media.currentTime = Math.min(previous.time, media.duration || previous.time); if (ui.anchor.type === 'time') media.currentTime = Math.min(ui.anchor.start, media.duration || ui.anchor.start); update(); });
    media.addEventListener('pause', rememberPosition); media.addEventListener('seeked', rememberPosition);
    for (const name of ['timeupdate', 'seeking', 'seeked']) media.addEventListener(name, update); update();
    $('shot-track').replaceChildren();
    for (const shot of context?.shots || []) { const clip = button('', () => { media.currentTime = shot.start; }, 'clip'); clip.style.flexGrow = Math.max(1, shot.duration); clip.dataset.start = shot.start; clip.dataset.end = shot.start + shot.duration; clip.append(el('span', shot.id), el('small', time(shot.start))); $('shot-track').append(clip); }
    if (!context?.shots.length) $('shot-track').append(el('span', '此版本未保存镜头结构，请按播放时间定位。', 'hint'));
  } else {
    const wrap = el('div', undefined, 'directory'); wrap.append(el('h2', file.label), el('p', '需要专用软件检查；此处展示已保存的文件组成。定位原文件不会记录为已打开验收。'));
    const list = el('ul'); for (const entry of v.snapshot.entries) { const row = el('li'); row.append(el('span', entry.path), el('small', bytes(entry.size))); list.append(row); } wrap.append(list); $('viewer').append(wrap);
  }
}
function noteStatus(note) { return note.status || (note.resolved ? 'resolved' : 'pending'); }
async function goToNote(note) {
  const file = allItems(ui.report).find(i => i.id === note.artifactId); if (!file) throw new Error('意见对应的交付物未找到');
  await choose(file, note.versionId, note.id);
  if (!$('note-text').value) { setAnchor(note.anchor); captureDrafts(); }
  else { showImageAnchor(note.anchor, true); notice('已定位原意见；你尚未提交的草稿及其定位仍保留。'); }
  if (note.anchor.type === 'time' && ui.media) { const media = ui.media, seek = () => { media.currentTime = note.anchor.start; }; if (media.readyState) seek(); else media.addEventListener('loadedmetadata', seek, { once: true }); }
  if (note.anchor.type === 'text' && $('document')) revealDocumentAnchor($('document'), note.anchor);
}
async function goToRepair(note) {
  const file = allItems(ui.report).find(i => i.id === note.repair?.artifactId);
  if (!file || !file.versions.some(v => v.id === note.repair.versionId)) throw new Error('返修目标版本未找到，请回到对话核实');
  await choose(file, note.repair.versionId, note.id);
}
function requestResolution(note, type) { resolving = { id: note.id, action: type, film: ui.film }; $('resolution-title').textContent = type === 'dismissed' ? '无需修改，关闭意见' : '退回继续处理'; $('resolution-reason').value = ''; $('resolution-dialog').showModal(); }
function noteCard(note) {
  const card = el('article', undefined, 'note-card' + (note.resolved ? ' resolved' : '')), original = allItems(ui.report).find(i => i.id === note.artifactId), vn = original?.versions.find(v => v.id === note.versionId)?.number;
  card.append(button('v' + (vn || '?') + ' · ' + anchorText(note.anchor), () => goToNote(note)), el('p', note.text));
  if (original?.id !== ui.item) card.append(el('small', '原意见：' + original?.label));
  card.append(el('p', noteLabels[noteStatus(note)] + (note.blocking ? ' · 阻塞意见' : ' · 建议'), 'meta'));
  if (note.repair) {
    card.append(el('p', '修改说明：' + note.repair.summary), el('p', '验证结果：' + note.repair.verification), button('查看对应返修版本', () => goToRepair(note)));
    if (noteStatus(note) === 'awaiting-review' && !ui.report.readonly) {
      const target = allItems(ui.report).find(i => i.id === note.repair.artifactId), valid = target?.current?.id === note.repair.versionId && target?.revision === note.repair.revision && target?.availability === 'present';
      const verify = button('确认复验通过', async () => { stash(); await api('/api/resolve', { id: note.id, action: 'verified', repairId: note.repair.id }); await loadReport(); notice('已记录你的复验结论。'); }, 'primary');
      verify.disabled = !valid || ui.item !== note.repair.artifactId || ui.version !== note.repair.versionId; card.append(verify);
      card.append(el('p', valid ? '打开对应返修版本并检查后，可确认复验。' : '返修目标已变化，请回到对话核实新版。', 'hint'));
    }
  }
  const footer = el('footer');
  if (!note.resolved && !ui.report.readonly) { footer.append(button('无需修改关闭', () => requestResolution(note, 'dismissed'))); if (noteStatus(note) === 'awaiting-review') footer.append(button('退回继续处理', () => requestResolution(note, 'reopen'))); }
  else if (!ui.report.readonly) footer.append(button('重新打开', async () => { await api('/api/resolve', { id: note.id, action: 'reopen' }); await loadReport(); }));
  card.append(footer);
  if (note.history?.length) { const details = el('details'); details.append(el('summary', '处置记录')); for (const h of note.history) details.append(el('p', date(h.at) + ' · ' + ({ repair: '提交返修结果', verified: '用户复验通过', dismissed: '无需修改关闭', reopen: '重新处理' }[h.action] || h.action) + (h.reason ? ' · ' + h.reason : ''))); card.append(details); }
  return card;
}
function renderInspector() {
  const file = item(), v = version(), s = stage(); $('kind-label').textContent = kinds[file?.kind] || ''; $('versions').replaceChildren();
  for (const row of [...file?.versions || []].reverse()) { const option = el('option', 'v' + row.number + ' · ' + date(row.at) + (row.id === file.current.id && file.availability !== 'historical' ? ' · 当前' : ' · 历史')); option.value = row.id; $('versions').append(option); }
  $('versions').value = ui.version || ''; $('versions').disabled = !v;
  $('version-detail').textContent = v ? v.snapshot.entries.length + ' 个文件 · ' + bytes(v.snapshot.entries.reduce((n, e) => n + e.size, 0)) + ' · ' + categories[file.category] : '尚无保存版本';
  $('checks').replaceChildren();
  if (file && current()) {
    for (const message of [file.availability !== 'present' && labels[file.availability], file.freshness === 'needs-review' && '来源已变化，请复核当前成果', file.problem, file.checked ? '当前版本已检查' : '尚未标记当前版本已检查']) if (message) $('checks').append(el('p', message, 'status-line ' + (file.checked && message === '当前版本已检查' ? 'good' : 'warn')));
  }
  else if (v) $('checks').append(el('p', '正在查看历史内容；当前阶段的检查与通过不会自动转移到此版本。', 'hint'));
  if (file?.category === 'reference') $('checks').append(el('p', '参考资料不作为本阶段必检项。', 'hint'));
  $('checked').disabled = ui.report.readonly || !file || !v || !current() || file.availability !== 'present' || file.checked;
  $('checked').textContent = file?.checked && current() ? '当前版本已检查' : '标记此版本已检查';
  $('note-form').hidden = ui.report.readonly || !v; $('notes').replaceChildren();
  let notes = [...file?.notes || []]; const selected = ui.report.notes.find(n => n.id === ui.reviewNote);
  if (selected && !notes.some(n => n.id === selected.id)) notes.unshift(selected);
  $('note-count').textContent = notes.filter(n => !n.resolved).length + ' 条未关闭';
  notes = notes.filter(n => n.id === ui.reviewNote || $('note-filter').value === 'all' || ($('note-filter').value === 'verification' ? noteStatus(n) === 'awaiting-review' : !n.resolved));
  for (const note of notes) $('notes').append(noteCard(note));
  if (!notes.length) $('notes').append(el('p', '没有匹配的意见。', 'empty-notes'));
  $('stage-status').textContent = labels[s.status]; $('stage-status').className = 'tag ' + (s.status === 'approved' ? 'good' : s.status === 'needs-review' ? 'warn' : '');
  $('stage-blocks').replaceChildren();
  if (!s.gate) $('stage-blocks').append(el('p', ui.report.readonly ? '旧项目只读留档；继续制作请新建项目并复用素材。' : '此工序不单独签批，检查结果保留到相关节点。'));
  for (const block of s.blocks) $('stage-blocks').append(el('p', '· ' + block));
  $('approve').disabled = !s.gate || s.blocks.length > 0 || s.status === 'approved' || !current(); $('request-changes').disabled = !s.gate; $('decision-note').disabled = !s.gate;
  $('draft-confirm').hidden = ui.report.readonly || ui.step !== 8; $('decision-history').replaceChildren();
  for (const d of [...s.decisions].reverse()) { const row = el('div'); row.append(el('p', date(d.at) + ' · ' + labels[d.decision] + (d.revision !== s.revision ? ' · 历史依据' : '') + '\n' + d.note)); if (d.repair) row.append(el('p', d.repair.summary + '\n' + d.repair.verification), button('查看阶段返修版本', () => goToRepair(d))); $('decision-history').append(row); }
  const lastApproval = s.decisions.findLastIndex(d => d.decision === 'approved');
  for (const d of (ui.report.readonly ? [] : s.decisions.slice(lastApproval + 1)).filter(d => d.decision === 'changes-requested')) {
    const row = el('div', undefined, 'stage-repair'); row.append(el('p', (d.repair ? '阶段返修待复验：' : '阶段待修改：') + d.note));
    if (d.repair) row.append(el('p', d.repair.summary + '\n验证：' + d.repair.verification), button('查看阶段返修版本', () => goToRepair(d)));
    row.append(el('p', '检查当前成果后，用“通过本阶段”确认，或填写结论退回修改。', 'hint')); $('stage-blocks').append(row);
  }
  if (!s.decisions.length) $('decision-history').append(el('p', '尚无阶段结论'));
  $('stage-drafts').replaceChildren();
  const prefix = 'stage:' + ui.film + ':' + ui.step + ':';
  for (const [key, value] of Object.entries(session?.values() || {})) if (key.startsWith(prefix) && key !== ui.stageDraftKey && value?.text) $('stage-drafts').append(el('p', value.text));
}
async function render() {
  if (!ui.report) return;
  $('archive-banner').hidden = !ui.report.readonly; $('mark-time').hidden = ui.report.readonly; $('next-item').hidden = ui.report.readonly;
  $('overview-button').textContent = ui.report.readonly ? '历史总览' : '待审总览';
  $('draft-status').hidden = ui.report.readonly; $('retry-drafts').hidden = ui.report.readonly || $('retry-drafts').hidden;
  const serial = ++ui.render; $('overview').hidden = !ui.overview; document.querySelector('.workspace').hidden = ui.overview; document.querySelector('.panelbar').hidden = ui.overview;
  if (ui.overview) { if (ui.media) ui.media.pause(); ui.noteDraftKey = null; ui.stageDraftKey = null; renderOverview(); return; }
  renderStages(); renderFiles(); restoreDrafts(); renderInspector(); await renderViewer(serial); showPanel(ui.panel || 'preview');
}
function updateFilmChoices(listing) {
  const signature = JSON.stringify(listing.films.map(film => [film.id, film.name]));
  if (signature === ui.filmChoices) return;
  ui.filmChoices = signature;
  const options = listing.films.map(film => { const option = el('option', film.name); option.value = film.id; return option; });
  if (ui.film && !listing.films.some(film => film.id === ui.film)) { const option = el('option', '当前项目暂不可用'); option.value = ui.film; options.push(option); }
  $('films').replaceChildren(...options); $('films').value = ui.film || '';
}
async function poll() {
  try {
    const listing = await api('/api/films'); updateFilmChoices(listing);
    if (!ui.film && listing.films.length) { ui.film = listing.films[0].id; $('films').value = ui.film; await loadReport(true); }
    if (!ui.film) { connection('已连接 · 等待加入影片'); return; }
    const film = ui.film, state = await api('/api/status?film=' + film); if (film !== ui.film) return;
    ui.busy = state.busy;
    connection(state.busy ? '制作进行中 · 可查看已载入内容，正式提交暂不可用' : '已连接 · 素材保留本机', state.busy);
    if (!state.busy && state.revision !== ui.fingerprint) {
      const report = await api('/api/report?film=' + film); if (film !== ui.film) return;
      ui.pendingReport = report; ui.lastSync = new Date().toISOString(); ui.fingerprint = (await api('/api/status?film=' + film)).revision;
      $('apply-update').textContent = '有更新 · 查看'; $('apply-update').hidden = false; connection('已连接 · 有更新待查看');
      if (!ui.overview && version()) { $('view-state').textContent = '正在查看 · v' + version().number + ' · 有更新待核对'; $('view-state').className = 'tag warn'; }
    }
    if (session?.dirty()) await session.flush();
  } catch (error) { connection(error.message, true); }
  finally { clearTimeout(pollTimer); pollTimer = setTimeout(poll, document.hidden ? 15000 : 4000); }
}

$('overview-button').onclick = () => action(async () => { stash(); ui.overview = true; await render(); rememberPosition(); });
$('films').onchange = () => action(async () => { stash(); ui.film = $('films').value; ui.fingerprint = null; ui.reviewNote = null; await loadReport(true); });
$('refresh').onclick = () => action(async () => { stash(); $('refresh').disabled = true; try { updateFilmChoices(await api('/api/films')); if (ui.film) await loadReport(); notice('已刷新，正在查看的版本保持不变。'); } finally { $('refresh').disabled = false; } });
$('apply-update').onclick = () => action(async () => { stash(); await loadReport(false, true); notice('已载入更新；旧版本的草稿仍单独保留。'); });
$('versions').onchange = () => action(async () => { stash(); ui.version = $('versions').value; await render(); rememberPosition(); });
$('clear-anchor').onclick = () => { setAnchor({ type: 'general' }); captureDrafts(); };
$('note-text').oninput = captureDrafts; $('blocking').onchange = captureDrafts; $('decision-note').oninput = captureDrafts;
for (const id of ['time-start', 'time-end']) $(id).onchange = () => { setAnchor({ type: 'time', start: Number($('time-start').value), end: Number($('time-end').value) }); captureDrafts(); };
$('mark-time').onclick = () => { if (ui.media && !ui.report.readonly) { setAnchor({ type: 'time', start: ui.media.currentTime, end: ui.media.currentTime }); captureDrafts(); showPanel('notes'); $('note-text').focus(); } };
$('seek').oninput = () => { if (ui.media) ui.media.currentTime = Number($('seek').value); };
$('speed').onchange = () => { if (ui.media) { ui.media.playbackRate = Number($('speed').value); rememberPosition(); } };
$('fullscreen').onclick = () => action(() => document.fullscreenElement ? document.exitFullscreen() : $('viewer').requestFullscreen());
$('locate').onclick = () => action(async () => notice((await api('/api/locate', { artifactId: ui.item })).message));
$('checked').onclick = () => action(async () => { stash(); const file = item(); await api('/api/check', { artifactId: file.id, versionId: ui.version, revision: file.revision }); await loadReport(); });
$('note-filter').onchange = renderInspector;
$('read-mode').onclick = () => action(async () => { captureDrafts(); ui.raw = !ui.raw; await render(); rememberPosition(); });
$('shot-jump').onchange = () => { const row = [...document.querySelectorAll('[data-shot]')].find(r => r.dataset.shot === $('shot-jump').value); if (row) { row.scrollIntoView({ block: 'center' }); row.focus(); } };
function selectedText() { const root = $('document'); if (!root || ui.documentText === null) return; const a = documentAnchor(root, window.getSelection(), ui.documentText); if (a) { setAnchor(a); captureDrafts(); } }
document.addEventListener('mouseup', selectedText); document.addEventListener('keyup', event => { if (event.key === 'Shift' || event.key.startsWith('Arrow')) selectedText(); });
$('note-form').onsubmit = event => { event.preventDefault(); action(async () => {
  captureDrafts(); const film = ui.film, key = ui.noteDraftKey, draft = structuredClone(session.get(key)), artifactId = ui.item, versionId = ui.version;
  const submit = $('note-form').querySelector('[type=submit]'); submit.disabled = true;
  try {
    await api('/api/note', { film, artifactId, versionId, ...draft });
    if (JSON.stringify(session.get(key)) === JSON.stringify(draft)) { storeValue(key, null); if (ui.noteDraftKey === key) { $('note-text').value = ''; setAnchor({ type: 'general' }); } }
    if (film === ui.film) { stash(); await loadReport(); } notice('意见已正式提交；返修仍由对话发起。');
  } finally { submit.disabled = false; }
}); };
async function decision(value) {
  stash(); const film = ui.film, s = stage(), key = ui.stageDraftKey, input = $('decision-note').value, note = input.trim() || (value === 'approved' ? '已逐项检查，通过当前阶段及版本' : '');
  if (!note) throw new Error('请填写需要修改的内容');
  $('approve').disabled = true; $('request-changes').disabled = true;
  try {
    const result = await api('/api/decision', { film, step: s.step, revision: s.revision, decision: value, note, ...(ui.step === 8 && $('draft-opened').checked ? { openStatus: 'opened' } : {}) });
    if (session.get(key)?.text === input) { storeValue(key, null); if (ui.stageDraftKey === key) $('decision-note').value = ''; }
    if (film === ui.film) await loadReport();
    notice(value === 'approved' ? result.archive?.git === 'not-confirmed' ? '批准已记录；Git 存档未确认，请在对话中核实。' : '阶段已通过，结论已同步。' : '返修要求已保存，回到对话后发起处理。');
  } finally { if (!ui.overview) renderInspector(); }
}
$('approve').onclick = () => action(() => decision('approved')); $('request-changes').onclick = () => action(() => decision('changes-requested'));
$('resolution-form').onsubmit = event => { event.preventDefault(); action(async () => { await api('/api/resolve', { ...resolving, reason: $('resolution-reason').value }); $('resolution-dialog').close(); stash(); await loadReport(); }); };
$('cancel-resolution').onclick = () => $('resolution-dialog').close();
$('pending').onclick = () => action(async () => {
  const data = await api('/api/pending?film=' + ui.film); $('pending-list').replaceChildren();
  for (const n of data.notes) { const card = el('article', undefined, 'note-card'); card.append(el('p', '第 ' + n.step + ' 道 · v' + n.version + (n.historical ? ' · 历史版本' : '') + ' · ' + noteLabels[noteStatus(n)]), el('p', n.text), button('定位原意见', async () => { $('pending-dialog').close(); await goToNote(n); })); if (n.repair) card.append(button('查看返修版本', async () => { $('pending-dialog').close(); await goToRepair(n); })); $('pending-list').append(card); }
  for (const d of data.decisions) { const card = el('article', undefined, 'note-card'); card.append(el('p', '第 ' + d.step + ' 道 · 阶段返修\n' + d.note), button('查看阶段', async () => { $('pending-dialog').close(); await chooseStage(ui.report.stages.find(s => s.step === d.step)); showPanel('checks'); })); if (d.repair) card.append(button('查看阶段返修版本', async () => { $('pending-dialog').close(); await goToRepair(d); })); $('pending-list').append(card); }
  if (!data.notes.length && !data.decisions.length) $('pending-list').append(el('p', '目前没有待处理意见。')); $('pending-dialog').showModal();
});
$('close-pending').onclick = () => $('pending-dialog').close();
for (const id of ['search', 'queue-filter', 'queue-category']) $(id).addEventListener(id === 'search' ? 'input' : 'change', renderOverview);
$('next-item').onclick = () => action(async () => { const rows = reviewRows(ui.report).filter(r => r.priority < 4); if (!rows.length) { notice('目前没有下一项待审成果。'); return; } const next = rows[(rows.findIndex(r => r.item.id === ui.item) + 1) % rows.length]; await choose(next.item); });
document.querySelectorAll('button[data-panel]').forEach(b => b.onclick = () => showPanel(b.dataset.panel));
function applyLayout(layout = {}) {
  const work = document.querySelector('.workspace');
  work.classList.toggle('library-collapsed', !!layout.libraryHidden); work.classList.toggle('inspector-collapsed', !!layout.inspectorHidden);
  document.documentElement.style.setProperty('--library-width', Math.max(180, Math.min(340, layout.libraryWidth || 220)) + 'px');
  document.documentElement.style.setProperty('--inspector-width', Math.max(260, Math.min(460, layout.inspectorWidth || 320)) + 'px');
  $('library-width').value = layout.libraryWidth || 220; $('inspector-width').value = layout.inspectorWidth || 320;
  $('toggle-library').textContent = layout.libraryHidden ? '展开文件栏' : '收起文件栏'; $('toggle-inspector').textContent = layout.inspectorHidden ? '展开审阅栏' : '收起审阅栏';
}
for (const [id, key] of [['toggle-library', 'libraryHidden'], ['toggle-inspector', 'inspectorHidden'], ['library-width', 'libraryWidth'], ['inspector-width', 'inspectorWidth']]) $(id).addEventListener(id.startsWith('toggle') ? 'click' : 'input', () => { const layout = { ...session.get('layout') }; layout[key] = id.startsWith('toggle') ? !layout[key] : Number($(id).value); applyLayout(layout); storeValue('layout', layout); });
$('retry-drafts').onclick = () => action(async () => { if (await session.flush()) return; if (confirm('其他页面可能已修改草稿。是否保留本页文字，并用本页草稿覆盖冲突项？')) await session.keepLocal(); });
window.addEventListener('pagehide', () => { stash(); session?.flush(); });
// Legacy fragment links still open, but no longer carry connection credentials.
window.addEventListener('hashchange', () => {
  if (location.hash) history.replaceState(null, '', '/');
});
document.addEventListener('visibilitychange', () => { if (document.hidden) stash(); else { clearTimeout(pollTimer); poll(); } });
action(async () => {
  const listing = await api('/api/films');
  session = await createSession({ read: () => api('/api/ui'), write: data => api('/api/ui', data), storage: localStorage, prefix: listing.workspaceId, onState: (state, message) => { $('draft-status').textContent = message; $('draft-status').className = state === 'error' ? 'warn' : ''; $('retry-drafts').hidden = ui.report?.readonly || state !== 'error'; } });
  const requested = new URLSearchParams(location.search).get('film');
  ui.film = listing.films.find(f => f.id === requested)?.id || listing.films.find(f => f.id === session.get('film'))?.id || listing.films[0]?.id;
  updateFilmChoices(listing); applyLayout(session.get('layout'));
  if (ui.film) await loadReport(true); else connection('已连接 · 等待加入影片');
  pollTimer = setTimeout(poll, 4000);
});
