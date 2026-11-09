// Deterministic, disposable benchmark inputs. Never receives a customer film.
import fs from 'node:fs';
import path from 'node:path';

export function writeBytes(file, size) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const fd=fs.openSync(file,'wx'), block=Buffer.alloc(1024*1024);
  for(let i=0;i<block.length;i++) block[i]=(i*31+17)%251;
  try {for(let left=size;left>0;) {const n=Math.min(left,block.length);fs.writeSync(fd,block,0,n);left-=n;}}
  finally {fs.closeSync(fd);}
}

export function writePcm(file, dataBytes) {
  dataBytes=Math.ceil(dataBytes/4)*4;
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const header=Buffer.alloc(44), block=Buffer.alloc(48000*4);
  header.write('RIFF');header.writeUInt32LE(dataBytes+36,4);header.write('WAVEfmt ',8);
  header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(2,22);
  header.writeUInt32LE(48000,24);header.writeUInt32LE(192000,28);header.writeUInt16LE(4,32);header.writeUInt16LE(16,34);
  header.write('data',36);header.writeUInt32LE(dataBytes,40);
  const fd=fs.openSync(file,'wx');
  try {
    fs.writeSync(fd,header);
    // Alternate one second of tone and silence: later preview intervals can be checked.
    for(let offset=0;offset<dataBytes;offset+=block.length) {
      block.fill(0);
      if(Math.floor(offset/block.length)%2===0) for(let i=0;i<48000;i++) {
        const value=Math.round(3000*Math.sin(2*Math.PI*440*i/48000));block.writeInt16LE(value,i*4);block.writeInt16LE(value,i*4+2);
      }
      fs.writeSync(fd,block,0,Math.min(block.length,dataBytes-offset));
    }
  } finally {fs.closeSync(fd);}
}

export function writeSynthetic(dir,{pipeline,home,count=107,audioBytes=Math.ceil(count*2.05*192000)}) {
  fs.mkdirSync(path.join(dir,'shots'),{recursive:true});
  const style=`bench-${pipeline}`,styleDir=path.join(home,'styles',style);
  fs.mkdirSync(styleDir,{recursive:true});
  fs.writeFileSync(path.join(styleDir,'style.json'),JSON.stringify({id:style,name:'Performance fixture',category:'xinxi',order:999,engine:'>=0.1.0',pipeline,kits:{},fonts:[],fps:30,aspects:['16:9','9:16'],keywords:['benchmark']}));
  const shots=Array.from({length:count},(_,i)=>{
    const id=`s${String(i+1).padStart(3,'0')}`,file=`shots/${id}.${pipeline==='browser'?'js':'tsx'}`;
    const color=i%2?'#234567':'#345678';
    fs.writeFileSync(path.join(dir,file),pipeline==='browser'
      ? `wk.shot({render(ctx,t,s){ctx.fillStyle='${color}';ctx.fillRect(0,0,s.W,s.H);ctx.fillStyle='#fafafa';ctx.fillRect(20+t*8,30,40,40);}});\n`
      : `import React from 'react';import {AbsoluteFill,useCurrentFrame,useVideoConfig} from 'remotion';export default function Shot(){const frame=useCurrentFrame(),{fps}=useVideoConfig();return <AbsoluteFill style={{background:'${color}'}}><div style={{position:'absolute',left:20+frame/fps*8,top:30,width:40,height:40,background:'#fafafa'}}/></AbsoluteFill>;}\n`);
    return {id,file,duration:2.05,full_bleed:true};
  });
  writePcm(path.join(dir,'audio/track.wav'),audioBytes);
  const film={title:'Performance fixture',style,size:[512,288],fps:30,seed:731,shots,audio:{voice_source:'none',voices:[],tracks:[{file:'audio/track.wav',start:0,gain:1}]},subtitles:{mode:'none'},export:{formats:['mp4'],name:'benchmark'}};
  fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify(film,null,2)+'\n');return film;
}

export const BUILTIN_FIXTURE_STYLES = Object.freeze({'ink-wash':'browser',keynote:'remotion'});

// Independent geometry, generated only in a disposable test directory. No demo assets.
export function writeBuiltinFixture(dir,pipeline,{audio=true}={}) {
  const style=Object.keys(BUILTIN_FIXTURE_STYLES).find(id=>BUILTIN_FIXTURE_STYLES[id]===pipeline);
  if(!style)throw new Error('Unsupported fixture pipeline: '+pipeline);
  fs.mkdirSync(path.join(dir,'shots'),{recursive:true});
  const shots=Array.from({length:3},(_,i)=>{
    const id=`s${String(i+1).padStart(2,'0')}`,file=`shots/${id}.${pipeline==='browser'?'js':'tsx'}`;
    const color=i%2?'#234567':'#345678';
    fs.writeFileSync(path.join(dir,file),pipeline==='browser'
      ? `wk.shot({render(ctx,t,s){ctx.fillStyle='${color}';ctx.fillRect(0,0,s.W,s.H);ctx.fillStyle='#fafafa';ctx.fillRect((0.2+t*0.05)*s.W,0.3*s.H,0.1*s.W,0.2*s.H);}});\n`
      : `import React from 'react';import {AbsoluteFill,useCurrentFrame,useVideoConfig} from 'remotion';export default function Shot(){const frame=useCurrentFrame(),{fps}=useVideoConfig();return <AbsoluteFill style={{background:'${color}'}}><div style={{position:'absolute',left:(20+frame/fps*5)+'%',top:'30%',width:'10%',height:'20%',background:'#fafafa'}}/></AbsoluteFill>;}\n`);
    return {id,file,duration:2,full_bleed:true};
  });
  const film={title:'Rendering fixture',style,size:[512,288],fps:30,seed:731,shots,subtitles:{mode:'none'},variants:{'9:16':{}},export:{formats:['mp4'],name:'fixture'}};
  if(audio){
    writePcm(path.join(dir,'audio/track.wav'),6*192000);
    film.audio={voice_source:'none',voices:[],tracks:[{file:'audio/track.wav',start:0,gain:1}]};
  }
  fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify(film,null,2)+'\n');return film;
}

export function restoreFixture(snapshot,live,mode) {
  if(path.resolve(snapshot)===path.resolve(live))throw new Error('snapshot and live must be distinct');
  if(!['cold','unchanged','single'].includes(mode))throw new Error('invalid fixture mode');
  fs.rmSync(live,{recursive:true,force:true});fs.cpSync(snapshot,live,{recursive:true});
  if(mode==='single') {
    const film=JSON.parse(fs.readFileSync(path.join(live,'film.json')));
    fs.appendFileSync(path.join(live,film.shots[0].file),'\n// benchmark single shot: same picture, new source identity\n');
  }
}
