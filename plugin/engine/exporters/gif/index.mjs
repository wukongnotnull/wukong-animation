// gif 导出器：两遍法（palettegen + paletteuse），无声。
import { run } from '../../core/ffmpeg.mjs';

export async function encodeOutput({ video, out, width = 640, fps = 12 }) {
  const f = `fps=${Math.min(fps, 12)},scale=${width}:-2:flags=lanczos`;
  await run(['-i', video, '-vf', `${f},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', '0', out]);
}
