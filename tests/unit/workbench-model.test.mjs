import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inSpan, chatPrompt, chatLink } from '../../plugin/engine/workbench/model.mjs';

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
  assert.equal(chatLink('bad', 'x'), 'codex://threads/new?prompt=x');
  assert.equal(chatLink(null, 'x'), 'codex://threads/new?prompt=x');
});
