// 混音：执行片子的 audio/build.mjs（生成配乐 / 音效）→ 合成 VO → 按时间点混合 → 响度标准化。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as synth from './synth.mjs';
import { synthesizeVoiceOver } from './tts.mjs';
import { run, probeDuration } from '../core/ffmpeg.mjs';
import { loadFilm } from '../core/job.mjs';

/**
 * VO 素材：按 audio.vo_source（第 6 道工序审片节点④由用户签批）取用户自供录音或 AI 配音。
 * 返回与 voiceover 一一对应的数组：{file, at, duration} 或 null（无音频，同步点按字数估算）。
 */
function prepareVoiceOver(ctx, audio, outDir, log) {
  const lines = audio.voiceover || [];
  if (!lines.length) return [];
  const source = audio.vo_source || (lines.some((l) => l.file) ? 'user' : 'ai');
  if (source === 'none') {
    log('  · VO 素材来源：无 VO');
    return [];
  }
  if (source === 'user') {
    const missing = lines.map((l, i) => (!l.file ? `第 ${i + 1} 条「${l.text}」` : null)).filter(Boolean);
    if (missing.length) throw new Error(`VO 素材来源为"用户自供录音"，但以下条目没有挂接音频文件（voiceover[].file）：\n  ${missing.join('\n  ')}`);
    const items = lines.map((l) => {
      const file = path.join(ctx.filmDir, l.file);
      if (!fs.existsSync(file)) throw new Error(`找不到用户自供的 VO 录音：${l.file}`);
      const duration = probeDuration(file);
      if (!duration) throw new Error(`无法读取音频时长（格式不支持或文件损坏）：${l.file}`);
      return { file, at: l.at, duration, text: l.text };
    });
    log(`  ✓ VO ${items.length} 条（用户自供录音）`);
    return items;
  }
  const r = synthesizeVoiceOver(lines, outDir, { log });
  return r ? r.items : lines.map(() => null);
}

/**
 * 把 VO 的实测入出点写进 film.json 的 cues（声音同步点）。
 * 没有音频（未装 TTS）时按每秒约 3.6 个汉字估算，并标注为估算值。
 */
function writeVoiceOverCues(ctx, lines, vo, log) {
  const file = path.join(ctx.filmDir, 'film.json');
  const film = JSON.parse(fs.readFileSync(file, 'utf8'));
  film.cues = film.cues || {};
  const before = JSON.stringify(film.cues);
  log('  声音同步点：');
  lines.forEach((l, i) => {
    const measured = vo[i]?.duration;
    const dur = measured || Math.max(0.6, [...l.text.replace(/[，。！？、；：,.!?\s]/g, '')].length / 3.6);
    const name = l.cue || `vo${i + 1}`;
    film.cues[name] = [+l.at.toFixed(3), +(l.at + dur).toFixed(3)];
    const shot = ctx.shots.find((s) => l.at >= s.start && l.at < s.start + s.duration);
    const over = shot && l.at + dur > shot.start + shot.duration ? `  ! 超出 ${shot.id} 结尾 ${(l.at + dur - shot.start - shot.duration).toFixed(2)}s` : '';
    const next = lines[i + 1];
    const overlap = next && l.at + dur > next.at ? `  ! 与下一条 VO 重叠 ${(l.at + dur - next.at).toFixed(2)}s` : '';
    log(`    ${name.padEnd(8)} ${l.at.toFixed(2)}s → ${(l.at + dur).toFixed(2)}s  (${dur.toFixed(2)}s${measured ? '' : ' 估算'})${over}${overlap}`);
  });
  // 同步点没变就不动 film.json，免得无谓地改动文件、触发重渲
  if (JSON.stringify(film.cues) === before) return log('  · 声音同步点未变化');
  fs.writeFileSync(file, JSON.stringify(film, null, 2) + '\n');
}

/**
 * @returns {Promise<string|null>} 混好的 wav 路径；没有任何音轨时返回 null
 */
export async function mixSoundtrack(filmDir, { log = console.log } = {}) {
  const ctx = loadFilm(filmDir);
  const audio = ctx.film.audio || {};
  const genDir = path.join(ctx.filmDir, 'audio', 'generated');
  fs.mkdirSync(genDir, { recursive: true });
  const tracks = [];

  if (audio.build) {
    const mod = await import(pathToFileURL(path.join(ctx.filmDir, audio.build)).href + `?v=${Date.now()}`);
    const res = await mod.default({ synth, duration: ctx.totalDuration, outDir: genDir, shots: ctx.shots, cues: ctx.film.cues || {}, log });
    for (const t of res || []) tracks.push({ start: 0, gain: 0, ...t });
    log(`  ✓ 配乐脚本生成 ${res?.length || 0} 条音轨`);
  }
  const vo = prepareVoiceOver(ctx, audio, path.join(genDir, 'vo'), log);
  for (const it of vo) if (it?.file) tracks.push({ file: it.file, start: it.at, gain: 2 });
  if (audio.voiceover?.length && audio.vo_source !== 'none') writeVoiceOverCues(ctx, audio.voiceover, vo, log);
  for (const t of audio.tracks || []) tracks.push({ start: 0, gain: 0, ...t, file: path.join(ctx.filmDir, t.file) });

  if (!tracks.length) {
    // 清掉上一次的混音，免得动态分镜和导出误用旧声轨
    fs.rmSync(path.join(ctx.filmDir, '.cache', 'mix.wav'), { force: true });
    log('  · 没有音轨，导出无声视频');
    return null;
  }
  for (const t of tracks) if (!fs.existsSync(t.file)) throw new Error(`音轨不存在：${t.file}`);

  const D = ctx.totalDuration;
  const inputs = tracks.flatMap((t) => ['-i', t.file]);
  const chains = tracks.map((t, i) => {
    const ms = Math.round((t.start || 0) * 1000);
    return `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms},volume=${t.gain || 0}dB[a${i}]`;
  });
  const fadeOut = Math.min(1.2, D * 0.1);
  const filter =
    chains.join(';') +
    `;${tracks.map((_, i) => `[a${i}]`).join('')}amix=inputs=${tracks.length}:normalize=0,apad,atrim=0:${D},` +
    `afade=t=out:st=${(D - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)},loudnorm=I=-18:TP=-1.5:LRA=11[out]`;
  fs.mkdirSync(path.join(ctx.filmDir, '.cache'), { recursive: true });
  const out = path.join(ctx.filmDir, '.cache', 'mix.wav');
  await run([...inputs, '-filter_complex', filter, '-map', '[out]', '-ar', '48000', out]);
  log(`  ✓ 混音完成（${tracks.length} 条音轨）`);
  return out;
}
