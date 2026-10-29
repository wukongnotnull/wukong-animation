#!/usr/bin/env node
// 源码构建允许 Git；发布后的安装器不依赖 Git。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { filesAt,sha,validateBundle } from './install-agent.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p,value)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,value);};
// ZIP store：固定 DOS 时间、UTF-8 文件名、排序，无外部 zip 工具或平台元数据。
function crc32(data){let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zip(entries){const local=[],central=[];let offset=0;for(const [name,data] of entries){
 const n=Buffer.from(name),crc=crc32(data),h=Buffer.alloc(30),c=Buffer.alloc(46);
 h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(33,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(n.length,26);
 c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
 local.push(h,n,data);central.push(c,n);offset+=h.length+n.length+data.length;
 }const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);}
export function build(out) {
 out=path.resolve(out);if(out===ROOT||!out.startsWith(ROOT+path.sep)&&out===path.parse(out).root)throw new Error('无效输出目录');
 const bundle=path.join(out,'wukong-animation');
 if(fs.existsSync(bundle)){
  // 只替换本构建器的产物，避免误删用户目录。
  validateBundle(bundle);fs.rmSync(bundle,{recursive:true});
 }
 const tracked=execFileSync('git',['ls-files','-z','--','plugin/engine','plugin/skills','plugin/catalog.json'],{cwd:ROOT,encoding:'utf8'}).split('\0').filter(Boolean);
 const required=tracked.filter(p=>!p.includes('/node_modules/')&&!p.includes('/.cache/'));
 if(!required.length)throw new Error('缺少运行资源');
 for(const source of required){
  const stat=fs.lstatSync(path.join(ROOT,source));if(!stat.isFile())throw new Error('运行资源必须是普通文件：'+source);
  let relative=source.slice('plugin/'.length).replace(/(^|\/)SKILL\.md$/,'$1INSTRUCTIONS.md');
  let data=fs.readFileSync(path.join(ROOT,source));
  if(source.endsWith('.md'))data=Buffer.from(data.toString('utf8').replaceAll('SKILL.md','INSTRUCTIONS.md'));
  write(path.join(bundle,relative),data);
 }
 for(const name of ['SKILL.md'])write(path.join(bundle,name),fs.readFileSync(path.join(ROOT,'distribution/portable',name)));
 write(path.join(bundle,'LICENSE'),fs.readFileSync(path.join(ROOT,'LICENSE')));
 const pluginVersion=json(path.join(ROOT,'plugin/plugin.json')).version;
 const manifest={schemaVersion:1,pluginVersion,engineVersion:json(path.join(bundle,'engine/package.json')).version,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),entry:'SKILL.md',files:filesAt(bundle).map(p=>({path:p,sha256:sha(path.join(bundle,p))}))};
 write(path.join(bundle,'bundle.json'),JSON.stringify(manifest,null,2)+'\n');validateBundle(bundle);
 // 只检查明确的文档路径，不把教学占位符当运行资源。
 for(const file of filesAt(bundle).filter(f=>f.endsWith('.md'))){
  const text=fs.readFileSync(path.join(bundle,file),'utf8');
  for(const m of text.matchAll(/\]\(([^)]+\.md)\)/g)){
   if(/^(https?:|<|#)/.test(m[1]))continue;
   const dest=path.resolve(bundle,path.dirname(file),m[1]);
   if(!dest.startsWith(bundle+path.sep)||!fs.existsSync(dest))throw new Error(`指令链接缺失：${file} → ${m[1]}`);
  }
 }
 for(const [source,dest] of [['tools/install-agent.mjs','install-agent.mjs'],['distribution/agents.json','agents.json']])write(path.join(out,dest),fs.readFileSync(path.join(ROOT,source)));
 const name=`wukong-animation-agent-skills-v${pluginVersion}.zip`;
 const entries=[...filesAt(bundle).map(p=>['wukong-animation/'+p,fs.readFileSync(path.join(bundle,p))]),...['install-agent.mjs','agents.json'].map(p=>[p,fs.readFileSync(path.join(out,p))])].sort((a,b)=>a[0].localeCompare(b[0],'en'));
 write(path.join(out,name),zip(entries));write(path.join(out,'SHA256SUMS'),sha(path.join(out,name))+'  '+name+'\n');
 return {bundle,archive:path.join(out,name),files:manifest.files.length,version:pluginVersion,sourceCommit:manifest.sourceCommit};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--out'))throw new Error('用法：node tools/build-portable.mjs [--out <目录>]');console.log(JSON.stringify(build(args[1]||path.join(ROOT,'dist')),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
