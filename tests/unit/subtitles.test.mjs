import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubtitles, formatSrt, parseSrt, checkSubtitles, subtitleSettings, subtitleOutputs } from '../../plugin/engine/core/subtitles.mjs';
import { subtitleStyle, mergeSubtitleStyle } from '../../plugin/engine/core/subtitle-layer.mjs';

const texts = (subs) => subs.map((s) => s.text);

test('a voice line within the limit is one subtitle spanning its measured cue', () => {
  const subs = buildSubtitles([{ text: '山不说话。', at: 1, cue: '第一句' }], { 第一句: [1, 2.4] }, { maxChars: 18 });
  assert.deepEqual(subs, [{ index: 1, start: 1, end: 2.4, text: '山不说话' }]);
});

test('default cue names are vo1, vo2…', () => {
  const subs = buildSubtitles([{ text: '甲', at: 0 }, { text: '乙', at: 2 }], { vo1: [0, 1], vo2: [2, 3] }, { maxChars: 18 });
  assert.deepEqual(texts(subs), ['甲', '乙']);
});

test('a long line splits at punctuation, merged greedily up to maxChars', () => {
  const text = '江水不回头，山也不回头，只有回声，一遍一遍地回来。';
  const subs = buildSubtitles([{ text, at: 0 }], { vo1: [0, 10] }, { maxChars: 10 });
  assert.deepEqual(texts(subs), ['江水不回头　山也不回头', '只有回声', '一遍一遍地回来']);
});

test('a segment with no punctuation is hard-split at maxChars', () => {
  const subs = buildSubtitles([{ text: '一二三四五六七八九十甲乙丙', at: 0 }], { vo1: [0, 13] }, { maxChars: 5 });
  assert.deepEqual(texts(subs), ['一二三四五', '六七八九十', '甲乙丙']);
});

test('split pieces share the line duration by character count, end to end', () => {
  const subs = buildSubtitles([{ text: '一二三四五六七八九十甲乙丙', at: 0 }], { vo1: [2, 15] }, { maxChars: 5 });
  assert.deepEqual(subs.map((s) => [s.start, s.end]), [[2, 7], [7, 12], [12, 15]]);
  assert.deepEqual(subs.map((s) => s.index), [1, 2, 3]);
});

test('trailing 。，、；： are dropped, ？！… are kept', () => {
  const subs = buildSubtitles(
    [{ text: '来了？', at: 0 }, { text: '走吧！', at: 1 }, { text: '再等等……', at: 2 }, { text: '好；', at: 3 }],
    { vo1: [0, 1], vo2: [1, 2], vo3: [2, 3], vo4: [3, 4] },
    { maxChars: 18 }
  );
  assert.deepEqual(texts(subs), ['来了？', '走吧！', '再等等……', '好']);
});

test('a voice line without its measured cue is an error', () => {
  assert.throws(() => buildSubtitles([{ text: '甲', at: 0, cue: '开场' }], {}, { maxChars: 18 }), /开场.*wka soundtrack/);
});

test('subtitles are sorted by start time', () => {
  const subs = buildSubtitles([{ text: '后', at: 5 }, { text: '先', at: 1 }], { vo1: [5, 6], vo2: [1, 2] }, { maxChars: 18 });
  assert.deepEqual(texts(subs), ['先', '后']);
  assert.deepEqual(subs.map((s) => s.index), [1, 2]);
});

test('formatSrt writes standard SRT', () => {
  const srt = formatSrt([
    { index: 1, start: 1, end: 2.4, text: '山不说话' },
    { index: 2, start: 3661.5, end: 3662.25, text: '水不回头\n第二行' },
  ]);
  assert.equal(srt, '1\n00:00:01,000 --> 00:00:02,400\n山不说话\n\n2\n01:01:01,500 --> 01:01:02,250\n水不回头\n第二行\n');
});

test('parseSrt reads back what formatSrt wrote', () => {
  const subs = [
    { index: 1, start: 1, end: 2.4, text: '山不说话' },
    { index: 2, start: 3, end: 4.125, text: '水不回头\n第二行' },
  ];
  assert.deepEqual(parseSrt(formatSrt(subs)), subs);
});

test('parseSrt accepts a BOM, CRLF line endings and extra blank lines', () => {
  const text = '﻿1\r\n00:00:01,000 --> 00:00:02,000\r\n甲\r\n\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n乙\r\n';
  assert.deepEqual(texts(parseSrt(text)), ['甲', '乙']);
});

test('parseSrt names the broken entry', () => {
  const text = '1\n00:00:01,000 --> 00:00:02,000\n甲\n\n2\n00:00:03 --> 00:00:04,000\n乙\n';
  assert.throws(() => parseSrt(text), /第 2 条/);
});

test('checkSubtitles: reversed times and running past the end are errors', () => {
  const r = checkSubtitles([{ index: 1, start: 2, end: 1, text: '甲' }, { index: 2, start: 9, end: 11, text: '乙' }], { duration: 10, maxChars: 18 });
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /第 1 条/);
  assert.match(r.errors[1], /第 2 条.*片长/);
});

test('checkSubtitles: overlaps, long lines and very short subtitles are warnings', () => {
  const r = checkSubtitles(
    [
      { index: 1, start: 0, end: 2, text: '甲' },
      { index: 2, start: 1.5, end: 3, text: '一二三四五六，七' },
      { index: 3, start: 4, end: 4.3, text: '丙' },
    ],
    { duration: 10, maxChars: 6 }
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 3);
  assert.match(r.warnings[0], /第 1 条.*第 2 条.*重叠/);
  assert.match(r.warnings[1], /第 2 条.*7 字/);
  assert.match(r.warnings[2], /第 3 条.*0\.30/);
});

test('subtitleSettings: no subtitles field means mode none; max_chars defaults by aspect', () => {
  assert.equal(subtitleSettings({ size: [1920, 1080] }).mode, 'none');
  assert.deepEqual(subtitleSettings({ size: [1920, 1080], subtitles: { mode: 'srt' } }), { mode: 'srt', file: 'subtitles.srt', maxChars: 18 });
  assert.equal(subtitleSettings({ size: [1080, 1920], subtitles: { mode: 'burn' } }).maxChars, 12);
  assert.equal(subtitleSettings({ size: [1080, 1080], subtitles: { mode: 'both' } }).maxChars, 14);
  assert.equal(subtitleSettings({ size: [1920, 1080], subtitles: { mode: 'srt', max_chars: 20, file: 'zh.srt' } }).maxChars, 20);
});

test('final file suffixes say whether the video carries subtitles', () => {
  assert.deepEqual(subtitleOutputs('none'), { burned: null, clean: '', srt: null });
  assert.deepEqual(subtitleOutputs('burn'), { burned: '_有字幕', clean: null, srt: null });
  assert.deepEqual(subtitleOutputs('srt'), { burned: null, clean: '_无字幕', srt: '_字幕' });
  assert.deepEqual(subtitleOutputs('both'), { burned: '_有字幕', clean: '_无字幕', srt: '_字幕' });
});

test('a film subtitle style overrides the style one: font replaced whole, stroke merged by field', () => {
  const base = { font: { family: 'Ma Shan Zheng', fallback: ['serif'] }, color: '#2B2B2B', stroke: { color: 'white', width: 0.12 }, bottom: 0.1 };
  const merged = mergeSubtitleStyle(base, { font: { family: 'Long Cang' }, stroke: { width: 0.2 }, size: 0.05 });
  assert.deepEqual(merged, { font: { family: 'Long Cang' }, color: '#2B2B2B', stroke: { color: 'white', width: 0.2 }, bottom: 0.1, size: 0.05 });
});

test('subtitleStyle fills engine defaults under the merged style', () => {
  const s = subtitleStyle({ subtitles: mergeSubtitleStyle(undefined, { color: '#000000' }) });
  assert.equal(s.color, '#000000');
  assert.equal(s.font.family, 'Noto Sans SC');
  assert.deepEqual(s.stroke, { color: 'rgba(0,0,0,0.65)', width: 0.08 });
});

test('sentence punctuation inside a subtitle becomes one full-width space; ？！ are kept', () => {
  const cues = { a: [0, 3], b: [4, 7] };
  const subs = buildSubtitles([{ text: '春晓。孟浩然。', at: 0, cue: 'a' }, { text: '何处？春归，。', at: 4, cue: 'b' }], cues, { maxChars: 16 });
  assert.equal(subs[0].text, '春晓　孟浩然');
  assert.equal(subs[1].text, '何处？春归');
});

test('decimals, thousands separators and ... survive; ASCII pauses become one full-width space', () => {
  const cues = { a: [0, 3], b: [4, 7] };
  const subs = buildSubtitles([{ text: '增长了3.5亿，达到1,000万', at: 0, cue: 'a' }, { text: 'Hello, world. 等等...', at: 4, cue: 'b' }], cues, { maxChars: 30 });
  assert.equal(subs[0].text, '增长了3.5亿　达到1,000万');
  assert.equal(subs[1].text, 'Hello　world　等等…');
});
