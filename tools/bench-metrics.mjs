// Development-only preload. Never imported by the production engine.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

let files={},processes=[],nested=0;
const descriptors=new Map(),original={...fs},write=fs.writeFileSync.bind(fs);
const filePath=value=>typeof value==='string'?path.resolve(value):value instanceof URL?fileURLToPath(value):null;
function record(file,bytes,request,complete) {
  if(!file)return;
  const row=files[file] ||= {bytes:0,maxReadRequest:0,completeReads:0};
  row.bytes+=bytes;row.maxReadRequest=Math.max(row.maxReadRequest,request);row.completeReads+=complete?1:0;
}
export function resetMetrics() {files={};processes=[];}
if(process.env.WKA_BENCH_PROBE==='1') {
  fs.readFileSync=function(file,...args) {
    nested++;
    try {
      const result=original.readFileSync.call(this,file,...args),bytes=Buffer.isBuffer(result)?result.length:Buffer.byteLength(result);
      record(filePath(file),bytes,bytes,true);return result;
    } finally {nested--;}
  };
  fs.openSync=function(file,...args) {
    const fd=original.openSync.call(this,file,...args);
    if(!nested) {try {const stat=original.fstatSync(fd);if(stat.isFile())descriptors.set(fd,{file:filePath(file),size:stat.size,bytes:0,contiguous:true});}catch{}}
    return fd;
  };
  fs.readSync=function(fd,buffer,...args) {
    const n=original.readSync.call(this,fd,buffer,...args),item=descriptors.get(fd);
    if(item&&!nested) {
      const options=args[0],position=typeof options==='object'?options.position:args[2];
      const request=typeof options==='object'?(options.length??buffer.length):(args[1]??buffer.length);
      if(position!=null&&position!==item.bytes)item.contiguous=false;
      item.bytes+=n;record(item.file,n,request,false);
    }
    return n;
  };
  fs.closeSync=function(fd) {
    const item=descriptors.get(fd);descriptors.delete(fd);
    if(item&&item.contiguous&&item.bytes===item.size)record(item.file,0,0,true);
    return original.closeSync.call(this,fd);
  };
  for(const name of ['spawn','spawnSync']) {
    const spawn=cp[name];
    cp[name]=function(command,args,...rest) {
      const row={command:String(command),args:Array.isArray(args)?args:[],kind:path.basename(String(command)),wallMs:null};
      processes.push(row);const start=performance.now(),child=spawn.call(this,command,args,...rest);
      if(name==='spawnSync')row.wallMs=performance.now()-start;
      else child.once('close',()=>{row.wallMs=performance.now()-start;});
      return child;
    };
  }
  syncBuiltinESMExports();
}
const cpu=process.cpuUsage();
process.once('exit',()=>{
  const out=process.env.WKA_BENCH_METRICS;
  if(out)write(out,JSON.stringify({scope:'main Node process only; maxRSS lifetime KiB; excludes browser/ffmpeg children',cpu:process.cpuUsage(cpu),maxRSSKiB:process.resourceUsage().maxRSS,instrumented:process.env.WKA_BENCH_PROBE==='1',files,processes}));
});
