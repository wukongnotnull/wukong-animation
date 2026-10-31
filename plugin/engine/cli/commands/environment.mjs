import { spawnSync } from 'node:child_process';
import { getRegistry, getStyles, loadModule } from '../../core/registry.mjs';
import { ENGINE_VERSION, PLUGIN_ROOT, HOME } from '../../core/paths.mjs';
import { dependencyInfo } from '../../core/deps.mjs';
import { setupDependencies } from '../../core/setup.mjs';
import { hasGit } from '../../core/project.mjs';
import { hasFfmpeg } from '../../core/ffmpeg.mjs';
import { detectTtsEngine } from '../../audio/tts.mjs';
import { resolveStyle } from '../../core/resolver.mjs';
import { fail } from '../context.mjs';
import { installationDiagnostics } from '../../core/installation-diagnostics.mjs';

const CATS = { dongfang: '东方神韵', shouhui: '手绘绘画', pingmian: '平面排版', katong: '卡通漫画', youxi: '游戏数字', dianying: '电影年代', caizhi: '材质 3D', xinxi: '信息叙事', custom: '自定义' };

export function environmentCommands({ pos, opt, log, aspectOpt }) {
  async function cmdCheck() {
    log(`wukong-animation 引擎 ${ENGINE_VERSION}  ·  Node ${process.version}`);
    log(`  插件目录 ${PLUGIN_ROOT}`);
    log(`  用户目录 ${HOME}`);
    const reg = getRegistry();
    let bad = 0;
    try {
      const deps = dependencyInfo();
      log(`  依赖目录 ${deps.root}（${deps.source} · ${deps.identity.slice(0, 12)}）`);
    } catch (e) { log(`  ✗ 依赖未就绪：${e.message}`); bad++; }
    log('\n基础工具');
    const tools = [
      ['ffmpeg', hasFfmpeg(), '必需：编码与混音'],
      ['git', hasGit(), '推荐：项目版本管理'],
      ['python3 + fonttools', spawnSync('python3', ['-c', 'import fontTools'], { stdio: 'ignore' }).status === 0, '推荐：中文字体子集化'],
      ['pyJianYingDraft', spawnSync('python3', ['-c', 'import pyJianYingDraft'], { stdio: 'ignore' }).status === 0, '可选：导出剪映草稿（pip install pyJianYingDraft==0.3.1）'],
    ];
    for (const [n, ok, why] of tools) log(`  ${ok ? '✓' : '✗'} ${n.padEnd(20)} ${why}`);
    if (!tools[0][1]) bad++;
    const tts = detectTtsEngine();
    log(`  ${tts.length ? '✓' : '·'} TTS                  ${tts.length ? tts.join(', ') : '未安装（可选：kokoro / edge-tts）'}`);

    log('\n管线');
    for (const p of reg.pipelines.values()) {
      if (p.status === 'planned') {
        log(`  · ${p.name.padEnd(10)} 规划中`);
        continue;
      }
      const r = await (await loadModule(p)).check();
      log(`  ${r.ok ? '✓' : '✗'} ${p.name.padEnd(10)} ${r.ok ? p.status : '缺少 ' + r.missing.join('、')}`);
      if (!r.ok) bad++;
    }
    log('\n工具包');
    for (const k of reg.kits.values()) log(`  ${k.status === 'planned' ? '·' : '✓'} ${k.name.padEnd(10)} ${k.version.padEnd(7)} ${k.status}`);
    log('\n导出器');
    for (const e of reg.exporters.values()) log(`  ✓ ${e.name.padEnd(10)} .${e.ext}`);
    const { styles, problems } = getStyles();
    const usable = [...styles.values()].filter((s) => resolveStyle(s, reg).errors.length === 0);
    log(`\n风格  ${usable.length} 个可用 / ${styles.size} 个已登记`);
    const all = [...reg.problems, ...problems];
    if (all.length) {
      log('\n问题');
      for (const p of all) log(`  ✗ ${p}`);
      bad += all.length;
    }
    log(bad ? `\n有 ${bad} 项需要处理。依赖缺失请运行 /wukong-animation:setup` : '\n一切就绪 ✓');
    return bad;
  }

  function cmdSetup() {
    setupDependencies({ log });
    if (!hasFfmpeg()) log('! 还缺 ffmpeg：macOS 用 brew install ffmpeg，Ubuntu 用 sudo apt install ffmpeg');
    if (!hasGit()) log('! 推荐安装 git，用于为每个审片节点做定版存档');
    if (spawnSync('python3', ['-c', 'import fontTools'], { stdio: 'ignore' }).status !== 0) {
      log('! 推荐：pip install fonttools brotli（中文字体子集化，渲染更快、体积更小）');
    }
    log('完成。运行 wka check 确认。');
  }

  function cmdList(what = 'styles') {
    const reg = getRegistry();
    if (what === 'styles') {
      const { styles } = getStyles();
      const rows = [...styles.values()].sort((a, b) => a.order - b.order);
      for (const s of rows) {
        const ok = resolveStyle(s, reg).errors.length === 0;
        log(`${String(s.order).padStart(2, '0')}  ${s.id.padEnd(18)} ${s.name.padEnd(8)} ${(CATS[s.category] || s.category).padEnd(6)} ${s.pipeline}/${Object.keys(s.kits).join('+')}${ok ? '' : '  (不可用)'}${s.origin === 'user' ? '  [用户]' : ''}`);
      }
      if (!rows.length) log('（还没有风格）');
      return;
    }
    const map = { pipelines: reg.pipelines, kits: reg.kits, exporters: reg.exporters }[what];
    if (!map) fail(`未知类别 ${what}`);
    for (const x of map.values()) log(`${x.name.padEnd(12)} ${x.version.padEnd(7)} ${x.status.padEnd(12)} ${x.description}`);
  }
  return {
    'setup': async () => {
      return cmdSetup();
    },
    'check': async () => {
      if(opt('upgrade')) {
        const result=installationDiagnostics();
        if(opt('json'))log(JSON.stringify(result,null,2));
        else {log(`插件 ${result.plugin.version||'未知'} · 引擎 ${result.engine.version||'未知'}`);log(`路径 ${result.plugin.root} · 来源 ${result.installation.kind}`);log(`依赖 ${result.dependencies?.root||'未就绪'}`);for(const text of [...result.guidance,...result.warnings])log('  '+text);}
        return result.exitCode;
      }
      return (await cmdCheck()) ? 1 : 0;
    },
    'list': async () => {
      return cmdList(pos[0]);
    }
  };
}
