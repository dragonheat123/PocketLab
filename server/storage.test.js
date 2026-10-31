import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readJson,writeJson} from './storage.js';

test('concurrent saves stay ordered and unsupported rename keeps a recoverable previous snapshot',async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'pocketlab-storage-')),file=path.join(directory,'workspace.json'),rename=fs.rename;
  try{
    await Promise.all([writeJson(file,{version:1}),writeJson(file,{version:2})]);assert.deepEqual(await readJson(file),{version:2});
    fs.rename=async()=>{throw Object.assign(new Error('unsupported mount operation'),{code:'ENOSYS'});};
    await writeJson(file,{version:3});assert.deepEqual(await readJson(file),{version:3});assert.deepEqual(JSON.parse(await fs.readFile(file+'.previous','utf8')),{version:2});
    await fs.writeFile(file,'incomplete upload');assert.deepEqual(await readJson(file),{version:2});assert.ok(!(await fs.readdir(directory)).some(name=>name.endsWith('.tmp')));
    fs.rename=async()=>{throw Object.assign(new Error('permission denied'),{code:'EACCES'});};
    await assert.rejects(writeJson(file,{version:4}),{code:'EACCES'});
  }finally{fs.rename=rename;await fs.rm(directory,{recursive:true,force:true});}
});
