// 剪映导出前的两道保护：剪映开着时不导（它退出时会把内存里的旧草稿写回去），
// 同名草稿已存在时换一个新名字（不覆盖用户在剪映里的改动）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// macOS 剪映专业版的进程名（/Applications/VideoFusion-macOS.app）
const MAC_PROCESS = 'VideoFusion-macOS';
const MAX_VERSION = 99;

/** macOS 检查默认剪映；已有进程名覆盖也可在 Linux 用真实 pgrep 验证，Linux 不猜默认桌面进程。 */
export function jianyingRunning() {
  if (process.platform !== 'darwin' && !(process.platform === 'linux' && process.env.WKA_JIANYING_PROCESS)) return false;
  const name = process.env.WKA_JIANYING_PROCESS || MAC_PROCESS;
  return spawnSync('pgrep', ['-x', name], { stdio: 'ignore' }).status === 0;
}

/** 草稿根目录里第一个没被占用的名字：<name>、<name>_v2、<name>_v3…… */
export function freeDraftName(root, name) {
  if (!fs.existsSync(path.join(root, name))) return name;
  for (let v = 2; v <= MAX_VERSION; v++) {
    const candidate = `${name}_v${v}`;
    if (!fs.existsSync(path.join(root, candidate))) return candidate;
  }
  throw new Error(`剪映草稿目录里已经有 ${MAX_VERSION} 份《${name}》（原名加 _v2 到 _v${MAX_VERSION}），请先在剪映里清理旧草稿`);
}
