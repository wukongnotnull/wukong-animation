import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const skill = fs.readFileSync(new URL('../../plugin/skills/director/SKILL.md', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../../plugin/engine/workbench/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../../plugin/engine/workbench/app.js', import.meta.url), 'utf8');

test('the director opens the workbench automatically before the brief sign-off', () => {
  const start = skill.indexOf('### 第 2 道 · 确定方案');
  const end = skill.indexOf('### 第 3 道');
  assert.ok(start > 0 && end > start);
  const stage = skill.slice(start, end);
  assert.match(stage, /签批前自动打开工作台/);
  assert.match(stage, /wka workbench <片目录> --capture/);
  assert.match(stage, /wka workbench <片目录> --open/);
  assert.match(stage, /工作台地址列在交付物清单第一行/);
  assert.match(stage, /退回文件路径/);
  assert.match(stage, /不代替用户签批/);
});

test('voice has a formal sign-off before storyboarding and final review sets shift together', () => {
  const stage = skill.split('### 第 4 道 · 制作人声')[1]?.split('### 第 5 道')[0];
  assert.ok(stage, '缺少独立制作人声工序');
  assert.match(stage, /--step 4/);
  assert.match(stage, /confirmed.*applied/);
  assert.match(stage, /词表.*pending.*不阻塞/);
  assert.match(stage, /none.*自动跳过/);
  assert.match(stage, /缺.*录音.*暂停/);
  for (const step of [7, 8, 9]) {
    const section = skill.split(`### 第 ${step} 道 · `)[1]?.split('### 第 ')[0];
    assert.ok(section?.includes(`reviewSets[${step}].deliveryRevision`));
  }
  assert.doesNotMatch(skill, /录音与台词定位是制作小样的过程产物/);
});

test('the director asks whether to enter the next step and never asks for cost', () => {
  assert.match(skill, /进入下一工序：<工序名>吗？/);
  assert.match(skill, /完成制作吗？/);
  assert.equal(skill.includes('预计费用'), false);
  assert.doesNotMatch(page, /通过并进入下一步|标记此版本已检查|阶段审阅/);
  assert.doesNotMatch(app, /通过并进入下一步|标记此版本已检查/);
});
