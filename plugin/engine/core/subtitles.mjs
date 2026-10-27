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
/** 英文字幕每条最多几个字符（含空格）：源规范横屏约 45 */
const MAX_CHARS_EN_BY_ASPECT = { landscape: 45, portrait: 28, square: 34 };
const SHORTEST = 0.6;

export const countChars = (text) => [...text.replace(NOT_COUNTED, '')].length;
const ms = (sec) => Math.round(sec * 1000) / 1000;

/** film.json 的 subtitles 字段加上缺省值。 */
export function subtitleSettings(film) {
  const s = film.subtitles || {};
  const [W, H] = film.size;
  const aspect = W > H ? 'landscape' : W < H ? 'portrait' : 'square';
  return {
    mode: s.mode || 'none',
    file: s.file || 'subtitles.srt',
    maxChars: s.max_chars || MAX_CHARS_BY_ASPECT[aspect],
    bilingual: !!s.bilingual,
    enFile: 'subtitles.en.json',
    maxCharsEn: s.max_chars_en || MAX_CHARS_EN_BY_ASPECT[aspect],
  };
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
export function subtitleOutputs(mode, bilingual = false) {
  if (mode === 'none') return { burned: null, clean: '', srt: null };
  const srt = ['srt', 'both'].includes(mode);
  return {
    burned: ['burn', 'both'].includes(mode) ? '_有字幕' : null,
    clean: srt ? '_无字幕' : null,
    srt: srt ? '_字幕' : null,
    ...(bilingual ? { srtEn: srt ? '_英文字幕' : null } : {}),
  };
}

/**
 * 按字幕条目重排英文稿：条数、顺序同字幕，zh 取字幕文字；旧稿里 zh 相同的条目保留 en（按出现顺序一一取用），其余 en 为空。
 * @param {{text: string}[]} subs
 * @param {{zh: string, en: string}[]|null} old
 * @returns {{zh: string, en: string}[]}
 */
/** 英文稿的格式：数组，每条 en 是文字（可以为空）。 */
function checkEnglishShape(pairs) {
  if (!Array.isArray(pairs)) throw new Error('subtitles.en.json 要是数组：[{ "zh": "…", "en": "…" }, …]');
  const bad = pairs.findIndex((p) => !p || typeof p !== 'object' || (p.en !== undefined && typeof p.en !== 'string'));
  if (bad !== -1) throw new Error(`subtitles.en.json 第 ${bad + 1} 条的 en 要是文字（加引号），没填就写 ""`);
}

export function syncEnglish(subs, old) {
  if (old) checkEnglishShape(old);
  const pool = new Map();
  for (const p of old || []) pool.set(p.zh, [...(pool.get(p.zh) || []), p.en || '']);
  const taken = new Map();
  return subs.map((s) => {
    const i = taken.get(s.text) || 0;
    taken.set(s.text, i + 1);
    return { zh: s.text, en: pool.get(s.text)?.[i] ?? '' };
  });
}

const RERUN = '重跑 wka subtitles <片> 会按现在的中文字幕重排英文稿，能对上的英文会保留';

/** 英文稿挂到字幕条目上（返回新数组，每条多一个 en）；对不上、有空条就报错。 */
export function attachEnglish(subs, pairs) {
  if (!pairs) throw new Error(`没有英文字幕（subtitles.en.json）。${RERUN}`);
  checkEnglishShape(pairs);
  if (pairs.length !== subs.length) throw new Error(`英文字幕 ${pairs.length} 条，中文字幕 ${subs.length} 条，对不上。${RERUN}`);
  const bad = subs.findIndex((s, i) => pairs[i].zh !== s.text);
  if (bad !== -1) throw new Error(`英文稿第 ${bad + 1} 条的中文是「${pairs[bad].zh}」，字幕里是「${subs[bad].text}」。${RERUN}`);
  const blank = pairs.flatMap((p, i) => (String(p.en || '').trim() ? [] : [i + 1]));
  if (blank.length) throw new Error(`还有 ${blank.length} 条英文没填：第 ${blank.join('、')} 条（subtitles.en.json）`);
  return subs.map((s, i) => ({ ...s, en: String(pairs[i].en).trim() }));
}

/** 英文稿的警告：超长、句号结尾（省略号、问号不算）。 */
export function checkEnglish(pairs, { maxChars }) {
  return pairs.flatMap((p, i) => {
    const en = String(p.en || '').trim();
    const w = [];
    if (en.length > maxChars) w.push(`第 ${i + 1} 条英文 ${en.length} 个字符，超过 ${maxChars}`);
    if (/[^.]\.$/.test(en) || en === '.') w.push(`第 ${i + 1} 条英文以句号结尾（英文字幕不加句号，问句保留问号）`);
    return w;
  });
}

/** 外挂英文 srt：时间同中文字幕。 */
export const englishSrt = (subs) => formatSrt(subs.map((s) => ({ ...s, text: s.en })));

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
