// 交付输入读取与冲突检查，供报告和终版共用。
import fs from 'node:fs';
import path from 'node:path';
import { loadFilm } from './film-context.mjs';
import { validate } from './validate.mjs';
import { aspectOf } from './variants.mjs';

export function fileLink(file,{host='codex',cwd=process.cwd()}={}) {
  if(!['codex','claude','generic'].includes(host)) throw new Error('host 应为 codex、claude 或 generic');
  if(host==='generic')return null;
  const absolute=path.resolve(file),relative=path.relative(cwd,absolute);
  const target=host==='claude'&&!relative.startsWith('..')?relative:absolute;
  const label=absolute.replace(/([\\[\]])/g,'\\$1');
  const encoded=encodeURI(target).replace(/#/g,'%23').replace(/\(/g,'%28').replace(/\)/g,'%29');
  return `[${label}](<${encoded}>)`;
}
export function readDecisions(dir) {
  const file=path.join(dir,'.wka/decisions.json');
  if(!fs.existsSync(file)) return {version:1,delivery:{status:'unknown'}};
  let value;try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){throw new Error(`decisions.json：${e.message}`);}
  const errors=validate('decisions',value,'decisions.json');
  for(const key of ['delivery','aspects','subtitles','materials']) {
    const item=value[key];
    if(item?.status==='confirmed'&&(!item.source?.trim()||item.value===undefined)) errors.push(`decisions.json.${key}：明确选择需要值与实际来源`);
    if(key==='materials'&&Array.isArray(item?.value)) for(const m of item.value) if(m.path&&!fs.existsSync(path.resolve(dir,m.path))) errors.push(`decisions.json.materials：素材缺失 ${m.path}`);
  }
  if(errors.length) throw new Error(errors.join('；'));
  return value;
}
export function decisionConflicts(ctx,decisions) {
  const errors=[];
  const main=loadFilm(ctx.filmDir,{requireShots:false});
  if(decisions.aspects?.status==='confirmed'&&JSON.stringify(decisions.aspects.value)!==JSON.stringify([aspectOf(main.film.size),...Object.keys(main.film.variants||{})])) errors.push('已确认画幅与 film.json 不一致，请核实最新明确选择');
  if(decisions.subtitles?.status==='confirmed') {
    const chosen=decisions.subtitles.value;
    if(chosen.mode!==(ctx.film.subtitles?.mode||'none')||!!chosen.bilingual!==!!ctx.film.subtitles?.bilingual) errors.push('已确认字幕方式/双语与 film.json 不一致，请核实最新明确选择');
  }
  return errors;
}
