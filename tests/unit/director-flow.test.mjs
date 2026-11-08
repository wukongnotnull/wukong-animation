// director/SKILL.md 的工序与审片节点要和引擎（core/state.mjs）一致：签批的 --step、节点名都从引擎来。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_STEPS, REVIEW_GATES, LAST_STEP } from '../../plugin/engine/core/state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKILL = fs.readFileSync(path.join(ROOT, 'plugin/skills/director/SKILL.md'), 'utf8');
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const squash = (s) => s.replace(/\s+/g, '');

/** 表头第一格为 first 的表的各行 */
function rows(first) {
  const lines = SKILL.split('\n');
  const start = lines.findIndex((l) => l.startsWith('|') && cells(l)[0] === first);
  assert.ok(start >= 0, `没有首格为「${first}」的表`);
  const out = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) out.push(cells(lines[i]));
  return out;
}

test('标题写明工序数和审片节点数', () => {
  assert.match(SKILL, new RegExp(`## 四、制作流程：${LAST_STEP} 道工序、${Object.keys(REVIEW_GATES).length} 个审片节点`));
});

test('工序总表逐道对应引擎的工序，审片节点与 --step 一致', () => {
  const table = rows('#');
  assert.deepEqual(table.map((r) => Number(r[0])), Object.keys(PRODUCTION_STEPS).map(Number));
  for (const r of table) {
    const gate = REVIEW_GATES[r[0]];
    assert.equal(r[1], PRODUCTION_STEPS[r[0]]);
    assert.ok(gate ? r.at(-1).includes(gate[0]) : r.at(-1) === '—');
  }
});

test('每道工序都有细则，每个节点都写明签批的 --step', () => {
  for (const n of Object.keys(PRODUCTION_STEPS)) assert.match(SKILL, new RegExp(`^### 第 ${n} 道 · `, 'm'), `缺第 ${n} 道细则`);
  for (const [n, gate] of Object.entries(REVIEW_GATES)) {
    const section = SKILL.split(`### 第 ${n} 道 · `)[1].split('### 第 ')[0];
    assert.ok(section.includes(`--step ${n}`), gate);
  }
});

test('命令表写明哪些命令能用 --aspect 出副版', () => {
  for (const cmd of ['still', 'animatic', 'render', 'qc', 'final']) {
    const line = SKILL.split('\n').find((l) => l.startsWith(`| \`wka ${cmd} `));
    assert.ok(line && line.includes('--aspect'), `wka ${cmd} 的命令行没写 --aspect`);
  }
});
