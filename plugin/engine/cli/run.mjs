import path from 'node:path';
import { parseArgs } from '../core/command-args.mjs';
import { inspectProduction, assertActiveProduction, assertProjectCompatible } from '../core/state.mjs';
import { lockProduction } from '../core/operations.mjs';
import { atomicJson } from '../core/evidence.mjs';
import { hasWorkbench, captureWorkbenchLocked, assertWorkbenchScope } from '../core/workbench.mjs';
import { workbenchJson } from '../core/workbench-catalog.mjs';
import { commandContext } from './context.mjs';
import { commandsFor } from './commands.mjs';
import { HELP } from './help.mjs';

/** Run one invocation without changing process globals or exiting the host. */
export async function runCli(argv, { log: write = console.log, error = console.error, interruptHost = null } = {}) {
  // Log callbacks may return values (for example Array.push); those are not exit codes.
  const log = (...args) => { write(...args); };
  try {
    argv = [...argv];
    const parsed = parseArgs(argv), { cmd, pos, opt } = parsed;
    if (['audition', 'subtitles'].includes(cmd)) {
      if (pos[0] && inspectProduction(pos[0]).readonly) assertActiveProduction(pos[0]);
      throw new Error('AI 人声和字幕制作已取消；请提供人声录音，在制作小样中完成声画编排。');
    }
    const commands = commandsFor(commandContext(parsed, log));
    const command = Object.hasOwn(commands, cmd) ? commands[cmd] : null;
    if (!command) {
      if (cmd === undefined || cmd === 'help' || cmd === '--help') { log(HELP); return 0; }
      error(`✗ 未知命令 "${cmd}"\n\n${HELP}`);
      return 1;
    }

    // Preflight always precedes locks, recovery records and handler side effects.
    if (command.preflight === 'project') assertProjectCompatible(pos[0] || '.');
    else if (pos[0] && command.preflight === 'new-film') {
      const dir = path.resolve(opt('dir', '.'), 'films', pos[0]);
      if (inspectProduction(dir).readonly) assertActiveProduction(dir);
    } else if (pos[0] && ['film', 'film-unless-list'].includes(command.preflight)) assertActiveProduction(pos[0]);

    const observe = pos[0] && ['signoff', 'qc', 'still', 'animatic', 'preview', 'render', 'soundtrack', 'final'].includes(cmd) && hasWorkbench(pos[0]);
    if (observe) assertWorkbenchScope(pos[0]);
    const needsLock = observe || command.lock === 'film' || (command.lock === 'final-record' && opt('final') && opt('record'));
    const unlock = needsLock && pos[0] ? lockProduction(pos[0], { waitMs: Number(process.env.WKA_LOCK_WAIT_MS ?? 30000) }) : () => {};
    // 只有进程入口传入 interruptHost：被中断时先释放自己持有的写入锁再退出，避免残留锁。
    const interrupts = interruptHost ? ['SIGINT', 'SIGTERM'].map((signal) => {
      const handler = () => { unlock(); interruptHost.exit(signal === 'SIGINT' ? 130 : 143); };
      interruptHost.once(signal, handler);
      return [signal, handler];
    }) : [];
    try {
      if (command.active && pos[0]) atomicJson(path.join(path.resolve(pos[0]), '.cache/active-command.json'), { argv });
      const operationsFile = pos[0] ? path.join(path.resolve(pos[0]), '.wka/operations.json') : null;
      const before = observe ? workbenchJson(operationsFile, { stages: {} }).stages : null;
      if (observe) captureWorkbenchLocked(pos[0]);
      const code = await command.run();
      if (observe) {
        const after = workbenchJson(operationsFile, { stages: {} }).stages;
        const producedPaths = Object.entries(after || {}).filter(([key, value]) => value.status === 'completed' &&
          (value.id !== before?.[key]?.id || value.checkedAt !== before?.[key]?.checkedAt)).flatMap(([, value]) => (value.outputs || []).map(o => o.file));
        captureWorkbenchLocked(pos[0], { producedPaths });
      }
      return Number.isInteger(code) ? code : 0;
    } finally {
      for (const [signal, handler] of interrupts) interruptHost.off(signal, handler);
      unlock();
    }
  } catch (err) {
    error(`✗ ${err.message}`);
    return 1;
  }
}
