// ffmpeg / ffprobe 的薄封装。
import { spawn, spawnSync } from 'node:child_process';

export function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

let drawtextCache = null;

/** 当前 ffmpeg 是否带 drawtext 滤镜（依赖 freetype，Homebrew 默认构建不带）。 */
export function hasDrawtext() {
  if (drawtextCache === null) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' });
    drawtextCache = /\sdrawtext\s/.test(r.stdout || '');
  }
  return drawtextCache;
}

/** drawtext 文字标注滤镜片段（以逗号开头）；ffmpeg 不带 drawtext 时返回空串，只是不加标注。 */
export function drawLabel(text, { x = 10, y = 10, size = 20, box = 0.5 } = {}) {
  if (!hasDrawtext()) return '';
  return `,drawtext=text='${text}':x=${x}:y=${y}:fontsize=${size}:fontcolor=white:box=1:boxcolor=black@${box}`;
}

/** 运行 ffmpeg 直到结束；失败时抛出带 stderr 尾部的错误。 */
export function run(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 失败 (${code}): ${err.slice(-800)}`))));
    if (input) input(p.stdin);
  });
}

/** 启动一个从 stdin 读图片流的编码进程，返回 { write(buf), end(), abort() }。abort 会杀掉进程并等它退出。 */
export function openImagePipe(args) {
  const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  let pipeErr = null;
  p.stdin.on('error', (e) => (pipeErr = e));
  const done = new Promise((resolve, reject) => {
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 失败 (${code}): ${err.slice(-800)}`))));
  });
  // ffmpeg 中途退出时，错误由 write / end 报给调用方；这里先挂上处理器，避免变成未处理的 rejection 直接崩进程
  done.catch(() => {});
  return {
    write: (buf) =>
      new Promise((resolve, reject) => {
        if (pipeErr) return reject(pipeErr);
        if (p.stdin.write(buf)) return resolve();
        p.stdin.once('drain', resolve);
        done.then(resolve, reject); // 进程中途退出就不会再有 drain，别一直等
      }),
    end: async () => {
      p.stdin.end();
      await done;
    },
    abort: async () => {
      if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
      await done.catch(() => {});
    },
  };
}

export function probeDuration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
  });
  return parseFloat(r.stdout) || 0;
}
