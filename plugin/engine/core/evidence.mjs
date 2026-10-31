// 本地证据共享原语：内容签名、原子保存、可读失败。这里不推断审批或产物有效性。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hashFile } from './file-hash.mjs';

export const digest = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const fileDigest = file => hashFile(file);
export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; }
}
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.part`;
  try { fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n'); fs.renameSync(tmp,file); }
  finally { fs.rmSync(tmp,{force:true}); }
}
export function fileEvidence(file,readDigest=fileDigest) {
  const stat=fs.statSync(file);
  if(!stat.isFile() || !stat.size) throw new Error(`文件为空或不是文件：${file}`);
  return {file:path.resolve(file),size:stat.size,sha256:readDigest(file)};
}
export function treeEvidence(dir, exclude=()=>false, readDigest=fileDigest) {
  if(!fs.existsSync(dir)) return [];
  const rows=[];
  const walk=(base)=>{for(const ent of fs.readdirSync(base,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const file=path.join(base,ent.name),rel=path.relative(dir,file);
    if(exclude(rel,ent)) continue;
    if(ent.isDirectory()) walk(file);
    else if(ent.isFile()) rows.push({path:rel,sha256:readDigest(file),size:fs.statSync(file).size});
  }};
  walk(dir); return rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export function evidenceMatches(items) {
  try { return items.length>0 && items.every(i=>fileDigest(i.file)===i.sha256 && fs.statSync(i.file).size===i.size); }
  catch { return false; }
}
