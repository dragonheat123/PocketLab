import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chunkText, lexicalRetrieve, cosine, validateSynthesis, synthesize } from './retrieval.js';
import { graphData } from './graph.js';
import { isPublicAddress, downloadDocument } from './network.js';

const dir=await mkdtemp(path.join(os.tmpdir(),'pocketlab-test-'));
process.env.POCKETLAB_DATA_DIR=dir;
const {createJob,runResearch,loadJobs,publicJob}=await import('./research.js');
await loadJobs();
const originalFetch=globalThis.fetch;
const keys=['LLM_BASE_URL','LLM_MODEL','LLM_API_KEY','EMBEDDING_MODEL','EMBEDDING_BASE_URL','NEO4J_URI','NEO4J_PASSWORD','NEO4J_USERNAME','SERPAPI_API_KEY'];
const originalEnv=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
beforeEach(()=>{for(const k of keys)delete process.env[k];globalThis.fetch=originalFetch;});
after(async()=>{globalThis.fetch=originalFetch;for(const k of keys){if(originalEnv[k]===undefined)delete process.env[k];else process.env[k]=originalEnv[k];}await rm(dir,{recursive:true,force:true});});
const text='Battery arbitrage optimization uses a differentiable state of charge model to schedule energy storage. Physical constraints bound power and charge. Dynamic penalties help enforce feasible battery dispatch.';
const indexed=text=>{const index={};text.split(' ').forEach((w,i)=>(index[w] ||= []).push(i));return index;};
const paper={title:'Battery arbitrage optimization',id:'https://openalex.org/W123',publication_year:2025,abstract_inverted_index:indexed(text),authorships:[],best_oa_location:null};
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});

test('chunking preserves overlap and bounds ingestion volume',()=>{
  const chunks=chunkText('battery '.repeat(10000),'p1');
  assert.equal(chunks.length,24);assert.equal(chunks[0].text.length,1600);
  assert.equal(chunks[1].offset,1400);assert.equal(chunks[0].text.slice(1400),chunks[1].text.slice(0,200));
  assert.deepEqual(chunkText('','p1'),[]);
});
test('BM25 retrieves relevant passages and returns no unsupported matches',()=>{
  const chunks=[{id:'a',text},{id:'b',text:'Molecular protein folding improves crystal structure prediction.'}];
  assert.equal(lexicalRetrieve(chunks,'battery charge')[0].id,'a');
  assert.deepEqual(lexicalRetrieve(chunks,'medieval architecture'),[]);
  assert.equal(cosine([1,0],[1,0]),1);assert.equal(cosine([1,0],[0,1]),0);
});
test('unknown citations and unstructured findings cannot enter the graph',()=>{
  const valid={summary:'A finding [p1-c1]',concepts:[{name:'Constraint handling',description:'A penalty formulation.',chunkIds:['p1-c1']}],directions:[],limitations:[]};
  assert.equal(validateSynthesis(valid,[{id:'p1-c1'}]).concepts.length,1);
  assert.throws(()=>validateSynthesis({...valid,concepts:[{...valid.concepts[0],chunkIds:['invented']}]},[{id:'p1-c1'}]),/unknown evidence/);
  assert.throws(()=>validateSynthesis({summary:'unstructured'},[]));
});
test('public document fetch rejects localhost and private addresses',async()=>{
  for(const address of ['127.0.0.1','10.0.0.4','192.168.1.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1'])assert.equal(isPublicAddress(address),false,address);
  assert.equal(isPublicAddress('8.8.8.8'),true);
  await assert.rejects(downloadDocument('http://127.0.0.1/test.pdf'),/not public/);
  await assert.rejects(downloadDocument('file:///etc/passwd'),/Unsupported/);
});
test('pipeline indexes abstracts without pretending to synthesize or sync',async()=>{
  globalThis.fetch=async url=>{assert.equal(new URL(url).hostname,'api.openalex.org');return json({results:[paper,paper]});};
  const job=await createJob({idea:'battery arbitrage',provider:'openalex',limit:3});await runResearch(job);
  assert.equal(job.status,'complete');assert.equal(job.papers.length,1);assert.equal(job.papers[0].access,'Abstract');
  assert.equal(job.synthesisMode,'evidence');assert.equal(job.graphSync.status,'not_configured');assert.ok(job.chunks.length);
  assert.equal(graphData(job).nodes.length,2);assert.equal(job.synthesis.concepts.length,0);
  job.chunks[0].embedding=[1,2];assert.equal(publicJob(job).chunks[0].embedding,undefined);
});
test('Nosana-compatible completion produces concepts with source lineage',async()=>{
  process.env.LLM_BASE_URL='https://nosana.example/v1';process.env.LLM_MODEL='deployed-model';process.env.LLM_API_KEY='test-token';
  globalThis.fetch=async(url,options)=>{
    if(new URL(url).hostname==='api.openalex.org')return json({results:[paper]});
    assert.equal(url,'https://nosana.example/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer test-token');
    const body=JSON.parse(options.body);assert.equal(body.model,'deployed-model');
    const context=JSON.parse(body.messages[1].content);const cid=context.passages[0].id;
    return new Response(JSON.stringify({id:'completion-receipt',usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150},choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:`Battery constraints [${cid}]`,concepts:[{name:'Feasible dispatch',description:'Battery optimization includes physical constraints.',chunkIds:[cid]}],directions:[{idea:'Evaluate adaptive penalties.',chunkIds:[cid]}],limitations:['Based on abstract evidence.']})}}]}),{headers:{'Content-Type':'application/json','x-request-id':'provider-request-receipt'}});
  };
  const job=await createJob({idea:'battery arbitrage',provider:'openalex',limit:3});await runResearch(job);
  assert.equal(job.status,'complete');assert.equal(job.synthesisMode,'ai');assert.equal(job.retrieval,'lexical');
  const g=graphData(job);assert.equal(g.nodes.filter(n=>n.label==='Concept').length,1);assert.ok(g.edges.some(e=>e.type==='SUPPORTS'&&e.source===job.papers[0].id));assert.ok(g.edges.some(e=>e.type==='INFORMS'));
  const receipt=job.inferenceRuns[0];assert.equal(receipt.status,'completed');assert.equal(receipt.requestId,'provider-request-receipt');assert.equal(receipt.responseId,'completion-receipt');assert.equal(receipt.totalTokens,150);assert.equal(receipt.model,'deployed-model');assert.deepEqual(receipt.inputChunkIds,job.evidence);assert.match(receipt.promptSha256,/^[a-f0-9]{64}$/);assert.match(receipt.outputSha256,/^[a-f0-9]{64}$/);assert.equal(job.synthesisRunId,receipt.id);assert.ok(g.nodes.find(n=>n.label==='Concept').id.startsWith(receipt.id));assert.ok(!JSON.stringify(receipt).includes('test-token'));
});
test('missing source text remains an actionable failure',async()=>{
  globalThis.fetch=async()=>json({results:[{...paper,abstract_inverted_index:null}]});
  const job=await createJob({idea:'battery arbitrage',provider:'openalex',limit:3});await runResearch(job);
  assert.equal(job.status,'failed');assert.match(job.error,/no readable text/);
});
test('Google Scholar maps search snippets honestly',async()=>{
  process.env.SERPAPI_API_KEY='test';globalThis.fetch=async url=>{assert.equal(new URL(url).searchParams.get('engine'),'google_scholar');return json({organic_results:[{title:'Battery optimization',link:'https://example.org/paper',snippet:text}]});};
  const job=await createJob({idea:'battery arbitrage',provider:'scholar',limit:3});await runResearch(job);
  assert.equal(job.status,'complete');assert.equal(job.papers[0].access,'Search snippet');
});
test('truncated LLM output is rejected',async()=>{
  process.env.LLM_BASE_URL='https://nosana.example/v1';process.env.LLM_MODEL='test';
  globalThis.fetch=async()=>json({choices:[{finish_reason:'length',message:{content:'{}'}}]});
  let receipt;
  await assert.rejects(synthesize('question',[{id:'p1-c1',text}],{onRun:run=>receipt=run}),/did not finish/);
  assert.equal(receipt.status,'failed');assert.equal(receipt.finishReason,'length');assert.equal(receipt.outputJson,undefined);assert.ok(receipt.completedAt);assert.equal(receipt.httpStatus,200);
});
test('HTTP failures retain a failed receipt without fabricating response IDs or usage',async()=>{
  process.env.LLM_BASE_URL='https://nosana.example/v1';process.env.LLM_MODEL='test';
  globalThis.fetch=async()=>new Response('{}',{status:503});
  let receipt;
  await assert.rejects(synthesize('question',[{id:'p1-c1',text}],{onRun:run=>receipt=run}),/HTTP 503/);
  assert.equal(receipt.status,'failed');assert.equal(receipt.httpStatus,503);assert.equal(receipt.responseId,undefined);assert.equal(receipt.totalTokens,undefined);assert.equal(receipt.outputJson,undefined);
});
