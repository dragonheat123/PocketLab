import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const directory=await mkdtemp(path.join(os.tmpdir(),'pocketlab-daytona-test-'));process.env.POCKETLAB_DATA_DIR=directory;
const originalKey=process.env.DAYTONA_API_KEY;process.env.DAYTONA_API_KEY='test-daytona-secret';
for(const key of ['NEO4J_URI','NEO4J_PASSWORD','NEO4J_USERNAME'])delete process.env[key];
const {createRun,executeRun,parseMetrics,publicRun,terminalRun}=await import('./daytona.js');
after(async()=>{if(originalKey===undefined)delete process.env.DAYTONA_API_KEY;else process.env.DAYTONA_API_KEY=originalKey;await rm(directory,{recursive:true,force:true});});
const metrics=run=>({status:'SUCCESS',run_id:run.id,code_sha256:run.codeSha256,variant:run.variant,epochs:run.epochs,profit_usd:1.2,baseline_profit_usd:1,delta_usd:.2,final_loss:-1.19,violations:0,final_soc_kwh:2,execution_time_sec:2,schedule_projection:'Projected equally for both strategies',hourly_schedule:Array.from({length:24},(_,hour)=>({hour,action_kw:0,soc_kwh:2}))});
const output=run=>'POCKETLAB_METRICS_START\n'+JSON.stringify(metrics(run))+'\nPOCKETLAB_METRICS_END';
function fixture(){const experiment={id:'experiment-'+Math.random(),name:'Adaptive penalty',hypothesis:'An adaptive penalty improves feasible profit.',status:'planned'};return{workspace:{id:'battery-arbitrage',name:'Battery',experiments:[experiment]},experiment};}
function fakeClient(run,{failPrepare=false}={}){
  const commands=new Map();let deleted=false,uploaded=false;
  const sandbox={id:'real-api-test-sandbox',getWorkDir:async()=>'/home/daytona',fs:{uploadFile:async buffer=>{assert.equal(buffer.toString(),run.code);uploaded=true;}},process:{createSession:async()=>{},executeSessionCommand:async(session,request)=>{assert.equal(request.runAsync,true);const stage=session.endsWith('prepare')?'prepare':'experiment';commands.set(stage,{polls:0});return{cmdId:stage};},getSessionCommand:async(_session,id)=>{const c=commands.get(id);c.polls++;return c.polls<2?{id}:{id,exitCode:id==='prepare'&&failPrepare?1:0};},getSessionCommandLogs:async(_session,id)=>({stdout:id==='prepare'?'PyTorch installed\n':output(run)})}};
  return {client:{create:async options=>{assert.equal(options.autoDeleteInterval,0);assert.equal(options.ttlMinutes,10);assert.equal(options.labels.run,run.id);return sandbox;},delete:async()=>{deleted=true;}},get deleted(){return deleted;},get uploaded(){return uploaded;}};
}
test('real worker contract tracks remote commands, verifies metrics, cleans up, and writes run evidence',async()=>{
  const {workspace,experiment}=fixture();const run=await createRun(workspace,experiment,{variant:'adaptive',epochs:500});const fake=fakeClient(run);const snapshots=[];let recorded;
  await executeRun(workspace,experiment,run,{client:fake.client,save:async()=>snapshots.push(run.status),sleep:async()=>{},writeGraph:async(_w,_e,r)=>recorded=r});
  assert.equal(run.status,'completed');assert.equal(run.sandboxState,'deleted');assert.equal(run.metrics.profit_usd,1.2);assert.equal(fake.deleted,true);assert.equal(fake.uploaded,true);
  assert.ok(snapshots.includes('running'));assert.equal(run.commands[1].exitCode,0);assert.equal(recorded.status,'completed');assert.equal(run.graphSync.status,'synced');assert.equal(publicRun(run).code,undefined);
});
test('a failed remote setup is never represented as a completed experiment',async()=>{
  const {workspace,experiment}=fixture();const run=await createRun(workspace,experiment);const fake=fakeClient(run,{failPrepare:true});
  await executeRun(workspace,experiment,run,{client:fake.client,save:async()=>{},sleep:async()=>{},writeGraph:async()=>{}});
  assert.equal(run.status,'failed');assert.equal(run.metrics,null);assert.equal(run.commands.length,1);assert.equal(run.commands[0].exitCode,1);assert.ok(!run.events.some(e=>e.phase==='running'));assert.equal(fake.deleted,true);
});
test('metrics for the wrong code or run cannot be accepted',async()=>{
  const {workspace,experiment}=fixture();const run=await createRun(workspace,experiment);assert.equal(parseMetrics(output(run),run).run_id,run.id);
  assert.throws(()=>parseMetrics(output({...run,codeSha256:'different'}),run),/do not match/);assert.throws(()=>parseMetrics('Traceback: failed',run));
  assert.equal(parseMetrics(output(run).replaceAll('\n','\n\u0001\u0001\u0001'),run).run_id,run.id,'Daytona stdout framing is removed before parsing');
});
test('a queued run prevents duplicate execution and cancellation still cleans up',async()=>{
  const {workspace,experiment}=fixture();const run=await createRun(workspace,experiment);await assert.rejects(createRun(workspace,experiment),/already executing/);
  run.cancelRequested=true;const fake=fakeClient(run);await executeRun(workspace,experiment,run,{client:fake.client,save:async()=>{},writeGraph:async()=>{}});
  assert.equal(run.status,'cancelled');assert.equal(run.commands.length,0);assert.equal(fake.deleted,true);assert.equal(terminalRun(run.status),true);
});
test('Nosana runtime uses the pinned container image and bounded CPU resources',async()=>{
  const {workspace,experiment}=fixture();const run=await createRun(workspace,experiment,{runtime:'nosana-pytorch',epochs:500});const fake=fakeClient(run);const originalCreate=fake.client.create;
  fake.client.create=async options=>{assert.equal(options.image,run.runtime.pinnedImage);assert.ok(options.image.includes('@sha256:'));assert.deepEqual(options.resources,{cpu:2,memory:4,disk:10});return originalCreate(options);};
  await executeRun(workspace,experiment,run,{client:fake.client,save:async()=>{},sleep:async()=>{},writeGraph:async()=>{}});
  assert.equal(run.status,'completed');assert.equal(run.runtime.image,'docker.io/nosana/pytorch-jupyter:2.0.0');assert.equal(fake.deleted,true);
});
