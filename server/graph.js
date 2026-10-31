import neo4j from 'neo4j-driver';
import { createHash } from 'node:crypto';
let driver;
export const neo4jConfigured = () => Boolean(process.env.NEO4J_URI && process.env.NEO4J_USERNAME && process.env.NEO4J_PASSWORD);
function getDriver() {
  if (!neo4jConfigured()) throw new Error('Configure NEO4J_URI, NEO4J_USERNAME and NEO4J_PASSWORD in .env');
  driver ||= neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USERNAME,process.env.NEO4J_PASSWORD),{ connectionTimeout:8000,connectionAcquisitionTimeout:10000,maxTransactionRetryTime:5000 });
  return driver;
}
export async function graphHealth() {
  if (!neo4jConfigured()) return { configured:false, connected:false };
  try { await getDriver().verifyConnectivity(); return {configured:true,connected:true}; }
  catch { return {configured:true,connected:false,error:'Neo4j is unreachable. Check the server URL, credentials, and database.'}; }
}

/** Read a bounded visualization from the existing database without altering it. */
export async function readExistingGraph(workspaceId=null) {
  const session=getDriver().session({database:process.env.NEO4J_DATABASE || 'neo4j',defaultAccessMode:neo4j.session.READ});
  try{return await session.executeRead(async tx=>{
    const scope={workspaceId};
    const totals=await tx.run('MATCH (n) WHERE $workspaceId IS NULL OR n.workspaceId=$workspaceId RETURN count(n) AS count',scope);
    const relationshipTotals=await tx.run('MATCH (a)-[r]->(b) WHERE $workspaceId IS NULL OR (a.workspaceId=$workspaceId AND b.workspaceId=$workspaceId) RETURN count(r) AS count',scope);
    const result=await tx.run(`MATCH (n) WHERE $workspaceId IS NULL OR n.workspaceId=$workspaceId RETURN elementId(n) AS id, n.id AS entityId, labels(n) AS labels,
      coalesce(n.name,n.title,n.id,n.text,n.query,elementId(n)) AS name,
      coalesce(n.description,n.summary,n.abstract,'') AS description,
      coalesce(n.url,n.source,'') AS url
      ORDER BY id LIMIT 500`,scope);
    const nodes=result.records.map(r=>({id:r.get('id'),entityId:r.get('entityId'),labels:r.get('labels'),name:String(r.get('name')).slice(0,200),description:String(r.get('description')).slice(0,4000),url:String(r.get('url'))}));
    const relationships=await tx.run(`MATCH (a)-[r]->(b) WHERE elementId(a) IN $ids AND elementId(b) IN $ids RETURN elementId(r) AS id,elementId(a) AS source,elementId(b) AS target,type(r) AS type ORDER BY id LIMIT 1500`,{ids:nodes.map(n=>n.id)});
    const edges=relationships.records.map(r=>({id:r.get('id'),source:r.get('source'),target:r.get('target'),type:r.get('type')}));
    const totalNodes=totals.records[0].get('count').toNumber(),totalEdges=relationshipTotals.records[0].get('count').toNumber();
    return {source:'neo4j',database:process.env.NEO4J_DATABASE || 'neo4j',workspaceId,nodes,edges,totalNodes,totalEdges,truncated:nodes.length<totalNodes||edges.length<totalEdges,fetchedAt:new Date().toISOString()};
  });}finally{await session.close();}
}

export function graphData(job) {
  const nodes = [{id:job.id,label:'ResearchTopic',name:job.idea}];
  const edges = [];
  for (const paper of job.papers) {
    nodes.push({id:paper.id,label:'Paper',name:paper.title,url:paper.url,access:paper.access});
    edges.push({source:job.id,target:paper.id,type:'EXPLORES'});
  }
  for (const [index,concept] of (job.synthesis?.concepts || []).entries()) {
    const id = `${job.id}-concept-${index}`;
    nodes.push({id,label:'Concept',name:concept.name,description:concept.description,chunkIds:concept.chunkIds});
    edges.push({source:job.id,target:id,type:'CONSOLIDATES'});
    for (const paperId of new Set(concept.chunkIds.map(cid=>job.chunks.find(c=>c.id===cid)?.paperId).filter(Boolean))) edges.push({source:paperId,target:id,type:'SUPPORTS'});
  }
  for (const [index,direction] of (job.synthesis?.directions || []).entries()) {
    const id = `${job.id}-direction-${index}`;
    nodes.push({id,label:'ResearchDirection',name:direction.idea,chunkIds:direction.chunkIds});
    edges.push({source:job.id,target:id,type:'SUGGESTS'});
    for (const paperId of new Set(direction.chunkIds.map(cid=>job.chunks.find(c=>c.id===cid)?.paperId).filter(Boolean))) edges.push({source:paperId,target:id,type:'INFORMS'});
  }
  return {nodes,edges};
}

export async function persistGraph(job) {
  const driver = getDriver();
  const database = process.env.NEO4J_DATABASE || 'neo4j';
  await driver.executeQuery('CREATE CONSTRAINT pocketlab_node_id IF NOT EXISTS FOR (n:PocketLabNode) REQUIRE n.id IS UNIQUE',{}, {database});
  const session = driver.session({database});
  const graph = graphData(job);
  try {
    await session.executeWrite(async tx => {
      await tx.run(`MERGE (t:PocketLabNode:ResearchTopic {id:$id}) SET t.name=$idea, t.query=$idea, t.updatedAt=$date, t.summary=$summary, t.retrieval=$retrieval`,{id:job.id,idea:job.idea,date:new Date().toISOString(),summary:job.synthesis?.summary || '',retrieval:job.retrieval});
      await tx.run(`MATCH (t:ResearchTopic {id:$id})-[:CONSOLIDATES|SUGGESTS]->(n) DETACH DELETE n`,{id:job.id});
      for (const p of job.papers) {
        await tx.run(`MATCH (t:ResearchTopic {id:$topic}) MERGE (p:PocketLabNode:Paper {id:$id}) SET p.title=$title,p.url=$url,p.year=$year,p.access=$access,p.provider=$provider,p.textHash=$hash MERGE (t)-[:EXPLORES]->(p)`,{topic:job.id,id:p.id,title:p.title,url:p.url,year:p.year || 0,access:p.access,provider:job.provider,hash:createHash('sha256').update(job.chunks.filter(c=>c.paperId===p.id).map(c=>c.text).join('')).digest('hex')});
      }
      await tx.run(`UNWIND $chunks AS c MATCH (p:Paper {id:c.paperId}) MERGE (n:PocketLabNode:Chunk {id:c.id}) SET n.text=c.text,n.offset=c.offset,n.embedding=c.embedding,n.embeddingModel=$model MERGE (p)-[:HAS_CHUNK]->(n)`,{chunks:job.chunks.map(c=>({id:c.id,paperId:c.paperId,text:c.text,offset:c.offset,embedding:c.embedding || []})),model:job.embeddingModel || ''});
      // Labels and relationship types below are fixed literals, never model-generated Cypher.
      for (const n of graph.nodes.filter(n=>['Concept','ResearchDirection'].includes(n.label))) {
        const query = n.label==='Concept' ? `MERGE (n:PocketLabNode:Concept {id:$id}) SET n.name=$name,n.description=$description,n.chunkIds=$chunkIds` : `MERGE (n:PocketLabNode:ResearchDirection {id:$id}) SET n.name=$name,n.description=$description,n.chunkIds=$chunkIds`;
        await tx.run(query,{id:n.id,name:n.name,description:n.description || '',chunkIds:n.chunkIds});
        await tx.run(`UNWIND $ids AS cid MATCH (n:PocketLabNode {id:$id}),(c:Chunk {id:cid}) MERGE (n)-[:GROUNDED_IN]->(c)`,{id:n.id,ids:n.chunkIds});
      }
      const queries = {CONSOLIDATES:'CONSOLIDATES',SUPPORTS:'SUPPORTS',SUGGESTS:'SUGGESTS',INFORMS:'INFORMS'};
      for (const e of graph.edges.filter(e=>e.type!=='EXPLORES')) {
        await tx.run(`MATCH (a:PocketLabNode {id:$source}),(b:PocketLabNode {id:$target}) MERGE (a)-[:${queries[e.type]}]->(b)`,{source:e.source,target:e.target});
      }
      if(job.workspaceId){
        await tx.run('MATCH (n:PocketLabNode) WHERE n.id IN $ids SET n.workspaceId=$workspaceId',{ids:[...graph.nodes.map(n=>n.id),...job.chunks.map(c=>c.id)],workspaceId:job.workspaceId});
        await tx.run('MATCH (w:ResearchTopic {id:$root}),(t:ResearchTopic {id:$topic}) MERGE (w)-[:HAS_RESEARCH]->(t)',{root:`workspace:${job.workspaceId}`,topic:job.id});
      }
    });
    return {status:'synced',syncedAt:new Date().toISOString(),nodes:graph.nodes.length+job.chunks.length,edges:graph.edges.length+job.chunks.length+(job.synthesis?.concepts || []).reduce((n,c)=>n+c.chunkIds.length,0)+(job.synthesis?.directions || []).reduce((n,c)=>n+c.chunkIds.length,0)};
  } finally { await session.close(); }
}
export async function closeGraph() { if(driver) await driver.close(); }

export async function registerWorkspace(workspace,{adoptExisting=false}={}){
  const database=process.env.NEO4J_DATABASE || 'neo4j';
  const session=getDriver().session({database});
  try{await session.executeWrite(async tx=>{
    if(adoptExisting)await tx.run('MATCH (n) WHERE n.workspaceId IS NULL SET n.workspaceId=$id',{id:workspace.id});
    await tx.run(`MERGE (w:PocketLabNode:ResearchTopic {id:$root}) SET w.workspaceId=$id,w.name=$name,w.query=$idea,w.description=$idea,w.kind='workspace'`,{root:`workspace:${workspace.id}`,id:workspace.id,name:workspace.name,idea:workspace.idea});
    if(adoptExisting)await tx.run(`MATCH (w:ResearchTopic {id:$root}),(p) WHERE p.workspaceId=$id AND (p:Paper OR p:ResearchPaper OR p:__Document__) MERGE (w)-[:EXPLORES]->(p)`,{root:`workspace:${workspace.id}`,id:workspace.id});
  });return {status:'synced'};}finally{await session.close();}
}

export async function workspaceStats(ids){
  const {records}=await getDriver().executeQuery(`UNWIND $ids AS id OPTIONAL MATCH (n) WHERE n.workspaceId=id RETURN id,count(n) AS nodes,sum(CASE WHEN n:Paper OR n:ResearchPaper OR n:__Document__ THEN 1 ELSE 0 END) AS sources`,{ids},{database:process.env.NEO4J_DATABASE || 'neo4j',routing:'READ'});
  return Object.fromEntries(records.map(r=>[r.get('id'),{nodes:r.get('nodes').toNumber(),sources:r.get('sources').toNumber()}]));
}

export async function persistExperiment(workspace,experiment){
  const {records}=await getDriver().executeQuery(`MATCH (w:ResearchTopic {id:$root})
    MERGE (h:PocketLabNode:Hypothesis {id:$hypothesisId}) SET h.workspaceId=$workspaceId,h.name=$name,h.description=$hypothesis
    MERGE (e:PocketLabNode:Experiment {id:$experimentId}) SET e.workspaceId=$workspaceId,e.name=$name,e.status=$status,e.description=$hypothesis,e.createdAt=$createdAt
    MERGE (w)-[:HAS_EXPERIMENT]->(e) MERGE (e)-[:TESTS]->(h)
    WITH e,h OPTIONAL MATCH (source) WHERE elementId(source)=$source AND source.workspaceId=$workspaceId
    FOREACH (_ IN CASE WHEN source IS NULL THEN [] ELSE [1] END | MERGE (h)-[:GROUNDED_IN]->(source))
    RETURN e.id AS id`,{root:`workspace:${workspace.id}`,workspaceId:workspace.id,hypothesisId:`${experiment.id}:hypothesis`,experimentId:experiment.id,name:experiment.name,hypothesis:experiment.hypothesis,status:experiment.status,createdAt:experiment.createdAt,source:experiment.sourceNodeId || ''},{database:process.env.NEO4J_DATABASE || 'neo4j'});
  if(!records.length)throw new Error('Workspace graph is not registered');
}

export async function persistExperimentRun(workspace,experiment,run){
  await persistExperiment(workspace,experiment);
  await getDriver().executeQuery(`MATCH(e:Experiment {id:$experimentId,workspaceId:$workspaceId}),(h:Hypothesis {id:$hypothesisId,workspaceId:$workspaceId})
    MERGE(r:PocketLabNode:ExperimentRun {id:$id})
    SET r.workspaceId=$workspaceId,r.name=$name,r.status=$status,r.sandboxId=$sandboxId,r.provider='Daytona',r.codeSha256=$hash,r.variant=$variant,r.epochs=$epochs,
      r.profit_usd=$profit,r.baseline_profit_usd=$baseline,r.delta_usd=$delta,r.violations=$violations,r.final_loss=$loss,r.execution_time_sec=$duration,r.createdAt=$createdAt,r.completedAt=$completedAt,r.error=$error,r.runtime=$runtime,r.image=$image,r.imageDigest=$imageDigest,
      r.description=$description
    MERGE(e)-[:EVALUATED_BY]->(r) MERGE(h)-[:EVALUATED_BY]->(r)`,{
      experimentId:experiment.id,hypothesisId:`${experiment.id}:hypothesis`,workspaceId:workspace.id,id:run.id,name:`${experiment.name} · ${run.status}`,status:run.status,sandboxId:run.sandboxId||'',hash:run.codeSha256,variant:run.variant,epochs:run.epochs,profit:run.metrics?.profit_usd??null,baseline:run.metrics?.baseline_profit_usd??null,delta:run.metrics?.delta_usd??null,violations:run.metrics?.violations??null,loss:run.metrics?.final_loss??null,duration:run.metrics?.execution_time_sec??null,createdAt:run.createdAt,completedAt:run.completedAt||'',error:run.error||'',runtime:run.runtime?.id||'daytona-python',image:run.runtime?.image||'Daytona default Python',imageDigest:run.runtime?.digest||'',description:`${run.sandboxId?'Actual Daytona sandbox execution.':'Daytona provisioning attempt; no sandbox execution occurred.'} ${run.recipe}. Sandbox: ${run.sandboxId||'not provisioned'}. Code SHA-256: ${run.codeSha256}. ${run.metrics?.schedule_projection||''}`,
    },{database:process.env.NEO4J_DATABASE||'neo4j'});
}
