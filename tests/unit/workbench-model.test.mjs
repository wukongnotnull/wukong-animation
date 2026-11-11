import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inSpan } from '../../plugin/engine/workbench/model.mjs';

test('镜头选中态容忍跳转后落在起点前一帧内的播放位置', () => {
  const shots = [{ id: 's008', start: 14.57, end: 16.08 }, { id: 's009', start: 16.08, end: 18 }];
  const activeAt = time => shots.find(shot => inSpan(time, shot.start, shot.end))?.id;
  assert.equal(activeAt(16.08), 's009');
  assert.equal(activeAt(16.08 - 1 / 30), 's009');
  assert.equal(activeAt(16.0), 's008');
  assert.equal(activeAt(14.57 - 1 / 30), 's008');
});
