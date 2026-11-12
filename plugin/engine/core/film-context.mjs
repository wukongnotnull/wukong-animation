// 工程读取与上下文解析，不依赖渲染或交付编排。
import fs from 'node:fs';
import path from 'node:path';
import { getRegistry, getStyles } from './registry.mjs';
import { resolveStyle } from './resolver.mjs';
import { validate } from './validate.mjs';
import { migrateFilm } from './compat.mjs';
import { resolveVariant, overrideShotPath } from './variants.mjs';
import { assertActiveProduction } from './state.mjs';

/**
 * @param {{requireShots?: boolean, aspect?: string|null}} [o] requireShots: false 时不检查镜头文件是否存在（声轨这一步还没画镜头）；
 *   aspect: 要处理的画幅，缺省为主版。副版换成副版尺寸、优先用覆盖镜头文件 sNN.<后缀>.<扩展名>
 */
export function loadFilm(filmDir, { requireShots = true, aspect = null } = {}) {
  assertActiveProduction(filmDir);
  filmDir = path.resolve(filmDir);
  const file = path.join(filmDir, 'film.json');
  if (!fs.existsSync(file)) throw new Error(`找不到 ${file}`);
  const { film: rawFilm, renamed: legacyFields } = migrateFilm(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (rawFilm.subtitles && (rawFilm.subtitles.mode !== 'none' || Object.keys(rawFilm.subtitles).some(k => k !== 'mode'))) throw new Error('新制作流程不支持字幕，请移除字幕配置；画面标题与题字仍可使用。');
  if (Object.values(rawFilm.variants || {}).some(v => v.subtitles)) throw new Error('新制作流程不支持字幕画幅配置。');
  if (rawFilm.audio?.voice_source === 'ai' || (rawFilm.audio?.voices || []).some(v => v.voice || v.rate || v.pitch)) throw new Error('新制作流程仅使用用户提供的人声，不支持 AI 人声或自动变速。');
  const errs = validate('film', rawFilm, 'film.json');
  if (errs.length) throw new Error('film.json 校验失败:\n  ' + errs.join('\n  '));
  const ids = new Set();
  for (const shot of rawFilm.shots) {
    if (ids.has(shot.id)) throw new Error(`film.json 镜头编号重复：${shot.id}；请修改编号后重试`);
    ids.add(shot.id);
  }

  const registry = getRegistry();
  const { styles } = getStyles();
  const style = styles.get(rawFilm.style);
  if (!style) throw new Error(`film.json 使用的风格 "${rawFilm.style}" 不存在。可用: ${[...styles.keys()].join(', ')}`);
  const resolved = resolveStyle(style, registry);
  if (resolved.errors.length) throw new Error('风格解析失败:\n  ' + resolved.errors.join('\n  '));

  const variant = resolveVariant({ film: rawFilm, style, filmDir }, aspect);
  const film = variant.isMain ? rawFilm : { ...rawFilm, size: variant.size };

  let t = 0;
  const shots = film.shots.map((s) => {
    const shot = { ...s, start: t, path: overrideShotPath(path.join(filmDir, s.file), variant.isMain ? null : variant.suffix) };
    if (requireShots && !fs.existsSync(shot.path)) throw new Error(`镜头 ${s.id} 的文件不存在: ${s.file}`);
    t += s.duration;
    return shot;
  });

  const styleScripts = (style.scripts || []).map((p) => path.join(style.dir, p));
  const filmScripts = (film.scripts || []).map((p) => path.join(filmDir, p));
  return { film, filmDir, legacyFields, style, registry, ...resolved, shots, totalDuration: t, styleScripts, filmScripts, variant };
}

