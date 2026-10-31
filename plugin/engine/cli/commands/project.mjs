import fs from 'node:fs';
import path from 'node:path';
import { getStyles } from '../../core/registry.mjs';
import { ENGINE_ROOT, PLUGIN_ROOT, TEMPLATES_DIR, USER_STYLES_DIR } from '../../core/paths.mjs';
import { copyTemplate, NAME_RE } from '../../core/scaffold.mjs';
import { initProject } from '../../core/project.mjs';
import { recordProgress, listProductions, PRODUCTION_STEPS, LAST_STEP, flowDiagnostic } from '../../core/state.mjs';
import { recoveryStatus } from '../../core/operations.mjs';
import { fail } from '../context.mjs';

const STYLE_SCHEMA = path.join(ENGINE_ROOT, 'schemas', 'style.schema.json');
const STYLE_SCHEMA_URL = 'https://raw.githubusercontent.com/wukongnotnull/wukong-animation/main/plugin/engine/schemas/style.schema.json';

export function projectCommands({ pos, opt, log, aspectOpt }) {
  function cmdInit(name, { style, dir = '.', aspect = '16:9' }) {
    if (!name) fail('用法：wka init <片名> --style <id>');
    const { styles } = getStyles();
    const st = styles.get(style);
    if (!st) fail(`没有风格 "${style}"。可用：${[...styles.keys()].join(', ')}`);
    const filmDir = path.resolve(dir, 'films', name);
    if (fs.existsSync(path.join(filmDir, 'film.json'))) fail(`${filmDir} 已存在`);
    const tpl = path.join(TEMPLATES_DIR, 'film');
    fs.cpSync(tpl, filmDir, { recursive: true });
    const size = aspect === '9:16' ? [1080, 1920] : aspect === '1:1' ? [1080, 1080] : [1920, 1080];
    const film = JSON.parse(fs.readFileSync(path.join(filmDir, 'film.json'), 'utf8'));
    Object.assign(film, { title: name, style: st.id, size, fps: st.fps });
    // 模板里两种镜头写法都有：remotion 管线用 React 组件（.tsx），其余用 wk.shot（.js）
    const ext = st.pipeline === 'remotion' ? 'tsx' : 'js';
    fs.rmSync(path.join(filmDir, 'shots', ext === 'tsx' ? 's01.js' : 's01.tsx'), { force: true });
    film.shots = film.shots.map((s) => ({ ...s, file: s.file.replace(/\.js$/, `.${ext}`) }));
    fs.writeFileSync(path.join(filmDir, 'film.json'), JSON.stringify(film, null, 2) + '\n');
    log(`✓ 已创建 ${path.relative(process.cwd(), filmDir) || '.'}（风格 ${st.name} · ${size.join('×')} @${st.fps}fps）`);
    log(`  风格文档：${path.join(st.dir, 'STYLE.md')}`);
    log(`  技术文档：${path.join(st.dir, 'TECH.md')}`);
  }

  function cmdBrief(name, { dir = '.' }) {
    if (!name) fail('用法：wka brief <片名> [--dir 项目目录]');
    const filmDir = path.resolve(dir, 'films', name);
    const brief = path.join(filmDir, 'brief.md');
    if (fs.existsSync(brief)) fail(`${brief} 已存在`);
    const tpl = fs.readFileSync(path.join(TEMPLATES_DIR, 'brief.md'), 'utf8');
    fs.mkdirSync(filmDir, { recursive: true });
    fs.writeFileSync(brief, tpl.replaceAll('<片名>', name));
    recordProgress(filmDir, { step: 1, note: '建立占位片目录' });
    log(`✓ 已创建 ${path.relative(process.cwd(), brief) || brief}`);
  }

  function cmdNew(what, id, { name, category = 'custom', order = 101, dest = USER_STYLES_DIR }) {
    if (what !== 'style') fail('wka new 只支持 style（工具包、管线、导出器要在插件仓库里实现）');
    if (!id || !NAME_RE.test(id) || !name || name === true) fail('用法：wka new style <id> --name 名称 [--category 分类] [--order N] [--dest 目录]（id 只用小写字母、数字和连字符）');
    if (!/^\d+$/.test(String(order)) || Number(order) < 1 || Number(order) > 999) fail(`--order 要是 1–999 的整数，收到 "${order}"`);
    const dir = path.resolve(dest, id);
    if (fs.existsSync(dir)) fail(`${dir} 已存在`);
    const inPlugin = !path.relative(PLUGIN_ROOT, dir).startsWith('..');
    copyTemplate(path.join(TEMPLATES_DIR, 'style-skill'), dir, {
      ID: id,
      NAME: name,
      CATEGORY: category,
      ORDER: Number(order),
      SCHEMA: inPlugin ? path.relative(dir, STYLE_SCHEMA).split(path.sep).join('/') : STYLE_SCHEMA_URL,
      GLOBAL: id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()),
      ONE_LINE: '（一句话特征）',
      WHEN: '（什么样的片子）',
    });
    log(`✓ 已创建 ${dir}（第 ${order} 变）`);
    log('  下一步：写 STYLE.md 十节 → TECH.md → scripts/style.js → examples/ 示范片 → wka list styles 校验');
  }
  return {
    'resume': async () => {
      if(!pos[0]) throw new Error('用法：wka resume <片目录> [--json]');
      const diagnostic=flowDiagnostic(pos[0]);
      if(diagnostic){log(opt('json')?JSON.stringify(diagnostic,null,2):diagnostic.error);return 1;}
      const status=recoveryStatus(path.resolve(pos[0]));
      log(opt('json')?JSON.stringify(status,null,2):[...status.stages.map(s=>`[${s.aspect} ${s.proxy?'小样':'高清'} · ${s.stage}] ${s.status}${s.error?'：'+s.error:''}`),status.next].join('\n'));return;
    },
    'init-project': async () => {
      log('项目初始化');
      initProject(pos[0] || '.', { log });
      return;
    },
    'brief': async () => {
      return cmdBrief(pos[0], { dir: opt('dir', '.') });
    },
    'new': async () => {
      return cmdNew(pos[0], pos[1], { name: opt('name'), category: opt('category', 'custom'), order: opt('order', 101), dest: opt('dest', USER_STYLES_DIR) });
    },
    'init': async () => {
      return cmdInit(pos[0], { style: opt('style'), dir: opt('dir', '.'), aspect: opt('aspect', '16:9') });
    },
    'status': async () => {
      let exitCode = 0;
      const list = listProductions(pos[0] || '.');
      if (!list.length) return log('还没有片子。用 wka init <片名> --style <id> 开始。');
      for (const f of list) {
        log(`${f.name}  《${f.title}》 ${f.style}`);
        if(f.compatible===false){log(`  ${f.error}`);exitCode=1;continue;}
        if (f.migrated) log(`  · 进度已按新流程（${LAST_STEP} 道工序）换算`);
        log(`  进度 ${f.step}/${LAST_STEP}${f.step ? ` 「${PRODUCTION_STEPS[f.step]}」` : ''}  →  下一步：${f.next ? `${f.next}. ${f.nextLabel}` : '已完成'}`);
        if (f.last) log(`  最近：${f.last.at.slice(0, 16).replace('T', ' ')}  ${f.last.note}`);
        for (const a of f.staleVariants) log(`  ! ${a} 副版已过期：主版在第 13 道重新签批过，要重做第 14 道「改版」`);
      }
      return exitCode;
    }
  };
}
