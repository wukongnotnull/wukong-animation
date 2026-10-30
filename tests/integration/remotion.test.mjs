// 需要 remotion 依赖 + playwright 的 headless shell + ffmpeg（wka setup）；缺依赖时整组跳过。
// 用临时 WUKONG_ANIMATION_HOME 里的一个最小用户风格，只测管线本身，不依赖 keynote 的组件。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check } from '../../plugin/engine/pipelines/remotion/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WKA = path.join(ROOT, 'plugin/engine/bin/wka.mjs');
const ready = (await check()).ok;
const opts = { skip: ready ? false : 'remotion 管线依赖未安装（运行 wka setup）', timeout: 300_000 };

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-rm-home-'));
const STYLE = {
  id: 'rm-test', name: '测试', category: 'xinxi', order: 999, engine: '>=0.1.0',
  pipeline: 'remotion', kits: {}, fps: 30, keywords: ['test'],
};
fs.mkdirSync(path.join(HOME, 'styles', 'rm-test'), { recursive: true });
fs.writeFileSync(path.join(HOME, 'styles', 'rm-test', 'style.json'), JSON.stringify(STYLE));

const SHOT = (color, extra = '') => `import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
export default function Shot({ dur, s }) {
  const f = useCurrentFrame();
  ${extra}
  return <AbsoluteFill style={{ background: '${color}' }}><div style={{ width: (f / dur) * s.W, height: 20, background: '#D97757' }} /></AbsoluteFill>;
}
`;

function makeFilm(shots) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-rm-'));
  fs.mkdirSync(path.join(dir, 'shots'));
  for (const [id, src] of Object.entries(shots)) fs.writeFileSync(path.join(dir, 'shots', `${id}.tsx`), src);
  const film = {
    title: 'rm', style: 'rm-test', size: [320, 180], fps: 10, seed: 1,
    shots: Object.keys(shots).map((id) => ({ id, file: `shots/${id}.tsx`, duration: 1 })),
  };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  return dir;
}

const wka = (...args) => spawnSync(process.execPath, [WKA, ...args], {
  encoding: 'utf8',
  env: { ...process.env, WUKONG_ANIMATION_HOME: HOME, WKA_NO_FONT_DOWNLOAD: '1' },
});
const segDir = (dir) => path.join(dir, '.cache', 'segments');
const segments = (dir) => (fs.existsSync(segDir(dir)) ? fs.readdirSync(segDir(dir)) : []);
const probe = (file) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames,r_frame_rate', '-of', 'json', file], { encoding: 'utf8' });
  return JSON.parse(r.stdout).streams[0];
};

test('渲染出与 film.json 一致的片段，再渲全部命中缓存，改一镜只重渲那一镜', opts, () => {
  const dir = makeFilm({ s01: SHOT('#111111'), s02: SHOT('#242426') });
  let r = wka('render', dir);
  assert.equal(r.status, 0, r.stderr);
  const segs = segments(dir).filter((f) => f.endsWith('.mp4'));
  assert.equal(segs.length, 2);
  for (const f of segs) {
    const st = probe(path.join(segDir(dir), f));
    assert.equal(st.width, 320);
    assert.equal(st.height, 180);
    assert.equal(Number(st.nb_read_frames), 10);
  }
  r = wka('render', dir);
  assert.match(r.stdout, /s01 缓存命中/);
  assert.match(r.stdout, /s02 缓存命中/);

  fs.writeFileSync(path.join(dir, 'shots', 's02.tsx'), SHOT('#333333'));
  r = wka('render', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /s01 缓存命中/);
  assert.doesNotMatch(r.stdout, /s02 缓存命中/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('同一帧渲染两次逐像素一致', opts, () => {
  const dir = makeFilm({ s01: SHOT('#111111') });
  const shoot = () => {
    const r = wka('still', dir, '--at', 's01:0.5');
    assert.equal(r.status, 0, r.stderr);
    return fs.readFileSync(path.join(dir, 'stills', 's01-0.50s.png'));
  };
  const a = shoot();
  const b = shoot();
  assert.ok(a.equals(b));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('小样不放大小尺寸，低于15fps时保留原帧率', opts, () => {
  const dir = makeFilm({ s01: SHOT('#111111') });
  const r = wka('render', dir, '--proxy');
  assert.equal(r.status, 0, r.stderr);
  const seg = segments(dir).find((f) => f.endsWith('.mp4'));
  const st = probe(path.join(segDir(dir), seg));
  assert.deepEqual([st.width, st.height, st.r_frame_rate, Number(st.nb_read_frames)], [320, 180, '10/1', 10]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('60fps工程直接只绘制15fps小样，组件看到实际输出帧率', opts, () => {
  const dir = makeFilm({ s01: SHOT('#111111', "if(s.fps!==15 || dur!==6) throw new Error('多生成了不需要的帧');") });
  try {
    const file=path.join(dir,'film.json'),film=JSON.parse(fs.readFileSync(file));
    film.fps=60;film.size=[1920,1080];film.shots[0].duration=0.4;fs.writeFileSync(file,JSON.stringify(film));
    const r=wka('preview',dir);assert.equal(r.status,0,r.stderr);
    const seg=segments(dir).find(f=>f.endsWith('.mp4')),st=probe(path.join(segDir(dir),seg));
    assert.deepEqual([st.width,st.height,st.r_frame_rate,Number(st.nb_read_frames)],[960,540,'15/1',6]);
    assert.equal(fs.existsSync(path.join(dir,'.cache/video-proxy.mp4')),false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('镜头组件出错：报错带镜头 id，不留半成品', opts, () => {
  const dir = makeFilm({ s01: SHOT('#111111'), s02: SHOT('#111111', "if (f >= 5) throw new Error('boom at ' + f);") });
  const r = wka('render', dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /s02/);
  assert.match(r.stderr, /boom at 5/);
  const segs = segments(dir);
  assert.equal(segs.filter((f) => f.includes('.part')).length, 0, `leftover: ${segs}`);
  assert.equal(segs.filter((f) => f.startsWith('s02-')).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('风格 assets/ 变了，镜头缓存失效', opts, () => {
  const assets = path.join(HOME, 'styles', 'rm-test', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, 'bg.txt'), 'v1');
  const dir = makeFilm({ s01: SHOT('#111111') });
  assert.equal(wka('render', dir).status, 0);
  assert.match(wka('render', dir).stdout, /s01 缓存命中/);
  fs.writeFileSync(path.join(assets, 'bg.txt'), 'v2');
  const r = wka('render', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /s01 缓存命中/);
  fs.rmSync(assets, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('小样尺寸与 job 一致：宽高比例不同的取整也不出错', opts, () => {
  const dir = makeFilm({ s01: SHOT('#111111') });
  const f = path.join(dir, 'film.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), size: [1000, 562] }));
  const r = wka('render', dir, '--proxy');
  assert.equal(r.status, 0, r.stderr);
  const seg = segments(dir).find((x) => x.endsWith('.mp4'));
  const st = probe(path.join(segDir(dir), seg));
  assert.deepEqual([st.width, st.height], [960, 540]);
  fs.rmSync(dir, { recursive: true, force: true });
});
