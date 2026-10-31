import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
// Only repository prose is eligible: skill instructions and unknown paths run media checks.
export const documentationOnly=files=>files.length>0&&files.every(f=>/^(README\.md|LICENSE(?:\.[A-Za-z]+)?|docs\/.+\.(md|txt))$/.test(f));
export function gatePassed(docs,results){
 return ['lint','installation','jianying'].every(k=>results[k]==='success')&&
   (results.smoke==='success'||(docs&&results.smoke==='skipped'));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='classify'){
  const files=execFileSync('git',['diff','--name-only','-z',process.argv[3],process.argv[4]],{encoding:'utf8'}).split('\0').filter(Boolean);
  console.log('docs='+documentationOnly(files));
 }else{
  const needs=JSON.parse(process.env.GATE_NEEDS||'{}');
  const passed=needs.changes?.result==='success'&&gatePassed(needs.changes.outputs.docs==='true',Object.fromEntries(['lint','installation','jianying','smoke'].map(k=>[k,needs[k]?.result])));
  console.log(JSON.stringify(needs));if(!passed)process.exitCode=1;
 }
}
