#!/usr/bin/env node
// Explicit developer benchmark; production commands never import this module.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeBytes, writeSynthetic, copyExample, restoreFixture } from '../tests/fixtures/performance.mjs';

const self=fileURLToPath(import.meta.url),metrics=fileURLToPath(new URL('./bench-metrics.mjs',import.meta.url));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const json=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
export function parseOptions(args) {
  const options={rounds:5,suite:'hash',timeout:1200000};
  for(let i=0;i<args.length;i+=2) {
    const key=args[i].replace(/^--/,'');
    if(!['engine','candidate','suite','rounds','out','cases','timeout'].includes(key))throw new Error(`unknown option ${args[i]}`);
    if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`missing value for ${key}`);
    options[key]=args[i+1];
  }
  for(const key of ['engine',...(options.candidate?['candidate']:[])]) {
    if(!options[key])throw new Error('engine is required');
    options[key]=path.resolve(options[key]);
    for(const file of ['package.json','package-lock.json','bin/wka.mjs','core/dependency-manifest.mjs'])if(!fs.existsSync(path.join(options[key],file)))throw new Error(`engine missing ${file}: ${options[key]}`);
  }
  options.rounds=Number(options.rounds);options.timeout=Number(options.timeout);
  if(!Number.isInteger(options.rounds)||options.rounds<5)throw new Error('rounds must be an integer >= 5');
  if(!Number.isFinite(options.timeout)||options.timeout<100)throw new Error('timeout must be >= 100 ms');
  if(!['hash','workflow'].includes(options.suite))throw new Error('suite must be hash or workflow');
  if(!options.out)throw new Error('out is required');options.out=path.resolve(options.out);
  if(options.cases)options.cases=options.cases.split(',');
  return options;
}
export function claimOutput(out) {fs.mkdirSync(out);json(path.join(out,'owner.json'),{tool:self,pid:process.pid,created:new Date().toISOString()});}
export function summarize(rows,expected) {
  const valid=rows.filter(row=>row.ok),times=valid.map(r=>r.wallMs).sort((a,b)=>a-b),n=times.length;
  return {ok:rows.length===expected&&n===expected&&new Set(rows.map(r=>r.round)).size===expected,expected,total:rows.length,valid:n,failed:rows.length-n,medianMs:n?(times[Math.floor((n-1)/2)]+times[Math.floor(n/2)])/2:null,minMs:n?times[0]:null,maxMs:n?times[n-1]:null};
}
export async function runCommand(command,args,{log,timeoutMs=1200000,env=process.env,accepted=[0]}={}) {
  const fd=fs.openSync(log,'wx'),start=performance.now();
  return new Promise(resolve=>{
    let timedOut=false,error=null,settled=false;
    const child=spawn(command,args,{env,stdio:['ignore',fd,fd],detached:process.platform!=='win32'});
    const stop=()=>{
      if(!child.pid)return;
      try {
        if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});
        else process.kill(-child.pid,'SIGKILL');
      } catch(e) {if(e.code!=='ESRCH')error=String(e);}
    };
    const timer=setTimeout(()=>{timedOut=true;stop();},timeoutMs);
    const interrupt=()=>{error='benchmark interrupted';stop();};
    process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
    child.once('error',e=>{error=String(e);});
    child.once('close',(code,signal)=>{
      if(settled)return;settled=true;clearTimeout(timer);fs.closeSync(fd);
      process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);
      resolve({command,args,log,code,signal,timedOut,error,wallMs:performance.now()-start,ok:!timedOut&&!error&&accepted.includes(code)});
    });
  });
}
function identity(engine) {
  const git=args=>{const r=spawnSync('git',['-C',engine,...args],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
  const status=git(['status','--porcelain']);
  if(status)throw new Error(`engine checkout must be clean: ${engine}`);
  return {engine,commit:git(['rev-parse','HEAD']),package:sha(path.join(engine,'package.json')),lock:sha(path.join(engine,'package-lock.json'))};
}
export function plannedScenarios(options) {
  if(options.suite==='hash')return [8,64,256].flatMap(n=>['fileDigest','sourceState','deliverySnapshot'].map(method=>`${method}-${n}MiB`));
  const cases=['browser','remotion'].flatMap(pipeline=>['example','long','large-audio'].map(fixture=>`${pipeline}-${fixture}`));
  if(options.cases?.some(name=>!cases.includes(name)))throw Error('unknown workflow case');
  return cases.filter(name=>!options.cases||options.cases.includes(name)).flatMap(name=>[
    ...['preview','render'].flatMap(command=>['cold','unchanged','single'].map(mode=>`${name}-${command}-${mode}`)),
    ...(name.endsWith('-example')?[]:['resume','qc','delivery'].map(command=>`${name}-${command}`))
  ]);
}
function summaries(rows,rounds,environment) {
  const keys=environment.engines.flatMap(engine=>environment.scenarios.map(scenario=>`${engine.label}/${scenario}`));
  return Object.fromEntries(keys.map(key=>[key,summarize(rows.filter(r=>!r.instrumented&&`${r.engineLabel}/${r.scenario}`===key),rounds)]));
}
async function measured(ctx,scenario,round,args,{instrumented=false,accepted=[0],validate}={}) {
  const name=`${ctx.label}-${scenario}-${instrumented?'probe':round}`,log=path.join(ctx.out,`${name}.log`),metricFile=path.join(ctx.out,`${name}.metrics.json`);
  const result=await runCommand(process.execPath,['--import',metrics,...args],{log,timeoutMs:ctx.timeout,accepted,env:{...ctx.env,WKA_BENCH_METRICS:metricFile,WKA_BENCH_PROBE:instrumented?'1':'0'}});
  const row={...result,engineLabel:ctx.label,scenario,round,instrumented,metrics:fs.existsSync(metricFile)?read(metricFile):null};
  if(row.ok&&validate)try{row.validation=await validate(row);}catch(e){row.ok=false;row.error=String(e);}
  if(row.validation?.operationMs!==undefined){row.commandWallMs=row.wallMs;row.wallMs=row.validation.operationMs;}
  ctx.rows.push(row);json(path.join(ctx.out,'results.json'),{complete:false,environment:ctx.environment,rows:ctx.rows,summaries:summaries(ctx.rows,ctx.rounds,ctx.environment)});
  console.log(`${ctx.label} ${scenario} ${instrumented?'probe':round} ${row.ok?'OK':'FAIL'} ${(row.wallMs/1000).toFixed(2)}s${row.error?' '+row.error:''}`);
  if(!row.ok)throw new Error(`benchmark failed; retained ${log}: ${row.error||row.code}`);
  return row;
}
async function hashWorker(engine,method,dir,out) {
  const {resetMetrics}=await import('./bench-metrics.mjs');
  const {fileDigest}=await import(pathToFileURL(path.join(engine,'core/evidence.mjs')));
  const {sourceState}=await import(pathToFileURL(path.join(engine,'core/operations.mjs')));
  const {deliverySnapshot}=await import(pathToFileURL(path.join(engine,'core/final-delivery.mjs')));
  const target=path.join(dir,'audio/track.wav');resetMetrics();
  const cpu=process.cpuUsage(),start=performance.now();
  const result=method==='fileDigest'?fileDigest(target):method==='sourceState'?sourceState(dir):deliverySnapshot(target);
  json(out,{operationMs:performance.now()-start,cpu:process.cpuUsage(cpu),result});
}
async function hashSuite(contexts,options) {
  for(const size of [8,64,256]) {
    for(const ctx of contexts) {
      const dir=path.join(ctx.root,`hash-${size}`);writeSynthetic(dir,{pipeline:'browser',home:ctx.home,audioBytes:4});
      fs.rmSync(path.join(dir,'audio/track.wav'));writeBytes(path.join(dir,'audio/track.wav'),size*1024*1024);ctx.fixture=dir;
    }
    for(const method of ['fileDigest','sourceState','deliverySnapshot'])for(let round=1;round<=options.rounds+1;round++) {
      for(const ctx of round%2?[...contexts]:[...contexts].reverse()) {
        const instrumented=round>options.rounds,scenario=`${method}-${size}MiB`,out=path.join(ctx.out,`${ctx.label}-${scenario}-${round}.operation.json`);
        await measured(ctx,scenario,round,[self,'--hash-worker',ctx.engine,method,ctx.fixture,out],{instrumented,validate:()=>read(out)});
      }
    }
  }
}
async function wka(ctx,args,name) {
  const row=await runCommand(process.execPath,[path.join(ctx.engine,'bin/wka.mjs'),...args],{env:ctx.env,timeoutMs:ctx.timeout,log:path.join(ctx.out,`${ctx.label}-prepare-${name}.log`)});
  ctx.preparations.push(row);json(path.join(ctx.out,'preparations.json'),contextsPreparations(ctx));
  if(!row.ok)throw Error(`preparation failed: ${row.log}`);return row;
}
function contextsPreparations(ctx) {return {note:'Outside measured command times',rows:ctx.preparations};}
function movieInfo(file) {
  const p=spawnSync('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_type,width,height,avg_frame_rate,nb_read_frames,duration','-of','json',file],{encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
  if(p.status!==0)throw Error(`output probe failed: ${file}: ${p.stderr}`);return JSON.parse(p.stdout).streams;
}
function audioEnvelope(file,start,duration) {
  const r=spawnSync('ffmpeg',['-v','error','-ss',String(start),'-i',file,'-t',String(duration),'-map','0:a:0','-ac','1','-ar','8000','-f','s16le','-'],{timeout:120000,maxBuffer:1024*1024});
  if(r.status!==0)throw Error(`audio interval decoding failed: ${file}: ${r.stderr}`);
  const values=[];
  for(let base=0;base+1600<=r.stdout.length;base+=1600){let sum=0;for(let i=base;i<base+1600;i+=2)sum+=Math.abs(r.stdout.readInt16LE(i));values.push(sum/800);}
  return values;
}
function checkPreviewAudio(dir,shots,fps) {
  for(const shot of [shots[0],shots.at(-1)]) {
    const duration=Math.min(2,shot.frames/fps),expected=audioEnvelope(path.join(dir,'.cache/mix.wav'),shot.start/fps,duration);
    const actual=audioEnvelope(path.join(dir,'review/局部小样',`${shot.id}.mp4`),0,duration);
    if(!expected.length||actual.length!==expected.length)throw Error('preview audio interval length mismatch');
    const peak=Math.max(1,...expected),error=expected.reduce((n,value,i)=>n+Math.abs(value-actual[i]),0)/expected.length;
    if(error>peak*0.15+20)throw Error(`preview audio interval mismatch: ${shot.id}`);
  }
}
function validateWorkflow(ctx,film,dir,command,mode,row) {
  const log=fs.readFileSync(row.log,'utf8'),matches=[...log.matchAll(/渲染 (\d+) 个镜头用时/g)];
  const rerendered=matches.reduce((n,m)=>n+Number(m[1]),0),expected=mode==='cold'?film.shots.length:mode==='single'?1:0;
  if(rerendered!==expected)throw Error(`rerender count ${rerendered}, expected ${expected}`);
  const fps=Math.min(15,film.fps),scale=Math.min(1,960/Math.max(...film.size)),size=film.size.map(n=>Math.max(2,Math.round(n*scale/2)*2));
  let elapsed=0;
  const expectedShots=film.shots.map(s=>{const start=Math.round(elapsed*fps);elapsed+=s.duration;return {...s,start,frames:Math.round(elapsed*fps)-start};});
  const outputs=command==='preview'?expectedShots.map(s=>({file:path.join(dir,'review/局部小样',`${s.id}.mp4`),frames:s.frames})): [{file:path.join(dir,'review/小样.mp4'),frames:Math.round(elapsed*fps)}];
  for(const output of outputs) {
    const streams=movieInfo(output.file),v=streams.find(s=>s.codec_type==='video');
    const [num,den]=v?.avg_frame_rate?.split('/').map(Number)||[];
    if(!v||v.width!==size[0]||v.height!==size[1]||num/den!==fps||Number(v.nb_read_frames)!==output.frames||!streams.some(s=>s.codec_type==='audio'))throw Error(`unexpected media specification: ${output.file}`);
  }
  if(command==='preview')checkPreviewAudio(dir,expectedShots,fps);
  return {rerendered,outputs:outputs.length,size,fps,frames:Math.round(elapsed*fps),audio:true,...(command==='preview'?{audioIntervalsChecked:[expectedShots[0].id,expectedShots.at(-1).id]}:{})};
}
async function workflowSuite(contexts,options) {
  for(const ctx of contexts) {
    await wka(ctx,['setup'],'setup');
    const file=path.join(ctx.out,`${ctx.label}-runtime.json`);
    const row=await runCommand(process.execPath,[self,'--runtime-worker',ctx.engine,file],{env:ctx.env,timeoutMs:ctx.timeout,log:path.join(ctx.out,`${ctx.label}-runtime.log`)});
    if(!row.ok)throw Error(`dependency verification failed: ${row.log}`);
    ctx.runtime=read(file);
  }
  if(contexts.some(ctx=>JSON.stringify(ctx.runtime)!==JSON.stringify(contexts[0].runtime)))throw Error('runtime identities differ between engines');
  for(const pipeline of ['browser','remotion'])for(const fixture of ['example','long','large-audio']) {
    const caseName=`${pipeline}-${fixture}`;
    if(options.cases&&!options.cases.includes(caseName))continue;
    for(const ctx of contexts) {
      const dir=path.join(ctx.root,caseName);const film=fixture==='example'?copyExample(ctx.engine,dir,pipeline):writeSynthetic(dir,{pipeline,home:ctx.home,...(fixture==='large-audio'?{audioBytes:256*1024*1024}:{} )});
      await wka(ctx,['soundtrack',dir],`${caseName}-soundtrack`);
      ctx.case={dir,film,pristine:path.join(ctx.root,`${caseName}-pristine`)};fs.cpSync(dir,ctx.case.pristine,{recursive:true});
      json(path.join(ctx.out,`${ctx.label}-${caseName}-fixture.json`),{film,seconds:film.shots.reduce((sum,shot)=>sum+shot.duration,0),audio:{bytes:fs.statSync(path.join(dir,'audio/track.wav')).size,sha256:sha(path.join(dir,'audio/track.wav')),interval:[0,film.shots.reduce((sum,shot)=>sum+shot.duration,0)]},runtime:ctx.runtime,cacheStates:{cold:'soundtrack prepared, no rendered shots',unchanged:'completed command snapshot',single:'same snapshot plus comment in first shot'}});
    }
    for(const command of ['preview','render']) {
      for(const ctx of contexts) {
        restoreFixture(ctx.case.pristine,ctx.case.dir,'cold');
        const args=[command,ctx.case.dir,...(command==='render'?['--proxy']:[])];
        await wka(ctx,args,`${caseName}-${command}`);
        ctx.case.warm=path.join(ctx.root,`${caseName}-${command}-warm`);fs.cpSync(ctx.case.dir,ctx.case.warm,{recursive:true});
      }
      for(const mode of ['cold','unchanged','single'])for(let round=1;round<=options.rounds+1;round++)for(const ctx of round%2?[...contexts]:[...contexts].reverse()) {
        restoreFixture(mode==='cold'?ctx.case.pristine:ctx.case.warm,ctx.case.dir,mode);
        await measured(ctx,`${caseName}-${command}-${mode}`,round,[path.join(ctx.engine,'bin/wka.mjs'),command,ctx.case.dir,...(command==='render'?['--proxy']:[])],{instrumented:round>options.rounds,validate:row=>validateWorkflow(ctx,ctx.case.film,ctx.case.dir,command,mode,row)});
      }
    }
    if(fixture!=='example')for(const ctx of contexts) {
      restoreFixture(ctx.case.warm,ctx.case.dir,'unchanged');
      await wka(ctx,['final',ctx.case.dir,'--formats','mp4'],`${caseName}-final`);
      const boundary=path.join(ctx.root,`${caseName}-completed`);fs.cpSync(ctx.case.dir,boundary,{recursive:true});ctx.case.warm=boundary;
      const coreCheck=await runCommand(process.execPath,[self,'--readonly-worker',ctx.engine,ctx.case.dir],{env:ctx.env,timeoutMs:ctx.timeout,log:path.join(ctx.out,`${ctx.label}-${caseName}-readonly.log`)});
      if(!coreCheck.ok)throw Error(`read-only delivery check failed: ${coreCheck.log}`);
    }
    if(fixture!=='example')for(const command of ['resume','qc','delivery'])for(let round=1;round<=options.rounds+1;round++)for(const ctx of round%2?[...contexts]:[...contexts].reverse()) {
      restoreFixture(ctx.case.warm,ctx.case.dir,'unchanged');
      const before=treeIdentity(ctx.case.dir);
      await measured(ctx,`${caseName}-${command}`,round,[path.join(ctx.engine,'bin/wka.mjs'),command,ctx.case.dir,...(command==='delivery'?['--final','--json']:command==='resume'?['--json']:[])],{instrumented:round>options.rounds,accepted:command==='delivery'?[2]:[0],validate:row=>{
        if(command!=='qc') {
          const after=treeIdentity(ctx.case.dir),allowed=command==='delivery'?['最终交付清单.json','最终交付清单.md','最终交付审计.json','最终交付审计.md'].map(name=>'review/'+name):[];
          for(const name of new Set([...Object.keys(before),...Object.keys(after)]))if(!allowed.includes(name)&&before[name]!==after[name])throw Error(`unexpected boundary write: ${name}`);
        }
        if(command==='delivery') {const report=read(row.log);if(report.ok!==false||!report.items?.some(item=>item.link)||report.items.some(item=>item.acceptance==='accepted'))throw Error('real output must remain linked and unapproved');return {blockedWithoutUserApproval:true};}
        return {code:row.code};
      }});
    }
  }
}
function treeIdentity(dir) {
  const rows={};
  const walk=base=>{for(const entry of fs.readdirSync(base,{withFileTypes:true})){
    const file=path.join(base,entry.name);if(entry.isDirectory())walk(file);else {const stat=fs.statSync(file,{bigint:true});rows[path.relative(dir,file).split(path.sep).join('/')]=`${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;}
  }};walk(dir);return rows;
}
async function runtimeWorker(engine,out) {
  const {dependencyInfo,requireDep}=await import(pathToFileURL(path.join(engine,'core/deps.mjs')));
  const {headlessShellFrom}=await import(pathToFileURL(path.join(engine,'pipelines/remotion/entry.mjs')));
  const info=dependencyInfo(),browser=requireDep('playwright').chromium.executablePath(),shell=headlessShellFrom(browser,fs);
  if(!shell)throw Error('pinned Chromium headless shell required');
  json(out,{identity:info.identity,browser:{file:browser,sha256:sha(browser)},headless:{file:shell,sha256:sha(shell)},versions:Object.fromEntries(['playwright','remotion','@remotion/bundler','@remotion/renderer','react','react-dom'].map(name=>[name,read(path.join(info.root,'node_modules',name,'package.json')).version]))});
}
async function main() {
  if(process.argv[2]==='--hash-worker')return hashWorker(...process.argv.slice(3));
  if(process.argv[2]==='--runtime-worker')return runtimeWorker(...process.argv.slice(3));
  if(process.argv[2]==='--readonly-worker') {
    const [engine,dir]=process.argv.slice(3),before=treeIdentity(dir);
    const {finalDeliveryReport}=await import(pathToFileURL(path.join(engine,'core/final-delivery.mjs')));
    const report=finalDeliveryReport(dir);
    if(report.ok||JSON.stringify(before)!==JSON.stringify(treeIdentity(dir)))throw Error('core final delivery changed inputs or accepted unsigned fixture');
    return;
  }
  const options=parseOptions(process.argv.slice(2));
  const engines=[{label:'baseline',engine:options.engine},...(options.candidate?[{label:'candidate',engine:options.candidate}]:[])];
  const identities=engines.map(e=>({...e,...identity(e.engine)}));
  if(identities.some(i=>i.lock!==identities[0].lock||i.package!==identities[0].package))throw Error('comparison requires identical locked dependencies');
  claimOutput(options.out);
  const version=command=>{const r=spawnSync(command,['-version'],{encoding:'utf8',timeout:10000});return {code:r.status,version:(r.stdout||r.stderr||'').split('\n')[0]};};
  const environment={started:new Date().toISOString(),options,scenarios:plannedScenarios(options),node:process.version,platform:process.platform,arch:process.arch,cpus:os.cpus().length,cpu:os.cpus()[0]?.model,memory:os.totalmem(),engines:identities,tool:{file:self,sha256:sha(self),metrics:sha(metrics),fixtures:sha(fileURLToPath(new URL('../tests/fixtures/performance.mjs',import.meta.url)))},ffmpeg:version('ffmpeg'),ffprobe:version('ffprobe'),osFileCache:'uncontrolled; never purged',memoryScope:'main Node lifetime maximum RSS KiB, excludes descendants',timing:'uninstrumented samples; one separate attribution probe after timed rounds; setup/restore/output validation excluded; hash operation time additionally excludes module imports',audioInterval:'track start 0; mixed to film duration; alternating one-second tone/silence',workers:process.env.WKA_WORKERS||'engine defaults',fontDownload:false};
  json(path.join(options.out,'environment.json'),environment);
  const rows=[],preparations=[];
  const contexts=engines.map(e=>{
    const root=path.join(options.out,e.label),home=path.join(root,'home');fs.mkdirSync(home,{recursive:true});
    return {...e,...options,label:e.label,engine:e.engine,root,home,rows,preparations,environment,env:{...process.env,WUKONG_ANIMATION_HOME:home,WKA_JIANYING_DRAFTS:path.join(root,'drafts'),WKA_NO_FONT_DOWNLOAD:'1'}};
  });
  await (options.suite==='hash'?hashSuite:workflowSuite)(contexts,options);
  json(path.join(options.out,'results.json'),{complete:true,environment,rows,summaries:summaries(rows,options.rounds,environment)});
}
if(process.argv[1]&&path.resolve(process.argv[1])===self)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
