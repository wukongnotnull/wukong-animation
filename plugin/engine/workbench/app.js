import { allItems, restorePosition, noteKey, playbackContext, inSpan, formatClock, formatSpan, parseClock, chatPrompt, chatLink } from './model.mjs';
import { renderDocument, documentAnchor, revealDocumentAnchor } from './document.mjs';
import { createSession } from './session.mjs';

const $ = id => document.getElementById(id);
if (location.hash) history.replaceState(null, '', '/');
const ui = { film: null, report: null, step: 2, item: null, version: null, anchor: { type: 'general' }, media: null, render: 0, panel: 'preview', raw: false, fileQuery: '', fileKind: 'all', mediaStates: new Map(), fingerprint: null, busy: false, lastSync: null };
let session, draftTimer, noticeTimer, pollTimer;
const labels = { archived: '历史档案 · 只读', pending: '待审阅', approved: '已通过', 'changes-requested': '需要修改', 'needs-review': '需要复核', 'not-applicable': '不适用', present: '已生成', missing: '文件缺失', 'not-generated': '尚未生成', unreadable: '无法读取', historical: '历史交付物' };
const categories = { formal: '正式交付物', reference: '参考资料', history: '历史交付物' };
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
  if (a.type === 'time') return '时间 · ' + formatSpan(a.start, a.end);
  return '整份交付物';
}
function commitTime() {
  if (ui.anchor.type !== 'time') return;
  const start = parseClock($('time-start').value), end = parseClock($('time-end').value);
  if (start === null || end === null) { setAnchor(ui.anchor); notice('时间写成 01:23.45 这样的分秒。'); return; }
  if (!$('notice').hidden && $('notice').textContent === '时间写成 01:23.45 这样的分秒。') $('notice').hidden = true;
  const same = start === ui.anchor.start && end === (ui.anchor.end ?? ui.anchor.start);
  if (same) { setAnchor(ui.anchor); return; }
  setAnchor({ type: 'time', start, end }); captureDrafts();
}
function setAnchor(anchor) {
  ui.anchor = anchor; $('anchor-label').textContent = anchorText(anchor); $('time-anchor').hidden = anchor.type !== 'time';
  if (anchor.type === 'time') { $('time-start').value = formatClock(anchor.start); $('time-end').value = formatClock(anchor.end ?? anchor.start); }
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
  if (!session || !ui.report || ui.report.readonly) return;
  if (ui.noteDraftKey) {
    const text = $('note-text').value, old = session.get(ui.noteDraftKey);
    const batch = Array.isArray(old?.batch) ? old.batch : [];
    const value = text || ui.anchor.type !== 'general' || batch.length ? { text, anchor: ui.anchor, batch } : null;
    if (value) {
      const unchanged = old && old.text === text && JSON.stringify(old.anchor) === JSON.stringify(ui.anchor) && JSON.stringify(old.batch || []) === JSON.stringify(batch);
      value.requestId = unchanged && old.requestId ? old.requestId : crypto.randomUUID();
    }
    storeValue(ui.noteDraftKey, value);
  }
}
function rememberPosition() {
  if (!session || !ui.film) return;
  const key = ui.film + '/' + ui.item + '/' + ui.version;
  if (ui.media && ui.viewKey === key) ui.mediaStates.set(key, { time: ui.media.currentTime, rate: ui.media.playbackRate });
  storeValue('position:' + ui.film, { step: ui.step, item: ui.item, version: ui.version, panel: ui.panel, raw: ui.raw, reviewNote: ui.reviewNote, media: ui.mediaStates.get(key) || null });
  storeValue('film', ui.film);
}
function stash() { captureDrafts(); rememberPosition(); }
function restoreDrafts() {
  ui.noteDraftKey = ui.item && ui.version ? noteKey(ui.film, ui.item, ui.version) : null;
  const draft = ui.noteDraftKey && session?.get(ui.noteDraftKey);
  $('note-text').value = draft?.text || ''; setAnchor(draft?.anchor || { type: 'general' });
}
async function loadReport(reset = false, nextVersion = false) {
  const film = ui.film, report = await api('/api/report?film=' + encodeURIComponent(film));
  if (film !== ui.film) return;
  ui.report = report;
  ui.lastSync = new Date().toISOString(); connection(report.producing ? '制作进行中 · 可查看上次登记的版本，正式提交暂不可用' : '已连接 · 素材保留本机', report.producing);
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
  stash(); ui.step = file.step; ui.item = file.id; ui.version = v; ui.reviewNote = reviewNote; ui.panel = 'preview'; await render(); rememberPosition();
}
async function chooseStage(row) {
  const file = row.items.find(i => i.category === 'formal' && i.availability === 'present') || row.items[0];
  if (file) return choose(file);
  stash(); ui.step = row.step; ui.item = null; ui.version = null; ui.reviewNote = null; await render(); rememberPosition();
}
function showPanel(panel) {
  ui.panel = panel; document.querySelector('.workspace').dataset.panel = panel;
  document.querySelectorAll('[data-panel]').forEach(node => { if (node.tagName === 'BUTTON') node.setAttribute('aria-pressed', String(node.dataset.panel === panel)); });
  rememberPosition();
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
const fileTabs = { text: '文档', image: '图片', audio: '音频', video: '视频', directory: '工程', file: '其他' };
function renderFiles() {
  const selected = stage();
  if (!selected.items.some(i => i.id === ui.item)) { ui.item = selected.items.find(i => i.availability === 'present')?.id || selected.items[0]?.id || null; ui.version = item()?.current?.id || null; }
  if (ui.item && !item().versions.some(v => v.id === ui.version)) ui.version = item().current?.id;
  if (ui.fileKind !== 'all' && !selected.items.some(i => i.kind === ui.fileKind)) ui.fileKind = 'all';
  renderFileList();
}
function renderFileList() {
  const selected = stage(), term = ui.fileQuery.trim().toLocaleLowerCase();
  const searched = selected.items.filter(i => !term || [i.label, i.relativePath || i.path || ''].join(' ').toLocaleLowerCase().includes(term));
  const shown = searched.filter(i => ui.fileKind === 'all' || i.kind === ui.fileKind);
  $('file-count').textContent = (shown.length === selected.items.length ? '' : shown.length + ' / ') + selected.items.length + ' 项';
  $('file-tabs').replaceChildren();
  const tabs = [['all', '全部', searched.length], ...Object.keys(fileTabs).filter(kind => selected.items.some(i => i.kind === kind)).map(kind => [kind, fileTabs[kind], searched.filter(i => i.kind === kind).length])];
  $('file-tabs').hidden = tabs.length < 3;
  for (const [kind, label, count] of tabs) {
    const node = el('button', undefined, 'file-tab' + (ui.fileKind === kind ? ' active' : '')); node.type = 'button'; node.setAttribute('role', 'tab'); node.setAttribute('aria-selected', String(ui.fileKind === kind));
    node.append(label, el('span', String(count), 'file-tab-count')); node.addEventListener('click', () => { ui.fileKind = kind; renderFileList(); }); $('file-tabs').append(node);
  }
  $('files').replaceChildren();
  if (!shown.length) { $('files').append(el('p', term || ui.fileKind !== 'all' ? '没有符合条件的交付物。' : '这一阶段还没有交付物。', 'hint file-empty')); return; }
  for (const category of ['formal', 'reference', 'history']) {
    const group = shown.filter(i => i.category === category); if (!group.length) continue;
    $('files').append(el('p', categories[category], 'category-label'));
    for (const file of group) {
      const node = button('', () => choose(file), 'file' + (ui.item === file.id ? ' active' : '')), copy = el('span', undefined, 'file-copy');
      copy.append(el('strong', file.label), el('small', (file.current ? 'v' + file.current.number + ' · ' : '') + labels[file.availability]));
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
      document.querySelectorAll('.clip').forEach(clip => clip.classList.toggle('active', inSpan(media.currentTime, Number(clip.dataset.start), Number(clip.dataset.end))));
      const track = $('shot-track'), playing = track.querySelector('.clip.active');
      if (!playing) return;
      const pad = 12, view = track.getBoundingClientRect(), box = playing.getBoundingClientRect();
      if (box.left < view.left + pad) track.scrollLeft += box.left - view.left - pad;
      else if (box.right > view.right - pad) track.scrollLeft += box.right - view.right + pad;
    };
    media.addEventListener('loadedmetadata', () => { if (previous) media.currentTime = Math.min(previous.time, media.duration || previous.time); if (ui.anchor.type === 'time') media.currentTime = Math.min(ui.anchor.start, media.duration || ui.anchor.start); update(); });
    media.addEventListener('pause', rememberPosition); media.addEventListener('seeked', rememberPosition);
    for (const name of ['timeupdate', 'seeking', 'seeked']) media.addEventListener(name, update);
    $('shot-track').replaceChildren();
    for (const shot of context?.shots || []) {
      const end = shot.start + shot.duration, label = formatSpan(shot.start, end);
      const clip = button('', () => { media.currentTime = shot.start; if (!ui.report.readonly) { setAnchor({ type: 'time', start: shot.start, end }); captureDrafts(); showPanel('notes'); } }, 'clip');
      clip.style.flexGrow = Math.max(1, shot.duration); clip.dataset.start = shot.start; clip.dataset.end = end; clip.title = shot.id + ' · ' + label;
      clip.append(el('span', shot.id), el('small', formatClock(shot.start)), el('small', formatClock(end))); $('shot-track').append(clip);
    }
    if (!context?.shots.length) $('shot-track').append(el('span', '此版本未保存镜头结构，请按播放时间定位。', 'hint'));
    update();
  } else {
    const wrap = el('div', undefined, 'directory'); wrap.append(el('h2', file.label), el('p', '需要专用软件检查；此处展示已保存的文件组成。定位原文件不会记录为已打开验收。'));
    const list = el('ul'); for (const entry of v.snapshot.entries) { const row = el('li'); row.append(el('span', entry.path), el('small', bytes(entry.size))); list.append(row); } wrap.append(list); $('viewer').append(wrap);
  }
}
function draftRecord() { return (ui.noteDraftKey && session?.get(ui.noteDraftKey)) || {}; }
function writeDraft(batch, text = $('note-text').value, anchor = ui.anchor) {
  if (!ui.noteDraftKey) return;
  const old = draftRecord();
  const value = text || anchor.type !== 'general' || batch.length ? { text, anchor, requestId: old.requestId || crypto.randomUUID(), batch } : null;
  storeValue(ui.noteDraftKey, value);
}
function renderBatch() {
  const batch = Array.isArray(draftRecord().batch) ? draftRecord().batch : [];
  $('batch').replaceChildren();
  $('note-count').textContent = batch.length ? batch.filter(item => item.send !== false).length + ' 条待发送' : '';
  for (const [index, item] of batch.entries()) {
    const row = el('article', undefined, 'note-card');
    const mark = el('input'); mark.type = 'checkbox'; mark.checked = item.send !== false; mark.setAttribute('aria-label', '发送这条批注');
    mark.onchange = () => { const next = draftRecord().batch.map((entry, i) => i === index ? { ...entry, send: mark.checked } : entry); writeDraft(next); renderBatch(); };
    const copy = el('div'); copy.append(el('p', anchorText(item.anchor), 'meta'), el('p', item.text));
    row.append(mark, copy, button('移除', () => { writeDraft(draftRecord().batch.filter((_, i) => i !== index)); renderBatch(); }, 'quiet'));
    $('batch').append(row);
  }
}
function renderSent() {
  const file = item(), sent = [...file?.notes || []].reverse(), groups = [[false, '待办', '还没确认解决'], [true, '已完成', '你已确认解决']];
  $('sent-notes').replaceChildren(); $('sent-heading').hidden = !sent.length;
  $('sent-count').textContent = groups.map(([done, name]) => name + ' ' + sent.filter(note => !!note.resolved === done).length).join(' · ');
  for (const [done, name, meaning] of groups) {
    const rows = sent.filter(note => !!note.resolved === done);
    if (!rows.length) continue;
    const group = el('section', undefined, 'sent-group'); group.append(el('h3', name + ' · ' + rows.length + ' 条　' + meaning));
    for (const note of rows) {
      const row = el('article', undefined, done ? 'note-card sent-note resolved' : 'note-card sent-note'), number = file.versions.find(v => v.id === note.versionId)?.number;
      const copy = el('div'); copy.append(el('p', anchorText(note.anchor), 'meta'), el('p', note.text), el('p', [number ? 'v' + number : '', date(note.at)].filter(Boolean).join(' · '), 'meta'));
      row.append(copy); group.append(row);
    }
    $('sent-notes').append(group);
  }
}
function renderInspector() {
  const file = item(), v = version();
  $('kind-label').textContent = kinds[file?.kind] || ''; $('versions').replaceChildren();
  for (const row of [...file?.versions || []].reverse()) { const option = el('option', 'v' + row.number + ' · ' + date(row.at) + (row.id === file.current.id && file.availability !== 'historical' ? ' · 当前' : ' · 历史')); option.value = row.id; $('versions').append(option); }
  $('versions').value = ui.version || ''; $('versions').disabled = !v;
  $('version-detail').textContent = v ? v.snapshot.entries.length + ' 个文件 · ' + bytes(v.snapshot.entries.reduce((n, e) => n + e.size, 0)) + ' · ' + categories[file.category] : '尚无保存版本';
  $('checks').replaceChildren();
  if (file && current()) {
    for (const message of [file.availability !== 'present' && labels[file.availability], file.problem]) if (message) $('checks').append(el('p', message, 'status-line warn'));
  }
  else if (v) $('checks').append(el('p', '正在查看历史内容；意见仍属于这个版本。', 'hint'));
  if (file?.category === 'reference') $('checks').append(el('p', '参考资料不作为正式交付物。', 'hint'));
  $('note-form').hidden = ui.report.readonly || !v; renderBatch(); renderSent();
}
async function render() {
  if (!ui.report) return;
  $('archive-banner').hidden = !ui.report.readonly; $('mark-time').hidden = ui.report.readonly;
  $('draft-status').hidden = ui.report.readonly; $('retry-drafts').hidden = ui.report.readonly || $('retry-drafts').hidden;
  const serial = ++ui.render; document.querySelector('.workspace').hidden = false; document.querySelector('.panelbar').hidden = false;
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
    if (!ui.report && listing.films.length) { ui.film = ui.film || listing.films[0].id; $('films').value = ui.film; await loadReport(true); }
    if (!ui.film) { connection('已连接 · 等待加入影片'); return; }
    const film = ui.film, state = await api('/api/status?film=' + film); if (film !== ui.film) return;
    ui.busy = state.busy;
    connection(state.busy ? '制作进行中 · 可查看已载入内容，正式提交暂不可用' : '已连接 · 素材保留本机', state.busy);
    if (!state.busy && state.revision !== ui.fingerprint && !ui.applyingUpdate) {
      ui.applyingUpdate = true;
      try {
        stash();
        await loadReport(false, true);
        if (film === ui.film) notice('已载入新版本；未提交的草稿仍留在原版本。');
      } finally { ui.applyingUpdate = false; }
    }
    if (session?.dirty()) await session.flush();
  } catch (error) { connection(error.message, true); }
  finally { clearTimeout(pollTimer); pollTimer = setTimeout(poll, document.hidden ? 15000 : 4000); }
}

$('films').onchange = () => action(async () => { stash(); ui.film = $('films').value; ui.fingerprint = null; ui.reviewNote = null; await loadReport(true); });
$('versions').onchange = () => action(async () => { stash(); ui.version = $('versions').value; await render(); rememberPosition(); });
$('clear-anchor').onclick = () => { setAnchor({ type: 'general' }); captureDrafts(); };
$('note-text').oninput = captureDrafts;
for (const id of ['time-start', 'time-end']) {
  $(id).addEventListener('keydown', event => { if (event.key !== 'Enter') return; event.preventDefault(); commitTime(); });
  $(id).addEventListener('blur', () => commitTime());
}
$('mark-time').onclick = () => { if (ui.media && !ui.report.readonly) { const at = ui.media.currentTime, shot = (playbackContext(item(), version())?.shots || []).find(s => inSpan(at, s.start, s.start + s.duration)); setAnchor(shot ? { type: 'time', start: shot.start, end: shot.start + shot.duration } : { type: 'time', start: at, end: at }); captureDrafts(); showPanel('notes'); $('note-text').focus(); } };
$('seek').oninput = () => { if (ui.media) ui.media.currentTime = Number($('seek').value); };
$('speed').onchange = () => { if (ui.media) { ui.media.playbackRate = Number($('speed').value); rememberPosition(); } };
$('file-search').addEventListener('input', () => { ui.fileQuery = $('file-search').value; if (ui.report) renderFileList(); });
$('file-search').addEventListener('keydown', event => { if (event.key === 'Escape' && $('file-search').value) { event.preventDefault(); $('file-search').value = ''; ui.fileQuery = ''; renderFileList(); } });
$('fullscreen').onclick = () => action(() => document.fullscreenElement ? document.exitFullscreen() : $('viewer').requestFullscreen());
$('locate').onclick = () => action(async () => notice((await api('/api/locate', { artifactId: ui.item })).message));
$('read-mode').onclick = () => action(async () => { captureDrafts(); ui.raw = !ui.raw; await render(); rememberPosition(); });
$('shot-jump').onchange = () => { const row = [...document.querySelectorAll('[data-shot]')].find(r => r.dataset.shot === $('shot-jump').value); if (row) { row.scrollIntoView({ block: 'center' }); row.focus(); } };
function selectedText() { const root = $('document'); if (!root || ui.documentText === null) return; const a = documentAnchor(root, window.getSelection(), ui.documentText); if (a) { setAnchor(a); captureDrafts(); } }
document.addEventListener('mouseup', selectedText); document.addEventListener('keyup', event => { if (event.key === 'Shift' || event.key.startsWith('Arrow')) selectedText(); });
$('add-note').onclick = () => { const text = $('note-text').value.trim(); if (!text) { notice('先写下这一条批注。'); return; } const batch = [...(draftRecord().batch || []), { requestId: crypto.randomUUID(), text, anchor: structuredClone(ui.anchor), send: true }]; $('note-text').value = ''; setAnchor({ type: 'general' }); writeDraft(batch, '', { type: 'general' }); renderBatch(); };
$('note-form').onsubmit = event => { event.preventDefault(); action(async () => {
  captureDrafts(); const film = ui.film, artifactId = ui.item, versionId = ui.version, label = item()?.label || ui.item, draft = draftRecord();
  const batch = [...(draft.batch || [])];
  if ($('note-text').value.trim()) batch.push({ requestId: draft.requestId || crypto.randomUUID(), text: $('note-text').value.trim(), anchor: ui.anchor, send: true });
  const chosen = batch.filter(item => item.send !== false && item.text?.trim());
  if (!chosen.length) throw new Error('先写下批注，或勾选要发送的条目。');
  const submit = $('note-form').querySelector('[type=submit]'); submit.disabled = true;
  try {
    for (const item of chosen) await api('/api/note', { film, artifactId, versionId, text: item.text, anchor: item.anchor, blocking: true, requestId: item.requestId });
    const remain = batch.filter(item => item.send === false);
    if (ui.noteDraftKey) { $('note-text').value = ''; setAnchor({ type: 'general' }); writeDraft(remain, '', { type: 'general' }); }
    if (film === ui.film) { stash(); await loadReport(); }
    const link = document.createElement('a'); link.href = chatLink(new URLSearchParams(location.search).get('thread'), chatPrompt({ film, label, notes: chosen.map(note => ({ where: anchorText(note.anchor), text: note.text.trim() })) }));
    document.body.append(link); link.click(); link.remove();
    notice('已把 ' + chosen.length + ' 条批注放进对话输入框，回到对话确认后发送。');
  } finally { submit.disabled = false; }
}); };
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
function storedTheme() {
  try {
    const stored = localStorage.getItem('wka-workbench-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* 沿用页面已经设置的主题 */ }
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}
function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === next)));
  try { localStorage.setItem('wka-workbench-theme', next); } catch { /* 主题仍可在本次页面使用 */ }
}
document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => applyTheme(button.dataset.themeChoice)));
applyTheme(storedTheme());
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
