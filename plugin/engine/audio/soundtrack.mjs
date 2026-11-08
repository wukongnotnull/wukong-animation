import { applyVoiceAlignment } from './voice-alignment.mjs';
// 混音：执行片子的 audio/build.mjs（生成配乐 / 音效）→ 准备人声 → 按时间点混合 → 响度标准化。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as synth from './synth.mjs';
import { run, probeDuration } from '../core/ffmpeg.mjs';
import { loadFilm } from '../core/film-context.mjs';
import { writeVoiceSources } from '../core/word-sync.mjs';
import { charCues, clearCharCues, orphanCharCues } from './char-cues.mjs';
import { detectSoundRanges } from '../exporters/jianying/silence.mjs';
import { loadSfxLibrary, createSfx, densityWarnings } from './sfx.mjs';
import { duckFile } from './duck.mjs';
import { normalizeLoudness } from './loudness.mjs';
import { frameDb, judgeSfx, formatAudit } from './audit.mjs';
import { runStage } from '../core/operations.mjs';
import { digest, fileDigest, treeEvidence } from '../core/evidence.mjs';
import { ENGINE_ROOT } from '../core/paths.mjs';
import { saveAudioReview,saveSfxReview } from '../core/review-evidence.mjs';
import { rememberArtifacts } from '../core/operations.mjs';

// 风格没写 style.json 的 loudness 时，声轨标准化到的整体响度（LUFS）
const DEFAULT_LOUDNESS = -18;
const SFX_TRACK = 'sfx.wav'; // 听感审计按这个文件名认音效轨

// 逐字同步点找句中停顿：比剪映切配乐更灵敏，不留前后余量
const CHAR_SILENCE = { noise: -40, minSilence: 0.15, pad: 0 };

/** Each entry is one user recording. A whole recording is mixed only once. */
export function planVoiceLines(audio) {
  const raw = audio.voices || [], source = audio.voice_source || (raw.length ? 'user' : 'none');
  if (source === 'ai') throw new Error('仅支持用户提供的录音，AI 人声已取消');
  if (source === 'none') return { source, lines: [] };
  if (!raw.length || raw.some(l => !l.file)) throw new Error('需要用户人声录音；请先提供 voices[].file，不使用估算声音替代。');
  return { source, lines: raw.map(l => ({ ...l, kind: l.kind || 'vo', via: 'recording' })) };
}

function probeRecording(ctx, l) {
  const file = path.join(ctx.filmDir, l.file);
  if (!fs.existsSync(file)) throw new Error(`找不到人声录音：${l.file}`);
  const duration = probeDuration(file);
  if (!duration) throw new Error(`无法读取音频时长（格式不支持或文件损坏）：${l.file}`);
  if (l.at + duration > ctx.totalDuration + 0.001) throw new Error(`录音 ${l.file} 超出已批准的影片时长，请先确认调整；不会截断或变速。`);
  return { file, at: l.at, duration, text: l.text || '' };
}

function prepareVoices(ctx, audio, log) {
  const { source, lines } = planVoiceLines(audio);
  if (source === 'none') return [];
  const items = lines.map(l => probeRecording(ctx, l));
  log(`  ✓ 用户录音 ${items.length} 段`);
  return items;
}
function voiceDuration(line, item) {
  if (!item?.duration) throw new Error('缺少可用录音时长，不能估算人声');
  return item.duration;
}

const cueName = (line, i) => line.cue || `vo${i + 1}`;

/** cue 名重复时后一句会悄悄盖掉前一句的同步点，直接报错。 */
function checkCueNames(lines) {
  const seen = new Map();
  lines.forEach((l, i) => seen.set(cueName(l, i), [...(seen.get(cueName(l, i)) || []), i + 1]));
  const dup = [...seen].filter(([, idx]) => idx.length > 1).map(([name, idx]) => `「${name}」用在第 ${idx.join('、')} 条`);
  if (dup.length) throw new Error(`人声的同步点名重复：${dup.join('；')}。每条人声的 cue 名要不同（film.json 的 audio.voices[].cue）`);
}

/** 「甲#1…#5、乙#1」：把逐字同步点按名字归并成一行。 */
function describeCharCues(keys) {
  const byName = new Map();
  for (const k of keys) {
    const [, name, n] = k.match(/^(.+)#(\d+)$/);
    byName.set(name, [...(byName.get(name) || []), +n]);
  }
  return [...byName].map(([name, ns]) => {
    const [lo, hi] = [Math.min(...ns), Math.max(...ns)];
    return lo === hi ? `${name}#${lo}` : `${name}#${lo}…#${hi}`;
  }).join('、');
}

/**
 * 人声改名或删掉后，它以前写的逐字点没人再清，镜头会读到过期时间：去掉不属于 keepNames 的「名#数字」。
 * 手写的同步点（不带 #数字）不动。返回新对象。
 */
function dropOrphanCharCues(cues, keepNames, log) {
  const orphans = orphanCharCues(cues, keepNames);
  if (!orphans.length) return cues;
  log(`  · 清掉了已不用的逐字同步点：${describeCharCues(orphans)}`);
  return Object.fromEntries(Object.entries(cues).filter(([k]) => !orphans.includes(k)));
}

/** 人声全删了：只清孤立的逐字点，有变化才写 film.json。 */
function clearAllCharCues(ctx, log) {
  const file = path.join(ctx.filmDir, 'film.json');
  const film = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!film.cues) return;
  const cues = dropOrphanCharCues(film.cues, [], log);
  if (cues !== film.cues) fs.writeFileSync(file, JSON.stringify({ ...film, cues }, null, 2) + '\n');
}

const sortedJson = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));

function writeVoiceCues(ctx, lines, vo, log) {
  const file = path.join(ctx.filmDir, 'film.json');
  const film = JSON.parse(fs.readFileSync(file, 'utf8'));
  film.cues = film.cues || {};
  const before = sortedJson(film.cues);
  log('  声音同步点：');
  lines.forEach((l, i) => {
    const measured = vo[i]?.duration;
    const dur = voiceDuration(l, vo[i]);
    const name = cueName(l, i);
    film.cues[name] = [+l.at.toFixed(3), +(l.at + dur).toFixed(3)];
    const shot = ctx.shots.find((s) => l.at >= s.start && l.at < s.start + s.duration);
    const over = shot && l.at + dur > shot.start + shot.duration ? `  ! 超出 ${shot.id} 结尾 ${(l.at + dur - shot.start - shot.duration).toFixed(2)}s` : '';
    const next = lines[i + 1];
    const overlap = next && l.at + dur > next.at ? `  ! 与下一条人声重叠 ${(l.at + dur - next.at).toFixed(2)}s` : '';
    log(`    ${name.padEnd(8)} ${l.at.toFixed(2)}s → ${(l.at + dur).toFixed(2)}s  (${dur.toFixed(2)}s${measured ? '' : ' 估算'})${over}${overlap}`);
    film.cues = clearCharCues(film.cues, name);
    if (l.chars) {
      const ranges = vo[i]?.file ? detectSoundRanges(vo[i].file, dur, CHAR_SILENCE) : null;
      const chars = charCues(l.text, name, { at: l.at, duration: dur, ranges });
      Object.assign(film.cues, chars);
      const n = Object.keys(chars).length;
      log(n ? `             逐字同步点 ${name}#1…#${n}（${ranges ? '按停顿分组后均分，估算' : '按字数估算'}）` : `  ! ${name} 设了 chars，但这句没有要计时的字（只有标点）`);
    }
  });
  film.cues = dropOrphanCharCues(film.cues, lines.map((l, i) => (l.chars ? cueName(l, i) : null)).filter(Boolean), log);
  // 同步点没变就不动 film.json，免得无谓地改动文件、触发重渲。按键排序后再比：逐字点重写后键的顺序会变，值没变
  if (sortedJson(film.cues) === before) return log('  · 声音同步点未变化');
  fs.writeFileSync(file, JSON.stringify(film, null, 2) + '\n');
}

/**
 * @returns {Promise<{mix: string|null, tracks: object[], voices: object[]}>}
 *   mix：混好的 wav 路径，没有任何音轨时为 null；
 *   tracks：未混的音轨 {role: voice|build|track, file, start, gain}，人声另带实测 duration；voices：人声 {text, at, duration, estimated}
 */
export async function mixSoundtrack(filmDir, { log = console.log } = {}) {
  applyVoiceAlignment(filmDir);
  const ctx=loadFilm(filmDir,{requireShots:false}),audio=ctx.film.audio||{};
  const files=[...(audio.tracks||[]),...(audio.voices||[])].filter(t=>t.file).map(t=>path.resolve(ctx.filmDir,t.file));
  const signature=audio.build?null:digest({audio,shots:ctx.shots.map(s=>[s.id,s.duration]),style:ctx.style.loudness,files:files.map(file=>[file,fileDigest(file)]),engine:treeEvidence(path.join(ENGINE_ROOT,'audio'))});
  const value=await runStage(ctx.filmDir,{stage:'soundtrack',aspect:ctx.variant.aspect,signature,log,onReuse:()=>{if(audio.voices?.length)log('  · 声音同步点未变化（完整声轨与同步点文件已核对）');},run:async()=>{
    const value=await mixSoundtrackFresh(filmDir,{log});
    return {value,outputs:[path.join(ctx.filmDir,'film.json'),...(value.mix?[value.mix]:[]),path.join(ctx.filmDir,'.cache/voice-sources.json'),...value.tracks.map(t=>t.file)]};
  }});
  const report=saveAudioReview(ctx,value.mix);
  const outputs=['声轨审听.md','声轨审听.json'].map(f=>path.join(ctx.filmDir,'review',f));
  saveSfxReview(ctx,value.mix,value.sfxAudit);
  if(value.sfxAudit)outputs.push(path.join(ctx.filmDir,'review','音效电平审计.json'));
  rememberArtifacts(ctx.filmDir,{stage:'review:audio-notes',aspect:ctx.variant.aspect,signature:report.sha256,outputs,value:outputs});
  if(report.errors.length)throw new Error(report.errors.join('；'));
  log(`声轨审听状态：${report.status}（测量不代表实际听过）`);return value;
}

async function mixSoundtrackFresh(filmDir, { log = console.log } = {}) {
  // 制作小样先准备声轨，只用到镜头时长，不要求镜头文件已经写好
  let ctx = loadFilm(filmDir, { requireShots: false });
  if (ctx.legacyFields.length) log(`  ! film.json 用了旧字段名，已按新名读取，建议改过来：${ctx.legacyFields.join('，')}`);
  const audio = ctx.film.audio || {};
  checkCueNames(audio.voices || []);
  const vo = prepareVoices(ctx, audio, log);
  const hasVoices = vo.length > 0;
  if (hasVoices) writeVoiceCues(ctx, audio.voices, vo, log);
  else clearAllCharCues(ctx, log);
  ctx = loadFilm(filmDir, { requireShots: false });
  const genDir = path.join(ctx.filmDir, 'audio', 'generated');
  fs.mkdirSync(genDir, { recursive: true });
  const tracks = [];
  let lib = null;
  let sfx = null;

  if (audio.build) {
    const mod = await import(pathToFileURL(path.join(ctx.filmDir, audio.build)).href + `?v=${Date.now()}`);
    // 风格有录音音效清单才有 sfx；没有时为 null
    lib = loadSfxLibrary(ctx.style);
    sfx = lib && createSfx(lib);
    const res = await mod.default({ synth, sfx, duration: ctx.totalDuration, outDir: genDir, shots: ctx.shots, cues: ctx.film.cues || {}, log });
    for (const t of res || []) tracks.push({ start: 0, gain: 0, ...t, role: 'build' });
    log(`  ✓ 配乐脚本生成 ${res?.length || 0} 条音轨`);
    for (const w of sfx ? densityWarnings(sfx.placements, ctx.shots) : []) log(`  ! 音效太密：${w}`);
  }
  for (const it of vo) tracks.push({ role: 'voice', file: it.file, start: it.at, duration: it.duration, gain: 2 });
  const voices = hasVoices ? audio.voices.map((l, i) => ({ text: l.text, at: l.at, duration: voiceDuration(l, vo[i]), estimated: !vo[i]?.duration })) : [];
  for (const t of audio.tracks || []) tracks.push({ start: 0, gain: 0, ...t, role: 'track', file: path.join(ctx.filmDir, t.file) });

  if (!tracks.length) {
    // 清掉上一次的混音，免得动态分镜和导出误用旧声轨
    fs.rmSync(path.join(ctx.filmDir, '.cache', 'mix.wav'), { force: true });
    writeVoiceSources(ctx, vo);
    log('  · 没有音轨，导出无声视频');
    return { mix: null, tracks, voices };
  }
  for (const t of tracks) if (!fs.existsSync(t.file)) throw new Error(`音轨不存在：${t.file}`);

  duckTracks(tracks, voices, path.join(genDir, 'ducked'), log);
  const D = ctx.totalDuration;
  const cache = path.join(ctx.filmDir, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  const premix = await mixTracks(tracks, D, path.join(cache, 'premix.wav'));
  const out = path.join(cache, 'mix.wav');
  const target = ctx.style.loudness ?? DEFAULT_LOUDNESS;
  const { output } = await normalizeLoudness(premix, out, target);
  log(`  ✓ 混音完成（${tracks.length} 条音轨）`);
  log(output === null ? '  · 声轨没有可测响度，未做响度标准化' : `  ✓ 响度 ${output.toFixed(1)} LUFS（目标 ${target}）`);
  const sfxAudit=sfx?.placements.length?await auditSfx({ tracks, D, cache, sfx, lib, shots: ctx.shots, log }):null;
  writeVoiceSources(ctx, vo);
  return { mix: out, tracks, voices, loudness:output, sfxAudit };
}

/** 各音轨按起点和增益混成一条（保留完整用户录音），不做响度标准化。 */
async function mixTracks(tracks, D, out) {
  const inputs = tracks.flatMap((t) => ['-i', t.file]);
  const chains = tracks.map((t, i) => {
    const ms = Math.round((t.start || 0) * 1000);
    return `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms},volume=${t.gain || 0}dB[a${i}]`;
  });
  const filter =
    chains.join(';') +
    `;${tracks.map((_, i) => `[a${i}]`).join('')}amix=inputs=${tracks.length}:normalize=0,apad,atrim=0:${D}[out]`;
  // 32 位浮点：多轨叠加会超过 0 dBFS，16 位会在测响度之前就削波
  await run([...inputs, '-filter_complex', filter, '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_f32le', out]).catch((e) => {
    throw new Error(`混音失败：${e.message}`);
  });
  return out;
}

/**
 * 标了 duck 的音轨（背景音乐）按人声闪避：换成 ducked/ 下同名的处理后文件，混音和剪映草稿都用它。原地改 tracks 里的 file。
 */
function duckTracks(tracks, voices, dir, log) {
  const toDuck = tracks.filter((t) => t.duck && t.role !== 'voice');
  if (!toDuck.length) return;
  if (!voices.length) return log('  · 没有人声，背景音乐不闪避');
  const intervals = voices.map((v) => [v.at, v.at + v.duration]);
  const used = new Set();
  for (const t of toDuck) {
    // 文件名不变（剪映草稿按文件名起轨道名）；重名时放进子目录，免得互相覆盖
    const name = path.basename(t.file);
    let dest = path.join(dir, name);
    for (let n = 2; used.has(dest); n++) dest = path.join(dir, String(n), name);
    used.add(dest);
    t.file = duckFile(t.file, dest, intervals, { start: t.start || 0 });
    t.duckApplied=true;
    log(`  ✓ ${path.basename(t.file)} 随人声闪避`);
  }
}

/** 听感审计：音效轨（sfx.wav）和其余音轨分开混，在每个音效起点比电平。 */
async function auditSfx({ tracks, D, cache, sfx, lib, shots, log }) {
  const isSfx = (t) => t.role !== 'voice' && path.basename(t.file) === SFX_TRACK;
  const fx = tracks.filter(isSfx);
  const bed = tracks.filter((t) => !isSfx(t));
  if (!fx.length) return log(`  · 音效没有单独写成 ${SFX_TRACK}，跳过听感审计`);
  if (!bed.length) return log('  · 没有人声和音乐，音效不会被盖住，跳过听感审计');
  const fxDb = frameDb(await mixTracks(fx, D, path.join(cache, 'audit-sfx.wav')));
  const bedDb = frameDb(await mixTracks(bed, D, path.join(cache, 'audit-bed.wav')));
  const quiet = new Set(Object.entries(lib.sounds).filter(([, s]) => s.quiet).map(([n]) => n));
  if (fx.length > 1) log(`  ! 有 ${fx.length} 条 ${SFX_TRACK}，听感审计按第一条的起点换算时间`);
  const rows = judgeSfx(sfx.placements, fxDb, bedDb, { quiet, offset: fx[0].start || 0 });
  for (const line of formatAudit(rows, shots, quiet)) log(line);
  return rows.map(r=>({...r,quiet:quiet.has(r.name)}));
}
