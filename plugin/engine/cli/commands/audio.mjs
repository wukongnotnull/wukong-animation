import path from 'node:path';
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
    },
    'audition': async () => {
      if (!pos[0]) fail('用法：wka audition <片目录> [--voices a,b,c] [--text "…"] [--rate -20%] [--pitch -2Hz]');
      const ctx = loadFilm(pos[0], { requireShots: false });
      const { auditionVoices, DEFAULT_AUDITION_VOICES } = await import('../../audio/audition.mjs');
      const voices = typeof opt('voices') === 'string' ? opt('voices').split(',').map((v) => v.trim()).filter(Boolean) : DEFAULT_AUDITION_VOICES;
      const first = ctx.film.audio?.voices?.[0] || {};
      const str = (name) => (typeof opt(name) === 'string' ? opt(name) : undefined);
      // 没给参数时用第一条人声的文本和它已经调过的语速、音高
      const text = str('text') ?? first.text;
      const audition=auditionVoices({ text, voices, rate: str('rate') ?? first.rate, pitch: str('pitch') ?? first.pitch, outDir: path.join(ctx.filmDir, 'review'), log });
      registerReview(pos[0],'audition',audition.map(a=>a.file));
      return;
    }
  };
}
