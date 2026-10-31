import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { jobs,loadJobs,createJob,runResearch,publicJob,save } from './research.js';
import { graphHealth,persistGraph,closeGraph,readExistingGraph,neo4jConfigured } from './graph.js';
import { retrieve,synthesize,evidenceOnly,llmConfigured } from './retrieval.js';
import { llmHealth } from './llm.js';
import {workspaces,BATTERY_ID,initializeWorkspaces,createWorkspace,createExperiment,listWorkspaces,syncWorkspace} from './workspaces.js';
import {daytonaHealth,createRun,executeRun,publicRun,terminalRun,recoverInterruptedRuns} from './daytona.js';

const app=express();
const operations=new Set();
app.disable('x-powered-by');app.use(express.json({limit:'16kb'}));
// This is a local, single-user lab. Reject cross-origin mutations.
app.use('/api',(req,res,next)=>{
  const origin=req.headers.origin;
  if(origin && !['http://localhost:'+ (process.env.PORT || 5173),'http://127.0.0.1:'+(process.env.PORT || 5173)].includes(origin))return res.status(403).json({error:'Cross-origin request rejected'});
  next();
});
app.get('/api/health',async(_req,res)=>{
  const [neo4j,llm,daytona]=await Promise.all([graphHealth(),llmHealth(),daytonaHealth()]);
  res.json({scholar:Boolean(process.env.SERPAPI_API_KEY),openalex:true,ai:llm.connected,llm,neo4j,daytona});
});
app.get('/api/graph',async(req,res)=>{
  const workspaceId=req.query.workspaceId || BATTERY_ID;
  if(!workspaces.has(workspaceId))return res.status(404).json({error:'Workspace not found'});
  try{res.json(await readExistingGraph(workspaceId));}
  catch{res.status(503).json({error:'Could not read the existing Neo4j graph. Check connection and database access.'});}
});
app.get('/api/workspaces',async(_req,res)=>res.json(await listWorkspaces(jobs)));
app.post('/api/workspaces',async(req,res)=>{
  const input=z.object({name:z.string().trim().min(3).max(100),idea:z.string().trim().min(12).max(1500),domain:z.string().trim().max(80).optional()}).safeParse(req.body);
  if(!input.success)return res.status(400).json({error:'Give your workspace a name (3–100 characters) and a research question (12–1500 characters).'});
  res.status(201).json(await createWorkspace(input.data));
});
app.use('/api/workspaces/:workspaceId',(req,res,next)=>{req.workspace=workspaces.get(req.params.workspaceId);if(!req.workspace)return res.status(404).json({error:'Workspace not found'});next();});
app.get('/api/workspaces/:workspaceId',async(req,res)=>{
  const all=await listWorkspaces(jobs);res.json(all.find(w=>w.id===req.workspace.id));
});
app.post('/api/workspaces/:workspaceId/sync',async(req,res)=>{
  await syncWorkspace(req.workspace,{adoptExisting:req.workspace.id===BATTERY_ID&&!req.workspace.migrated});
  res.status(req.workspace.graphSync.status==='synced'?200:503).json(req.workspace);
});
app.post('/api/workspaces/:workspaceId/experiments',async(req,res)=>{
  const input=z.object({name:z.string().trim().min(3).max(120),hypothesis:z.string().trim().min(12).max(2000),sourceNodeId:z.string().max(300).optional()}).safeParse(req.body);
  if(!input.success)return res.status(400).json({error:'Add an experiment name (3–120 characters) and a testable hypothesis (12–2000 characters).'});
  if(input.data.sourceNodeId){const graph=await readExistingGraph(req.workspace.id);if(!graph.nodes.some(n=>n.id===input.data.sourceNodeId))return res.status(400).json({error:'Choose an evidence node from this workspace.'});}
  res.status(201).json(await createExperiment(req.workspace,input.data));
});
app.use('/api/workspaces/:workspaceId/experiments/:experimentId',(req,res,next)=>{
  req.experiment=req.workspace.experiments.find(e=>e.id===req.params.experimentId);
  if(!req.experiment)return res.status(404).json({error:'Experiment not found in this workspace.'});next();
});
app.post('/api/workspaces/:workspaceId/experiments/:experimentId/runs',async(req,res)=>{
  const input=z.object({variant:z.enum(['baseline','adaptive','degradation','cosine']).default('adaptive'),epochs:z.number().int().min(100).max(3000).default(1000),runtime:z.enum(['daytona-python','nosana-pytorch']).default('daytona-python')}).safeParse(req.body);
  if(!input.success)return res.status(400).json({error:'Choose a supported battery recipe and 100–3000 training epochs.'});
  try{
    const run=await createRun(req.workspace,req.experiment,input.data);res.status(202).json(publicRun(run));
    void executeRun(req.workspace,req.experiment,run).catch(error=>{console.error('Experiment worker failed to save run state:',error.name);});
  }catch(error){res.status(409).json({error:error.message});}
});
app.use('/api/workspaces/:workspaceId/experiments/:experimentId/runs/:runId',(req,res,next)=>{
  req.run=(req.experiment.runs||[]).find(r=>r.id===req.params.runId);if(!req.run)return res.status(404).json({error:'Run not found in this experiment.'});next();
});
app.get('/api/workspaces/:workspaceId/experiments/:experimentId/runs/:runId',(req,res)=>res.json(publicRun(req.run)));
app.get('/api/workspaces/:workspaceId/experiments/:experimentId/runs/:runId/code',(req,res)=>res.type('text/plain').send(req.run.code));
app.post('/api/workspaces/:workspaceId/experiments/:experimentId/runs/:runId/cancel',async(req,res)=>{
  if(terminalRun(req.run.status))return res.status(409).json({error:'This run has already finished.'});
  req.run.cancelRequested=true;await (await import('./workspaces.js')).saveWorkspace(req.workspace);res.json({message:'Cancellation requested. The worker will delete the sandbox.'});
});
app.get('/api/research',(req,res)=>res.json([...jobs.values()].filter(j=>!req.query.workspaceId||j.workspaceId===req.query.workspaceId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(j=>({id:j.id,workspaceId:j.workspaceId,idea:j.idea,status:j.status,createdAt:j.createdAt,papers:j.papers.length}))));
const inputSchema=z.object({idea:z.string().trim().min(8).max(1500),provider:z.enum(['scholar','openalex']),limit:z.number().int().min(3).max(10).default(6),workspaceId:z.string().default(BATTERY_ID)});
app.post('/api/research',async(req,res)=>{
  const parsed=inputSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Enter a research idea of 8–1500 characters and choose a valid source (3–10 papers).'});
  if(!workspaces.has(parsed.data.workspaceId))return res.status(404).json({error:'Workspace not found'});
  if([...jobs.values()].some(j=>j.workspaceId===parsed.data.workspaceId&&['running','queued'].includes(j.status)))return res.status(409).json({error:'A research agent is already running in this workspace. Wait for it to finish.'});
  if(parsed.data.provider==='scholar'&&!process.env.SERPAPI_API_KEY)return res.status(422).json({error:'Add SERPAPI_API_KEY to .env and restart the server to search Google Scholar, or select OpenAlex.'});
  const job=await createJob(parsed.data);res.status(202).json(publicJob(job));void runResearch(job).catch(()=>{job.status='failed';job.error='Research could not be saved. Check available disk space.';});
});
app.use('/api/research/:id',(req,res,next)=>{const job=jobs.get(req.params.id);if(!job)return res.status(404).json({error:'Research not found'});req.job=job;next();});
app.get('/api/research/:id',(req,res)=>res.json(publicJob(req.job)));
app.post('/api/research/:id/sync',async(req,res)=>{
  if(req.job.status!=='complete')return res.status(409).json({error:'Wait for research to complete before syncing.'});
  if(operations.has(req.job.id))return res.status(409).json({error:'An operation is already running for this research.'});
  operations.add(req.job.id);
  try{req.job.graphSync=await persistGraph(req.job);await save(req.job);res.json(publicJob(req.job));}
  catch{res.status(503).json({error:'Neo4j sync failed. Check NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, and database access.'});}
  finally{operations.delete(req.job.id);}
});
app.post('/api/research/:id/consolidate',async(req,res)=>{
  if(req.job.status!=='complete')return res.status(409).json({error:'Wait for research to complete.'});
  if(!llmConfigured())return res.status(422).json({error:'Configure LLM_BASE_URL for your Nosana deployment, then restart the server.'});
  const health=await llmHealth();
  if(!health.connected)return res.status(503).json({error:health.message});
  if(operations.has(req.job.id))return res.status(409).json({error:'An operation is already running for this research.'});
  operations.add(req.job.id);
  try {
    const passages=await retrieve(req.job,req.job.idea,8);
    if(!passages.length)return res.status(422).json({error:'No relevant evidence was retrieved. Start a more specific search.'});
    const synthesis=await synthesize(req.job.idea,passages);
    req.job.synthesis=synthesis;req.job.synthesisMode='ai';req.job.evidence=passages.map(c=>c.id);
    req.job.graphSync={status:'pending',error:'New synthesis is saved locally. Sync to Neo4j to commit the updated graph.'};
    if(neo4jConfigured()){
      try{req.job.graphSync=await persistGraph(req.job);}
      catch{req.job.graphSync={status:'pending',error:'Synthesis saved; workspace graph sync needs a retry.'};}
    }
    await save(req.job);res.json(publicJob(req.job));
  } catch{res.status(502).json({error:'Nosana consolidation failed. Verify the endpoint, model ID, API key, and JSON output support.'});}
  finally{operations.delete(req.job.id);}
});
app.post('/api/research/:id/ask',async(req,res)=>{
  const question=z.string().trim().min(5).max(1000).safeParse(req.body.question);
  if(!question.success)return res.status(400).json({error:'Enter a question of 5–1000 characters.'});
  if(req.job.status!=='complete')return res.status(409).json({error:'Wait for research to finish.'});
  try {
    const passages=await retrieve(req.job,question.data,8);
    if(!passages.length)return res.json({mode:'evidence',answer:{...evidenceOnly([]),summary:'No relevant passages found. Try a question closer to the indexed research topic.'},passages:[]});
    const answer=llmConfigured()?await synthesize(question.data,passages):evidenceOnly(passages);
    res.json({mode:llmConfigured()?'ai':'evidence',answer,passages:passages.map(({embedding,...c})=>c)});
  } catch{res.status(502).json({error:'Could not answer from the indexed evidence. Check AI provider configuration and retry.'});}
});
app.use('/api',(_req,res)=>res.status(404).json({error:'Endpoint not found'}));
await loadJobs();
await initializeWorkspaces(jobs,save);
await recoverInterruptedRuns(workspaces);
if(process.env.NODE_ENV==='production') {
  app.use(express.static(fileURLToPath(new URL('../dist',import.meta.url))));
  app.get('/{*path}',(_req,res)=>res.sendFile(fileURLToPath(new URL('../dist/index.html',import.meta.url))));
} else {
  const {createServer}=await import('vite');
  const vite=await createServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);
}
app.use((error,_req,res,_next)=>res.status(error.status || 500).json({error:error.status===400?'Invalid JSON request.':'The request could not be completed.'}));
const server=app.listen(Number(process.env.PORT || 5173),'127.0.0.1',()=>console.log(`Pocket Lab → http://localhost:${process.env.PORT || 5173}`));
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Port is in use. Stop the previous dev server or change PORT.':error.message);process.exit(1);});
process.on('SIGTERM',()=>{server.close();void closeGraph().finally(()=>process.exit(0));});
