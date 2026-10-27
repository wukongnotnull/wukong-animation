// 音色试听（第 6 道）：同一句文案用几个音色各合成一遍，交给用户挑。
// 输出 review/试听-<n>-<音色短名>.m4a；不写 film.json，不进声轨缓存。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ENGINES } from './tts.mjs';

export const DEFAULT_AUDITION_VOICES = ['zh-CN-YunyangNeural', 'zh-CN-YunjianNeural', 'zh-CN-XiaoxiaoNeural'];
const MAX_VOICES = 4;
const AUDITION_FILE = /^试听-.*\.m4a$/;

/** zh-CN-YunyangNeural → Yunyang；zh-CN-liaoning-XiaobeiNeural → liaoning-Xiaobei */
export const voiceShortName = (voice) => voice.replace(/^zh-CN-/, '').replace(/Neural$/, '');

/**
 * @param {{text:string, voices?:string[], rate?:string, pitch?:string, outDir:string, engines?:object[], log?:Function}} o
 * @returns {{file:string, voice:string}[]} file 是绝对路径
 */
export function auditionVoices({ text, voices = DEFAULT_AUDITION_VOICES, rate, pitch, outDir, engines = ENGINES, log = console.log }) {
  if (!text) throw new Error('没有试听文本：film.json 里还没有人声条目时，用 --text 指定一句');
  if (voices.length > MAX_VOICES) throw new Error(`一次最多 ${MAX_VOICES} 个音色，收到 ${voices.length} 个`);
  const engine = engines.find((e) => e.name === 'edge-tts' && e.available());
  if (!engine) throw new Error('试听需要 edge-tts（pip install edge-tts）；也可以改用自供录音');

  outDir = path.resolve(outDir);
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (AUDITION_FILE.test(f)) fs.rmSync(path.join(outDir, f), { force: true });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-audition-'));
  try {
    return voices.map((voice, i) => {
      const raw = path.join(tmp, `${i + 1}.mp3`);
      if (!engine.synth(text, voice, raw, { rate, pitch }) || !fs.existsSync(raw)) throw new Error(`试听合成失败：${voice}`);
      const file = path.join(outDir, `试听-${i + 1}-${voiceShortName(voice)}.m4a`);
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-c:a', 'aac', '-b:a', '192k', file], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`试听转码失败（${voice}）：${r.stderr.slice(-400)}`);
      log(`${file}  ${voice}`);
      return { file, voice };
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
