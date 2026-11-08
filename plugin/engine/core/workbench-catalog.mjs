// Read-only discovery. No film scripts, rendering or progress migration.
import fs from 'node:fs';
import path from 'node:path';
import { digest, fileDigest } from './evidence.mjs';
import { finalContract } from './final-delivery.mjs';
import { pickCues } from './cues.mjs';

export function workbenchJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`工作台无法读取 ${file}：${error.message}`); }
}

export function scopedPath(root, file) {
  const absolute = path.resolve(root, file), rel = path.relative(root, absolute);
  if (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw new Error('文件超出项目范围');
  let cursor = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`不跟随文件链接：${cursor}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return absolute;
}

export function workbenchKind(file) {
  const ext = path.extname(file).toLowerCase();
  if (['.mp4', '.webm', '.mov'].includes(ext)) return 'video';
  if (['.m4a', '.mp3', '.wav', '.ogg', '.aac', '.flac'].includes(ext)) return 'audio';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) return 'image';
  if (['.md', '.txt', '.json', '.srt', '.vtt', '.csv'].includes(ext)) return 'text';
  return 'file';
}

function walk(root, relative) {
  const base = scopedPath(root, relative);
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const ent of fs.readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = path.join(relative, ent.name); scopedPath(root, rel);
    if (ent.isDirectory()) out.push(...walk(root, rel));
    else if (ent.isFile()) out.push(rel);
  }
  return out;
}

function inferredStep(file) {
  if (/(?:[-./\\])\d+x\d+(?=[./\\-]|$)/.test(file)) return 7;
  if (/QC报告(?!-proxy)|最终交付|主版不变/.test(file)) return 6;
  return 5;
}

export function workbenchCatalog(dir, registrations = []) {
  const configured = fs.existsSync(scopedPath(dir, 'film.json'));
  const film = workbenchJson(scopedPath(dir, 'film.json'), {}), items = new Map(), warnings = [];
  const stages = workbenchJson(scopedPath(dir, '.cache/operations.json'), { stages: {} }).stages || {};
  const ledger = workbenchJson(scopedPath(dir, '.wka/final-delivery.json'), { artifacts: [] });
  const add = (file, step, extra = {}) => {
    const absolute = extra.external ? path.resolve(file) : scopedPath(dir, file);
    const key = absolute;
    const old = items.get(key);
    const relativePath = extra.external ? null : path.relative(dir, absolute).split(path.sep).join('/');
    items.set(key, { step, label: path.basename(file), kind: workbenchKind(file), required: true, ...old, ...extra,
      id: digest(relativePath === null ? 'external:' + absolute : 'project:' + relativePath).slice(0, 24), path: absolute, relativePath });
  };
  add('brief.md', 2, { label: '方案简报' }); add('story.md', 3, { label: '剧本' }); add('storyboard.md', 4, { label: '分镜稿' });
  add('review/小样.mp4', 5, { label: '小样视频' }); add('review/QC报告-proxy.json', 5, { label: '检查结果' });
  for (const file of [...walk(dir, 'review'), ...walk(dir, 'stills')]) {
    if (!['text', 'image', 'audio', 'video'].includes(workbenchKind(file))) continue;
    if (/交付清单|交付审计|字幕|subtitles/.test(file)) continue;
    // A directory may also contain user references; discovery alone is not a review contract.
    if (!items.has(scopedPath(dir, file))) {
      const formal = /^(?:stills\/s[\w-]+[-.]|review\/(?:局部小样|局部原画质)\/|review\/(?:小样|QC报告|主版不变)[-.])/u.test(file.split(path.sep).join('/'));
      add(file, inferredStep(file), { required: formal });
    }
  }
  for (const file of fs.readdirSync(dir)) if (/\.(mp4|webm|gif)$/.test(file) && !/^subtitles/.test(file)) add(file, /-\d+x\d+/.test(file) ? 7 : 6, { required: false });
  for (const operation of Object.values(stages).filter(s => s.status === 'completed')) {
    for (const output of operation.outputs || []) {
      if (!output.file || /字幕|subtitles/.test(output.file)) continue;
      const rel = path.relative(dir, path.resolve(dir, output.file));
      if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some(p => p.startsWith('.'))) continue;
      if (['text', 'image', 'audio', 'video'].includes(workbenchKind(rel))) add(rel, inferredStep(rel), { required: /小样|QC报告/.test(rel) });
    }
  }
  let contract = null;
  if (film.style && film.shots) {
    try {
      contract = finalContract(dir);
      for (const slot of contract.slots) {
        const artifact = (ledger.artifacts || []).filter(a => a.slot === slot.slot).at(-1);
        const operation = Object.values(stages).find(s => s.stage === slot.stage && s.aspect === slot.aspect && !s.proxy && s.status === 'completed');
        const file = artifact?.path || operation?.outputs?.[0]?.file || slot.path;
        if (file) add(file, slot.kind === 'draft' ? 8 : slot.aspect === contract.mainAspect ? 6 : 7,
          { required: true, external: slot.kind === 'draft', kind: slot.kind === 'draft' ? 'directory' : workbenchKind(file), aspect: slot.aspect, technical: artifact?.technical || null });
      }
      warnings.push(...contract.errors);
    } catch (error) { warnings.push(`最终交付要求待核实：${error.message}`); }
  }
  for (const reg of registrations) add(reg.relativePath || reg.path, reg.step, reg);
  // A whole draft directory is an explicitly registered external deliverable, not an arbitrary browsing root.
  for (const item of items.values()) if (fs.existsSync(item.path) && fs.lstatSync(item.path).isDirectory()) item.kind = 'directory';
  const notApplicable = new Set();
  if (configured && !Object.keys(film.variants || {}).length) notApplicable.add(7);
  const decisions = workbenchJson(scopedPath(dir, '.wka/decisions.json'), {});
  if (decisions.delivery?.status === 'confirmed' && decisions.delivery.value === 'video-only') notApplicable.add(8);
  let start = 0;
  const shots = (film.shots || []).map(s => { const row = { id: s.id, start, duration: Number(s.duration) || 0 }; start += row.duration; return row; });
  return { film, items: [...items.values()], warnings, notApplicable, shots, duration: start, contract };
}

export function workbenchDependencies(dir, item, film) {
  const files = new Set(), projections = {};
  const add = file => { if (typeof file === 'string') files.add(file); };
  const source = rel => {
    const file = scopedPath(dir, rel);
    if (!fs.existsSync(file)) return [rel, null];
    if (fs.statSync(file).isDirectory()) return [rel, walk(dir, rel).map(f => [f, fileDigest(scopedPath(dir, f))])];
    return [rel, fileDigest(file)];
  };
  if (item.depends) item.depends.forEach(add);
  else {
    if ([3, 4].includes(item.step)) add('brief.md');
    if (item.step === 4) add('story.md');
    const sound = [5, 6, 7, 8].includes(item.step) && item.kind !== 'image';
    const picture = [5, 6, 7, 8].includes(item.step);
    if (sound) {
      projections.audio = film.audio || {}; add(film.audio?.build);
      for (const track of [...(film.audio?.tracks || []), ...(film.audio?.voices || [])]) add(track.file);
    }
    if (picture) {
      const local = item.kind === 'image' || /局部小样|局部原画质/.test(item.path);
      const selected = local ? (film.shots || []).find(s => path.basename(item.path).startsWith(s.id + '.') || path.basename(item.path).startsWith(s.id + '-')) : null;
      const shots = selected ? [selected] : film.shots || [];
      const seen = new Set();
      const addScript = rel => {
        if (!rel || seen.has(rel)) return; seen.add(rel); add(rel);
        const file = scopedPath(dir, rel);
        if (!fs.existsSync(file)) return;
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
          const base = path.resolve(path.dirname(file), match[1]);
          const found = [base, ...['.js', '.mjs', '.ts', '.tsx', '.jsx'].map(ext => base + ext)].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
          if (found) addScript(path.relative(dir, found));
        }
      };
      for (const shot of shots) addScript(shot.file);
      for (const script of film.scripts || []) addScript(script);
      const start = selected ? (film.shots || []).slice(0, film.shots.indexOf(selected)).reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0) : null;
      projections.picture = { style: film.style, size: film.size, fps: film.fps, seed: film.seed, shots, start,
        cues: pickCues(film.cues || {}, [...seen].map(f => scopedPath(dir, f))), variants: item.step === 7 ? film.variants : undefined };
      add('brief.md'); add('story.md'); add('storyboard.md');
    }

  }
  return digest({ projections, files: [...files].sort().filter(f => path.resolve(dir, f) !== item.path).map(source) });
}
