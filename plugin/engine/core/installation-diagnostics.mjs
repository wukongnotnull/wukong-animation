import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileDigest} from './evidence.mjs';
import {PLUGIN_ROOT} from './paths.mjs';
import {dependencyInfo} from './deps.mjs';

/** Explicit, offline diagnostics. Never runs setup or a marketplace command. */
export function installationDiagnostics({pluginRoot=PLUGIN_ROOT,dependency=dependencyInfo,configFile=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'config.toml')}={}){
 const warnings=[];let failed=false;
 const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT'){failed=true;warnings.push('无法读取清单：'+path.basename(file));}return null;}};
 const root=fs.realpathSync(pluginRoot),manifest=read(path.join(root,'plugin.json')),bundle=read(path.join(root,'bundle.json')),engine=read(path.join(root,'engine/package.json'));
 let kind='unknown',version=manifest?.version||null,sourceCommit=null;
 if(bundle){
  kind='portable';version=bundle.pluginVersion||null;sourceCommit=bundle.sourceCommit||null;
  try{
   if(bundle.schemaVersion!==1||!Array.isArray(bundle.files)||!bundle.files.length)throw Error();
   for(const item of bundle.files){
    if(typeof item.path!=='string'||path.isAbsolute(item.path))throw Error();
    const file=path.resolve(root,item.path);if(!file.startsWith(root+path.sep)||fs.realpathSync(file)!==file||!fs.statSync(file).isFile()||fileDigest(file)!==item.sha256)throw Error();
   }
   if(bundle.engineVersion!==engine?.version)throw Error();
  }catch{failed=true;warnings.push('便携包身份或资源摘要不一致');}
 }else if(fs.existsSync(path.join(root,'../.git'))){kind='development';}
 else if(manifest){
  const native=read(path.join(root,'.codex-plugin/plugin.json')),claude=read(path.join(root,'.claude-plugin/plugin.json'));
  if(native||claude){kind='native';if([native,claude].filter(Boolean).some(m=>m.name!==manifest.name||m.version!==version)){failed=true;warnings.push('原生清单版本或名称冲突');}}
 }
 if(typeof version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)||typeof engine?.version!=='string'){failed=true;warnings.push('缺少插件或引擎版本证据');}
 let dependencies=null;try{dependencies=dependency();}catch{failed=true;warnings.push('依赖未就绪，请运行当前安装的 setup 后重新检查');}
 try{
  const text=fs.readFileSync(configFile,'utf8');let entry=null;const entries=[];
  for(const line of text.split(/\r?\n/)){
   if(line.trim().startsWith('[')){
    const match=line.match(/^\s*\[marketplaces\.(?:"([^"\\]+)"|([A-Za-z0-9_-]+))\]\s*$/);
    if(!match&&line.includes('[marketplaces.'))warnings.push('部分 marketplace 配置格式无法识别，请用宿主工具核对');
    entry=match?{name:match[1]||match[2]}:null;if(entry)entries.push(entry);continue;
   }
   if(!entry)continue;
   const value=line.match(/^\s*(source_type|source)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*$/);
   if(!value&&/^\s*(source_type|source)\s*=/.test(line))warnings.push('部分 marketplace 配置格式无法识别，请用宿主工具核对');
   if(value){try{entry[value[1]]=value[2][0]==="'"?value[2].slice(1,-1):JSON.parse(value[2]);}catch{warnings.push('部分宿主配置格式无法识别');}}
  }
  for(const e of entries)if(e.source_type==='local'&&typeof e.source==='string'&&path.isAbsolute(e.source)&&!['.agents/plugins/marketplace.json','.claude-plugin/marketplace.json'].some(f=>fs.existsSync(path.join(e.source,f))))warnings.push(`marketplace ${e.name} 的本地目录缺少清单：${e.source}；请手动核对该条目，保留其他配置`);
 }catch(e){if(e.code!=='ENOENT')warnings.push('无法读取宿主配置；本插件身份诊断继续');}
 warnings.push('离线诊断未查询远端最新版本；宿主是否已重载无法判断');
 if(kind==='unknown')warnings.push('安装来源证据不足');
 const guidance=kind==='portable'?['下载同一发布版本的 ZIP 与 SHA256SUMS 并核对摘要','使用新包安装器和原 agent、scope、project、variant 执行 upgrade']:kind==='native'?['已识别原生包格式；具体宿主和安装渠道需核对','若通过 Codex wukong-animation marketplace 安装：codex plugin marketplace upgrade wukong-animation；随后 codex plugin add wukong-animation@wukong-animation','更新后打开新聊天，必要时按宿主要求重载']:kind==='development'?['通过当前仓库的正常 Git 更新和开发初始化流程维护']:['先核对实际安装渠道，再选择该渠道的更新方式'];
 const normalized=v=>typeof v==='string'&&/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(v)?v:null;
 return {schemaVersion:1,plugin:{version:normalized(version),root},engine:{version:normalized(engine?.version)},installation:{kind,sourceCommit,hostLoaded:null,latestVersion:null},dependencies,guidance,warnings,exitCode:failed?1:0};
}
