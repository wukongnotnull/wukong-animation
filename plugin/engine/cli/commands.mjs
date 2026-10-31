import { environmentCommands } from './commands/environment.mjs';
import { projectCommands } from './commands/project.mjs';
import { reviewCommands } from './commands/review.mjs';
import { mediaCommands } from './commands/media.mjs';
import { audioCommands } from './commands/audio.mjs';
import { subtitlesFinalCommands } from './commands/subtitles-final.mjs';

// 唯一命令目录：处理器与保护策略一起维护。
export function commandsFor(context) {
  const groups = {
    'environment': environmentCommands(context),
    'project': projectCommands(context),
    'review': reviewCommands(context),
    'media': mediaCommands(context),
    'audio': audioCommands(context),
    'subtitles-final': subtitlesFinalCommands(context),
  };

  return {
    'delivery': { preflight: 'film', lock: 'final-record', active: false, run: groups['review']['delivery'] },
    'resume': { preflight: 'none', lock: 'none', active: false, run: groups['project']['resume'] },
    'setup': { preflight: 'none', lock: 'none', active: false, run: groups['environment']['setup'] },
    'check': { preflight: 'none', lock: 'none', active: false, run: groups['environment']['check'] },
    'list': { preflight: 'none', lock: 'none', active: false, run: groups['environment']['list'] },
    'init-project': { preflight: 'project', lock: 'none', active: false, run: groups['project']['init-project'] },
    'brief': { preflight: 'new-film', lock: 'none', active: false, run: groups['project']['brief'] },
    'new': { preflight: 'none', lock: 'none', active: false, run: groups['project']['new'] },
    'init': { preflight: 'new-film', lock: 'none', active: false, run: groups['project']['init'] },
    'signoff': { preflight: 'film', lock: 'film', active: true, run: groups['review']['signoff'] },
    'status': { preflight: 'none', lock: 'none', active: false, run: groups['project']['status'] },
    'qc': { preflight: 'film', lock: 'film', active: true, run: groups['review']['qc'] },
    'still': { preflight: 'film', lock: 'film', active: true, run: groups['media']['still'] },
    'animatic': { preflight: 'film', lock: 'film', active: true, run: groups['media']['animatic'] },
    'preview': { preflight: 'film', lock: 'film', active: true, run: groups['media']['preview'] },
    'clean': { preflight: 'film', lock: 'film', active: true, run: groups['media']['clean'] },
    'render': { preflight: 'film', lock: 'film', active: true, run: groups['media']['render'] },
    'soundtrack': { preflight: 'film', lock: 'film', active: true, run: groups['audio']['soundtrack'] },
    'sfx': { preflight: 'film-unless-list', lock: 'none', active: false, run: groups['audio']['sfx'] },
    'audition': { preflight: 'film', lock: 'none', active: false, run: groups['audio']['audition'] },
    'subtitles': { preflight: 'film', lock: 'film', active: true, run: groups['subtitles-final']['subtitles'] },
    'final': { preflight: 'film', lock: 'film', active: true, run: groups['subtitles-final']['final'] }
  };
}
