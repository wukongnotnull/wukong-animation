// 用户项目的 git 管理：初始化仓库，并在 director 的每个审片节点签批后做一次定版快照（git 提交）。
// 片子的"源"（故事、分镜、镜头代码、film.json）进版本库；渲染产物、缓存不进。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertActiveProduction, assertProjectCompatible, inspectProduction } from './state.mjs';

const IGNORE_BLOCK = `# >>> wukong-animation >>>
# 缓存、定稿快照、生成的音频，以及审阅副本和成片里的大媒体，都可以由源文件重新生成，不进版本库
# review/ 里的文字报告、.wka/ 里的签批记录仍然纳入版本管理；本机的执行记录和中间状态不进
films/*/.cache/
films/*/.wka/approved/
films/*/.wka/operations.json
films/*/.wka/voice-sources.json
films/*/.wka/main-check.json
films/*/audio/generated/
films/*/review/**/*.mp4
films/*/review/**/*.m4a
films/*/review/**/*.png
films/*/review/**/*.jpg
films/*/review/**/*.jpeg
films/*/review/QC/异常帧/
films/*/review/素材/素材抽帧/
films/*/成片/*.mp4
films/*/成片/*.gif
films/*/成片/*.webm
films/*/成片/*.mov
films/*/成片/**/*.png
node_modules/
.DS_Store
# 想把成片也纳入版本管理，建议用 Git LFS：git lfs track "films/*/成片/*.mp4"
# <<< wukong-animation <<<
`;

const BLOCK_BEGIN = '# >>> wukong-animation >>>';
const BLOCK_END = '# <<< wukong-animation <<<';

/** 把 .gitignore 里的 wukong-animation 段落写成当前版本：没有就追加，旧版就整段替换，段落外的内容不动。 */
export function upsertIgnoreBlock(text) {
  const begin = text.indexOf(BLOCK_BEGIN);
  if (begin >= 0) {
    const end = text.indexOf(BLOCK_END, begin);
    // 结束标记被删掉了：分不清段落到哪为止，不动它，免得删掉用户自己写的规则
    if (end < 0) return text;
    const after = text.slice(end + BLOCK_END.length).replace(/^\r?\n/, '');
    return text.slice(0, begin) + IGNORE_BLOCK + after;
  }
  return (text && !text.endsWith('\n') ? text + '\n' : text) + (text ? '\n' : '') + IGNORE_BLOCK;
}

function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

export function hasGit() {
  return spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;
}

function hasIdentity(dir) {
  return git(dir, ['config', 'user.name']).ok && git(dir, ['config', 'user.email']).ok;
}

const IDENTITY_HINT =
  '尚未配置 git 身份，跳过提交。请运行：git config --global user.name "你的名字" && git config --global user.email "you@example.com"';

/**
 * 初始化项目目录：
 *   1. 不是 git 仓库 → git init（默认分支 main）
 *   2. 写入 .gitignore 中的 wukong-animation 段落，旧版段落换成当前版本
 *   3. 仓库还没有任何提交 → 做一次初始提交；已有提交且改写了 .gitignore → 单独提交 .gitignore
 * 已经是仓库的目录不会被重新初始化，只补全 / 更新 .gitignore。
 */
export function initProject(dir, { log = console.log } = {}) {
  assertProjectCompatible(dir);
  if (inspectProduction(dir).mode === 'archive') assertActiveProduction(dir);
  dir = path.resolve(dir);
  fs.mkdirSync(path.join(dir, 'films'), { recursive: true });
  if (!hasGit()) {
    log('  ✗ 没有找到 git，跳过版本管理（建议安装 git，方便回退每一步修改）');
    return { git: false };
  }

  const inside = git(dir, ['rev-parse', '--is-inside-work-tree']);
  let created = false;
  if (!inside.ok) {
    let r = git(dir, ['init', '-b', 'main']);
    if (!r.ok) r = git(dir, ['init']); // 老版本 git 不支持 -b
    if (!r.ok) throw new Error(`git init 失败：${r.err}`);
    created = true;
    log(`  ✓ 已初始化 git 仓库：${dir}`);
  } else {
    log(`  ✓ 已在 git 仓库中：${git(dir, ['rev-parse', '--show-toplevel']).out}`);
  }

  const gi = path.join(dir, '.gitignore');
  const old = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  const next = upsertIgnoreBlock(old);
  const hasCommit = git(dir, ['rev-parse', '--verify', 'HEAD']).ok;
  // 改写前 .gitignore 里有用户自己没提交的改动时，不替用户提交
  const userEdits = hasCommit && !git(dir, ['diff', '--quiet', 'HEAD', '--', '.gitignore']).ok;
  if (next !== old) {
    fs.writeFileSync(gi, next);
    log(old.includes(BLOCK_BEGIN) ? '  ✓ 已更新 .gitignore 的 wukong-animation 段落' : '  ✓ 已写入 .gitignore（忽略缓存、定稿快照、审阅大媒体和成片）');
  }

  if (hasCommit && next !== old) commitIgnoreUpdate(dir, userEdits, log);
  if (!hasCommit) {
    if (!hasIdentity(dir)) {
      log('  ! ' + IDENTITY_HINT);
    } else {
      git(dir, ['add', '.gitignore']);
      const r = git(dir, ['commit', '-m', 'wukong-animation: 初始化项目', '--', '.gitignore']);
      log(r.ok ? '  ✓ 已创建初始提交' : `  ! 初始提交失败：${r.err}`);
    }
  }
  return { git: true, created };
}

function commitIgnoreUpdate(dir, userEdits, log) {
  if (userEdits) {
    log('  ! .gitignore 里有你自己没提交的改动，已更新 wukong-animation 段落，请自己提交');
    return;
  }
  if (!hasIdentity(dir)) {
    log('  ! ' + IDENTITY_HINT);
    return;
  }
  git(dir, ['add', '.gitignore']);
  const r = git(dir, ['commit', '-m', 'wukong-animation: 更新 .gitignore', '--', '.gitignore']);
  log(r.ok ? '  ✓ 已提交 .gitignore' : `  ! 提交 .gitignore 失败：${r.err}`);
}

/**
 * 定版快照：只提交这支片的源文件（film.json、story.md、storyboard.md、shots/ 等）。
 * 没有改动时什么都不做。返回提交的短哈希或 null。
 */
export function commitSnapshot(filmDir, message, { log = console.log } = {}) {
  assertActiveProduction(filmDir);
  filmDir = fs.realpathSync(path.resolve(filmDir));
  if (!hasGit()) return null;
  if (!git(filmDir, ['rev-parse', '--is-inside-work-tree']).ok) {
    log('  ! 项目不是 git 仓库，跳过提交（先运行 wka init-project）');
    return null;
  }
  if (!hasIdentity(filmDir)) {
    log('  ! ' + IDENTITY_HINT);
    return null;
  }
  git(filmDir, ['add', '-A', '--', '.']);
  const staged = git(filmDir, ['diff', '--cached', '--quiet', '--', '.']);
  if (staged.ok) {
    log('  · 没有新的改动，无需提交');
    return null;
  }
  const name = path.basename(filmDir);
  const r = git(filmDir, ['commit', '-m', `${name}: ${message}`, '--', '.']);
  if (!r.ok) {
    log(`  ! 提交失败：${r.err}`);
    return null;
  }
  const sha = git(filmDir, ['rev-parse', '--short', 'HEAD']).out;
  log(`  ✓ 已提交 ${sha}  ${name}: ${message}`);
  return sha;
}

function normalizeReviewPath(file) {
  if (typeof file !== 'string') throw new Error('待审提交范围无效');
  const rel = file.split('\\').join('/');
  if (!rel || path.isAbsolute(file) || rel.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('待审提交范围无效');
  return rel;
}

function gitRoot(dir) {
  const r = git(dir, ['rev-parse', '--show-toplevel']);
  if (!r.ok) throw new Error('项目不是 git 仓库，先运行 wka init-project');
  return path.resolve(r.out);
}
const EVIDENCE_PREFIXES = ['review/', 'media/', 'audio/voice/', '资料/'];

/** review/ 里的文字报告和输入素材（media/、audio/voice/、资料/）里还没提交的文件：签批时随待审版本一起提交。 */
export function dirtyReviewPaths(filmDir) {
  filmDir = fs.realpathSync(path.resolve(filmDir));
  if (!hasGit() || !git(filmDir, ['rev-parse', '--is-inside-work-tree']).ok) return [];
  return changedPaths(filmDir).map(file => file.split(path.sep).join('/')).filter(file => file === '.wka/materials-origin.json' || EVIDENCE_PREFIXES.some(prefix => file.startsWith(prefix)));
}

function changedPaths(dir) {
  const root = gitRoot(dir), prefix = path.relative(root, dir).split(path.sep).filter(Boolean).join('/');
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '-uall'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`无法读取 Git 状态：${(r.stderr || '').trim()}`);
  const records = (r.stdout || '').split('\0').filter(part => part !== '');
  const paths = [];
  for (let i = 0; i < records.length; i++) {
    const status = records[i].slice(0, 2);
    paths.push(records[i].slice(3).trimStart());
    if (status[0] === 'R' || status[0] === 'C') paths.push(records[++i]);
  }
  return paths.filter(Boolean).filter(file => !prefix || file === prefix || file.startsWith(prefix + '/')).map(file => prefix ? file.slice(prefix.length + 1) : file);
}

/** 只提交调用方点名的文件。范围外有改动时拒绝，不改动暂存区。 */
export function commitPaths(filmDir, { message, paths } = {}, { log = console.log } = {}) {
  assertActiveProduction(filmDir);
  filmDir = fs.realpathSync(path.resolve(filmDir));
  if (typeof message !== 'string' || !message.trim()) throw new Error('待审提交说明无效');
  if (!Array.isArray(paths) || !paths.length) throw new Error('待审提交范围无效');
  const allowed = [...new Set(paths.map(normalizeReviewPath))];
  if (!hasGit()) throw new Error('没有找到 git，不能提交待审版本');
  if (!git(filmDir, ['rev-parse', '--is-inside-work-tree']).ok) throw new Error('项目不是 git 仓库，先运行 wka init-project');
  if (!hasIdentity(filmDir)) throw new Error(IDENTITY_HINT);
  const root = gitRoot(filmDir), prefix = path.relative(root, filmDir).split(path.sep).filter(Boolean).join('/');
  const dirty = changedPaths(filmDir);
  const outside = dirty.filter(file => !allowed.includes(file.split(path.sep).join('/')));
  if (outside.length) throw new Error(`签批范围之外还有未提交改动：${outside.join('、')}`);
  const head = git(filmDir, ['rev-parse', 'HEAD']);
  if (!dirty.length) {
    if (!head.ok) throw new Error('没有可提交的待审文件');
    log('  · 当前提交已包含待审内容');
    return { sha: head.out, created: false };
  }
  for (const file of allowed) {
    const absolute = path.resolve(filmDir, file);
    const tracked = git(filmDir, ['ls-files', '--error-unmatch', '--', file]).ok;
    if (!fs.existsSync(absolute) && !tracked) throw new Error(`待审文件不存在：${file}`);
    if (fs.existsSync(absolute) && !fs.statSync(absolute).isFile()) throw new Error(`待审范围必须是文件：${file}`);
  }
  const rooted = allowed.map(file => prefix ? prefix + '/' + file : file);
  const added = git(root, ['add', '--', ...rooted]);
  if (!added.ok) throw new Error(`暂存待审文件失败：${added.err}${/ignored/.test(added.err) ? '\n  .gitignore 规则太旧会挡住 review/ 里的待审文件，运行 wka init-project 更新 wukong-animation 段落后重试' : ''}`);
  const committed = git(root, ['commit', '-m', message, '--', ...rooted]);
  if (!committed.ok) throw new Error(`提交失败：${committed.err}`);
  const sha = git(filmDir, ['rev-parse', 'HEAD']);
  if (!sha.ok) throw new Error('提交后无法读取 Git 版本');
  log(`  ✓ 已提交 ${sha.out.slice(0, 7)}  ${message}`);
  return { sha: sha.out, created: true };
}
