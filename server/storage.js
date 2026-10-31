import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const pending=new Map();
export async function readJson(file){
  try{return JSON.parse(await fs.readFile(file,'utf8'));}
  catch(error){try{return JSON.parse(await fs.readFile(file+'.previous','utf8'));}catch{throw error;}}
}
/** Serialize each file's commits. Object-store mounts do not implement rename. */
export function writeJson(file,value){
  const data=JSON.stringify(value);
  const task=(pending.get(file)||Promise.resolve()).catch(()=>{}).then(async()=>{
    await fs.mkdir(path.dirname(file),{recursive:true});
    const temp=file+'.'+randomUUID()+'.tmp';
    try{
      await fs.writeFile(temp,data);
      try{await fs.rename(temp,file);}
      catch(error){
        if(!['ENOSYS','ENOTSUP'].includes(error.code))throw error;
        let previous;try{previous=await fs.readFile(file,'utf8');JSON.parse(previous);}catch{previous=null;}
        if(previous!==null)await fs.writeFile(file+'.previous',previous);
        await fs.writeFile(file,data);
      }
    }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
  });
  pending.set(file,task);void task.finally(()=>{if(pending.get(file)===task)pending.delete(file);}).catch(()=>{});
  return task;
}
