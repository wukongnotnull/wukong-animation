// 同步字节哈希；缓冲区有界，不保存摘要或跨调用的文件状态。
import fs from 'node:fs';
import crypto from 'node:crypto';

const CHUNK_BYTES = 1024 * 1024;
const versionOf = stat => [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');

// 只用于一次同步观察中的变化检测；不能代替下一次调用的内容读取。
export function fileVersion(file) {
  const stat=fs.statSync(file,{bigint:true,throwIfNoEntry:false});
  return stat ? versionOf(stat) : null;
}

export function updateHashFromFile(hash,file,{prefix}={}) {
  const fd=fs.openSync(file,'r');
  try {
    const stat=fs.fstatSync(fd,{bigint:true}),size=Number(stat.size);
    if(!stat.isFile())throw new Error(`不是普通文件：${file}`);
    if(!Number.isSafeInteger(size)||size<0)throw new Error(`文件大小无法精确读取：${file}`);
    if(prefix)hash.update(prefix(size));
    const buffer=Buffer.allocUnsafe(Math.min(CHUNK_BYTES,size||1));
    let total=0;
    while(total<size) {
      const count=fs.readSync(fd,buffer,0,Math.min(buffer.length,size-total),null);
      if(!count)throw new Error(`文件读取提前结束或发生变化：${file}`);
      hash.update(buffer.subarray(0,count));
      total+=count;
    }
    // 与打开的同一文件身份比较，同时拒绝路径替换、截断和同长度改写。
    if(fileVersion(file)!==versionOf(stat))throw new Error(`文件读取期间发生变化：${file}`);
    return total;
  } finally {fs.closeSync(fd);}
}

export function hashFile(file) {
  const hash=crypto.createHash('sha256');
  updateHashFromFile(hash,file);
  return hash.digest('hex');
}
