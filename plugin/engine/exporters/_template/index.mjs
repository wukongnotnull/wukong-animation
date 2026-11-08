// __NAME__ 导出器。
// 参数：video（拼接好的无声 H.264）、audio（混好的 wav，可能为 null）、out（输出路径）、fps、proxy，
//      timeline（wka final 时提供：{title, size, fps, duration, shots, tracks, voices}，需要分镜 / 分轨时用）。
// 可返回实际产物路径（产物不在 out 时）。
import { run } from '../../core/ffmpeg.mjs';

export async function encodeOutput({ video, audio, out, fps, proxy, timeline }) {
  // TODO
}
