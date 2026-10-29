import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntry, rewriteFontCss, webpackAliases, headlessShellFrom } from '../../plugin/engine/pipelines/remotion/entry.mjs';

const job = {
  film: { fps: 30, cues: { boom: 1.2 } },
  designW: 1920,
  designH: 1080,
  seed: 7,
  styleEntry: '/plug/skills/keynote/scripts/index.ts',
  filmDir: '/films/demo',
  shots: [
    { id: 's01', path: '/films/demo/shots/s01.tsx', duration: 2, start: 0 },
    { id: 's02', path: '/films/demo/shots/s02.tsx', duration: 1.25, start: 2 },
    { id: 's03', path: '/films/demo/shots/s03.tsx', duration: 0.1, start: 3.25 },
  ],
};

/** 从生成的源码里取出嵌入的镜头清单。 */
const shotsOf = (src) => JSON.parse(src.match(/const SHOTS = (.*);\n/)[1]);

test('107 个非整数帧镜头按全片切点分配，不能累计舍入误差', () => {
  const long = { ...job, shots: Array.from({ length: 107 }, (_, i) => ({ id: `s${i + 1}`, path: '/shot.tsx', duration: 1.02, start: i * 1.02 })) };
  const shots = shotsOf(buildEntry(long, ''));
  assert.equal(shots.reduce((sum, s) => sum + s.frames, 0), 3274);
  let frames = 0;
  for (const [i, shot] of shots.entries()) {
    frames += shot.frames;
    assert.equal(frames, Math.round((i + 1) * 1.02 * 30));
  }
});

test('每个镜头一个 Composition：id、帧数（累计切点之差）、设计尺寸', () => {
  const shots = shotsOf(buildEntry(job, ''));
  assert.deepEqual(shots.map((s) => [s.id, s.frames]), [['s01', 60], ['s02', 38], ['s03', 3]]);
  assert.ok(shots.every((s) => s.s.designW === 1920 && s.s.designH === 1080 && s.s.fps === 30));
});

test('镜头的 s 与 browser 管线同名同义', () => {
  const [, s02] = shotsOf(buildEntry(job, ''));
  assert.deepEqual(s02.s, { id: 's02', W: 1920, H: 1080, designW: 1920, designH: 1080, aspect: '16:9', orientation: 'landscape', fps: 30, seed: 7, cues: { boom: 1.2 }, duration: 1.25, start: 2 });
});

test('竖屏镜头的 s.aspect / s.orientation', () => {
  const [s01] = shotsOf(buildEntry({ ...job, designW: 1080, designH: 1920 }, ''));
  assert.equal(s01.s.aspect, '9:16');
  assert.equal(s01.s.orientation, 'portrait');
});

test('按绝对路径引入镜头文件，注册根组件', () => {
  const src = buildEntry(job, '');
  assert.match(src, /import S0 from "\/films\/demo\/shots\/s01\.tsx";/);
  assert.match(src, /import S2 from "\/films\/demo\/shots\/s03\.tsx";/);
  assert.match(src, /registerRoot\(/);
});

test('有风格脚本时引入 @wka/style，没有时不引入', () => {
  assert.match(buildEntry(job, ''), /from "@wka\/style"/);
  assert.doesNotMatch(buildEntry({ ...job, styleEntry: null }, ''), /@wka\/style/);
});

test('字体 CSS 嵌入入口', () => {
  const src = buildEntry(job, "@font-face{font-family:'Inter';src:url('wka-static:fonts/0-Inter.ttf');}");
  assert.match(src, /wka-static:fonts\/0-Inter\.ttf/);
});

test('webpack 别名：@wka/style 指向风格入口，@wka/film 指向片目录', () => {
  assert.deepEqual(webpackAliases(job), { '@wka/style': '/plug/skills/keynote/scripts/index.ts', '@wka/film': '/films/demo' });
  assert.deepEqual(webpackAliases({ ...job, styleEntry: null }), { '@wka/film': '/films/demo' });
});

test('字体 CSS 的 file:// 路径改写为静态目录地址，并列出要复制的文件', () => {
  const css = "@font-face{font-family:'Inter';src:url('file:///c/fonts/Inter-subset.ttf');font-display:block;}\n"
    + "@font-face{font-family:'Noto Sans SC';src:url('file:///c/fonts/NotoSansSC.ttf');font-display:block;}\n";
  const r = rewriteFontCss(css);
  assert.equal(r.css.includes('file://'), false);
  assert.match(r.css, /url\('wka-static:fonts\/0-Inter-subset\.ttf'\)/);
  assert.match(r.css, /url\('wka-static:fonts\/1-NotoSansSC\.ttf'\)/);
  assert.deepEqual(r.files, [
    { from: '/c/fonts/Inter-subset.ttf', to: 'fonts/0-Inter-subset.ttf' },
    { from: '/c/fonts/NotoSansSC.ttf', to: 'fonts/1-NotoSansSC.ttf' },
  ]);
});

test('从 playwright 的 Chromium 路径推出同版本 headless shell', () => {
  const exe = '/cache/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  const fake = {
    '/cache/ms-playwright/chromium_headless_shell-1248': ['chrome-headless-shell-mac-arm64'],
    '/cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64': ['chrome-headless-shell', 'ABOUT'],
  };
  const fsLike = { readdirSync: (d) => { if (!fake[d]) throw new Error('ENOENT'); return fake[d]; } };
  assert.equal(headlessShellFrom(exe, fsLike), '/cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
  assert.equal(headlessShellFrom('/cache/ms-playwright/chromium-9999/chrome-linux/chrome', fsLike), null);
  assert.equal(headlessShellFrom('/usr/bin/chromium', fsLike), null);
});

test('Windows 的 headless shell 带 .exe', () => {
  const exe = 'C:\\pw\\chromium-1248\\chrome-win64\\chrome.exe';
  const sep = '\\';
  const fake = {
    ['C:\\pw\\chromium_headless_shell-1248']: ['chrome-headless-shell-win64'],
    ['C:\\pw\\chromium_headless_shell-1248\\chrome-headless-shell-win64']: ['chrome-headless-shell.exe'],
  };
  const fsLike = { readdirSync: (d) => { if (!fake[d]) throw new Error('ENOENT'); return fake[d]; } };
  assert.equal(headlessShellFrom(exe, fsLike, sep), 'C:\\pw\\chromium_headless_shell-1248\\chrome-headless-shell-win64\\chrome-headless-shell.exe');
});

test('check()：缺任一 remotion 依赖或 ffmpeg 时不可用，并列出缺失项', async () => {
  const { check } = await import('../../plugin/engine/pipelines/remotion/index.mjs');
  const r = await check({ has: (n) => n !== '@remotion/renderer', ffmpeg: () => true });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['@remotion/renderer']);
  assert.match(r.hint, /setup/);
  const r2 = await check({ has: () => true, ffmpeg: () => false });
  assert.deepEqual(r2.missing, ['ffmpeg']);
  assert.equal((await check({ has: () => true, ffmpeg: () => true })).ok, true);
});
