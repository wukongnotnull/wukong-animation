// 签批夹具：影片目录本身就是仓库，生成媒体留在提交范围外。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function initReviewRepo(dir) {
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'git 失败').trim());
  };
  git('init', '-q');
  for (const args of [['user.name', 'Fixture'], ['user.email', 'fixture@example.invalid'], ['commit.gpgsign', 'false']]) git('config', ...args);
  fs.writeFileSync(path.join(dir, '.gitignore'), '/.cache/\n/review/\n/stills/\n/audio/generated/\n*.mp4\n*.gif\n*.webm\n.DS_Store\n');
  git('add', '--', '.gitignore');
  git('commit', '-qm', 'init');
}
