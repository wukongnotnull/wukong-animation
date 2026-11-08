import test from 'node:test';
import assert from 'node:assert/strict';
import * as subtitles from '../../plugin/engine/core/subtitles.mjs';
import { buildFrameTimeline } from '../../plugin/engine/core/timing.mjs';
import { resolveVariant } from '../../plugin/engine/core/variants.mjs';

const timeline = buildFrameTimeline([{id:'s01',duration:1},{id:'s02',duration:1}], 10);
const cue = (index,start,end,text='主播实录') => ({index,start,end,text});

test('主播字幕用半开区间定位跨镜，短句只检查一次', () => {
  const report = subtitles.planPresenterSubtitles([cue(1,.8,1.2),cue(2,1.2,1.3)], timeline, []);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.rows[0].shots, [{id:'s01',start:.8,end:1},{id:'s02',start:1,end:1.2}]);
  assert.deepEqual(report.rows.map(row=>row.frames), [[8,10,11],[12]]);
});

test('多行、重叠、局部插播冲突和无可显示帧均阻止导出', () => {
  const {errors} = subtitles.planPresenterSubtitles([
    cue(1,.8,1.2,'第一行\n第二行'),cue(2,1.1,1.3),cue(3,1.61,1.62),
  ], timeline, [{start:1.15,end:1.4,label:'原片'}]);
  assert.match(errors.join('\n'), /第 1 条.*单行/);
  assert.match(errors.join('\n'), /第 2 条.*重叠/);
  assert.match(errors.join('\n'), /第 1 条.*原片.*s02/);
  assert.match(errors.join('\n'), /第 3 条.*没有可显示帧/);
});

test('副版可继承或显式覆盖主播 SRT 和留空区间', () => {
  const film = {size:[960,540],subtitles:{mode:'burn',source:'presenter',file:'host.srt',blank_ranges:[{start:1,end:2}]},variants:{'9:16':{},'1:1':{subtitles:{file:'square.srt',blank_ranges:[]}}}};
  const settings = aspect => subtitles.subtitleSettings(film,resolveVariant({film,style:{aspects:['16:9','9:16','1:1']},filmDir:'/tmp/film'},aspect));
  assert.equal(settings('9:16').file,'host.srt');
  assert.deepEqual(settings('9:16').blankRanges,[{start:1,end:2}]);
  assert.equal(settings('1:1').file,'square.srt');
  assert.deepEqual(settings('1:1').blankRanges,[]);
});

test('待人工核对只接受当前复核摘要，确认漏字不能绕过', async () => {
  const {presenterVerdict} = await import('../../plugin/engine/core/presenter-subtitles.mjs');
  assert.equal(presenterVerdict([{status:'uncertain'}],'current','prior'),'uncertain');
  assert.equal(presenterVerdict([{status:'uncertain'}],'current','current'),'confirmed');
  assert.equal(presenterVerdict([{status:'missing'}],'current','current'),'missing');
});
