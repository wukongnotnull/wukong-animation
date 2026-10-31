import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { sourceState, runStage } from '../../plugin/engine/core/operations.mjs';
import { fileEvidence, treeEvidence } from '../../plugin/engine/core/evidence.mjs';

const digest=value=>crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const oldFile=file=>{const st=fs.statSync(file);if(!st.isFile()||!st.size)throw Error('empty file');return digest(fs.readFileSync(file));};
function oldTree(dir,exclude=()=>false) {
  if(!fs.existsSync(dir))return [];
  const rows=[];
  const walk=base=>{for(const ent of fs.readdirSync(base,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const file=path.join(base,ent.name),rel=path.relative(dir,file);if(exclude(rel,ent))continue;
    if(ent.isDirectory())walk(file);else if(ent.isFile())rows.push({path:rel,sha256:digest(fs.readFileSync(file)),size:fs.statSync(file).size});
  }};walk(dir);return rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
// Independent pre-optimization projection: duplicate declarations remain in the data.
function legacy(dir) {
  const roots=['film.json','brief.md','story.md','storyboard.md','sync-points.json','subtitle-layout.json','review-notes.json','.wka/decisions.json'];
  const data=roots.map(rel=>[rel,fs.existsSync(path.join(dir,rel))?oldFile(path.join(dir,rel)):null]);
  let film={};try{film=JSON.parse(fs.readFileSync(path.join(dir,'film.json'),'utf8'));}catch{}
  const references=[...(film.scripts||[]),...(film.shots||[]).map(s=>s.file),...(film.audio?.tracks||[]).map(t=>t.file),...(film.audio?.voices||[]).map(t=>t.file)].filter(Boolean);
  for(const rel of references)data.push([rel,fs.existsSync(path.resolve(dir,rel))?oldFile(path.resolve(dir,rel)):null]);
  data.push(['shots',oldTree(path.join(dir,'shots'))],['audio',oldTree(path.join(dir,'audio'),(rel,ent)=>ent.isDirectory()&&ent.name==='generated')]);
  if(fs.existsSync(dir))for(const f of fs.readdirSync(dir).filter(f=>/^subtitles.*\.(srt|json)$/.test(f)))data.push([f,oldFile(path.join(dir,f))]);
  return digest(data);
}
function fixture(t,count=3) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-source-state-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const sub of ['shots','audio/generated','other'])fs.mkdirSync(path.join(dir,sub),{recursive:true});
  const shots=Array.from({length:count},(_,i)=>{const id=`s${String(i+1).padStart(3,'0')}`,file=`shots/${id}.js`;fs.writeFileSync(path.join(dir,file),`shot ${id}`);return {id,file,duration:2.05};});
  fs.writeFileSync(path.join(dir,'shots/empty.txt'),'');
  fs.writeFileSync(path.join(dir,'audio/track.wav'),Buffer.alloc(1024*1024+31,7));
  fs.writeFileSync(path.join(dir,'audio/generated/ignored.wav'),'ignored');
  fs.writeFileSync(path.join(dir,'other/s001.js'),'different directory');
  fs.writeFileSync(path.join(dir,'brief.md'),'brief one');
  fs.writeFileSync(path.join(dir,'subtitles.srt'),'1\n00:00:00,000 --> 00:00:01,000\n字幕\n');
  const film={shots,scripts:['shots/../shots/s001.js','other/s001.js','missing.js'],audio:{tracks:[{file:'audio/track.wav'},{file:'audio/../audio/track.wav'}],voices:[]}};
  fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify(film));return dir;
}
function countReads(t,dir) {
  const files=new Map(),fds=new Map(),open=fs.openSync,read=fs.readSync,whole=fs.readFileSync,close=fs.closeSync;let nested=0;
  const add=(file,bytes,complete)=>{const row=files.get(file)||{bytes:0,passes:0};row.bytes+=bytes;row.passes+=complete?1:0;files.set(file,row);};
  t.mock.method(fs,'readFileSync',function(file,...args){nested++;try{const bytes=whole.call(this,file,...args);if(typeof file==='string'&&path.resolve(file).startsWith(dir+path.sep))add(path.resolve(file),Buffer.byteLength(bytes),true);return bytes;}finally{nested--;}});
  t.mock.method(fs,'openSync',function(file,flags,...args){const fd=open.call(this,file,flags,...args);if(!nested&&typeof file==='string'&&path.resolve(file).startsWith(dir+path.sep))fds.set(fd,{file:path.resolve(file),size:fs.fstatSync(fd).size,bytes:0,read:false});return fd;});
  t.mock.method(fs,'readSync',function(fd,...args){const n=read.call(this,fd,...args),entry=fds.get(fd);if(entry&&!nested){entry.read=true;entry.bytes+=n;add(entry.file,n,false);}return n;});
  t.mock.method(fs,'closeSync',function(fd){const entry=fds.get(fd);if(entry?.read&&entry.bytes===entry.size)add(entry.file,0,true);fds.delete(fd);return close.call(this,fd);});
  return files;
}

test('107-shot source state preserves the old projection and hashes each normalized source once',t=>{
  const dir=fixture(t,107),expected=legacy(dir),counts=countReads(t,dir);
  assert.equal(sourceState(dir),expected);
  for(const relative of ['audio/track.wav',...Array.from({length:107},(_,i)=>`shots/s${String(i+1).padStart(3,'0')}.js`),'other/s001.js']) {
    const file=path.join(dir,relative);assert.deepEqual(counts.get(file),{bytes:fs.statSync(file).size,passes:1},relative);
  }
  assert.equal(sourceState(dir),expected);
  for(const relative of ['audio/track.wav','shots/s001.js'])assert.equal(counts.get(path.join(dir,relative)).passes,2,'a separate call must re-read even completely unchanged files');
});

test('separate calls re-read same-length edits even after mtime restoration; add/delete/rename remain visible',t=>{
  const dir=fixture(t),file=path.join(dir,'shots/s001.js');fs.utimesSync(file,1234567890,1234567890);
  const stat=fs.statSync(file),before=sourceState(dir);
  fs.writeFileSync(file,'shot NEW!');fs.utimesSync(file,stat.atime,stat.mtime);
  assert.equal(fs.statSync(file).size,stat.size);assert.equal(fs.statSync(file).mtimeMs,stat.mtimeMs);assert.notEqual(sourceState(dir),before);assert.equal(sourceState(dir),legacy(dir));
  const after=sourceState(dir);fs.writeFileSync(path.join(dir,'shots/added.js'),'added');assert.notEqual(sourceState(dir),after);assert.equal(sourceState(dir),legacy(dir));
  fs.renameSync(path.join(dir,'shots/added.js'),path.join(dir,'shots/renamed.js'));assert.equal(sourceState(dir),legacy(dir));
  fs.rmSync(file);assert.equal(sourceState(dir),legacy(dir));
});

test('generated audio exclusion, missing references and distinct hard-link paths retain their semantics',t=>{
  const dir=fixture(t),before=sourceState(dir);
  fs.writeFileSync(path.join(dir,'audio/generated/ignored.wav'),'new generated data');assert.equal(sourceState(dir),before);
  const original=path.join(dir,'audio/track.wav'),alias=path.join(dir,'other/track.wav');fs.linkSync(original,alias);
  const film=JSON.parse(fs.readFileSync(path.join(dir,'film.json')));film.audio.voices=[{file:'other/track.wav'}];fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify(film));
  const expected=legacy(dir),counts=countReads(t,dir);assert.equal(sourceState(dir),expected);
  assert.equal(counts.get(original).passes,1);assert.equal(counts.get(alias).passes,1,'different normalized paths must not be merged by inode');
});

test('default evidence calls do not inherit a sourceState observation',t=>{
  const dir=fixture(t);sourceState(dir);const counts=countReads(t,dir),file=path.join(dir,'audio/track.wav');
  fileEvidence(file);fileEvidence(file);assert.equal(counts.get(file).passes,2);
  treeEvidence(path.join(dir,'audio'));treeEvidence(path.join(dir,'audio'));assert.equal(counts.get(file).passes,4);
});

test('an explicitly declared generated file still participates even though the generated tree is excluded',t=>{
  const dir=fixture(t),manifest=path.join(dir,'film.json'),file=path.join(dir,'audio/generated/ignored.wav');
  const film=JSON.parse(fs.readFileSync(manifest));film.audio.voices=[{file:'audio/generated/ignored.wav'}];fs.writeFileSync(manifest,JSON.stringify(film));
  const before=sourceState(dir);assert.equal(before,legacy(dir));
  fs.writeFileSync(file,'changed declared generated voice');
  assert.notEqual(sourceState(dir),before);assert.equal(sourceState(dir),legacy(dir));
});

test('writes to excluded generated audio and unrelated cache files do not invalidate an observation',t=>{
  const dir=fixture(t),expected=legacy(dir),readdir=fs.readdirSync;let changed=false;
  t.mock.method(fs,'readdirSync',function(file,...args){const entries=readdir.call(this,file,...args);if(file===path.join(dir,'audio')&&!changed){changed=true;
    fs.writeFileSync(path.join(dir,'audio/generated/new.wav'),'generated');fs.mkdirSync(path.join(dir,'.cache'),{recursive:true});fs.writeFileSync(path.join(dir,'.cache/work.tmp'),'cache');
  }return entries;});
  assert.equal(sourceState(dir),expected);assert.equal(changed,true);
});

test('an earlier source changed during a later read is rejected at observation end',t=>{
  const dir=fixture(t),target=path.join(dir,'brief.md'),audio=path.join(dir,'audio/track.wav');
  // readdir is a boundary used by both implementations, independent of hashing chunk size.
  const readdir=fs.readdirSync;let changed=false;
  t.mock.method(fs,'readdirSync',function(file,...args){const entries=readdir.call(this,file,...args);if(file===path.dirname(audio)&&!changed){changed=true;fs.writeFileSync(target,'brief two');}return entries;});
  assert.throws(()=>sourceState(dir),/变化|changed|观察|observation/i);
});

test('new/deleted source entries after a tree traversal cannot produce a completed snapshot',t=>{
  for(const mutation of ['add','remove','replace','missing-appears']) {
    const dir=fixture(t),readdir=fs.readdirSync;let changed=false;
    const mock=t.mock.method(fs,'readdirSync',function(file,...args){const entries=readdir.call(this,file,...args);if(file===path.join(dir,'audio')&&!changed){changed=true;
      if(mutation==='add')fs.writeFileSync(path.join(dir,'shots/added.js'),'late');
      if(mutation==='remove')fs.rmSync(path.join(dir,'shots/s001.js'));
      if(mutation==='replace'){
        const target=path.join(dir,'shots/s001.js'),stat=fs.statSync(target),replacement=path.join(dir,'replacement');
        fs.writeFileSync(replacement,'shot NEW!');fs.utimesSync(replacement,stat.atime,stat.mtime);fs.renameSync(replacement,target);
      }
      if(mutation==='missing-appears')fs.writeFileSync(path.join(dir,'missing.js'),'late');
    }return entries;});
    assert.throws(()=>sourceState(dir),/变化|changed|观察|observation|ENOENT/i,mutation);mock.mock.restore();
  }
});

test('stage execution writes the source identity observed after await, never an earlier cached digest',async t=>{
  const dir=fixture(t),before=sourceState(dir),file=path.join(dir,'audio/track.wav'),out=path.join(dir,'out');
  await runStage(dir,{stage:'bench',aspect:'16:9',signature:'s',log:()=>{},run:async()=>{
    await Promise.resolve();const fd=fs.openSync(file,'r+');fs.writeSync(fd,Buffer.from([8]),0,1,0);fs.closeSync(fd);fs.writeFileSync(out,'output');return {value:out,outputs:[out]};
  }});
  const current=sourceState(dir),ledger=JSON.parse(fs.readFileSync(path.join(dir,'.cache/operations.json')));
  assert.notEqual(current,before);assert.equal(ledger.stages['16:9|full|bench'].sourceState,current);
});

test('an unstable observation records a failed stage and preserves user approval bytes',async t=>{
  const dir=fixture(t),out=path.join(dir,'out'),state=path.join(dir,'.wka/state.json');fs.mkdirSync(path.dirname(state));
  const approval=JSON.stringify({flow:5,step:13,history:[],approved:{mainId:'keep'}});fs.writeFileSync(state,approval);
  const readdir=fs.readdirSync;let changed=false;
  t.mock.method(fs,'readdirSync',function(file,...args){const entries=readdir.call(this,file,...args);if(file===path.join(dir,'audio')&&!changed){changed=true;fs.writeFileSync(path.join(dir,'brief.md'),'brief two');}return entries;});
  await assert.rejects(runStage(dir,{stage:'bench',aspect:'16:9',signature:'s',log:()=>{},run:async()=>{fs.writeFileSync(out,'output');return {value:out,outputs:[out]};}}),/变化|changed|观察|observation/i);
  const ledger=JSON.parse(fs.readFileSync(path.join(dir,'.cache/operations.json')));
  assert.equal(ledger.stages['16:9|full|bench'].status,'failed');assert.equal(fs.readFileSync(state,'utf8'),approval);
});
