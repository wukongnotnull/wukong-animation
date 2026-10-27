import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeFrames } from '../../plugin/engine/core/qc.mjs';

const cfg = { whitespace_min: 0.6, accent_max: 0.04, diff_max: 20, skip_start: 0.5 };
const frame = (t, shot, whitespace) => ({ t, shot, whitespace, accent: 0, diff: 0, std: 30 });

test('留白不足的帧报「留白不足」', () => {
  const { issues } = judgeFrames([frame(1, 's01', 0.2)], cfg, { boundaries: [], fps: 10 });
  assert.deepEqual(issues.map((i) => i.kind), ['留白不足']);
});

test('标了 full_bleed 的镜头不查留白，其他检查照旧', () => {
  const frames = [frame(1, 's01', 0.2), frame(2, 's02', 0.2), { ...frame(2.1, 's02', 0.2), accent: 0.5 }];
  const { issues } = judgeFrames(frames, cfg, { boundaries: [], fps: 10, fullBleed: new Set(['s02']) });
  assert.deepEqual(issues.map((i) => `${i.shot} ${i.kind}`), ['s01 留白不足', 's02 点缀色超量']);
});

test('镜头切换处的大帧差算硬切，不算闪烁', () => {
  const frames = [{ ...frame(1, 's02', 0.9), diff: 40 }, { ...frame(1.5, 's02', 0.9), diff: 40 }];
  const { issues, cuts } = judgeFrames(frames, cfg, { boundaries: [1], fps: 10 });
  assert.equal(cuts, 1);
  assert.deepEqual(issues.map((i) => i.kind), ['突变/闪烁']);
});
