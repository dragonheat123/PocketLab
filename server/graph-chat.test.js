import test from 'node:test';
import assert from 'node:assert/strict';
import {answerGraph,graphPassages} from './graph-chat.js';
import {readGraphEvidence,graphNodeInWorkspace} from './graph.js';

const workspace={id:'w1',idea:'Battery degradation and arbitrage'};
const node=(id,text,labels=['Chunk'],workspaceId='w1')=>({id,entityId:'entity-'+id,name:id,text,labels,workspaceId,evidence:{},url:''});
const graph={seedIds:['c'],nodes:[node('c','Battery degradation reduces cycle life.'),node('paper','A published study.',['Paper']),node('concept','A proposed constraint.',['Concept']),node('run','A recorded failed execution.',['ExperimentRun']),node('secret','Battery degradation PRIVATE',['Chunk'],'w2')],edges:[{source:'paper',target:'c',type:'HAS_CHUNK'},{source:'concept',target:'c',type:'GROUNDED_IN'},{source:'run',target:'concept',type:'TESTS'},{source:'secret',target:'c',type:'LEAK'}]};

test('graph context includes actual relationships, full passage text, and two-hop neighbors without leaking other workspaces',()=>{
  const passages=graphPassages(graph,'battery degradation','w1');
  assert.ok(passages.some(p=>p.nodeId==='run'));assert.equal(passages.length,4);
  const text=JSON.stringify(passages);assert.match(text,/Battery degradation reduces cycle life/);assert.match(text,/HAS_CHUNK/);assert.match(text,/GROUNDED_IN/);assert.doesNotMatch(text,/PRIVATE|LEAK|entity-secret/);
  assert.equal(new Set(passages.map(p=>p.id)).size,passages.length);
});
test('graph evidence stays bounded for dense and large records',()=>{
  const nodes=Array.from({length:100},(_,i)=>node(String(i),'battery '.repeat(1000)));
  const passages=graphPassages({nodes,seedIds:['0'],edges:nodes.slice(1).map(n=>({source:'0',target:n.id,type:'RELATED'}))},'battery','w1');
  assert.ok(passages.length<=20);assert.ok(passages.every(p=>p.text.length<=2400));assert.ok(passages.reduce((n,p)=>n+p.text.length,0)<=28000);
});
test('graph questions query Neo4j-scoped evidence and work without a configured model',async()=>{
  let called=false;
  const answer=await answerGraph(workspace,{mode:'ask',question:'What does battery degradation affect?'},{readEvidence:async(id,terms)=>{assert.equal(id,'w1');assert.ok(terms.includes('degradation'));return graph;},configured:()=>false,generate:async()=>{called=true;}});
  assert.equal(answer.mode,'evidence');assert.ok(answer.passages.length);assert.equal(called,false);assert.deepEqual(answer.answer.directions,[]);
});
test('empty graph evidence never triggers model invention',async()=>{
  let called=false;
  const answer=await answerGraph(workspace,{mode:'ask',question:'Missing subject?'},{readEvidence:async()=>({nodes:[],edges:[],seedIds:[]}),configured:()=>true,generate:async()=>{called=true;}});
  assert.equal(called,false);assert.match(answer.answer.summary,/No matching graph evidence/);assert.deepEqual(answer.passages,[]);
});
test('AI experiment proposals search the workspace topic and require actionable cited test plans',async()=>{
  const answer=await answerGraph(workspace,{mode:'propose'},{readEvidence:async(id,terms)=>{assert.ok(terms.includes('degradation'));return graph;},configured:()=>true,generate:async(question,passages,options)=>{
    assert.match(question,/baseline/);assert.match(question,/measurement metrics/);assert.match(question,/planned experiment or failed run/);assert.equal(options.purpose,'graph-question');
    return {summary:`Proposal [${passages[0].id}]`,concepts:[],directions:[{idea:'Compare degradation-aware dispatch against a baseline.',chunkIds:[passages[0].id]}],limitations:[]};
  }});
  assert.equal(answer.mode,'ai');assert.equal(answer.answer.directions.length,1);assert.match(answer.answer.limitations[0],/bounded/);
});
test('read errors propagate without a fabricated graph answer',async()=>{
  await assert.rejects(answerGraph(workspace,{mode:'ask',question:'battery'},{readEvidence:async()=>{throw new Error('database unavailable');}}),/database unavailable/);
});

const record=values=>({get:key=>values[key]});
function mockDriver(handler){let closed=false;return {get closed(){return closed;},session(options){assert.equal(options.defaultAccessMode,'READ');return {executeRead:fn=>fn({run:handler}),close:async()=>{closed=true;}};}};}
test('Neo4j evidence reader scopes seed selection, all traversed nodes, and returned edges',async()=>{
  let calls=0;
  const driver=mockDriver(async(query,params)=>{
    calls++;assert.equal(params.workspaceId,'w1');
    if(calls===1){assert.match(query,/n.workspaceId=\$workspaceId/);assert.deepEqual(params.terms,['battery']);return {records:[record({id:'c'})]};}
    if(calls===2){assert.match(query,/all\(x IN nodes\(p\) WHERE x.workspaceId=\$workspaceId\)/);assert.match(query,/\[\*1\.\.2\]/);assert.match(query,/n.text/);assert.doesNotMatch(query,/properties\(n\)|embedding/);return {records:[record({...graph.nodes[0]})]};}
    assert.match(query,/a.workspaceId=\$workspaceId AND b.workspaceId=\$workspaceId/);return {records:[]};
  });
  const result=await readGraphEvidence('w1',['battery'],{driver});assert.equal(result.nodes[0].text,graph.nodes[0].text);assert.equal(calls,3);assert.equal(driver.closed,true);
});
test('empty Neo4j matches return evidence-only context and close the read session',async()=>{
  const driver=mockDriver(async()=>({records:[]}));
  assert.deepEqual(await readGraphEvidence('w1',['missing'],{driver}),{nodes:[],edges:[],seedIds:[]});assert.equal(driver.closed,true);
});
test('saving evidence checks actual workspace membership independently of visualization limits',async()=>{
  const driver=mockDriver(async(query,params)=>{assert.match(query,/n.workspaceId=\$workspaceId AND elementId\(n\)=\$nodeId/);assert.deepEqual(params,{workspaceId:'w1',nodeId:'not-in-view'});assert.doesNotMatch(query,/LIMIT 500/);return {records:[record({id:'not-in-view'})]};});
  assert.equal(await graphNodeInWorkspace('w1','not-in-view',{driver}),true);assert.equal(driver.closed,true);
});
