// 剪映草稿导出：需要 browser 管线依赖 + ffmpeg + python3 里的 pyJianYingDraft；缺任一项整组跳过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check } from '../../plugin/engine/pipelines/browser/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WKA = path.join(ROOT, 'plugin/engine/bin/wka.mjs');
const hasPy = spawnSync('python3', ['-c', 'import pyJianYingDraft'], { stdio: 'ignore' }).status === 0;
const ready = (await check()).ok;
const opts = { skip: !ready ? 'browser 管线依赖未安装（运行 wka setup）' : !hasPy ? 'python3 里没有 pyJianYingDraft' : false };

const SHOT = "wk.shot({ render(ctx, t, s) { ctx.fillStyle = '#F2EDE3'; ctx.fillRect(0, 0, s.W, s.H); } });\n";
const BUILD = `export default async function ({ synth, duration, outDir }) {
  const buf = synth.buffer(duration);
  synth.knock(buf, { at: 0.3 });
  return [{ file: synth.writeWav(buf, outDir + '/score.wav'), start: 0, gain: 0 }];
}\n`;

const tone = (file, sec) => spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(sec), '-ac', '2', file]);
/** 0.3s 有声 + 1.4s 静音 + 0.3s 有声。 */
const gapped = (file) =>
  spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-ac', '2',
    '-af', "volume='if(between(t,0.3,1.7),0,1)':eval=frame", '-t', '2', file]);

/** 两镜各 1 秒；配乐脚本 1 条（一声"笃"）、自供录音人声 2 条、用户音轨 2 条（bgm -6dB、中间静音的 gap）。 */
function makeFilm({ voices } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-jy-'));
  fs.mkdirSync(path.join(dir, 'shots'));
  fs.mkdirSync(path.join(dir, 'audio'));
  for (const id of ['s01', 's02']) fs.writeFileSync(path.join(dir, 'shots', `${id}.js`), SHOT);
  fs.writeFileSync(path.join(dir, 'audio', 'build.mjs'), BUILD);
  tone(path.join(dir, 'audio', 'vo1.wav'), 0.5);
  tone(path.join(dir, 'audio', 'vo2.wav'), 0.4);
  tone(path.join(dir, 'audio', 'bgm.wav'), 3);
  gapped(path.join(dir, 'audio', 'gap.wav'));
  const film = {
    title: 'jy-it', style: 'ink-wash', size: [320, 180], fps: 10, seed: 1,
    shots: ['s01', 's02'].map((id) => ({ id, file: `shots/${id}.js`, duration: 1 })),
    audio: {
      build: 'audio/build.mjs',
      voice_source: 'user',
      voices: voices || [
        { text: '第一句', at: 0.2, file: 'audio/vo1.wav' },
        { text: '第二句', at: 1.3, file: 'audio/vo2.wav' },
      ],
      tracks: [{ file: 'audio/bgm.wav', gain: -6 }, { file: 'audio/gap.wav' }],
    },
  };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  return dir;
}

// 本机开着剪映时测试也要能跑：缺省把剪映进程名换成一个不存在的名字
const NO_JIANYING = 'wka-no-such-process';
const RUNNING = path.basename(process.execPath); // 当前 node 进程，一定在运行
const wka = (drafts, ...args) => wkaWith({ WKA_JIANYING_PROCESS: NO_JIANYING }, drafts, ...args);
const wkaWith = (env, drafts, ...args) =>
  spawnSync(process.execPath, [WKA, ...args], {
    encoding: 'utf8',
    env: { ...process.env, WKA_NO_FONT_DOWNLOAD: '1', WKA_WORKERS: '2', WKA_JIANYING_DRAFTS: drafts, ...env },
  });

const byType = (draft, type) => draft.tracks.filter((t) => t.type === type);

test('writer rejects a genuinely short video instead of silently leaving a timeline gap', opts, () => {
  const dir = makeFilm(), drafts = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-short-'));
  try {
    const media = path.join(dir, 'short.mp4');
    const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=s=320x180:r=30', '-t', '1', media]);
    assert.equal(made.status, 0, String(made.stderr));
    const plan = { name: 'short', width: 320, height: 180, fps: 30, video: [{ name: 's01', file: media, start: 0, duration: 2e6 }], audioTracks: [], subtitleTracks: [] };
    const file = path.join(dir, 'plan.json'); fs.writeFileSync(file, JSON.stringify(plan));
    const r = spawnSync('python3', [path.join(ROOT, 'plugin/engine/exporters/jianying/write_draft.py'), file, drafts], { encoding: 'utf8' });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /s01.*素材.*不足/);
    assert.deepEqual(fs.readdirSync(drafts), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(drafts, { recursive: true, force: true }); }
});

test('draft CLI keeps long English and punctuation as warnings, measures native layout and rejects mismatched text', opts, () => {
  const dir = makeFilm(), drafts = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-English-'));
  try {
    const file = path.join(dir, 'film.json'), film = JSON.parse(fs.readFileSync(file));
    film.size = [180, 320]; film.subtitles = { mode: 'both', bilingual: true, style: { size: .03 } };
    fs.writeFileSync(file, JSON.stringify(film));
    fs.writeFileSync(path.join(dir, 'subtitles.srt'), '1\n00:00:00,200 --> 00:00:00,700\n第一句\n\n2\n00:00:01,300 --> 00:00:01,700\n第二句\n');
    const pairs = [{ zh: '第一句', en: 'What you imagine can become what you make.' }, { zh: '第二句', en: 'Ready.' }];
    const en = path.join(dir, 'subtitles.en.json'); fs.writeFileSync(en, JSON.stringify(pairs));
    const r = wka(drafts, 'final', dir, '--formats', 'jianying');
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /超过 28/); assert.match(r.stdout, /句号/);
    const draft = JSON.parse(fs.readFileSync(path.join(drafts, 'jy-it/draft_info.json')));
    assert.ok(draft.materials.texts.some(t => JSON.parse(t.content).text === pairs[0].en));
    const texts = draft.materials.texts.map(t=>JSON.parse(t.content));
    const sizes = pairs.map(p=>texts.find(t=>t.text===p.en).styles[0].size);
    assert.ok(sizes[0] < sizes[1], 'long English uses its fitted per-segment size in Python output');
    assert.equal(fs.existsSync(path.join(dir, '.cache/video.mp4')), false);
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'review/字幕预检-版式.json')));
    assert.deepEqual([report.W, report.H], film.size); assert.equal(report.measurements.length, 2);
    pairs[0].zh = '错配'; fs.writeFileSync(en, JSON.stringify(pairs));
    const bad = wka(drafts, 'final', dir, '--formats', 'jianying'); assert.notEqual(bad.status, 0); assert.match(bad.stderr, /第 1 条.*中文/);
    pairs[0].zh = '第一句'; pairs[0].en = ''; fs.writeFileSync(en, JSON.stringify(pairs));
    const blank = wka(drafts, 'final', dir, '--formats', 'jianying'); assert.notEqual(blank.status, 0); assert.match(blank.stderr, /英文没填/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(drafts, { recursive: true, force: true }); }
});

test('107-shot 30fps main and portrait exports have contiguous actual draft cuts', opts, () => {
  const dir=makeFilm(),drafts=fs.mkdtempSync(path.join(os.tmpdir(),'wka-107-drafts-'));
  try {
    const file=path.join(dir,'film.json'),film=JSON.parse(fs.readFileSync(file));
    film.fps=30; film.audio={}; film.shots=Array.from({length:107},(_,i)=>({id:`s${String(i+1).padStart(2,'0')}`,file:'shots/s01.js',duration:(3+i%5)/30}));
    for(const size of [[160,90],[90,160]]) {
      film.size=size;film.title=`cuts-${size.join('x')}`;fs.writeFileSync(file,JSON.stringify(film));
      const r=wka(drafts,'final',dir,'--formats','jianying');assert.equal(r.status,0,r.stderr);
      const draft=JSON.parse(fs.readFileSync(path.join(drafts,film.title,'draft_info.json')));
      const cuts=byType(draft,'video')[0].segments.map(s=>s.target_timerange);assert.equal(cuts.length,107);
      let frames=0;
      for(let i=0;i<cuts.length;i++){
        assert.equal(cuts[i].start,Math.round(frames/30*1e6));frames+=3+i%5;
        assert.equal(cuts[i].start+cuts[i].duration,Math.round(frames/30*1e6));
      }
      assert.equal(fs.existsSync(path.join(dir,'.cache/video.mp4')),false);
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(drafts,{recursive:true,force:true});}
});

test('纯草稿不拼全片，重复/CLI登记前中断不重导，用户编辑后不覆盖',opts,()=>{
  const dir=makeFilm(),drafts=fs.mkdtempSync(path.join(os.tmpdir(),'wka-receipts-'));
  try{
    const first=wka(drafts,'final',dir,'--formats','jianying');assert.equal(first.status,0,first.stderr);
    assert.ok(first.stdout.indexOf('写入前说明')>=0&&first.stdout.indexOf('写入前说明')<first.stdout.indexOf('draft-export] 开始'),'声音差异在草稿写入前披露');
    const difference=JSON.parse(fs.readFileSync(path.join(dir,'review/草稿声音差异.json')));
    assert.equal(difference.master.fadeOut,0.2);assert.equal(difference.master.targetLUFS,-18);
    assert.equal(fs.existsSync(path.join(dir,'.cache/video.mp4')),false,'纯草稿无需拼全片');
    const file=path.join(drafts,'jy-it/draft_info.json'),original=fs.readFileSync(file);
    const twice=wka(drafts,'final',dir,'--formats','jianying');assert.equal(twice.status,0,twice.stderr);
    assert.deepEqual(fs.readdirSync(drafts),['jy-it']);assert.deepEqual(fs.readFileSync(file),original);
    fs.rmSync(path.join(dir,'.cache/operations.json'),{force:true});
    const receipts=path.join(dir,'.wka/export-receipts');
    for(const f of fs.readdirSync(receipts)){
      const p=path.join(receipts,f),receipt=JSON.parse(fs.readFileSync(p));delete receipt.outputs;receipt.status='prepared';fs.writeFileSync(p,JSON.stringify(receipt));
    }
    const recovered=wka(drafts,'final',dir,'--formats','jianying');assert.equal(recovered.status,0,recovered.stderr);
    assert.deepEqual(fs.readdirSync(drafts),['jy-it'],'利用草稿内完成回执补登记');
    const edit=JSON.parse(original);edit.name='用户手改';fs.writeFileSync(file,JSON.stringify(edit));
    const edited=wka(drafts,'final',dir,'--formats','jianying');assert.notEqual(edited.status,0);assert.match(edited.stderr,/user-modified|用户.*修改/);
    assert.deepEqual(fs.readdirSync(drafts),['jy-it']);assert.equal(JSON.parse(fs.readFileSync(file)).name,'用户手改');
    const forced=wka(drafts,'final',dir,'--formats','jianying','--force');assert.equal(forced.status,0,forced.stderr);assert.ok(fs.existsSync(path.join(drafts,'jy-it_v2')));
  }finally{fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(drafts,{recursive:true,force:true});}
});

test('exports an editable 剪映 draft split by shot, audio source and subtitle', opts, () => {
  const dir = makeFilm();
  const drafts = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-drafts-'));
  const r = wka(drafts, 'final', dir, '--formats', 'jianying');
  assert.equal(r.status, 0, r.stderr);

  const draftDir = path.join(drafts, 'jy-it');
  const draft = JSON.parse(fs.readFileSync(path.join(draftDir, 'draft_info.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(draftDir, 'draft_content.json')));
  assert.deepEqual([draft.canvas_config.width, draft.canvas_config.height, draft.fps], [320, 180, 10]);

  const [video] = byType(draft, 'video');
  assert.deepEqual(video.segments.map((s) => s.target_timerange), [
    { start: 0, duration: 1_000_000 },
    { start: 1_000_000, duration: 1_000_000 },
  ]);

  const audio = byType(draft, 'audio');
  assert.deepEqual(audio.map((t) => t.name), ['人声', 'score.wav', 'bgm.wav', 'gap.wav']);
  assert.deepEqual(audio[0].segments.map((s) => s.target_timerange.start), [200_000, 1_300_000]);
  const bgm = audio[2].segments[0];
  assert.equal(bgm.target_timerange.duration, 2_000_000, 'bgm is capped at the end of the film');
  assert.ok(Math.abs(bgm.volume - 0.501187) < 1e-4, `bgm volume ${bgm.volume}`);

  const gap = audio[3].segments;
  assert.equal(gap.length, 2, 'silence in the middle splits the track into two segments');
  assert.deepEqual(gap.map((s) => s.target_timerange.start === s.source_timerange.start), [true, true]);
  assert.ok(gap[1].target_timerange.start > 1_500_000 && gap[1].target_timerange.start < 1_700_000, `second part starts at ${gap[1].target_timerange.start}`);
  assert.equal(draft.materials.audios.filter((m) => m.path.endsWith('gap.wav')).length, 1, 'both parts share one material');

  const [text] = byType(draft, 'text');
  assert.equal(text.segments.length, 2);
  assert.equal(text.segments[0].target_timerange.start, 200_000);
  assert.ok(draft.materials.texts.some((t) => t.content.includes('第二句')));
  // ink-wash 的字幕样式：古风小楷、墨色字、宣纸描边、底边距 10%
  const [textStyle] = JSON.parse(draft.materials.texts[0].content).styles;
  assert.equal(textStyle.font.id, '7216598671016596029', '古风小楷');
  assert.deepEqual(textStyle.fill.content.solid.color.map((c) => Math.round(c * 255)), [0x2b, 0x2b, 0x2b]);
  assert.equal(textStyle.strokes.length, 1);
  assert.equal(text.segments[0].clip.transform.y, -0.75);

  const paths = [...draft.materials.videos, ...draft.materials.audios].map((m) => m.path);
  for (const p of paths) assert.ok(p.startsWith(path.join(draftDir, 'materials') + path.sep), `outside draft: ${p}`);
  assert.ok(paths.some((p) => path.basename(p) === 's01.mp4'));

  assert.match(r.stdout, /响度/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(drafts, { recursive: true, force: true });
});

test('a variant exports its own draft named after the title plus the aspect suffix', opts, () => {
  const dir = makeFilm();
  const f = path.join(dir, 'film.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), variants: { '9:16': {} } }));
  const drafts = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-drafts-'));
  const r = wka(drafts, 'final', dir, '--aspect', '9:16', '--formats', 'jianying');
  assert.equal(r.status, 0, r.stderr);
  const draft = JSON.parse(fs.readFileSync(path.join(drafts, 'jy-it-9x16', 'draft_info.json'), 'utf8'));
  assert.deepEqual([draft.canvas_config.width, draft.canvas_config.height], [180, 320]);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(drafts, { recursive: true, force: true });
});

test('gives every exported draft its own id so 剪映 does not reuse a cached timeline', opts, () => {
  const dir = makeFilm();
  const drafts = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-drafts-'));
  assert.equal(wka(drafts, 'final', dir, '--formats', 'jianying').status, 0);
  fs.renameSync(path.join(drafts, 'jy-it'), path.join(drafts, 'jy-first'));
  assert.equal(wka(drafts, 'final', dir, '--formats', 'jianying').status, 0);
  const read = (name, file) => JSON.parse(fs.readFileSync(path.join(drafts, name, file), 'utf8'));
  const [a, b] = ['jy-first', 'jy-it'].map((n) => read(n, 'draft_info.json').id);
  assert.notEqual(a, b);
  assert.notEqual(a, '91E08AC5-22FB-47e2-9AA0-7DC300FAEA2B');
  assert.equal(read('jy-it', 'draft_content.json').id, b);
  const meta = read('jy-it', 'draft_meta_info.json');
  assert.notEqual(meta.draft_id, read('jy-first', 'draft_meta_info.json').draft_id);
  assert.deepEqual([meta.draft_name, meta.draft_fold_path, meta.draft_root_path], ['jy-it', path.join(drafts, 'jy-it'), drafts]);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(drafts, { recursive: true, force: true });
});

test('puts overlapping voices and their subtitles on second tracks', opts, () => {
  const dir = makeFilm({
    voices: [
      { text: '第一句', at: 0.2, file: 'audio/vo1.wav' },
      { text: '第二句', at: 0.5, file: 'audio/vo2.wav' }, // vo1 长 0.5s，到 0.7s 才结束
    ],
  });
  const drafts = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-drafts-'));
  const r = wka(drafts, 'final', dir, '--formats', 'jianying');
  assert.equal(r.status, 0, r.stderr);
  const draft = JSON.parse(fs.readFileSync(path.join(drafts, 'jy-it', 'draft_info.json'), 'utf8'));
  const voices = byType(draft, 'audio').filter((t) => t.name.startsWith('人声'));
  assert.deepEqual(voices.map((t) => [t.name, t.segments.map((s) => s.target_timerange.start)]), [['人声', [200_000]], ['人声 2', [500_000]]]);
  assert.ok(Math.abs(voices[0].segments[0].target_timerange.duration - 500_000) < 20_000, 'voice segment is as long as its audio');
  assert.deepEqual(byType(draft, 'text').map((t) => t.segments.length), [1, 1]);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(drafts, { recursive: true, force: true });
});

test('a draft name already taken in 剪映 exports as name_v2 and leaves the old draft alone', opts, () => {
  const dir = makeFilm();
  const drafts = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-drafts-'));
  fs.mkdirSync(path.join(drafts, 'jy-it'));
  fs.writeFileSync(path.join(drafts, 'jy-it', 'keep.txt'), 'edited in 剪映');
  const r = wka(drafts, 'final', dir, '--formats', 'jianying');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /这次导出为「jy-it_v2」/);
  assert.ok(r.stdout.includes(path.join(drafts, 'jy-it_v2')));
  assert.deepEqual(fs.readdirSync(path.join(drafts, 'jy-it')), ['keep.txt']);
  const meta = JSON.parse(fs.readFileSync(path.join(drafts, 'jy-it_v2', 'draft_meta_info.json'), 'utf8'));
  assert.equal(meta.draft_name, 'jy-it_v2');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(drafts, { recursive: true, force: true });
});

test('refuses to export while 剪映 is running and writes nothing', opts, () => {
  const dir = makeFilm();
  const drafts = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-drafts-'));
  const r = wkaWith({ WKA_JIANYING_PROCESS: RUNNING }, drafts, 'final', dir, '--formats', 'jianying');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /剪映正在运行/);
  assert.match(r.stderr, /⌘Q/);
  assert.deepEqual(fs.readdirSync(drafts), []);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(drafts, { recursive: true, force: true });
});

test('fails clearly when the drafts root does not exist', opts, () => {
  const dir = makeFilm();
  const r = wka(path.join(os.tmpdir(), 'wka-no-such-drafts-root'), 'final', dir, '--formats', 'jianying');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /草稿位置/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('refuses to export a draft in proxy mode', opts, () => {
  const dir = makeFilm();
  const drafts = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-drafts-'));
  const r = wka(drafts, 'final', dir, '--formats', 'jianying', '--proxy');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /proxy|预览/);
  assert.deepEqual(fs.readdirSync(drafts), []);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(drafts, { recursive: true, force: true });
});

test('warns when the film’s subtitle font has no 剪映 counterpart, but not for fonts mapped to null', opts, () => {
  for (const [family, warned] of [['Long Cang', true], ['Noto Sans SC', false]]) {
    const dir = makeFilm();
    const f = path.join(dir, 'film.json');
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), subtitles: { mode: 'none', style: { font: { family } } } }));
    const drafts = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-drafts-'));
    const r = wka(drafts, 'final', dir, '--formats', 'jianying');
    assert.equal(r.status, 0, r.stderr);
    const re = new RegExp(`字幕字体「${family}」在剪映字体对照表里没有对应项`);
    if (warned) assert.match(r.stdout, re);
    else assert.doesNotMatch(r.stdout, /在剪映字体对照表里没有对应项/);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(drafts, { recursive: true, force: true });
  }
});
