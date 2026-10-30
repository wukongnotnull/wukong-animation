import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { JIANYING_FONTS, missingJianyingFonts } from '../../plugin/engine/exporters/jianying/fonts.mjs';
import { buildDraftPlan } from '../../plugin/engine/exporters/jianying/plan.mjs';

test('the font map covers the fonts the repo uses', () => {
  assert.deepEqual(JIANYING_FONTS, { 'Ma Shan Zheng': '古风小楷', 'Zhi Mang Xing': '毛笔行楷', 'Noto Serif SC': '思源中宋', 'Noto Sans SC': null, Inter: null });
});

test('missingJianyingFonts reports families with no entry; null entries count as mapped', () => {
  assert.deepEqual(missingJianyingFonts(['Ma Shan Zheng', 'Noto Sans SC', 'Long Cang']), ['Long Cang']);
});

test('the draft plan uses the map for subtitle fonts', () => {
  const style = { font: { family: 'Zhi Mang Xing' }, size: 0.05, color: '#2B2B2B', stroke: { color: '#F2EDE3', width: 0.12 }, bottom: 0.1 };
  const plan = buildDraftPlan({ title: 't', size: [1920, 1080], fps: 30, duration: 1, shots: [{id:'s01',file:'s01.mp4',start:0,duration:1}], tracks: [], voices: [], subtitleStyle: style });
  assert.equal(plan.subtitleStyle.font, '毛笔行楷');
});

const hasPy = spawnSync('python3', ['-c', 'import pyJianYingDraft'], { stdio: 'ignore' }).status === 0;
test('every mapped 剪映 font exists in pyJianYingDraft', { skip: hasPy ? false : 'python3 里没有 pyJianYingDraft' }, () => {
  const names = Object.values(JIANYING_FONTS).filter(Boolean);
  const r = spawnSync('python3', ['-c', 'import sys,json\nfrom pyJianYingDraft import FontType\nn={f.name for f in FontType}\nprint(json.dumps([x for x in json.loads(sys.argv[1]) if x not in n]))', JSON.stringify(names)], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(r.stdout), []);
});
