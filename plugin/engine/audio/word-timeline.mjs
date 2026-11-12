// 逐词时间表：本地识别 token + 保序比对 + 能量精修。不上传录音，不输出字幕格式。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadFilm } from '../core/film-context.mjs';
import { atomicJson, digest, fileDigest } from '../core/evidence.mjs';
import { scopedPath } from '../core/workbench-catalog.mjs';
import { reviewFile } from '../core/layout.mjs';
import { dtwPreset, prepareVoiceAlignment, recognitionTokens, recognizeVoice, voiceAlignmentStatus, voiceSources } from './voice-alignment.mjs';
import { buildWordTimeline, envelopeOf, unitsOf, WORD_CONFIDENCE } from './word-alignment.mjs';

const recordPath = dir => scopedPath(dir, '.wka/word-timeline.json');
const OK = ['measured', 'confirmed'];
export const wordCueKey = (voice, n) => `word:${voice}:${n}`;
export const WORD_CUE = /^word:([\p{L}\p{N}_-]+):(\d+)$/u;

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`无法读取词表记录：${error.message}`); }
}
function ledger(dir) {
  const data = read(recordPath(dir), { version: 1, voices: {} });
  if (data.version !== 1 || !data.voices || typeof data.voices !== 'object' || Array.isArray(data.voices)) throw new Error('词表记录损坏或版本不支持，不会覆盖');
  return data;
}
export function validateWords(words, duration) {
  if (!Array.isArray(words) || !words.length) throw new Error('词表没有词');
  let end = 0;
  words.forEach((word, i) => {
    const bad = word.n !== i + 1 || typeof word.text !== 'string' || !unitsOf(word.text).length || ![word.start, word.end].every(Number.isFinite) ||
      word.start < end - 0.001 || word.end < word.start || word.end > duration + 0.001 || !['measured', 'pending', 'confirmed'].includes(word.status);
    if (bad) throw new Error(`第 ${i + 1} 个词的序号、状态或时间无效、重叠或超出录音范围`);
    end = word.end;
  });
  return words;
}
function loadSamples(file) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Error(`无法解码录音用于能量精修：${String(result.stderr).slice(-300)}`);
  const bytes = result.stdout, even = bytes.length - (bytes.length % 2);
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + even));
}
const voiceState = (saved, source) => (saved ? (digest(saved.source) === digest(source) ? (saved.words.every(word => OK.includes(word.status)) ? (saved.words.some(word => word.status === 'confirmed') ? 'confirmed' : 'matched') : 'pending') : 'stale') : 'missing');

/** ctx 需要 film、filmDir。校验每段录音的词表是否仍对应当前录音、原稿与起点。 */
export function wordTimelineStatus(ctx, { checkTotal = true } = {}) {
  const data = ledger(ctx.filmDir), current = voiceSources(ctx, { checkTotal }), voices = {};
  for (const [id, source] of Object.entries(current)) {
    const saved = data.voices[id];
    if (saved) validateWords(saved.words, saved.source?.duration);
    voices[id] = { ...(saved || {}), source, status: voiceState(saved, source), ...(saved ? { savedSource: saved.source } : {}) };
  }
  return { version: 1, ready: Object.values(voices).length > 0 && Object.values(voices).every(voice => ['matched', 'confirmed'].includes(voice.status)), voices };
}

/** 已可用词（measured/confirmed 且录音未过期）→ 全片秒 cue；其余记录不可用原因。 */
export function wordTimelineCues(ctx, options = {}) {
  const result = { cues: {}, evidence: {}, unavailable: {} };
  if (!fs.existsSync(recordPath(ctx.filmDir))) return result;
  const status = wordTimelineStatus(ctx, { checkTotal: false, ...options });
  for (const [id, voice] of Object.entries(status.voices)) {
    if (voice.status === 'missing' || voice.status === 'stale') { result.unavailable[id] = voice.status === 'stale' ? '词表已过期（录音、原稿或起点变化），请重新运行 wka align-voice --words' : '这段录音还没有词表，请运行 wka align-voice --words'; continue; }
    for (const word of voice.words) {
      const key = wordCueKey(id, word.n);
      if (!OK.includes(word.status)) { result.unavailable[key] = `词“${word.text}”是 pending（${(word.issues || []).join('；') || '待确认'}），请听审后用 --import 确认或修正录音/原稿`; continue; }
      result.cues[key] = [voice.source.at + word.start, voice.source.at + word.end].map(seconds => +seconds.toFixed(3));
      result.evidence[key] = { id: `${id}-${word.n}`, voice: id, text: word.text, occurrence: word.n, method: 'aligned', verified: true, mixCurrent: true, reason: '逐词时间表（本地识别 + 能量精修）；声学准确性仍需听审', source: voice.source, range: result.cues[key], input_sha256: digest({ source: voice.source, word }), evidence: '.wka/word-timeline.json' };
    }
  }
  return result;
}

function writeReport(dir, data) {
  atomicJson(recordPath(dir), data);
  const lines = ['# 逐词时间表', '', '时间为全片秒数；词由本地识别时间与原稿保序比对得到，再按录音能量精修词边界。逐字时间只是词内细分，精度低于词边界。仍需随小样听审，不等于已验收。', ''];
  for (const [id, voice] of Object.entries(data.voices)) {
    const at = voice.source.at, pending = voice.words.filter(word => !OK.includes(word.status));
    lines.push(`## ${id} · ${voice.status}`, '', `词数 ${voice.words.length}；待确认 ${pending.length}；cue 名 \`word:${id}:<序号>\``, '', '| 序号 | 词 | 起 | 止 | 时长 | 前停顿 | 置信度 | 状态 |', '|---|---|---|---|---|---|---|---|');
    for (const word of voice.words) lines.push(`| ${word.n} | ${word.text} | ${(at + word.start).toFixed(3)} | ${(at + word.end).toFixed(3)} | ${(word.end - word.start).toFixed(3)} | ${word.pause_before.toFixed(3)}${word.pause_before >= 0.2 ? ' ⏸' : ''} | ${word.confidence.toFixed(2)} | ${word.status}${word.refined?.start || word.refined?.end ? '（已精修）' : ''} |`);
    if (pending.length) lines.push('', ...pending.map(word => `- 待确认 #${word.n} ${word.text}：${(word.issues || []).join('；')}`));
    lines.push('');
  }
  const file = reviewFile(scopedPath(dir, '.'), '逐词时间表.md', { ensure: true });fs.writeFileSync(file, lines.join('\n'));
  return data;
}

/** 生成/更新词表。复用已保存的识别证据；缺失或过期才重新本地识别。 */
export async function alignWords(dir, { binary, model, force = false, log = console.log } = {}) {
  const ctx = loadFilm(dir, { requireShots: false }), status = voiceAlignmentStatus(dir), data = ledger(ctx.filmDir);
  const targets = Object.entries(status.voices).filter(([id, voice]) => force || voiceState(data.voices[id], voice.source) === 'missing' || voiceState(data.voices[id], voice.source) === 'stale');
  if (!targets.length) return wordTimelineStatus(ctx);
  let setup = null;
  const stylePrompt = (text, evidence) => (/\p{Script=Han}/u.test(text || '') || (!text && evidence?.result?.language === 'zh') ? '以下是普通话的句子。' : null);
  const updates = {};
  for (const [id, voice] of targets) {
    const saved = voice.status !== 'stale' && voice.status !== 'missing' ? voice : null;
    let raw = saved?.evidence, tool = saved?.tool, method = 'whisper-token';
    setup = setup || prepareVoiceAlignment(dir, { binary, model });
    if (setup.ready && dtwPreset(setup.model)) {
      raw = await recognizeVoice(dir, id, voice.source, setup, log, { dtw: true, prompt: stylePrompt(voice.source.text, raw) });
      method = 'whisper-dtw';
    } else if (!recognitionTokens(raw).length) {
      if (!setup.ready) throw new Error([...setup.errors, setup.manual].join('；'));
      raw = await recognizeVoice(dir, id, voice.source, setup, log);
    }
    if (setup.ready) tool = { engine: setup.engine, binary: setup.binary, binarySha256: fileDigest(setup.binary), model: setup.model, modelSha256: fileDigest(setup.model), cpu: true };
    const envelope = envelopeOf(loadSamples(scopedPath(dir, voice.source.file)));
    if (!envelope.usable) log(`  ! ${id} 录音能量对比不足，词边界保持识别时间，未做精修`);
    const previous = data.voices[id] && digest(data.voices[id].source) === digest(voice.source) ? data.voices[id].words : [];
    const words = buildWordTimeline({ text: voice.source.text, tokens: recognitionTokens(raw), duration: voice.source.duration, envelope }).map(word => {
      const kept = previous.find(old => old.n === word.n && old.text === word.text && old.status === 'confirmed');
      return kept || word;
    });
    validateWords(words, voice.source.duration);
    const current = voiceAlignmentStatus(dir).voices[id]?.source;
    if (digest(current) !== digest(voice.source)) throw new Error('识别期间录音或原稿改变，词表未写入');
    const pending = words.filter(word => !OK.includes(word.status));
    updates[id] = { source: voice.source, method: `${method}+onset-snap`, confidence_threshold: WORD_CONFIDENCE, words, issues: pending.map(word => `#${word.n} ${word.text}：${(word.issues || []).join('；')}`), tool, evidence_sha256: digest(raw), at: new Date().toISOString() };
    log(`  逐词时间表 ${id}：${words.length} 个词，${pending.length} 个待确认`);
  }
  data.voices = { ...data.voices, ...updates };writeReport(dir, data);
  return wordTimelineStatus(ctx);
}

/** 人工确认：只覆盖列出的词，且必须绑定当前录音来源。 */
export function importWordTiming(dir, input, { confirmation } = {}) {
  if (typeof confirmation !== 'string' || !confirmation.trim()) throw new Error('人工词时间需要用户明确确认说明');
  const ctx = loadFilm(dir, { requireShots: false }), status = wordTimelineStatus(ctx), data = ledger(ctx.filmDir), updates = {};
  for (const [id, value] of Object.entries(input?.voices || {})) {
    if (!Array.isArray(value.words)) continue;
    const voice = status.voices[id];
    if (!voice || voice.status === 'missing' || voice.status === 'stale') throw new Error(`${id} 没有当前有效的词表，请先运行 wka align-voice --words`);
    if (digest(value.source) !== digest(voice.source)) throw new Error(`${id} 录音/原稿来源过期，请重新核对当前来源`);
    const words = voice.words.map(word => ({ ...word }));
    for (const edit of value.words) {
      const word = words.find(item => item.n === edit.n);
      if (!word || unitsOf(word.text).join('') !== unitsOf(edit.text).join('')) throw new Error(`${id} 第 ${edit.n} 个词与当前词表不一致`);
      if (![edit.start, edit.end].every(Number.isFinite)) throw new Error(`${id} 第 ${edit.n} 个词缺少有效起止时间`);
      Object.assign(word, { start: edit.start, end: edit.end, status: 'confirmed', confidence: 1, confirmation: confirmation.trim(), refined: { start: false, end: false }, chars: [] });
      delete word.issues;
    }
    words.forEach((word, i) => { word.pause_before = +Math.max(0, word.start - (i ? words[i - 1].end : 0)).toFixed(3); });
    words.filter(word => !word.chars.length).forEach(word => { const letters = unitsOf(word.text), step = (word.end - word.start) / letters.length; word.chars = letters.map((text, i) => ({ text, start: +(word.start + i * step).toFixed(3), end: +(word.start + (i + 1) * step).toFixed(3) })); });
    validateWords(words, voice.source.duration);
    const saved = data.voices[id];
    updates[id] = { ...saved, words, issues: words.filter(word => !OK.includes(word.status)).map(word => `#${word.n} ${word.text}：${(word.issues || []).join('；')}`), at: new Date().toISOString() };
  }
  if (!Object.keys(updates).length) throw new Error('导入文件里没有 words 内容');
  data.voices = { ...data.voices, ...updates };writeReport(dir, data);
  return wordTimelineStatus(ctx);
}
