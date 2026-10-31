import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const moduleFile=new URL('../../plugin/engine/core/file-hash.mjs',import.meta.url);
const api=fs.existsSync(moduleFile)?await import(moduleFile):{};
const CHUNK=1024*1024;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const nameOf=file=>file instanceof URL?fileURLToPath(file):file;
function fixture(t,size=0) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-hash-中文 空格-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'内容 #%.bin'),fd=fs.openSync(file,'wx');fs.ftruncateSync(fd,size);fs.closeSync(fd);return file;
}
function requireApi() {assert.equal(typeof api.hashFile,'function','bounded stable file hashing must be implemented');assert.equal(typeof api.updateHashFromFile,'function');}
function track(t,file) {
  const opened=new Set(),read=fs.readSync,open=fs.openSync,close=fs.closeSync;
  const observed={opened,requests:[],bytes:0,reads:0};
  t.mock.method(fs,'openSync',function(name,...args){const fd=open.call(this,name,...args);if(nameOf(name)===file)opened.add(fd);return fd;});
  t.mock.method(fs,'closeSync',function(fd){opened.delete(fd);return close.call(this,fd);});
  t.mock.method(fs,'readSync',function(fd,buffer,offset,length,position){
    const n=read.call(this,fd,buffer,offset,length,position);
    if(opened.has(fd)){observed.requests.push({buffer:buffer.length,length});observed.bytes+=n;observed.reads++;}
    return n;
  });
  return observed;
}

test('stable bytes match the independent original algorithm at empty and chunk boundaries', t=>{
  requireApi();
  for(const size of [0,1,CHUNK-1,CHUNK,CHUNK+1,CHUNK*2+137]) {
    const file=fixture(t),bytes=Buffer.alloc(size);for(let i=0;i<size;i++)bytes[i]=(i*37)%251;
    fs.writeFileSync(file,bytes);
    assert.equal(api.hashFile(file),sha(bytes));assert.equal(api.hashFile(pathToFileURL(file)),sha(bytes));
  }
});

test('256 MiB hashing uses at most 1 MiB reads/allocations and never a whole-file read', t=>{
  requireApi();const file=fixture(t,256*CHUNK),expected=sha(fs.readFileSync(file)),observed=track(t,file);
  const read=fs.readFileSync;
  t.mock.method(fs,'readFileSync',function(name,...args){assert.notEqual(nameOf(name),file,'no whole-file read');return read.call(this,name,...args);});
  for(const method of ['alloc','allocUnsafe','allocUnsafeSlow']) {
    const allocate=Buffer[method];t.mock.method(Buffer,method,function(size,...args){assert.ok(size<=CHUNK,`allocation ${size} exceeds bound`);return allocate.call(this,size,...args);});
  }
  assert.equal(api.hashFile(file),expected);assert.equal(observed.bytes,256*CHUNK);
  assert.ok(observed.requests.length>=256);assert.ok(observed.requests.every(r=>r.buffer<=CHUNK&&r.length<=CHUNK));assert.equal(observed.opened.size,0);
});

test('updates an existing hash with a same-open size prefix, raw bytes and a caller suffix', t=>{
  requireApi();const file=fixture(t),bytes=Buffer.from([0,255,1,2,13,10,128]);fs.writeFileSync(file,bytes);
  const hash=crypto.createHash('sha256').update('before\0');let prefixCalls=0;
  const count=api.updateHashFromFile(hash,file,{prefix:size=>{prefixCalls++;return `size:${size}\n`;}});hash.update('\0after');
  assert.equal(count,bytes.length);assert.equal(prefixCalls,1);
  assert.equal(hash.digest('hex'),crypto.createHash('sha256').update('before\0size:7\n').update(bytes).update('\0after').digest('hex'));
});

test('short reads continue using only actual bytes returned', t=>{
  requireApi();const file=fixture(t),bytes=Buffer.from('0123456789'.repeat(31));fs.writeFileSync(file,bytes);
  const read=fs.readSync;let calls=0;
  t.mock.method(fs,'readSync',function(fd,buffer,offset,length,position){calls++;return read.call(this,fd,buffer,offset,Math.min(length,7),position);});
  assert.equal(api.hashFile(file),sha(bytes));assert.ok(calls>40);
});

test('read errors and hash callback errors close their descriptors without partial success', t=>{
  requireApi();const file=fixture(t,CHUNK+1),observed=track(t,file),read=fs.readSync;let calls=0;
  t.mock.method(fs,'readSync',function(...args){if(++calls===2)throw Object.assign(Error('injected read failure'),{code:'EIO'});return read.apply(this,args);});
  assert.throws(()=>api.hashFile(file),/injected read failure/);assert.equal(observed.opened.size,0);
  assert.throws(()=>api.updateHashFromFile({update(){throw Error('hash update failure');}},file),/hash update failure/);assert.equal(observed.opened.size,0);
  assert.throws(()=>api.updateHashFromFile(crypto.createHash('sha256'),file,{prefix(){throw Error('prefix failure');}}),/prefix failure/);assert.equal(observed.opened.size,0);
});

for(const mutation of ['truncate','grow','replace','remove','rewrite-with-restored-mtime','early-eof'])test(`rejects ${mutation} during observation and releases the descriptor`, t=>{
  requireApi();const file=fixture(t,CHUNK+3);if(mutation==='rewrite-with-restored-mtime')fs.utimesSync(file,1234567890,1234567890);
  const before=fs.statSync(file),observed=track(t,file),read=fs.readSync;
  const replacement=file+'.new';if(mutation==='replace')fs.writeFileSync(replacement,Buffer.alloc(CHUNK+3,1));
  let first=true,mutated=false;
  t.mock.method(fs,'readSync',function(...args){
    if(mutation==='early-eof'&&!first){mutated=true;return 0;}
    const n=read.apply(this,args);
    if(first){first=false;
      if(mutation==='truncate')fs.truncateSync(file,3);
      if(mutation==='grow')fs.appendFileSync(file,'growth');
      // Rebind the path without overwriting an open destination (denied on Windows).
      if(mutation==='replace'){fs.renameSync(file,file+'.old');fs.renameSync(replacement,file);}
      if(mutation==='remove')fs.unlinkSync(file);
      if(mutation==='rewrite-with-restored-mtime'){fs.writeFileSync(file,Buffer.alloc(CHUNK+3,2));fs.utimesSync(file,before.atime,before.mtime);}
      if(mutation!=='early-eof')mutated=true;
    }
    return n;
  });
  assert.throws(()=>api.hashFile(file),error=>{
    assert.equal(mutated,true,'the fixture mutation must complete before the observation rejects it');
    // Windows can report a delete-pending open file as EPERM rather than ENOENT.
    if(mutation==='remove'&&process.platform==='win32'&&error.code==='EPERM')assert.equal(error.syscall,'stat');
    else assert.match(error.message,/变化|changed|ENOENT|EIO|读取|read/i);
    return true;
  });assert.equal(observed.opened.size,0);
  if(mutation==='replace')assert.equal(sha(fs.readFileSync(file)),sha(Buffer.alloc(CHUNK+3,1)),'the replacement must really occupy the observed path');
  if(mutation==='remove')assert.equal(fs.existsSync(file),false,'the file must really be removed after closing');
  if(mutation==='rewrite-with-restored-mtime')assert.equal(fs.statSync(file).mtimeMs,before.mtimeMs,'mtime really was restored exactly');
});

test('missing files and directories fail explicitly',t=>{
  requireApi();const file=fixture(t);assert.throws(()=>api.hashFile(file+'.missing'),{code:'ENOENT'});assert.throws(()=>api.hashFile(path.dirname(file)),/文件|file|directory|EISDIR|EPERM/i);
});
