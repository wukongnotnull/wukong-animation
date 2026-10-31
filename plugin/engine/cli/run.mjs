import path from 'node:path';
import { parseArgs } from '../bin/args.mjs';
import { assertCompatibleProgress, assertProjectCompatible } from '../core/state.mjs';
import { lockProduction } from '../core/operations.mjs';
import { atomicJson } from '../core/evidence.mjs';
import { commandContext } from './context.mjs';
import { commandsFor } from './commands.mjs';
import { HELP } from './help.mjs';

/** Run one invocation without changing process globals or exiting the host. */
export async function runCli(argv, { log: write = console.log, error = console.error } = {}) {
  // Log callbacks may return values (for example Array.push); those are not exit codes.
  const log = (...args) => { write(...args); };
  try {
    argv = [...argv];
    const parsed = parseArgs(argv), { cmd, pos, opt } = parsed;
    const commands = commandsFor(commandContext(parsed, log));
    const command = Object.hasOwn(commands, cmd) ? commands[cmd] : null;
    if (!command) {
      if (cmd === undefined || cmd === 'help' || cmd === '--help') { log(HELP); return 0; }
      error(`✗ 未知命令 "${cmd}"\n\n${HELP}`);
      return 1;
    }

    // Preflight always precedes locks, recovery records and handler side effects.
    if (command.preflight === 'project') assertProjectCompatible(pos[0] || '.');
    else if (pos[0] && command.preflight === 'new-film') assertCompatibleProgress(path.resolve(opt('dir', '.'), 'films', pos[0]));
    else if (pos[0] && (command.preflight === 'film' || (command.preflight === 'film-unless-list' && !opt('list')))) assertCompatibleProgress(pos[0]);

    const needsLock = command.lock === 'film' || (command.lock === 'final-record' && opt('final') && opt('record'));
    const unlock = needsLock && pos[0] ? lockProduction(pos[0]) : () => {};
    try {
      if (command.active && pos[0]) atomicJson(path.join(path.resolve(pos[0]), '.cache/active-command.json'), { argv });
      const code = await command.run();
      return Number.isInteger(code) ? code : 0;
    } finally {
      unlock();
    }
  } catch (err) {
    error(`✗ ${err.message}`);
    return 1;
  }
}
