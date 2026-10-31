import 'dotenv/config';
import {Daytona} from '@daytona/sdk';
import {readFile,writeFile,mkdir,chmod,readdir,mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readExistingGraph,workspaceStats,neo4jConfigured,closeGraph} from '../server/graph.js';

const root=path.resolve(import.meta.dirname,'..');
const stateFile=path.join(root,'.daytona-deployment.json');
const ownerFile=path.join(root,'.env.daytona');
const remote='/home/daytona/pocketlab',dataMount='/home/daytona/pocketlab-data';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const client=new Daytona({requestTimeoutMs:30000});
if(neo4jConfigured()){
  console.log('Exporting a dated graph snapshot for browsing if hosted networking is restricted.');
  try{
    const ids=[];for(const name of await readdir(path.join(root,'data','workspaces')))if(name.endsWith('.json'))ids.push(JSON.parse(await readFile(path.join(root,'data','workspaces',name),'utf8')).id);
    const stats=await workspaceStats(ids);await mkdir(path.join(root,'data','graph-snapshots'),{recursive:true});
    for(const id of ids){const graph=await readExistingGraph(id);await writeFile(path.join(root,'data','graph-snapshots',encodeURIComponent(id)+'.json'),JSON.stringify({...graph,snapshotStats:stats[id]}));}
  }finally{await closeGraph();}
}
let state={};try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch{}
let sandbox;
if(state.sandboxId){sandbox=await client.get(state.sandboxId);if(sandbox.state!=='started')await sandbox.start(90);}
else{
  for(const name of await readdir(path.join(root,'data','workspaces'))){if(!name.endsWith('.json'))continue;const w=JSON.parse(await readFile(path.join(root,'data','workspaces',name),'utf8'));if(w.experiments.some(e=>(e.runs||[]).some(r=>!['completed','failed','cancelled','interrupted'].includes(r.status))))throw new Error('Wait for active local experiments to finish before seeding the hosted app.');}
  console.log('Preparing durable application storage.');
  let volume=await client.volume.get('pocketlab-demo-data',true);
  for(let i=0;volume.state!=='ready'&&i<90;i++){await sleep(1000);volume=await client.volume.get('pocketlab-demo-data');}
  if(volume.state!=='ready')throw new Error('Application volume is not ready.');
  console.log('Creating the dedicated web app sandbox.');
  sandbox=await client.create({name:'pocketlab-web-demo',language:'javascript',image:'node:22-bookworm-slim',user:'root',public:true,resources:{cpu:1,memory:2,disk:5},autoStopInterval:0,autoDeleteInterval:-1,ttlMinutes:0,labels:{project:'pocketlab',role:'web-host'},volumes:[{volumeId:volume.id,mountPath:dataMount}]},{timeout:300,onSnapshotCreateLogs:()=>{}});
  state={sandboxId:sandbox.id,volumeId:volume.id,createdAt:new Date().toISOString()};await writeFile(stateFile,JSON.stringify(state,null,2)+'\n');
}
await sandbox.setAutostopInterval(0);await sandbox.setAutoDeleteInterval(-1);await sandbox.setTtl(0);
const preview=await sandbox.getPreviewLink(5173);state.url=preview.url.replace(/\/$/,'');
const probe=`import net from 'node:net';
const online=await Promise.all([fetch(${JSON.stringify((process.env.LLM_BASE_URL||'https://inference.nosana.com/v1').replace(/\/$/,'')+'/models')},{signal:AbortSignal.timeout(8000)}).then(()=>true,()=>false),new Promise(resolve=>{const s=net.connect({host:${JSON.stringify(new URL(process.env.NEO4J_URI).hostname)},port:7687,timeout:5000},()=>{s.destroy();resolve(true);});s.on('error',()=>resolve(false));s.on('timeout',()=>{s.destroy();resolve(false);});})]);process.exit(online.every(Boolean)?0:2);`;
await sandbox.fs.uploadFile(Buffer.from(probe),'/tmp/pocketlab-network-check.mjs');
const network=await sandbox.process.executeCommand('node /tmp/pocketlab-network-check.mjs',undefined,undefined,20);state.networkRestricted=network.exitCode!==0;
console.log(state.networkRestricted?'Organization network policy blocks external services; enabling saved-graph browsing.':'Live Nosana and Neo4j network paths are reachable.');
let ownerCode;
try{ownerCode=(await readFile(ownerFile,'utf8')).match(/^DEMO_ACCESS_CODE=(.+)$/m)?.[1];}catch{}
ownerCode ||=randomBytes(18).toString('base64url');
await writeFile(ownerFile,`# Private owner access code for the hosted Pocket Lab demo. Do not commit.\nDEMO_ACCESS_CODE=${ownerCode}\n`,{mode:0o600});await chmod(ownerFile,0o600);
const allowedKeys=['SERPAPI_API_KEY','OPENALEX_API_KEY','LLM_BASE_URL','LLM_MODEL','LLM_API_KEY','LLM_REASONING_EFFORT','LLM_MAX_TOKENS','LLM_TIMEOUT_MS','EMBEDDING_BASE_URL','EMBEDDING_MODEL','NEO4J_URI','NEO4J_USERNAME','NEO4J_PASSWORD','NEO4J_DATABASE','DAYTONA_API_KEY','DAYTONA_API_URL','DAYTONA_TARGET'];
const config=Object.fromEntries(allowedKeys.filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(config,{NODE_ENV:'production',HOST:'0.0.0.0',PORT:'5173',PUBLIC_ORIGIN:state.url,DEMO_ACCESS_CODE:ownerCode,POCKETLAB_DATA_DIR:dataMount,APP_NETWORK_RESTRICTED:String(state.networkRestricted)});
const env=Object.entries(config).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n';
const temp=await mkdtemp(path.join(tmpdir(),'pocketlab-deploy-'));
try{
  console.log('Uploading the production app and initial workspace data.');
  const appArchive=path.join(temp,'app.tar.gz'),seedArchive=path.join(temp,'seed.tar.gz');
  for(const [archive,files] of [[appArchive,['server','dist','scripts/host.mjs','package.json','package-lock.json']],[seedArchive,['data']]]){
    const result=spawnSync('tar',['--exclude=*.tmp','-czf',archive,'-C',root,...files],{encoding:'utf8'});if(result.status!==0)throw new Error('Could not package deployment files.');
  }
  let prepared=await sandbox.process.executeCommand(`mkdir -p ${remote}/scripts`,undefined,undefined,30);if(prepared.exitCode!==0)throw new Error('Could not prepare the app directory.');
  await sandbox.fs.uploadFiles([{source:appArchive,destination:'/tmp/pocketlab-app.tar.gz'},{source:seedArchive,destination:'/tmp/pocketlab-seed.tar.gz'},{source:Buffer.from(env),destination:remote+'/.env'}],120);
  prepared=await sandbox.process.executeCommand(`chmod 600 ${remote}/.env && tar -xzf /tmp/pocketlab-app.tar.gz -C ${remote} && if [ ! -f ${dataMount}/.seeded ]; then tar -xzf /tmp/pocketlab-seed.tar.gz -C /tmp && cp -R /tmp/data/. ${dataMount}/ && touch ${dataMount}/.seeded; fi && if [ -d /tmp/data/graph-snapshots ]; then cp -R /tmp/data/graph-snapshots ${dataMount}/; fi`,undefined,undefined,45);
  if(prepared.exitCode!==0)throw new Error('Could not unpack the deployment or seed persistent storage.');
  const session='pocketlab-install-'+Date.now();await sandbox.process.createSession(session);
  const install=await sandbox.process.executeSessionCommand(session,{command:`cd ${remote} && npm ci --omit=dev --no-audit --no-fund`,runAsync:true,suppressInputEcho:true},30);
  console.log('Installing production dependencies in Daytona.');
  let installed=false;
  for(let i=0;i<180;i++){const info=await sandbox.process.getSessionCommand(session,install.cmdId);if(Number.isInteger(info.exitCode)){if(info.exitCode!==0){const logs=await sandbox.process.getSessionCommandLogs(session,install.cmdId);console.error((logs.stdout||'').slice(-1500),(logs.stderr||'').slice(-1500));throw new Error('Remote dependency installation failed.');}installed=true;break;}await sleep(2000);}
  if(!installed)throw new Error('Dependency installation timed out.');
  // A deployment restarts only this sandbox's web host, never experiment workers.
  await sandbox.process.executeCommand(`if [ -f ${remote}/host.pid ]; then kill -TERM $(cat ${remote}/host.pid) 2>/dev/null || true; fi`,undefined,undefined,15);
  const hostSession='pocketlab-web-'+Date.now();await sandbox.process.createSession(hostSession);
  const host=await sandbox.process.executeSessionCommand(hostSession,{command:`cd ${remote} && echo $$ > host.pid && exec node scripts/host.mjs`,runAsync:true,suppressInputEcho:true},30);
  state.hostSession=hostSession;state.hostCommandId=host.cmdId;state.updatedAt=new Date().toISOString();await writeFile(stateFile,JSON.stringify(state,null,2)+'\n');
  console.log('Waiting for the public app and connected services.');
  let ready=false;
  for(let i=0;i<45;i++){
    try{const r=await fetch(state.url+'/api/access',{signal:AbortSignal.timeout(5000)});if(r.ok){const a=await r.json();if(a.protected&&!a.unlocked){ready=true;break;}}}catch{}
    const info=await sandbox.process.getSessionCommand(hostSession,host.cmdId);if(Number.isInteger(info.exitCode))throw new Error('Remote web host exited; inspect the Daytona host session.');
    await sleep(2000);
  }
  if(!ready)throw new Error('App did not become reachable through its preview URL.');
  console.log(JSON.stringify({url:state.url,sandboxId:state.sandboxId,volumeId:state.volumeId,ownerCodeFile:'.env.daytona',status:'ready',networkRestricted:state.networkRestricted}));
}finally{await rm(temp,{recursive:true,force:true});}
