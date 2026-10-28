// 分镜表栏目按观看顺序排：编号信息 → 怎么进这一镜 → 看到什么 → 听到什么（#68）。
// 规范、模板和每部示范片的表头必须一致，否则写分镜时照着的样例和规范对不上。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COLUMNS = ['镜', '段落', '时长', '转场', '景别', '画面', '运镜 / 动态', '屏幕文字', '人声', '音效'];
const SPEC = path.join(ROOT, 'plugin/skills/director/STORYBOARD.md');

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
/** 第一张以「| 镜 |」开头的表头。 */
const headerOf = (file) => {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => /^\|\s*镜\s*\|/.test(l));
  assert.ok(line, `${path.relative(ROOT, file)} 里没有分镜表`);
  return cells(line);
};

const skillsDir = path.join(ROOT, 'plugin/skills');
const boards = [
  SPEC,
  path.join(ROOT, 'plugin/engine/templates/film/storyboard.md'),
  ...fs.readdirSync(skillsDir).flatMap((id) => {
    const ex = path.join(skillsDir, id, 'examples');
    return fs.existsSync(ex) ? fs.readdirSync(ex).map((f) => path.join(ex, f, 'storyboard.md')).filter((f) => fs.existsSync(f)) : [];
  }),
];

for (const file of boards) {
  test(`${path.relative(ROOT, file)} 的分镜表栏目按规范顺序`, () => {
    assert.deepEqual(headerOf(file), COLUMNS);
  });
}

test('至少检查了规范、模板和三部示范片', () => {
  assert.ok(boards.length >= 5, boards.join('\n'));
});

test('「逐镜各栏写法」表的栏目顺序与分镜表一致', () => {
  const src = fs.readFileSync(SPEC, 'utf8');
  const block = src.slice(src.indexOf('**逐镜各栏写法'));
  const rows = block.split('\n').filter((l) => l.startsWith('| ') && !/^\|\s*栏目\s*\|/.test(l)).map((l) => cells(l)[0]);
  assert.deepEqual(rows.slice(0, COLUMNS.length), COLUMNS);
});
