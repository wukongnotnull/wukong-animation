// 风格规格书 STYLE.md 的一级章节固定：分镜表各栏到哪一节查取值，所有风格都一样。见 director/STORYBOARD.md。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SECTIONS = ['1. 风格本质', '2. 色彩', '3. 文字', '4. 构图', '5. 技法', '6. 运动语言', '7. 声音', '8. 禁忌清单', '9. 示范片', '10. 交付前质检'];

/** 一级章节（`## `），去掉括号说明。 */
const sectionsOf = (file) =>
  fs.readFileSync(file, 'utf8').split('\n')
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3).replace(/[（(].*$/, '').trim());

const skillsDir = path.join(ROOT, 'plugin/skills');
const styleFiles = [
  path.join(ROOT, 'plugin/engine/templates/style-skill/STYLE.md'),
  ...fs.readdirSync(skillsDir).map((d) => path.join(skillsDir, d, 'STYLE.md')).filter((f) => fs.existsSync(f)),
];

for (const file of styleFiles) {
  test(`${path.relative(ROOT, file)} 的一级章节是固定的 10 节`, () => {
    assert.deepEqual(sectionsOf(file), SECTIONS);
  });
}

test('至少检查了模板和两个现有风格', () => {
  assert.ok(styleFiles.length >= 3, styleFiles.join('\n'));
});
