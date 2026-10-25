// png-seq 导出器：out 为目录名（<name>.frames → <name>-frames/）。
import fs from 'node:fs';
import { run } from '../../core/ffmpeg.mjs';

export async function encodeOutput({ video, out }) {
  const dir = out.replace(/\.frames$/, '-frames');
  fs.mkdirSync(dir, { recursive: true });
  await run(['-i', video, `${dir}/%05d.png`]);
}
