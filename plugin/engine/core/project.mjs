// 用户项目的 git 管理：初始化仓库，并在 director 的每个审片节点签批后做一次定版快照（git 提交）。
// 片子的"源"（故事、分镜、镜头代码、film.json）进版本库；渲染产物、缓存不进。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const IGNORE_BLOCK = `# >>> wukong-animation >>>
# 渲染缓存、中间帧、风格帧、成片都可以由源文件重新生成，不进版本库
films/*/.cache/
films/*/stills/
films/*/audio/generated/
films/*/*.mp4
films/*/*.gif
films/*/*.webm
node_modules/
.DS_Store
# 想把成片也纳入版本管理，建议用 Git LFS：git lfs track "films/*/*.mp4"
# <<< wukong-animation <<<
`;

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
 *   2. 写入 / 补全 .gitignore 中的 wukong-animation 段落
 *   3. 仓库还没有任何提交 → 做一次初始提交
 * 已经是仓库的目录不会被重新初始化，只补全 .gitignore。
 */
export function initProject(dir, { log = console.log } = {}) {
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
  if (!old.includes('# >>> wukong-animation >>>')) {
    fs.writeFileSync(gi, (old && !old.endsWith('\n') ? old + '\n' : old) + (old ? '\n' : '') + IGNORE_BLOCK);
    log('  ✓ 已写入 .gitignore（忽略渲染缓存、中间帧和成片）');
  }

  const hasCommit = git(dir, ['rev-parse', '--verify', 'HEAD']).ok;
  if (!hasCommit) {
    if (!hasIdentity(dir)) {
      log('  ! ' + IDENTITY_HINT);
    } else {
      git(dir, ['add', '.gitignore']);
      const r = git(dir, ['commit', '-m', 'wukong-animation: 初始化项目']);
      log(r.ok ? '  ✓ 已创建初始提交' : `  ! 初始提交失败：${r.err}`);
    }
  }
  return { git: true, created };
}

/**
 * 定版快照：只提交这支片的源文件（film.json、story.md、storyboard.md、shots/ 等）。
 * 没有改动时什么都不做。返回提交的短哈希或 null。
 */
export function commitSnapshot(filmDir, message, { log = console.log } = {}) {
  filmDir = path.resolve(filmDir);
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
