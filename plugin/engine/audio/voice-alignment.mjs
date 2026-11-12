// Offline recognition evidence and manual timing. No subtitle formats or online inference.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { loadFilm } from '../core/film-context.mjs';
import { atomicJson, digest, fileDigest } from '../core/evidence.mjs';
import { probeDuration, run } from '../core/ffmpeg.mjs';
import { scopedPath } from '../core/workbench-catalog.mjs';
import { reviewFile } from '../core/layout.mjs';

const recordPath = dir => scopedPath(dir, '.wka/voice-alignment.json');
const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
// Cue key order is not a timing change; preserve the original file on a no-op.
const cueDigest = cues => digest(Object.keys(cues || {}).sort().map(key => [key, cues[key]]));
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error(`无法读取定位记录：${e.message}`); } }
function ledger(dir) {
  const data = read(recordPath(dir), { version: 1, voices: {}, ownedCues: [] });
  if (data.version !== 1 || !data.voices || typeof data.voices !== 'object' || Array.isArray(data.voices) || !Array.isArray(data.ownedCues) || data.ownedCues.some(key => typeof key !== 'string' || !/^speech:[\p{L}\p{N}_-]+:\d+$/u.test(key))) throw new Error('定位记录损坏或版本不支持，不会覆盖');
  return data;
}
export function validateSegments(rows, duration) {
  if (!Array.isArray(rows) || !rows.length || !Number.isFinite(duration) || duration <= 0) throw new Error('没有可用语音时间点');
  let end = 0;
  return rows.map((row, i) => {
    if (typeof row.text !== 'string' || !normalized(row.text) || ![row.start, row.end].every(Number.isFinite) || row.start < end || row.end <= row.start || row.end > duration + .001) throw new Error(`第 ${i + 1} 段时间无效、重叠或超出录音范围`);
    end = row.end;
    return { text: row.text.trim(), start: row.start, end: row.end, ...(Number.isFinite(row.confidence) ? { confidence: row.confidence } : {}) };
  });
}
export function reconcileSegments(rows, transcript, duration) {
  const segments = validateSegments(rows, duration), expected = normalized(transcript), observed = segments.map(s => normalized(s.text)).join('');
  const issues = [];
  if (expected && expected !== observed) issues.push('识别内容与原稿不符或有遗漏，请确认录音与剧本');
  const seen = new Set();
  for (const s of segments) {
    const text = normalized(s.text);
    if (seen.has(text)) issues.push(`重复台词需要核实位置：${s.text}`);
    seen.add(text);
    if (!Number.isFinite(s.confidence) || s.confidence < .65) issues.push(`定位可信度不足：${s.text}`);
  }
  // Timings come from recognition, never from distributing manuscript characters.
  return { status: issues.length ? 'pending' : 'matched', method: expected ? 'local-recognition-text-match' : 'local-recognition', segments, issues };
}
export function voiceSources(ctx, { checkTotal = true } = {}) {
  const audio = ctx.film.audio || {}, voices = audio.voices || [];
  if (audio.voice_source === 'none' || (!audio.voice_source && !voices.length)) return {};
  if (!voices.length) throw new Error('需要用户录音，请先提供素材');
  const result = {};
  voices.forEach((v, i) => {
    const id = v.cue || `vo${i + 1}`;
    if (!/^[\p{L}\p{N}_-]+$/u.test(id) || Object.hasOwn(result, id)) throw new Error('录音 cue 必须唯一，只含文字、数字、下划线或连字符');
    if (!v.file) throw new Error(`缺少用户录音：${id}`);
    const file = scopedPath(ctx.filmDir, v.file);
    if (!fs.existsSync(file)) throw new Error(`用户录音不存在：${v.file}`);
    const duration = probeDuration(file);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`录音损坏或没有可用时长：${v.file}`);
    if (!Number.isFinite(v.at) || v.at < 0 || (checkTotal && v.at + duration > ctx.totalDuration + .001)) throw new Error(`录音 ${id} 超出已批准的影片时长，请确认调整；不会截断或变速。`);
    result[id] = { file: v.file, audioSha256: fileDigest(file), textSha256: digest(v.text || ''), at: v.at, duration, text: v.text || '' };
  });
  return result;
}
export function voiceAlignmentStatus(dir) {
  const ctx = loadFilm(dir, { requireShots: false }), data = ledger(ctx.filmDir), current = voiceSources(ctx), voices = {};
  for (const [id, source] of Object.entries(current)) {
    const saved = data.voices[id];
    if (saved) validateSegments(saved.segments, saved.source?.duration);
    const fresh = saved && digest(saved.source) === digest(source);
    voices[id] = { source, ...(saved || {}), status: saved ? fresh ? saved.status : 'stale' : 'missing', source };
  }
  const ready = Object.values(voices).every(v => ['matched', 'confirmed'].includes(v.status));
  const expected = ready ? Object.fromEntries(Object.entries(voices).flatMap(([id, v]) => v.segments.map((s, i) => [`speech:${id}:${i + 1}`, [v.source.at + s.start, v.source.at + s.end]]))) : {};
  const applied = ready && !fs.existsSync(scopedPath(ctx.filmDir, '.wka/voice-cues-pending.json')) &&
    digest([...data.ownedCues].sort()) === digest(Object.keys(expected).sort()) && Object.entries(expected).every(([key, value]) => digest(ctx.film.cues?.[key] ?? null) === digest(value));
  return { version: 1, ready, applied, voices };
}
function writeReport(dir, data) {
  atomicJson(recordPath(dir), data);
  const rows = Object.entries(data.voices).flatMap(([id, v]) => [`## ${id} · ${v.status}`, `来源：${v.method}；不改变原始录音`, ...(v.issues || []).map(x => '- 待确认：' + x), ...v.segments.map((s, i) => `- ${i + 1}. ${(v.source.at + s.start).toFixed(3)}–${(v.source.at + s.end).toFixed(3)} 秒：${s.text}`), '']);
  const file = reviewFile(scopedPath(dir, '.'), '台词定位.md', { ensure: true });fs.writeFileSync(file, '# 台词定位\n\n仅用于声画编排；识别时间仍需结合小样听审。\n\n' + rows.join('\n'));
  return data;
}
export function importVoiceTiming(dir, input, { confirmation } = {}) {
  if (typeof confirmation !== 'string' || !confirmation.trim()) throw new Error('人工时间点需要用户明确确认说明');
  const status = voiceAlignmentStatus(dir), data = ledger(dir);
  if (input?.version !== 1 || !input.voices || !Object.keys(input.voices).length) throw new Error('人工时间点格式需要 version:1 和 voices');
  const updates = {};
  for (const [id, value] of Object.entries(input.voices)) {
    const source = status.voices[id]?.source;
    if (!source || digest(value.source) !== digest(source)) throw new Error(`${id} 录音/原稿来源过期，请重新核对当前来源`);
    const segments = validateSegments(value.segments, source.duration);
    updates[id] = { source, segments, status: 'confirmed', method: 'manual', confirmation: confirmation.trim(), at: new Date().toISOString(), issues: [] };
  }
  data.voices = { ...data.voices, ...updates };
  return writeReport(dir, data);
}
export function applyVoiceAlignment(dir) {
  const status = voiceAlignmentStatus(dir), data = ledger(dir);
  if (!status.ready) throw new Error('台词定位缺失、待确认或已过期，请先运行 align-voice 或确认人工时间点：' + Object.entries(status.voices).filter(([, v]) => !['matched', 'confirmed'].includes(v.status)).map(([id, v]) => `${id} ${v.status}`).join('；'));
  const file = scopedPath(dir, 'film.json'), journal = scopedPath(dir, '.wka/voice-cues-pending.json');
  const fingerprint = digest(Object.fromEntries(Object.entries(status.voices).map(([id, v]) => [id, { source: v.source, segments: v.segments }])));
  const pending = read(journal, null);
  if (pending) {
    const film = read(file);
    if (pending.fingerprint !== fingerprint || ![digest(pending.before), digest(pending.after)].includes(digest(film.cues || {})) ||
        ![digest(pending.oldOwned), digest(pending.nextOwned)].includes(digest(data.ownedCues))) throw new Error('定位写入中断后输入已变化，请核对 .wka/voice-cues-pending.json，未覆盖手工标记');
    atomicJson(file, { ...film, cues: pending.after });
    data.ownedCues = pending.nextOwned;atomicJson(recordPath(dir), data);fs.rmSync(journal);
  }
  const film = read(file), cues = { ...film.cues };
  for (const key of data.ownedCues) delete cues[key];
  const owned = [];
  for (const [id, v] of Object.entries(status.voices)) v.segments.forEach((s, i) => {
    const key = `speech:${id}:${i + 1}`;
    if (Object.hasOwn(cues, key)) throw new Error(`定位 cue 与手工标记冲突：${key}`);
    cues[key] = [v.source.at + s.start, v.source.at + s.end];owned.push(key);
  });
  if (cueDigest(film.cues) !== cueDigest(cues) || digest(data.ownedCues) !== digest(owned)) {
    atomicJson(journal, { fingerprint, before: film.cues || {}, after: cues, oldOwned: data.ownedCues, nextOwned: owned });
    atomicJson(file, { ...film, cues });
    data.ownedCues = owned;atomicJson(recordPath(dir), data);fs.rmSync(journal);
  }
  return voiceAlignmentStatus(dir);
}
function executable(name) {
  const candidates = path.isAbsolute(name) ? [name] : (process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, name));
  return candidates.find(file => { try { fs.accessSync(file, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);return fs.statSync(file).isFile(); } catch { return false; } });
}
export function prepareVoiceAlignment(dir, { binary, model } = {}) {
  loadFilm(dir, { requireShots: false });
  const file = scopedPath(dir, '.wka/local-speech.json'), saved = read(file, {});
  const tool = executable(binary || process.env.WKA_WHISPER_BIN || saved.binary || (process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'));
  const modelPath = model || process.env.WKA_WHISPER_MODEL || saved.model;
  const resolvedModel = modelPath && path.resolve(modelPath), errors = [];
  if (!tool) errors.push('缺少 whisper.cpp 的 whisper-cli，请按本地语音准备文档安装组件');
  if (!resolvedModel || !fs.existsSync(resolvedModel) || !fs.statSync(resolvedModel).isFile()) errors.push('缺少本地模型；下载多语言 ggml-base.bin 或更高精度模型后指定 --model');
  if (tool) { const result = spawnSync(tool, ['--help'], { encoding: 'utf8', timeout: 10000 });if (result.error || result.status !== 0) errors.push('本地识别组件不能运行：' + (result.error?.message || result.stderr)); }
  if (errors.length) return { ready: false, errors, manual: '可运行 align-voice --status，按当前 source 补充 JSON 时间点，再用 --import 和 --confirm 导入。' };
  const config = { binary: fs.realpathSync(tool), model: resolvedModel, engine: 'whisper.cpp', cpu: true };
  atomicJson(file, config);return { ready: true, ...config };
}
function recognize(binary, args, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'], shell: false });let errors = '';
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-8000); });
    const timer = setInterval(() => log('本地录音识别仍在运行…'), 15000);
    child.on('error', error => { clearInterval(timer);reject(error); });
    child.on('close', code => { clearInterval(timer);code === 0 ? resolve() : reject(new Error(`本地识别失败（${code}）：${errors}`)); });
  });
}
export async function recognizeVoice(dir, id, source, setup, log = console.log, { dtw = false, prompt = null } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-speech-'));
  try {
    const wav = path.join(temp, 'audio.wav'), output = path.join(temp, 'recognition');
    await run(['-i', scopedPath(dir, source.file), '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
    log(`本地识别 ${id}（${source.duration.toFixed(1)} 秒，CPU，不上传录音）`);
    const preset = dtw ? dtwPreset(setup.model) : null;
    await recognize(setup.binary, ['-m', setup.model, '-f', wav, '-l', 'auto', '-ojf', '-of', output, '--no-gpu', ...(preset ? ['--dtw', preset, '-nfa'] : []), ...(prompt ? ['--prompt', prompt] : [])], log);
    return read(output + '.json');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
// whisper.cpp 的 DTW 词时间需要与模型规格对应的预设；按官方文件名识别，认不出就不启用。
export function dtwPreset(model) {
  const match = path.basename(String(model || '')).toLowerCase().match(/^ggml-(tiny|base|small|medium|large-v1|large-v2|large-v3-turbo|large-v3)(\.en)?(?:[-.]|$)/);
  if (!match) return null;
  const size = match[1].replace('large-v3-turbo', 'large.v3.turbo').replace(/^large-v/, 'large.v');
  return size + (match[2] || '');
}
/** token 列表；有 DTW 时间时用它作为 token 起点（比解码器时间戳更贴近声学）。 */
export function recognitionTokens(raw) {
  const tokens = (raw?.transcription || []).flatMap(row => row.tokens || []).filter(token => typeof token.text === 'string' && !/^\[.*\]$/.test(token.text.trim()));
  const dtw = tokens.length > 0 && tokens.every(token => Number.isFinite(token.t_dtw) && token.t_dtw >= 0);
  return tokens.map((token, i) => {
    const from = dtw ? token.t_dtw / 100 : token.offsets?.from / 1000;
    const next = dtw ? tokens[i + 1]?.t_dtw / 100 : undefined;
    return { text: token.text, from, to: dtw ? (Number.isFinite(next) && next > from ? next : from + Math.max(0.05, (token.offsets?.to - token.offsets?.from) / 1000 || 0.15)) : token.offsets?.to / 1000, p: token.p };
  });
}
export async function alignVoice(dir, { binary, model, force = false, log = console.log } = {}) {
  const status = voiceAlignmentStatus(dir), data = ledger(dir);
  const targets = Object.entries(status.voices).filter(([, v]) => force || !['matched', 'confirmed'].includes(v.status));
  if (!targets.length) return status;
  const setup = prepareVoiceAlignment(dir, { binary, model });
  if (!setup.ready) throw new Error([...setup.errors, setup.manual].join('；'));
  const tool = { engine: setup.engine, binary: setup.binary, binarySha256: fileDigest(setup.binary), model: setup.model, modelSha256: fileDigest(setup.model), cpu: true };
  const updates = {};
  for (const [id, value] of targets) {
    const raw = await recognizeVoice(dir, id, value.source, setup, log);
    const rows = (raw?.transcription || []).map(row => {
      const probs = (row.tokens || []).filter(t => !/^\[.*\]$/.test(t.text?.trim())).map(t => t.p).filter(Number.isFinite);
      return { text: row.text, start: row.offsets?.from / 1000, end: row.offsets?.to / 1000, confidence: probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : null };
    });
    updates[id] = { source: value.source, ...reconcileSegments(rows, value.source.text, value.source.duration), tool, evidence: raw, at: new Date().toISOString() };
    const current = voiceAlignmentStatus(dir).voices[id]?.source;
    if (digest(current) !== digest(value.source)) throw new Error('识别期间录音或原稿改变，结果未写入');
  }
  data.voices = { ...data.voices, ...updates };writeReport(dir, data);
  return voiceAlignmentStatus(dir);
}
