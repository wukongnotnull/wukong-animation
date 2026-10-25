// mp4 导出器：画面直接复制（已是 H.264），音频编码为 AAC。
import { run } from '../../core/ffmpeg.mjs';

export async function encodeOutput({ video, audio, out }) {
  const args = ['-i', video];
  if (audio) args.push('-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k', '-shortest');
  args.push('-c:v', 'copy', '-movflags', '+faststart', out);
  await run(args);
}
