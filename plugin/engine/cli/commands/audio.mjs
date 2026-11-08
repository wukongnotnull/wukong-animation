import fs from 'node:fs';
import { alignVoice, prepareVoiceAlignment, voiceAlignmentStatus, importVoiceTiming, applyVoiceAlignment } from '../../audio/voice-alignment.mjs';
import { writeReview } from '../../core/job.mjs';
import { loadFilm } from '../../core/film-context.mjs';
import { fail } from '../context.mjs';
import { reviewArtifacts } from '../review-artifacts.mjs';

export function audioCommands({ pos, opt, log, aspectOpt }) {
  const { registerReview } = reviewArtifacts(log);
  async function cmdSfx(filmDir, { list }) {
    if (!filmDir) fail('用法：wka sfx <片目录> [--list]');
    const { style } = loadFilm(filmDir, { requireShots: false });
    const { loadSfxLibrary, listSfx, fetchSfx } = await import('../../audio/sfx.mjs');
    const lib = loadSfxLibrary(style);
    if (!lib) fail(`风格 ${style.id} 没有录音音效清单（style.json 的 sfx），音效请用 synth 合成`);
    if (list) {
      const rows = listSfx(lib);
      for (const r of rows) log(`${r.name.padEnd(8)} ${r.role.padEnd(10)} ${r.title.padEnd(36)} ${r.url.padEnd(62)} ${r.bytes === null ? '   ? KB' : `${String(Math.round(r.bytes / 1024)).padStart(4)} KB`}`);
      const total = rows.reduce((a, r) => a + (r.bytes || 0), 0);
      log(`${rows.length} 个文件，共 ${(total / 1024 / 1024).toFixed(1)} MB → ${lib.dir}\n${lib.license}`);
      return;
    }
    log(`下载并处理录音音效 → ${lib.dir}`);
    const failed = (await fetchSfx(lib, { log })).filter((r) => !r.ok);
    if (failed.length) fail(`${failed.length} 个音效没准备好：${failed.map((r) => r.name).join('、')}`);
    log('完成 ✓');
  }
  return {
    'align-voice': async () => {
      if (!pos[0]) fail('用法：wka align-voice <片目录> [--prepare --binary 路径 --model 路径 | --status | --import 时间点.json --confirm "用户确认说明"]');
      if (opt('status')) { const result = voiceAlignmentStatus(pos[0]);log(JSON.stringify(result, null, 2));return result.ready ? 0 : 2; }
      if (opt('prepare')) { const result = prepareVoiceAlignment(pos[0], { binary: opt('binary'), model: opt('model') });log(JSON.stringify(result, null, 2));return result.ready ? 0 : 2; }
      let result;
      if (opt('import')) { importVoiceTiming(pos[0], JSON.parse(fs.readFileSync(String(opt('import')), 'utf8')), { confirmation: opt('confirm') });result = voiceAlignmentStatus(pos[0]); }
      else result = await alignVoice(pos[0], { binary: opt('binary'), model: opt('model'), force: !!opt('force'), log });
      if (result.ready) applyVoiceAlignment(pos[0]);
      log(result.ready ? '台词定位可用于制作小样；请随小样检查声画对齐。' : '台词定位仍有待确认项，请查看 review/台词定位.md。');
      return result.ready ? 0 : 2;
    },
    'soundtrack': async () => {
      if (!pos[0]) fail('用法：wka soundtrack <片目录>');
      loadFilm(pos[0], { requireShots: false });
      const { mix } = await (await import('../../audio/soundtrack.mjs')).mixSoundtrack(pos[0], { log });
      // WAV 体积大，聊天里播放会卡：另存一份 AAC 放进 review/ 交给用户审听
      if (mix) {const out=await writeReview(pos[0], '声轨.m4a', ['-i', mix, '-c:a', 'aac', '-b:a', '192k']);registerReview(pos[0],'soundtrack',[out]);log(`声轨审听：${out}`);}
      return;
    },
    'sfx': async () => {
      return cmdSfx(pos[0], { list: !!opt('list') });
    }
  };
}
