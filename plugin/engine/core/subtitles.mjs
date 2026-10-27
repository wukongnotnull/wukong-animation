// 字幕：从人声原文和实测入出点生成字幕条目，读写 srt，检查时间和字数。都是纯函数，不碰文件。
// 字幕以片目录里的 srt 文件为准（wka subtitles 生成，之后可以手改断句）；烧录见 subtitle-layer.mjs。

/** 不计入字数的字符：标点和空白 */
const NOT_COUNTED = /[\s，。！？、；：,.!?;:…“”‘’"'（）()《》〈〉「」『』【】—\-·~～]/gu;
/** 可以在其后断开的句内标点 */
const BREAK_AFTER = /[，。！？、；：,.!?;:]/u;
/** 条目结尾要去掉的标点；？！… 保留 */
const TRAILING = /[。，、；：,.;:]+$/u;
// 句中的停顿标点在字幕里换成一个全角空格，连同两边的空白；？！… 和书名号、引号保留。
// 夹在两个数字之间的 . 和 ,（3.5、1,000）不是停顿；ASCII 的 ... 先当作省略号 …
const INNER_PAUSE = /\s*(?:[。，、；：;:]|(?<!\d)[.,]|[.,](?!\d))+\s*/gu;
const ASCII_ELLIPSIS = /\.{3,}/g;
/** 一条字幕的显示文字：去掉结尾标点，句中停顿换成全角空格。 */
const subtitleText = (p) => p.replace(ASCII_ELLIPSIS, '…').trim().replace(TRAILING, '').replace(INNER_PAUSE, '　').trim();

const MAX_CHARS_BY_ASPECT = { landscape: 18, portrait: 12, square: 14 };
const SHORTEST = 0.6;

export const countChars = (text) => [...text.replace(NOT_COUNTED, '')].length;
const ms = (sec) => Math.round(sec * 1000) / 1000;

/** film.json 的 subtitles 字段加上缺省值。 */
export function subtitleSettings(film) {
  const s = film.subtitles || {};
  const [W, H] = film.size;
  const aspect = W > H ? 'landscape' : W < H ? 'portrait' : 'square';
  return { mode: s.mode || 'none', file: s.file || 'subtitles.srt', maxChars: s.max_chars || MAX_CHARS_BY_ASPECT[aspect] };
}

const DIGIT = /[0-9]/;
/** 3.5、1,000 里的 . 和 , 夹在两个数字之间，不是断句点。 */
const inNumber = (chars, i) => (chars[i] === '.' || chars[i] === ',') && DIGIT.test(chars[i - 1] || '') && DIGIT.test(chars[i + 1] || '');

/** 按句内标点切开，标点跟着前一段。 */
function clauses(text) {
  const out = [];
  const chars = [...text];
  let cur = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    cur += ch;
    if (BREAK_AFTER.test(ch) && !inNumber(chars, i)) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 超长的一段按字数硬切，标点跟着前一个字。 */
function hardSplit(seg, maxChars) {
  const out = [];
  let cur = '';
  for (const ch of seg) {
    if (countChars(ch) && countChars(cur) === maxChars) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** 一条人声拆成若干段：先在标点处切、贪心合并到 maxChars，仍超长的再硬切。 */
function splitLine(text, maxChars) {
  const pieces = [];
  let cur = '';
  for (const c of clauses(text.trim())) {
    if (cur && countChars(cur) + countChars(c) > maxChars) {
      pieces.push(cur);
      cur = '';
    }
    cur += c;
  }
  if (cur) pieces.push(cur);
  return pieces.flatMap((p) => (countChars(p) > maxChars ? hardSplit(p, maxChars) : [p])).filter((p) => countChars(p));
}

/**
 * 成片按字幕方式出哪几个版本、文件名加什么后缀（null 表示不出）：
 * burned 烧录版，clean 无字幕版，srt 外挂字幕。不出字幕时成片名不加后缀。
 */
export function subtitleOutputs(mode) {
  if (mode === 'none') return { burned: null, clean: '', srt: null };
  return {
    burned: ['burn', 'both'].includes(mode) ? '_有字幕' : null,
    clean: ['srt', 'both'].includes(mode) ? '_无字幕' : null,
    srt: ['srt', 'both'].includes(mode) ? '_字幕' : null,
  };
}

/**
 * @param {object[]} voices film.json 的 audio.voices
 * @param {object} cues film.json 的 cues（wka soundtrack 写入的人声实测入出点）
 * @returns {{index:number,start:number,end:number,text:string}[]} 按入点排序
 */
export function buildSubtitles(voices, cues, { maxChars }) {
  const subs = voices.flatMap((v, i) => {
    const name = v.cue || `vo${i + 1}`;
    const range = cues[name];
    if (!range) throw new Error(`人声「${v.text}」没有声音同步点 ${name}，先运行 wka soundtrack`);
    const [start, end] = range;
    const pieces = splitLine(v.text, maxChars);
    const total = pieces.reduce((n, p) => n + countChars(p), 0);
    let done = 0;
    return pieces.map((p) => {
      const from = start + ((end - start) * done) / total;
      done += countChars(p);
      return { start: ms(from), end: ms(start + ((end - start) * done) / total), text: subtitleText(p) };
    });
  });
  return subs.sort((a, b) => a.start - b.start).map((s, i) => ({ index: i + 1, ...s }));
}

function timestamp(sec) {
  const t = Math.round(sec * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(t / 3600000))}:${pad(Math.floor(t / 60000) % 60)}:${pad(Math.floor(t / 1000) % 60)},${pad(t % 1000, 3)}`;
}

export function formatSrt(subs) {
  return subs.map((s) => `${s.index}\n${timestamp(s.start)} --> ${timestamp(s.end)}\n${s.text}\n`).join('\n');
}

const TIME_LINE = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})$/;
const seconds = (h, m, s, f) => ms(+h * 3600 + +m * 60 + +s + +f / 1000);

export function parseSrt(text) {
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((b, i) => {
    const [num, time, ...lines] = b.split('\n');
    const t = time?.trim().match(TIME_LINE);
    if (!/^\d+$/.test(num.trim()) || !t || !lines.length) throw new Error(`字幕第 ${i + 1} 条格式不对：\n${b}`);
    return { index: Number(num), start: seconds(...t.slice(1, 5)), end: seconds(...t.slice(5, 9)), text: lines.join('\n') };
  });
}

/** @returns {{errors: string[], warnings: string[]}} errors 要中断，warnings 打印后继续 */
export function checkSubtitles(subs, { duration, maxChars }) {
  const errors = [];
  const warnings = [];
  subs.forEach((s, i) => {
    const n = `第 ${s.index} 条`;
    if (s.end <= s.start) errors.push(`${n}出点早于入点（${s.start}s → ${s.end}s）`);
    if (s.end > duration + 0.001) errors.push(`${n}超出片长（出点 ${s.end}s，片长 ${duration}s）`);
    for (const line of s.text.split('\n')) {
      const k = countChars(line);
      if (k > maxChars) warnings.push(`${n}有一行 ${k} 字，超过 ${maxChars} 字`);
    }
    const len = s.end - s.start;
    if (len > 0 && len < SHORTEST) warnings.push(`${n}只有 ${len.toFixed(2)} 秒，可能来不及看`);
    const next = subs[i + 1];
    if (next && next.start < s.end) warnings.push(`${n}与第 ${next.index} 条重叠 ${(s.end - next.start).toFixed(2)} 秒`);
  });
  return { errors, warnings };
}
