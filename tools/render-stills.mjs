#!/usr/bin/env node
// 为每个风格渲染画廊图：取示范片里最"完整"的一帧（最后一镜的 80% 处），
// 输出 docs/gallery/<id>.jpg（1280 宽），可选 --gif 同时输出预览 GIF。
// 用法：node tools/render-stills.mjs [风格id…] [--gif]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WK = path.join(ROOT, 'plugin/engine/bin/wka.mjs');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const gif = process.argv.includes('--gif');
const out = path.join(ROOT, 'docs/gallery');
fs.mkdirSync(out, { recursive: true });

const skills = path.join(ROOT, 'plugin/skills');
for (const id of fs.readdirSync(skills)) {
  if (only.length && !only.includes(id)) continue;
  const ex = path.join(skills, id, 'examples');
  if (!fs.existsSync(path.join(skills, id, 'style.json')) || !fs.existsSync(ex)) continue;
  const name = fs.readdirSync(ex).find((d) => fs.existsSync(path.join(ex, d, 'film.json')));
  if (!name) continue;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-'));
  const film = path.join(tmp, name);
  fs.cpSync(path.join(ex, name), film, { recursive: true });
  const fj = JSON.parse(fs.readFileSync(path.join(film, 'film.json'), 'utf8'));
  const last = fj.shots[fj.shots.length - 1];
  const r = spawnSync(process.execPath, [WK, 'still', film, '--at', `${last.id}:${(last.duration * 0.8).toFixed(2)}`], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status);
  const png = fs.readdirSync(path.join(film, 'stills')).find((f) => f.endsWith('.png'));
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(film, 'stills', png), '-vf', 'scale=1280:-2', '-q:v', '3', path.join(out, `${id}.jpg`)]);
  console.log(`✓ docs/gallery/${id}.jpg`);
  if (gif) {
    spawnSync(process.execPath, [WK, 'final', film, '--proxy', '--formats', 'gif'], { stdio: 'inherit' });
    const g = fs.readdirSync(film).find((f) => f.endsWith('.gif'));
    if (g) fs.copyFileSync(path.join(film, g), path.join(out, `${id}.gif`));
    console.log(`✓ docs/gallery/${id}.gif`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
