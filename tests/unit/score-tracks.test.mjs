// 配乐脚本默认按 配乐 / 环境声 / 音效 各写一个文件，剪映草稿里才能分轨。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as synth from '../../plugin/engine/audio/synth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// 《春江花月夜》的配乐挂在人声同步点上：每句 4 秒，落印在片尾前。
const CHUNJIANG_CUES = {
  ...Object.fromEntries(Array.from({ length: 36 }, (_, i) => [`第${i + 1}句`, [5 + i * 4, 8 + i * 4]])),
  落印: [150, 150.5],
};
const SCRIPTS = {
  'film template': { rel: 'plugin/engine/templates/film/audio/build.mjs', duration: 12, cues: {} },
  'chunjiang example': { rel: 'plugin/skills/ink-wash/examples/chunjiang/audio/build.mjs', duration: 155, cues: CHUNJIANG_CUES },
};

for (const [name, { rel, duration, cues }] of Object.entries(SCRIPTS)) {
  test(`${name} writes bgm, ambience and sfx as separate files`, async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-score-'));
    const build = (await import(pathToFileURL(path.join(ROOT, rel)).href)).default;
    const tracks = await build({ synth, duration, outDir, shots: [], cues, log: () => {} });
    assert.deepEqual(tracks.map((t) => path.basename(t.file)), ['bgm.wav', 'ambience.wav', 'sfx.wav']);
    for (const t of tracks) assert.ok(fs.existsSync(t.file), `missing ${t.file}`);
    fs.rmSync(outDir, { recursive: true, force: true });
  });
}
