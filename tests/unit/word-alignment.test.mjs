import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentWords, recognizedUnits, alignUnits, envelopeOf, refineWords, buildWordTimeline } from '../../plugin/engine/audio/word-alignment.mjs';

const token = (text, from, to, p = 0.95) => ({ text, from, to, p });
function burstSamples(bursts, seconds, rate = 16000) {
  const samples = new Int16Array(Math.round(seconds * rate));
  for (const [from, to] of bursts) for (let s = Math.round(from * rate); s < Math.round(to * rate); s++) samples[s] = Math.round(9000 * Math.sin((2 * Math.PI * 220 * s) / rate));
  return samples;
}

test('分词只保留可计时文字，标点和空白不计入', () => {
  const words = segmentWords('有素材，无素材！Hello world 2024');
  assert.ok(words.every((word) => word.units.length && word.units.every((ch) => /[\p{L}\p{N}]/u.test(ch))));
  assert.equal(words.map((word) => word.units.join('')).join(''), '有素材无素材helloworld2024');
  assert.ok(words.some((word) => word.units.join('') === 'hello'));
});

test('token 内多个字符只在该 token 内均分；零长度 token 承接上一字', () => {
  const units = recognizedUnits([token('的时候', 1, 1.6), token('白', 2, 2)]);
  assert.deepEqual(units.map((u) => u.ch), ['的', '时', '候', '白']);
  assert.ok(Math.abs(units[1].start - 1.2) < 1e-9 && Math.abs(units[1].end - 1.4) < 1e-9);
  assert.ok(Math.abs(units[3].start - 1.6) < 1e-9);
});

test('保序比对按位置处理重复词，遗漏与替换不错位', () => {
  assert.deepEqual(alignUnits([...'你好你好'], [...'你好你好']), [0, 1, 2, 3]);
  assert.deepEqual(alignUnits([...'你好世界'], [...'你好界']), [0, 1, -1, 2]);
  assert.deepEqual(alignUnits([...'你好世界'], [...'你好视界']), [0, 1, 2, 3]);
  assert.throws(() => alignUnits(new Array(6000).fill('a'), new Array(6000).fill('a')), /太长/);
});

test('一致且可信的词为 measured，时间来自识别且不平均分配', () => {
  const words = buildWordTimeline({ text: '有素材，无素材', duration: 3, tokens: [token('有', 0.2, 0.5), token('素', 0.5, 0.9), token('材', 0.9, 1.4), token('无', 1.8, 2.0), token('素材', 2.0, 2.8)] });
  assert.equal(words.map((w) => w.text).join(''), '有素材无素材');
  assert.ok(words.every((w) => w.status === 'measured'));
  assert.equal(words[0].start, 0.2);assert.equal(words.at(-1).end, 2.8);
  const second = words.find((w) => w.start >= 1.8);
  assert.equal(second.pause_before, 0.4);
  assert.deepEqual(words.flatMap((w) => w.chars.map((c) => c.text)).join(''), '有素材无素材');
  assert.deepEqual(words.map((w) => w.n), words.map((_, i) => i + 1));
});

test('替换、遗漏、低可信的词是 pending，仍给出估计时间但标出原因', () => {
  const tokens = [token('你好', 0, 1), token('视', 1, 1.5), token('界', 1.5, 2), token('再见', 2, 3, 0.2)];
  const words = buildWordTimeline({ text: '你好世界再见', duration: 3, tokens });
  assert.equal(words.find((w) => w.text === '你好').status, 'measured');
  assert.ok(words.some((w) => w.status === 'pending' && w.issues.some((i) => /对不上/.test(i))));
  const low = words.find((w) => w.text === '再见');
  assert.equal(low.status, 'pending');assert.match(low.issues[0], /可信度/);
  const missing = buildWordTimeline({ text: '你好世界', duration: 2, tokens: [token('你好', 0, 1), token('界', 1.5, 2)] });
  const gap = missing.find((w) => w.chars.some((c) => c.text === '世')), lost = gap.chars.find((c) => c.text === '世');
  assert.equal(gap.status, 'pending');
  assert.ok(lost.start >= 1 && lost.end <= 1.5 + 1e-9, '遗漏字的估计时间落在两侧已识别字之间');
});

test('没有原稿时词表直接来自识别文字', () => {
  const words = buildWordTimeline({ text: '', duration: 2, tokens: [token('你好', 0, 1), token('世界', 1, 2)] });
  assert.equal(words.map((w) => w.text).join(''), '你好世界');
  assert.ok(words.every((w) => w.status === 'measured'));
});

test('有停顿时词首吸附上升沿、词尾吸附下降沿，误差在帧级', () => {
  const env = envelopeOf(burstSamples([[0.50, 0.90], [1.50, 2.00]], 2.4));
  const words = [{ start: 0.42, end: 0.98 }, { start: 1.43, end: 2.08 }];
  const flags = refineWords(words, env);
  assert.ok(Math.abs(words[0].start - 0.5) <= 0.03, String(words[0].start));
  assert.ok(Math.abs(words[0].end - 0.9) <= 0.03, String(words[0].end));
  assert.ok(Math.abs(words[1].start - 1.5) <= 0.03 && Math.abs(words[1].end - 2.0) <= 0.03);
  assert.deepEqual(flags.map((f) => [f.start, f.end]), [[true, true], [true, true]]);
});

test('连续语流的词边界吸附到能量低谷；音频过平或候选不可靠时保持识别时间', () => {
  const env = envelopeOf(burstSamples([[0.2, 0.7], [0.74, 1.3]], 1.6));
  const words = [{ start: 0.2, end: 0.78 }, { start: 0.78, end: 1.3 }];
  refineWords(words, env);
  assert.ok(Math.abs(words[0].end - 0.72) <= 0.03 && words[0].end === words[1].start, `${words[0].end}`);
  const flat = envelopeOf(burstSamples([[0, 1.5]], 1.5));
  const same = [{ start: 0.3, end: 0.8 }];
  assert.deepEqual(refineWords(same, flat), [{ start: false, end: false }]);
  assert.deepEqual(same, [{ start: 0.3, end: 0.8 }]);
});

test('精修后词首词尾由包络决定，端到端：含停顿的词表', () => {
  const env = envelopeOf(burstSamples([[0.5, 0.9], [1.5, 2.0]], 2.4));
  const words = buildWordTimeline({ text: '有素材无素材', duration: 2.4, envelope: env, tokens: [token('有', 0.43, 0.6), token('素', 0.6, 0.78), token('材', 0.78, 0.97), token('无', 1.42, 1.7), token('素材', 1.7, 2.07)] });
  assert.ok(Math.abs(words[0].start - 0.5) <= 0.03 && Math.abs(words.at(-1).end - 2.0) <= 0.03);
  assert.equal(words[0].refined.start, true);
  assert.ok(words.every((w) => w.chars[0].start === w.start && w.chars.at(-1).end === w.end));
});
