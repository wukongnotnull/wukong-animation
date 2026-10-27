// 逐字同步点：给题字这类"跟着人声一个字一个字出现"的画面用。
// edge-tts 对中文只按短语给时间，录音更没有时间信息，所以统一这样近似：
// 静音检测找出这句里有声音的几段，和按标点切出的分句一一对上；每段里按字数均分。
// 段数和分句数对不上时，整句（第一段声音开头到最后一段结尾）按字数均分。
import { countChars } from '../core/subtitles.mjs';

const PAUSE = /[，。！？、；：,.!?;:…—\s]/u;
const r3 = (x) => +x.toFixed(3);

/** 按停顿标点切成分句，每个分句是要计时的字（不含标点）的数组。 */
function clauseChars(text) {
  const out = [];
  let cur = [];
  for (const ch of text) {
    if (PAUSE.test(ch)) {
      if (cur.length) out.push(cur);
      cur = [];
    } else if (countChars(ch)) cur.push(ch);
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * @param {string} text 这句人声的原文
 * @param {string} name 这句的 cue 名
 * @param {{at:number, duration:number, ranges:{start:number,end:number}[]|null}} o
 *   ranges：这句音频里有声音的区间（相对音频开头，秒）；没有音频时为 null
 * @returns {Record<string, [number, number]>} { '名#1': [入点, 出点], … }，全片时间
 */
export function charCues(text, name, { at, duration, ranges }) {
  const clauses = clauseChars(text);
  const spans = ranges?.length === clauses.length
    ? ranges
    : [{ start: ranges?.length ? ranges[0].start : 0, end: ranges?.length ? ranges.at(-1).end : duration }];
  const groups = spans.length === clauses.length ? clauses : [clauses.flat()];
  const out = {};
  let k = 1;
  groups.forEach((chars, g) => {
    const { start, end } = spans[g];
    const step = (end - start) / chars.length;
    chars.forEach((_, i) => (out[`${name}#${k++}`] = [r3(at + start + step * i), r3(at + start + step * (i + 1))]));
  });
  return out;
}

/** 去掉某句以前写过的逐字同步点（名#1、名#2……），其余 cue 原样保留。返回新对象。 */
export function clearCharCues(cues, name) {
  const prefix = `${name}#`;
  return Object.fromEntries(Object.entries(cues).filter(([k]) => !(k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length)))));
}

/** cues 里形如「名#数字」、但「名」不在 keepNames 里的键：人声改名或删掉后留下的逐字同步点。 */
export function orphanCharCues(cues, keepNames) {
  const keep = new Set(keepNames);
  return Object.keys(cues).filter((k) => {
    const m = k.match(/^(.+)#\d+$/);
    return m && !keep.has(m[1]);
  });
}
