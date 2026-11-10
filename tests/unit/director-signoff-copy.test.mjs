import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const skill = fs.readFileSync(new URL('../../plugin/skills/director/SKILL.md', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../../plugin/engine/workbench/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../../plugin/engine/workbench/app.js', import.meta.url), 'utf8');

test('the director asks whether to enter the next step and never asks for cost', () => {
  assert.match(skill, /进入下一工序：<工序名>吗？/);
  assert.match(skill, /完成制作吗？/);
  assert.equal(skill.includes('预计费用'), false);
  assert.doesNotMatch(page, /通过并进入下一步|标记此版本已检查|阶段审阅/);
  assert.doesNotMatch(app, /通过并进入下一步|标记此版本已检查/);
});
