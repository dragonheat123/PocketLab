import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {neo4jConfigured,registerWorkspace,persistExperiment,persistExperimentRun,workspaceStats} from './graph.js';

const directory=path.resolve(process.env.POCKETLAB_DATA_DIR || 'data','workspaces');
export const workspaces=new Map();
export const BATTERY_ID='battery-arbitrage';
export async function saveWorkspace(workspace){
  await fs.mkdir(directory,{recursive:true});
  const file=path.join(directory,workspace.id+'.json'),temp=file+'.'+randomUUID()+'.tmp';
  await fs.writeFile(temp,JSON.stringify(workspace));await fs.rename(temp,file);
}
export async function syncWorkspace(workspace,{adoptExisting=false}={}){
  if(!neo4jConfigured()){workspace.graphSync={status:'pending',error:'Neo4j is not configured.'};return;}
  try{
    workspace.graphSync=await registerWorkspace(workspace,{adoptExisting});
    for(const experiment of workspace.experiments){
      await persistExperiment(workspace,experiment);experiment.graphSync={status:'synced'};
      for(const run of experiment.runs||[])if(['completed','failed','cancelled','interrupted'].includes(run.status)){try{await persistExperimentRun(workspace,experiment,run);run.graphSync={status:'synced'};}catch{run.graphSync={status:'pending'};}}
    }
    workspace.migrated=true;
  }catch{workspace.graphSync={status:'pending',error:'Workspace saved locally; graph sync is pending.'};}
  await saveWorkspace(workspace);
}
export async function initializeWorkspaces(jobs,saveJob){
  await fs.mkdir(directory,{recursive:true});
  for(const file of await fs.readdir(directory))if(file.endsWith('.json')){try{const workspace=JSON.parse(await fs.readFile(path.join(directory,file),'utf8'));if(workspace.id)workspaces.set(workspace.id,workspace);}catch{}}
  if(!workspaces.has(BATTERY_ID)){
    const createdAt=new Date().toISOString();
    workspaces.set(BATTERY_ID,{id:BATTERY_ID,name:'Battery arbitrage',idea:'Optimize 24-hour battery arbitrage using differentiable simulation while respecting state-of-charge, power, efficiency, and degradation constraints.',description:'A research workspace for smarter energy storage.',domain:'Energy systems',createdAt,updatedAt:createdAt,experiments:[],graphSync:{status:'pending'},migrated:false});
  }
  for(const job of jobs.values())if(!job.workspaceId){job.workspaceId=BATTERY_ID;await saveJob(job);}
  for(const workspace of workspaces.values()){
    await syncWorkspace(workspace,{adoptExisting:workspace.id===BATTERY_ID&&!workspace.migrated});await saveWorkspace(workspace);
  }
}
export async function createWorkspace({name,idea,domain}){
  const now=new Date().toISOString();
  const workspace={id:randomUUID(),name,idea,domain:domain || 'Open research',description:idea,createdAt:now,updatedAt:now,experiments:[],graphSync:{status:'pending'},migrated:false};
  workspaces.set(workspace.id,workspace);await saveWorkspace(workspace);await syncWorkspace(workspace);return workspace;
}
export async function createExperiment(workspace,{name,hypothesis,sourceNodeId}){
  const experiment={id:randomUUID(),name,hypothesis,sourceNodeId:sourceNodeId || null,status:'planned',createdAt:new Date().toISOString(),graphSync:{status:'pending'}};
  workspace.experiments.push(experiment);workspace.updatedAt=new Date().toISOString();await saveWorkspace(workspace);
  if(neo4jConfigured()){
    try{await registerWorkspace(workspace);await persistExperiment(workspace,experiment);experiment.graphSync={status:'synced'};}catch{experiment.graphSync={status:'pending',error:'Experiment saved locally. Graph sync can be retried.'};}
  }
  await saveWorkspace(workspace);return experiment;
}
export async function listWorkspaces(jobs){
  let stats={};if(neo4jConfigured()){try{stats=await workspaceStats([...workspaces.keys()]);}catch{}}
  return [...workspaces.values()].map(w=>({...w,experiments:w.experiments.map(e=>({...e,runs:(e.runs||[]).map(r=>({id:r.id,status:r.status,phase:r.phase,variant:r.variant,epochs:r.epochs,runtime:r.runtime,createdAt:r.createdAt,completedAt:r.completedAt,sandboxId:r.sandboxId,metrics:r.metrics,graphSync:r.graphSync}))})),stats:{nodes:stats[w.id]?.nodes ?? null,sources:stats[w.id]?.sources ?? [...jobs.values()].filter(j=>j.workspaceId===w.id).reduce((n,j)=>n+j.papers.length,0),experiments:w.experiments.length,researchRuns:[...jobs.values()].filter(j=>j.workspaceId===w.id).length}}));
}
