// 逐词对齐的纯函数：分词、字符比对、能量包络精修。不读写文件，不做在线推理。
const UNIT = /[\p{L}\p{N}]/u;
const r3 = (value) => +value.toFixed(3);
export const WORD_CONFIDENCE = 0.5;
export const REFINE_WINDOW = 0.12;
const ENVELOPE_HOP = 0.01;
const MAX_MATRIX = 3e7;

export const unitsOf = (text) => [...String(text || '').normalize('NFKC').toLowerCase()].filter((ch) => UNIT.test(ch));

/** 用 Intl.Segmenter 切词；标点、空白不计时。 */
export function segmentWords(text) {
  const words = [];
  for (const { segment } of new Intl.Segmenter('zh', { granularity: 'word' }).segment(String(text || ''))) {
    const units = unitsOf(segment);
    if (units.length) words.push({ text: segment.trim(), units });
  }
  return words;
}

/** whisper 的 token → 带时间的字符单元。一个 token 内的多个字符只在该 token 内均分。 */
export function recognizedUnits(tokens) {
  const units = [];
  let previousEnd = 0;
  for (const token of tokens) {
    const own = unitsOf(token.text);
    if (!own.length || !Number.isFinite(token.from) || !Number.isFinite(token.to)) continue;
    let { from, to } = token;
    // 零长度 token 的起点常被推到句内停顿之后；只在紧邻且间隔不大时，当作承接上一字。
    if (to - from < 0.03 && from > previousEnd && from - previousEnd <= 0.5) from = previousEnd;
    to = Math.max(to, from + 0.001);
    const step = (to - from) / own.length;
    own.forEach((ch, i) => units.push({ ch, start: from + i * step, end: from + (i + 1) * step, p: Number.isFinite(token.p) ? token.p : 0 }));
    previousEnd = Math.max(previousEnd, to);
  }
  return units;
}

/** 保序全局比对。返回每个原稿字符对应的识别字符序号（无对应为 -1）。 */
export function alignUnits(expected, observed) {
  const n = expected.length, m = observed.length, width = m + 1;
  if ((n + 1) * width > MAX_MATRIX) throw new Error('单段录音太长，无法逐词比对，请拆成多段录音');
  const score = new Int32Array((n + 1) * width), step = new Uint8Array((n + 1) * width);
  for (let i = 1; i <= n; i++) { score[i * width] = -i; step[i * width] = 1; }
  for (let j = 1; j <= m; j++) { score[j] = -j; step[j] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diagonal = score[(i - 1) * width + j - 1] + (expected[i - 1] === observed[j - 1] ? 2 : -1);
      const up = score[(i - 1) * width + j] - 1, left = score[i * width + j - 1] - 1;
      let best = diagonal, move = 0;
      if (up > best) { best = up; move = 1; }
      if (left > best) { best = left; move = 2; }
      score[i * width + j] = best;step[i * width + j] = move;
    }
  }
  const map = new Array(n).fill(-1);
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const move = step[i * width + j];
    if (move === 0) { map[i - 1] = j - 1;i--;j--; } else if (move === 1) i--; else j--;
  }
  return map;
}

/** 16 kHz 单声道 s16 采样 → 10 ms 的 dB 包络。 */
export function envelopeOf(samples, rate = 16000) {
  const hop = Math.round(rate * ENVELOPE_HOP), window = hop * 2, frames = Math.floor(samples.length / hop);
  const raw = new Float64Array(frames);
  for (let k = 0; k < frames; k++) {
    const from = Math.max(0, k * hop - hop / 2), to = Math.min(samples.length, from + window);
    let sum = 0;
    for (let s = from; s < to; s++) sum += (samples[s] / 32768) ** 2;
    raw[k] = 10 * Math.log10(sum / Math.max(1, to - from) + 1e-10);
  }
  const db = Array.from(raw, (_value, index) => (raw[Math.max(0, index - 1)] + raw[index] + raw[Math.min(frames - 1, index + 1)]) / 3);
  const sorted = [...db].sort((left, right) => left - right), at = (quantile) => sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))] ?? -100;
  const floor = at(0.1), level = at(0.9);
  return { hop: ENVELOPE_HOP, db, floor, level, threshold: floor + 0.25 * (level - floor), usable: frames > 10 && level - floor >= 12 };
}

const frameAt = (env, time) => Math.min(env.db.length - 1, Math.max(0, Math.floor(time / env.hop)));
const REACH = 0.4;
const EDGE_REACH = 0.8;
const MIN_PAUSE_FRAMES = 5;

/** 能量包络里可能是“字/词边界”的位置：停顿区间（起止）与连续语流里的低谷（起止同一点）。 */
export function boundaryCandidates(env) {
  if (env.candidates) return env.candidates;
  const { db, hop, threshold, level } = env, list = [], frames = db.length;
  const edge = (k, rising) => {
    const before = db[k - 1], after = db[k];
    return (k - 1 + (threshold - before) / (after - before) + 0.5) * hop;
  };
  const paused = new Uint8Array(frames);
  for (let k = 0; k < frames;) {
    if (db[k] >= threshold) { k++;continue; }
    let last = k;
    while (last + 1 < frames && db[last + 1] < threshold) last++;
    if (last - k + 1 >= MIN_PAUSE_FRAMES) {
      for (let j = k; j <= last; j++) paused[j] = 1;
      const mean = db.slice(k, last + 1).reduce((sum, value) => sum + value, 0) / (last - k + 1);
      const start = k > 0 ? edge(k, false) : 0, end = last + 1 < frames ? edge(last + 1, true) : frames * hop;
      list.push({ start, end, mid: (start + end) / 2, depth: Math.min(30, level - mean), pause: true, leading: k === 0, trailing: last + 1 >= frames });
    }
    k = last + 1;
  }
  for (let k = 3; k < frames - 3; k++) {
    if (paused[k]) continue;
    let low = true;
    for (let j = k - 3; j <= k + 3; j++) if (db[j] < db[k] || (db[j] === db[k] && j < k)) low = false;
    if (!low) continue;
    let leftMax = -Infinity, rightMax = -Infinity;
    for (let j = Math.max(0, k - 10); j <= k; j++) leftMax = Math.max(leftMax, db[j]);
    for (let j = k; j <= Math.min(frames - 1, k + 10); j++) rightMax = Math.max(rightMax, db[j]);
    const depth = Math.min(leftMax, rightMax) - db[k];
    if (depth >= 3) { const mid = (k + 0.5) * hop;list.push({ start: mid, end: mid, mid, depth, pause: false }); }
  }
  if (db[0] >= threshold) list.push({ start: 0, end: 0, mid: 0, depth: 12, pause: true, leading: true });
  if (db[frames - 1] >= threshold) list.push({ start: frames * hop, end: frames * hop, mid: frames * hop, depth: 12, pause: true, trailing: true });
  list.sort((left, right) => left.mid - right.mid);
  env.candidates = list;
  return list;
}

const bonus = (candidate) => (Math.min(candidate.depth, 18) / 18) * 3.5;
const NO_SNAP = 0.5;
const SHORTEST = 0.07;

function solveBoundaries(items, env, all, shift) {
  const count = items.length + 1, last = items.length;
  const prior = Array.from({ length: count }, (_, i) => (i === 0 ? items[0].start : i === last ? items[last - 1].end : (items[i - 1].end + items[i].start) / 2) + shift);
  const timeOf = (i, candidate) => (i === 0 ? candidate.end : i === last ? candidate.start : candidate.mid);
  const options = prior.map((center, i) => {
    const near = [];
    const edge = i === 0 || i === last, reach = edge ? EDGE_REACH : REACH;
    for (const [k, candidate] of all.entries()) {
      if (candidate.mid < center - reach) continue;
      if (candidate.mid > center + reach) break;
      if (edge && !candidate.pause) continue;
      const time = timeOf(i, candidate), score = bonus(candidate) - Math.abs(time - center) / (edge ? 0.3 : 0.1);
      if (score > NO_SNAP) near.push({ k, time, score });
    }
    return [{ k: -1, time: center, score: NO_SNAP }, ...near];
  });
  const total = options.map(() => []), from = options.map(() => []);
  options[0].forEach((option, o) => { total[0][o] = option.score;from[0][o] = -1; });
  for (let i = 1; i < count; i++) {
    options[i].forEach((option, o) => {
      let best = -Infinity, choice = 0;
      options[i - 1].forEach((previous, p) => {
        if (option.k >= 0 && previous.k >= 0 && option.k <= previous.k) return;
        const value = total[i - 1][p] - (option.time - previous.time < SHORTEST ? 4 : 0);
        if (value > best) { best = value;choice = p; }
      });
      total[i][o] = best + option.score;from[i][o] = choice;
    });
  }
  let pick = total[last].indexOf(Math.max(...total[last]));
  const score = total[last][pick], chosen = new Array(count);
  for (let i = last; i >= 0; i--) { chosen[i] = options[i][pick];pick = from[i][pick]; }
  return { score, chosen, timeOf };
}

/**
 * 把相邻单元（字）之间的边界整体吸附到能量低谷或停顿：按顺序全局最优，识别时间只作先验，单元不能短于 70 ms。
 * 先在 ±0.45 秒内整体平移识别时间，取与音频边界最吻合的偏移（识别时间常有整体偏早/偏晚）；
 * 找不到可靠候选的边界保持（平移后的）识别时间。就地修改 items（每项含 start/end），返回每项首尾是否被吸附。
 */
export function refineWords(items, env) {
  const refined = items.map(() => ({ start: false, end: false }));
  if (!env?.usable || !items.length) return refined;
  const all = boundaryCandidates(env), last = items.length;
  const base = solveBoundaries(items, env, all, 0).score;
  let shift = 0, best = base + 2;
  for (let step = -45; step <= 45; step++) {
    const result = solveBoundaries(items, env, all, step / 100);
    if (result.score > best) { best = result.score;shift = step / 100; }
  }
  if (shift) items.forEach((item) => { item.start = Math.max(0, item.start + shift);item.end = Math.max(item.start, item.end + shift); });
  const { chosen, timeOf } = solveBoundaries(items, env, all, 0);
  const ends = chosen.map((option, i) => (option.k < 0 ? null : all[option.k].pause && i > 0 ? all[option.k].start : timeOf(i, all[option.k])));
  const starts = chosen.map((option, i) => (option.k < 0 ? null : all[option.k].pause && i < last ? all[option.k].end : timeOf(i, all[option.k])));
  let cursor = 0;
  items.forEach((item, i) => {
    const start = Math.max(starts[i] ?? item.start, cursor);
    let end = ends[i + 1] ?? item.end;
    const snapEnd = ends[i + 1] !== null && end >= start + 0.02;
    if (end < start + 0.02) end = Math.max(item.end, start + 0.02);
    refined[i] = { start: starts[i] !== null && start === starts[i], end: snapEnd };
    item.start = r3(start);item.end = r3(end);cursor = item.end;
  });
  return refined;
}

/**
 * @param {{text:string, tokens:{text:string,from:number,to:number,p:number}[], duration:number, envelope?:object, confidence?:number}} input
 * 时间相对该段录音（秒）。没有原稿时以识别文字为准。
 */
export function buildWordTimeline({ text, tokens, duration, envelope = null, confidence = WORD_CONFIDENCE }) {
  const observed = recognizedUnits(tokens);
  if (!observed.length) throw new Error('识别结果里没有可用文字，无法生成词表');
  const script = String(text || '').trim() || tokens.map((token) => token.text).join('');
  const words = segmentWords(script), flat = words.flatMap((word, w) => word.units.map((ch) => ({ ch, w })));
  if (!flat.length) throw new Error('原稿没有可计时的文字');
  const map = alignUnits(flat.map((unit) => unit.ch), observed.map((unit) => unit.ch));
  const timed = flat.map((unit, i) => (map[i] >= 0 ? { ...observed[map[i]], exact: observed[map[i]].ch === unit.ch } : null));
  const typical = observed.reduce((sum, unit) => sum + (unit.end - unit.start), 0) / observed.length;
  for (let i = 0; i < timed.length; i++) {
    if (timed[i]) continue;
    const from = i;
    while (timed[i + 1] === null) i++;
    const before = timed[from - 1], after = timed[i + 1], run = i - from + 1;
    const start = before ? before.end : Math.max(0, (after ? after.start : duration) - run * typical);
    const end = after ? after.start : Math.min(duration, start + run * typical);
    for (let k = 0; k < run; k++) timed[from + k] = { start: start + ((end - start) * k) / run, end: start + ((end - start) * (k + 1)) / run, p: 0, exact: false };
  }
  let cursor = 0;
  const draft = words.map((word, w) => {
    const chars = [];
    flat.forEach((unit, i) => {
      if (unit.w !== w) return;
      const start = Math.min(duration, Math.max(cursor, timed[i].start)), end = Math.min(duration, Math.max(start, timed[i].end));
      cursor = end;
      chars.push({ text: unit.ch, start, end, exact: timed[i].exact, p: timed[i].p });
    });
    return { n: w + 1, text: word.text, start: chars[0].start, end: chars[chars.length - 1].end, chars };
  });
  const flatChars = draft.flatMap((word) => word.chars);
  const charFlags = refineWords(flatChars, envelope);
  draft.forEach((word) => { word.start = word.chars[0].start;word.end = word.chars[word.chars.length - 1].end; });
  let offset = 0;
  const flags = draft.map((word) => {
    const flag = { start: charFlags[offset].start, end: charFlags[offset + word.chars.length - 1].end };
    offset += word.chars.length;
    return flag;
  });
  let previousEnd = 0;
  return draft.map((word, w) => {
    const exact = word.chars.every((char) => char.exact);
    const score = word.chars.reduce((sum, char) => sum + (char.exact ? char.p : 0), 0) / word.chars.length;
    const issues = [];
    if (!exact) issues.push('识别内容与原稿对不上或有遗漏');
    else if (score < confidence) issues.push('识别可信度不足');
    let at = word.start;
    const chars = word.chars.map((char, i) => {
      const start = i === 0 ? word.start : Math.min(word.end, Math.max(at, char.start));
      const end = i === word.chars.length - 1 ? word.end : Math.min(word.end, Math.max(start, char.end));
      at = end;
      return { text: char.text, start: r3(start), end: r3(end) };
    });
    const entry = { n: word.n, text: word.text, start: r3(word.start), end: r3(word.end), confidence: r3(score), status: issues.length ? 'pending' : 'measured', refined: flags[w], pause_before: r3(Math.max(0, word.start - previousEnd)), chars, ...(issues.length ? { issues } : {}) };
    previousEnd = word.end;
    return entry;
  });
}
