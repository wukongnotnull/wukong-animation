import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
async function moduleAt(name) { const file = new URL('../../plugin/engine/workbench/' + name + '.mjs', import.meta.url); assert.ok(fs.existsSync(file), '缺少 ' + name + ' 行为'); return import(file); }

test('formatted document pieces retain exact raw offsets, tables and shot identities', async () => {
  const { parseDocument } = await moduleAt('document');
  const raw = '# 标题\r\n\r\n文字 **加粗** 与 `代码`。\n\n| 镜 | 画面 |\n|---|---|\n| s01 | 月亮 \\| 留白 |\n| s02 | 树 |\n\n<script>不能执行</script>\n';
  const blocks = parseDocument(raw);
  assert.equal(blocks[0].type, 'heading');
  const table = blocks.find(b => b.type === 'table'); assert.equal(table.rows[0].shotId, 's01'); assert.equal(table.rows[1].shotId, 's02');
  assert.equal(table.rows[0].cells.length, 2);
  for (const block of blocks) for (const part of block.parts || []) assert.equal(raw.slice(part.start, part.start + part.text.length), part.text);
  for (const row of [table.header, ...table.rows]) for (const cell of row.cells) for (const part of cell.parts) assert.equal(raw.slice(part.start, part.start + part.text.length), part.text);
  assert.ok(blocks.some(b => b.parts?.some(p => p.text.includes('<script>'))));
});

test('queue filters find feedback and historical items; restoration never substitutes an unknown version silently', async () => {
  const { reviewRows, restorePosition, noteKey, stageKey, playbackContext, formatClock, formatSpan, parseClock } = await moduleAt('model');
  const item = { id: 'a', step: 2, label: '简报', category: 'formal', required: true, availability: 'present', checked: false, freshness: 'current', versions: [{ id: 'v1' }, { id: 'v2' }], current: { id: 'v2' }, notes: [{ text: '受众不明确', blocking: true, resolved: false }] };
  const history = { ...item, id: 'b', label: '旧参考', category: 'history', availability: 'historical', required: false };
  const report = { stages: [{ step: 2, label: '简报确认', revision: 'r', items: [item, history] }] };
  assert.equal(reviewRows(report, { query: '受众', filter: 'blocking' }).length, 2);
  assert.deepEqual(reviewRows(report, { category: 'history' }).map(r => r.item.id), ['b']);
  assert.equal(restorePosition(report, { step: 2, item: 'a', version: 'v1' }).version, 'v1');
  assert.match(restorePosition(report, { step: 2, item: 'a', version: 'missing' }).message, /版本/);
  assert.equal(restorePosition(report, null).item, 'a');
  assert.equal(restorePosition(report, { overview: true }).item, 'a');
  assert.equal(restorePosition(report, { step: 9, item: 'gone' }).item, 'a');
  assert.match(restorePosition(report, { step: 9, item: 'gone' }).message, /当前可用成果/);
  assert.notEqual(noteKey('film-a', 'a', 'v1'), noteKey('film-a', 'a', 'v2'));
  assert.notEqual(stageKey('film-a', 2, 'r'), stageKey('film-b', 2, 'r'));
  assert.equal(formatClock(8.5334), '00:08.53');
  assert.equal(formatSpan(8.5334, 10.6667), '00:08.53–00:10.67');
  assert.equal(formatSpan(10.67, 10.67), '00:10.67');
  assert.equal(parseClock('1:23'), 83);
  assert.equal(parseClock('1:23.4'), 83.4);
  assert.equal(parseClock('01:23.45'), 83.45);
  assert.equal(parseClock('75:00.00'), 4500);
  assert.equal(formatClock(parseClock('1:23.4')), '01:23.40');
  assert.equal(parseClock(' 00:08.535 '), 8.54);
  assert.equal(parseClock('1:60'), null);
  assert.equal(parseClock('8.5'), null);
  assert.equal(parseClock(''), null);
  assert.equal(playbackContext({ path: 'old.mp4' }, { id: 'legacy' }), null);
  assert.deepEqual(playbackContext({ path: '局部小样/s02.mp4' }, { context: { shots: [{ id: 's01', start: 0, duration: 3 }, { id: 's02', start: 3, duration: 2 }] } }).shots, [{ id: 's02', start: 0, duration: 2 }]);
});

test('draft session preserves per-version values and keeps failed submissions local until explicit retry', async () => {
  const { createSession } = await moduleAt('session'); let fail = false;
  const saved = {}, local = new Map(), storage = { getItem: k => local.get(k) || null, setItem: (k, v) => local.set(k, v), removeItem: k => local.delete(k) };
  const states = [], deps = { storage, prefix: 'test', onState: (state, message) => states.push([state, message]), read: async () => ({ entries: structuredClone(saved) }), write: async req => { if (fail) throw new Error('offline'); const entry = { revision: (saved[req.key]?.revision || 0) + 1, value: req.value }; saved[req.key] = entry; return entry; } };
  let session = await createSession(deps);
  session.set('note:f:a:v1', { text: '一版' }); session.set('note:f:a:v2', { text: '二版' }); await session.flush();
  assert.deepEqual(states.at(-1), ['saved', '']);
  assert.equal(session.get('note:f:a:v1').text, '一版');
  fail = true; session.set('note:f:a:v2', { text: '断线草稿' }); await session.flush();
  session = await createSession(deps); assert.equal(session.get('note:f:a:v2').text, '断线草稿');
  fail = false; await session.flush(); assert.equal(saved['note:f:a:v2'].value.text, '断线草稿');
  session.set('note:f:a:v1', null); await session.flush(); assert.equal(session.get('note:f:a:v2').text, '断线草稿');
});

test('draft session keeps edits typed while a save is in flight', async () => {
  const { createSession } = await moduleAt('session'); const local = new Map(); let release;
  const saved = {}, storage = { getItem: k => local.get(k), setItem: (k,v) => local.set(k,v) };
  const session = await createSession({ storage, prefix:'inflight', read:async()=>({entries:saved}), write: async r => { await new Promise(resolve=>{release=resolve;}); const e={revision:r.expected+1,value:r.value}; saved[r.key]=e; return e; } });
  session.set('note:f:a:v', {text:'before'}); const first=session.flush();
  session.set('note:f:a:v', {text:'after'}); release(); await first;
  assert.equal(session.get('note:f:a:v').text,'after'); assert.equal(session.dirty(),true);
  const second=session.flush(); release(); await second; assert.equal(saved['note:f:a:v'].value.text,'after'); assert.equal(saved['note:f:a:v'].revision,2);
});

test('stage change requests remain discoverable until a later approval, including repair results', async () => {
  const { reviewRows } = await moduleAt('model');
  const item = { id:'a', step:2, label:'简报', category:'formal', required:true, checked:true, notes:[] };
  const stage = { step:2, label:'简报', items:[item], decisions:[{id:'d',decision:'changes-requested',note:'受众待澄清',repair:{id:'r'}}] };
  assert.equal(reviewRows({stages:[stage]},{filter:'verification',query:'受众'})[0]?.decision.id,'d');
  stage.decisions.push({decision:'approved'});
  assert.equal(reviewRows({stages:[stage]},{filter:'verification'}).length,0);
});
