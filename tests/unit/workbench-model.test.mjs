import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inSpan, chatPrompt, chatLink, lineDiff, lineChanges, formatLineDiff, formatChangeExcerpts, versionChanges } from '../../plugin/engine/workbench/model.mjs';

test('镜头选中态容忍跳转后落在起点前一帧内的播放位置', () => {
  const shots = [{ id: 's008', start: 14.57, end: 16.08 }, { id: 's009', start: 16.08, end: 18 }];
  const activeAt = time => shots.find(shot => inSpan(time, shot.start, shot.end))?.id;
  assert.equal(activeAt(16.08), 's009');
  assert.equal(activeAt(16.08 - 1 / 30), 's009');
  assert.equal(activeAt(16.0), 's008');
  assert.equal(activeAt(14.57 - 1 / 30), 's008');
});

test('批注发送到对话时生成带位置的预填文字，并回到发起工作台的对话', () => {
  const prompt = chatPrompt({ film: 'demo', label: '剧本', notes: [{ where: '时间 · 00:01.00', text: '节奏太慢' }, { where: '整份交付物', text: '加结尾' }] });
  assert.match(prompt, /^处理工作台里的待办。影片：demo；交付物：剧本。共 2 条批注：\n1\. 【时间 · 00:01.00】节奏太慢\n2\. 【整份交付物】加结尾$/);
  const thread = '01a1cb55-4172-77b2-9f6c-7a3e725a7608';
  assert.equal(chatLink(thread, prompt), 'codex://threads/' + thread + '?prompt=' + encodeURIComponent(prompt));
  // 非 Codex 宿主没有对话编号：不生成 codex:// 链接（会被 Claude 浏览器面板拦截）
  assert.equal(chatLink('bad', 'x'), null);
  assert.equal(chatLink(null, 'x'), null);
});

const snap = (kind, entries) => ({ kind, entries: entries.map(([path, sha256, size]) => ({ path, sha256, size })), digest: entries.map(e => e[1]).join() });

test('版本日志：首次保存、单文件更新、依赖更新与媒体变化', () => {
  const first = { snapshot: snap('file', [['a.mp4', 'h1', 1048577]]), duration: 10, context: { shots: [1, 2] } };
  const second = { snapshot: snap('file', [['a.mp4', 'h2', 2097153]]), duration: 12.5, context: { shots: [1, 2, 3] } };
  const same = { snapshot: snap('file', [['a.mp4', 'h2', 2097153]]), duration: 12.5, context: { shots: [1, 2, 3] } };
  assert.deepEqual(versionChanges(first), ['首次保存 · 1 个文件 · 1.0 MB']);
  assert.deepEqual(versionChanges(second, first), ['内容已更新 · 1.0 MB → 2.0 MB', '时长 10.0 秒 → 12.5 秒', '镜头 2 → 3 个']);
  assert.deepEqual(versionChanges(same, second), ['文件内容没有变化，上游依赖已更新']);
});

test('版本日志：工程目录列出新增、修改与删除的文件', () => {
  const before = { snapshot: snap('directory', [['a', 'h1', 10], ['b', 'h2', 10], ['c', 'h3', 10]]) };
  const after = { snapshot: snap('directory', [['a', 'h1', 10], ['b', 'h9', 20], ['d', 'h4', 5]]) };
  assert.deepEqual(versionChanges(after, before), ['新增 1 个文件：d', '修改 1 个文件：b', '删除 1 个文件：c', '总大小 30 B → 35 B']);
});

test('版本日志：文字版本按行统计新增与删除', () => {
  assert.deepEqual(lineDiff('一\n二\n三', '一\n三\n四\n五'), { added: 2, removed: 1 });
  assert.deepEqual(lineDiff('x', 'x'), { added: 0, removed: 0 });
  assert.equal(formatLineDiff({ added: 2, removed: 1 }), '文字内容：新增 2 行，删除 1 行');
  assert.equal(formatLineDiff({ added: 0, removed: 0 }), '');
});

test('版本日志：文字版本列出具体新增与删除的内容', () => {
  const changes = lineChanges('# 简报\n风格：水墨\n时长：30 秒\n', '# 简报\n风格：像素\n时长：30 秒\n画幅：16:9\n');
  assert.deepEqual(changes, { addedLines: ['风格：像素', '画幅：16:9'], removedLines: ['风格：水墨'] });
  assert.deepEqual(lineDiff('一\n二\n三', '一\n三\n四\n五'), { added: 2, removed: 1 });
  assert.deepEqual(formatChangeExcerpts(changes), ['新增：「风格：像素」「画幅：16:9」', '删除：「风格：水墨」']);
});

test('版本日志：摘录最多三条、截断长行并忽略空行', () => {
  const many = { addedLines: ['a', '', 'b', 'c', 'd', 'e'], removedLines: ['x'.repeat(40)] };
  assert.deepEqual(formatChangeExcerpts(many), ['新增：「a」「b」「c」等 5 行', '删除：「' + 'x'.repeat(24) + '…」']);
  assert.deepEqual(formatChangeExcerpts({ addedLines: ['', ' '], removedLines: [] }), []);
});
