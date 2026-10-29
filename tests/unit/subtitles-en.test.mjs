// 中英双语字幕：英文稿 subtitles.en.json 的同步、核对、检查，外挂英文 srt。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subtitleSettings, subtitleOutputs, syncEnglish, attachEnglish, checkEnglish, englishSrt, parseSrt, splitEnglishForVariant } from '../../plugin/engine/core/subtitles.mjs';

const subs = (...texts) => texts.map((text, i) => ({ index: i + 1, start: i, end: i + 0.8, text }));

test('设置：bilingual 缺省 false；英文字数缺省横 45、竖 28、方 34，可用 max_chars_en 改', () => {
  const s = subtitleSettings({ size: [1920, 1080], subtitles: { mode: 'burn' } });
  assert.equal(s.bilingual, false);
  assert.equal(s.enFile, 'subtitles.en.json');
  assert.equal(s.maxCharsEn, 45);
  assert.equal(subtitleSettings({ size: [1080, 1920], subtitles: { mode: 'burn', bilingual: true } }).maxCharsEn, 28);
  assert.equal(subtitleSettings({ size: [1080, 1080], subtitles: { mode: 'burn' } }).maxCharsEn, 34);
  assert.equal(subtitleSettings({ size: [1920, 1080], subtitles: { mode: 'burn', max_chars_en: 50 } }).maxCharsEn, 50);
});

test('同步英文稿：条数与字幕相同，中文相同的保留英文（重复句各取各的），改过的置空', () => {
  const old = [
    { zh: '山不说话', en: 'The mountain is silent' },
    { zh: '再来一遍', en: 'Once more' },
    { zh: '再来一遍', en: 'And again' },
    { zh: '旧句子', en: 'Old line' },
  ];
  const pairs = syncEnglish(subs('山不说话', '新句子', '再来一遍', '再来一遍'), old);
  assert.deepEqual(pairs, [
    { zh: '山不说话', en: 'The mountain is silent' },
    { zh: '新句子', en: '' },
    { zh: '再来一遍', en: 'Once more' },
    { zh: '再来一遍', en: 'And again' },
  ]);
  assert.deepEqual(syncEnglish(subs('甲'), null), [{ zh: '甲', en: '' }]);
});

test('挂英文：条数不等、中文对不上、英文为空分别报错；对上就给每条加 en', () => {
  const s = subs('甲', '乙');
  assert.deepEqual(attachEnglish(s, [{ zh: '甲', en: 'A' }, { zh: '乙', en: 'B' }]).map((x) => x.en), ['A', 'B']);
  assert.throws(() => attachEnglish(s, [{ zh: '甲', en: 'A' }]), /英文字幕 1 条.*中文字幕 2 条.*wka subtitles/s);
  assert.throws(() => attachEnglish(s, [{ zh: '甲', en: 'A' }, { zh: '丙', en: 'C' }]), /第 2 条.*「丙」.*「乙」/s);
  assert.throws(() => attachEnglish(s, [{ zh: '甲', en: 'A' }, { zh: '乙', en: ' ' }]), /还有 1 条英文没填：第 2 条/);
  assert.throws(() => attachEnglish(s, null), /没有英文字幕.*wka subtitles/s);
  assert.equal(s[0].en, undefined, '不改原数组');
});

test('检查英文：超长、句号结尾警告；省略号和问号不警告', () => {
  const w = checkEnglish([
    { zh: '甲', en: 'x'.repeat(46) },
    { zh: '乙', en: 'Done.' },
    { zh: '丙', en: 'Wait...' },
    { zh: '丁', en: 'Why?' },
  ], { maxChars: 45 });
  assert.equal(w.length, 2);
  assert.match(w[0], /第 1 条英文 46 个字符，超过 45/);
  assert.match(w[1], /第 2 条英文以句号结尾/);
});

test('外挂：双语时多一个英文 srt，时间与中文相同；单语时输出名不变', () => {
  assert.deepEqual(subtitleOutputs('srt'), { burned: null, clean: '_无字幕', srt: '_字幕' });
  assert.equal(subtitleOutputs('both', true).srtEn, '_英文字幕');
  assert.equal(subtitleOutputs('burn', true).srtEn, null);
  const en = parseSrt(englishSrt(attachEnglish(subs('甲', '乙'), [{ zh: '甲', en: 'A' }, { zh: '乙', en: 'B' }])));
  assert.deepEqual(en, [{ index: 1, start: 0, end: 0.8, text: 'A' }, { index: 2, start: 1, end: 1.8, text: 'B' }]);
});

test('英文稿格式不对：不是数组、en 不是字符串，给出能看懂的错误', () => {
  assert.throws(() => syncEnglish(subs('甲'), { zh: '甲' }), /subtitles\.en\.json 要是数组/);
  assert.throws(() => attachEnglish(subs('甲'), { zh: '甲' }), /subtitles\.en\.json 要是数组/);
  assert.throws(() => attachEnglish(subs('甲'), [{ zh: '甲', en: 42 }]), /第 1 条的 en 要是文字/);
  assert.throws(() => syncEnglish(subs('甲'), [{ zh: '甲', en: 42 }]), /第 1 条的 en 要是文字/);
});

test('副版英文保护多词术语，不够分条时明确报错而不生成空条',()=>{
 const input={voices:[{cue:'v01'}],cues:{v01:[0,2]},mainSubs:[{start:0,end:2,text:'甲乙'}],mainPairs:[{zh:'甲乙',en:'OpenAI Codex works well'}],variantSubs:[{start:0,end:1,text:'甲'},{start:1,end:2,text:'乙'}],protectedTerms:['OpenAI Codex']};
 const result=splitEnglishForVariant(input);assert.ok(result.some(p=>p.en.includes('OpenAI Codex')));assert.equal(result.map(p=>p.en).join(' '),'OpenAI Codex works well');
 input.mainPairs[0].en='OpenAI Codex';assert.throws(()=>splitEnglishForVariant(input),/保护单元不足/);
});
