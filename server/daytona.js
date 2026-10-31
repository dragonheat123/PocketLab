import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {batteryKernel} from './battery-kernel.js';
import {saveWorkspace} from './workspaces.js';
import {neo4jConfigured,persistExperiment,persistExperimentRun} from './graph.js';

export const terminalRun=status=>['completed','failed','cancelled','interrupted'].includes(status);
export const daytonaConfigured=()=>Boolean(process.env.DAYTONA_API_KEY);
export const RUNTIMES={
  'daytona-python':{id:'daytona-python',name:'Daytona Python',image:null},
  'nosana-pytorch':{id:'nosana-pytorch',name:'Nosana PyTorch Jupyter 2.0.0',image:'docker.io/nosana/pytorch-jupyter:2.0.0',digest:'sha256:6e5c66c0bbe6cd1add87bac0bb4a5b64feee3bf13766dca949d137d32376065c',pinnedImage:'docker.io/nosana/pytorch-jupyter@sha256:6e5c66c0bbe6cd1add87bac0bb4a5b64feee3bf13766dca949d137d32376065c'},
};
let clientPromise,healthCache;
async function getClient(){
  if(!daytonaConfigured())throw new Error('Add DAYTONA_API_KEY to .env and restart the server.');
  clientPromise ||= import('@daytona/sdk').then(({Daytona})=>new Daytona({requestTimeoutMs:20000}));
  return clientPromise;
}
export async function daytonaHealth(){
  if(!daytonaConfigured())return {configured:false,connected:false,message:'Add DAYTONA_API_KEY to enable sandbox execution.'};
  if(healthCache&&Date.now()-healthCache.at<30000)return healthCache.value;
  let value;
  try{const client=await getClient();await client.list().next();value={configured:true,connected:true,message:'Daytona API authentication verified.'};}
  catch{value={configured:true,connected:false,message:'Daytona authentication or connectivity failed. Check your API key.'};}
  healthCache={at:Date.now(),value};return value;
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
export function redact(value){let text=String(value);for(const key of ['DAYTONA_API_KEY','NEO4J_PASSWORD','LLM_API_KEY','SERPAPI_API_KEY'])if(process.env[key])text=text.replaceAll(process.env[key],'[redacted]');return text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g,'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(-240000);}
const metricsSchema=z.object({status:z.literal('SUCCESS'),run_id:z.string(),code_sha256:z.string(),variant:z.enum(['baseline','adaptive','degradation','cosine']),epochs:z.number().int().positive(),profit_usd:z.number().finite(),baseline_profit_usd:z.number().finite(),delta_usd:z.number().finite(),final_loss:z.number().finite(),violations:z.number().finite().nonnegative(),final_soc_kwh:z.number().finite(),execution_time_sec:z.number().finite().nonnegative(),schedule_projection:z.string(),runtime_info:z.object({python:z.string(),pytorch:z.string(),cuda_available:z.boolean(),execution_device:z.literal('cpu'),hostname:z.string()}).optional(),hourly_schedule:z.array(z.object({hour:z.number().int().min(0).max(23),action_kw:z.number().finite(),soc_kwh:z.number().finite()})).length(24)});
export function parseMetrics(stdout,run){
  const text=redact(stdout).split('POCKETLAB_METRICS_START').at(-1).split('POCKETLAB_METRICS_END')[0].trim();
  const metrics=metricsSchema.parse(JSON.parse(text));
  if(metrics.run_id!==run.id||metrics.code_sha256!==run.codeSha256||metrics.variant!==run.variant||metrics.epochs!==run.epochs)throw new Error('Returned metrics do not match this run and its uploaded code.');
  if(metrics.hourly_schedule.some((s,i)=>s.hour!==i))throw new Error('Returned schedule has invalid hour order.');
  return metrics;
}
export function publicRun(run){const {code,...rest}=run;return rest;}
export async function createRun(workspace,experiment,{variant='adaptive',epochs=1000,runtime='daytona-python'}={}){
  if(!daytonaConfigured())throw new Error('Add DAYTONA_API_KEY to .env and restart the server.');
  if(workspace.id!=='battery-arbitrage')throw new Error('The executable recipe currently supports the Battery arbitrage workspace.');
  if(workspace.experiments.some(e=>(e.runs||[]).some(r=>!terminalRun(r.status))))throw new Error('An experiment is already executing in this workspace.');
  if(!RUNTIMES[runtime])throw new Error('Choose a supported experiment runtime.');
  const id=randomUUID(),code=batteryKernel({runId:id,variant,epochs,runtime});
  const run={id,workspaceId:workspace.id,experimentId:experiment.id,status:'queued',phase:'queued',variant,epochs,runtime:RUNTIMES[runtime],createdAt:new Date().toISOString(),startedAt:null,completedAt:null,sandboxId:null,sandboxState:'not_created',commands:[],log:'',events:[],metrics:null,error:null,code,codeSha256:createHash('sha256').update(code).digest('hex'),recipe:'Battery arbitrage benchmark v1',graphSync:{status:'pending'}};
  (experiment.runs ||= []).push(run);experiment.status='queued';workspace.updatedAt=new Date().toISOString();await saveWorkspace(workspace);return run;
}

/** Poll actual Daytona session output; no synthetic console messages or progress percentages. */
export async function executeRun(workspace,experiment,run,dependencies={}){
  const save=dependencies.save||saveWorkspace,writeGraph=dependencies.writeGraph||persistExperimentRun;
  const delay=dependencies.sleep||sleep;
  let client,sandbox,outcome='failed';
  const event=async(phase,message)=>{run.phase=phase;run.status=phase;experiment.status=phase;run.events.push({at:new Date().toISOString(),phase,message:redact(message)});await save(workspace);};
  async function command(commandText,stage,timeoutSec){
    const sessionId='pocketlab-'+run.id+'-'+stage;
    await sandbox.process.createSession(sessionId);
    const result=await sandbox.process.executeSessionCommand(sessionId,{command:commandText,runAsync:true,suppressInputEcho:true},30);
    if(!result.cmdId)throw new Error('Daytona did not return a command ID.');
    const record={stage,sessionId,commandId:result.cmdId,command:commandText,exitCode:null,startedAt:new Date().toISOString()};run.commands.push(record);await save(workspace);
    const deadline=Date.now()+timeoutSec*1000;let prefix=run.log;
    while(true){
      if(run.cancelRequested)throw new Error('Run cancelled.');
      const [info,logs]=await Promise.all([sandbox.process.getSessionCommand(sessionId,result.cmdId),sandbox.process.getSessionCommandLogs(sessionId,result.cmdId)]);
      const output=redact((logs.stdout||logs.stderr)?(logs.stdout||'')+(logs.stderr||''):logs.output||'');
      run.log=redact(prefix+output);await save(workspace);
      if(Number.isInteger(info.exitCode)){
        record.exitCode=info.exitCode;record.completedAt=new Date().toISOString();await save(workspace);
        if(info.exitCode!==0)throw new Error(`${stage} exited with code ${info.exitCode}. See sandbox logs.`);
        return output;
      }
      if(Date.now()>deadline)throw new Error(`${stage} exceeded its ${timeoutSec}-second execution limit.`);
      await delay(1500);
    }
  }
  try{
    run.startedAt=new Date().toISOString();await event('provisioning','Requesting an ephemeral Python sandbox from Daytona.');
    client=dependencies.client||await getClient();
    const custom=run.runtime?.id==='nosana-pytorch';
    if(custom)run.events.push({at:new Date().toISOString(),phase:'provisioning',message:'Preparing the pinned Nosana PyTorch image. Its first snapshot build can take several minutes.'});
    sandbox=await client.create({name:'pocketlab-'+run.id,language:'python',autoStopInterval:5,autoDeleteInterval:0,ttlMinutes:10,labels:{pocketlab:'true',workspace:workspace.id,run:run.id},...(custom?{image:run.runtime.pinnedImage,resources:{cpu:2,memory:4,disk:10}}:{})},{timeout:custom?300:90,onSnapshotCreateLogs:chunk=>{run.log=redact(run.log+chunk);void save(workspace).catch(()=>{});}});
    run.sandboxId=sandbox.id;run.sandboxState='running';await event('preparing',`Daytona sandbox ${sandbox.id} is ready. Uploading the benchmark and preparing PyTorch.`);
    if(run.cancelRequested)throw new Error('Run cancelled.');
    const directory=await sandbox.getWorkDir();if(!directory||!directory.startsWith('/'))throw new Error('Daytona returned an invalid working directory.');
    const scriptPath=directory.replace(/\/$/,'')+'/run_experiment.py';
    await sandbox.fs.uploadFile(Buffer.from(run.code),scriptPath);
    await command('python3 -c "import torch; print(\'PyTorch\', torch.__version__)" || python3 -m pip install --disable-pip-version-check --no-input torch --index-url https://download.pytorch.org/whl/cpu','prepare',240);
    await event('running','Executing the uploaded benchmark in the Daytona sandbox.');
    const output=await command('python3 -u '+quote(scriptPath),'experiment',120);
    run.metrics=parseMetrics(output,run);await event('collecting','Remote process exited with code 0. Metrics and code provenance verified.');
    outcome='completed';
  }catch(error){
    outcome=run.cancelRequested?'cancelled':'failed';run.error=redact(error.message);
    run.events.push({at:new Date().toISOString(),phase:'failed',message:run.error});
    // The SDK exposes sandboxId when creation times out after provisioning.
    if(!sandbox&&error.sandboxId&&client){run.sandboxId=error.sandboxId;try{sandbox=await client.get(error.sandboxId);}catch{}}
  }finally{
    run.status='collecting';run.phase='cleanup';experiment.status='collecting';await save(workspace);
    if(sandbox){
      try{await client.delete(sandbox,30,true);run.sandboxState='deleted';run.events.push({at:new Date().toISOString(),phase:'cleanup',message:'Ephemeral Daytona sandbox deleted; logs and metrics retained.'});}
      catch{run.sandboxState='cleanup_pending';run.cleanupError='Automatic sandbox cleanup failed. The sandbox has a 10-minute maximum lifetime.';}
    }
    run.completedAt=new Date().toISOString();
    experiment.status=outcome;
    if(neo4jConfigured()||dependencies.writeGraph){
      try{await writeGraph(workspace,experiment,{...run,status:outcome});run.graphSync={status:'synced'};}
      catch{run.graphSync={status:'pending',error:'Run evidence is saved locally; graph sync needs a retry.'};}
    }
    run.status=outcome;run.phase=outcome;
    await save(workspace);
  }
}

export async function recoverInterruptedRuns(workspaces){
  for(const workspace of workspaces.values())for(const experiment of workspace.experiments)for(const run of experiment.runs||[]){
    const interrupted=!terminalRun(run.status);
    if(!interrupted&&run.sandboxState!=='cleanup_pending')continue;
    if(interrupted){run.status='interrupted';run.phase='interrupted';experiment.status='interrupted';run.error='Server restarted during execution. This run was interrupted; start a new run to retry.';run.completedAt=new Date().toISOString();}
    if(daytonaConfigured())try{
      const client=await getClient();
      if(run.sandboxId)await client.delete(await client.get(run.sandboxId),30,true);
      else for await(const sandbox of client.list({labels:{pocketlab:'true',run:run.id}})){run.sandboxId=sandbox.id;await client.delete(sandbox,30,true);}
      run.sandboxState=run.sandboxId?'deleted':'not_created';
    }catch(error){run.sandboxState=[404,410].includes(error.statusCode)?'deleted':'cleanup_pending';}
    if(neo4jConfigured())try{await persistExperimentRun(workspace,experiment,run);run.graphSync={status:'synced'};}catch{run.graphSync={status:'pending'};}
    await saveWorkspace(workspace);
  }
}
