import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {llmHealth,resolveModel} from './llm.js';
const originalFetch=globalThis.fetch;
const keys=['LLM_BASE_URL','LLM_MODEL','LLM_API_KEY'];
const originalEnv=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
let sequence=0;
beforeEach(()=>{for(const k of keys)delete process.env[k];process.env.LLM_BASE_URL=`https://nosana-${++sequence}.example/v1`;});
after(()=>{globalThis.fetch=originalFetch;for(const k of keys){if(originalEnv[k]===undefined)delete process.env[k];else process.env[k]=originalEnv[k];}});
test('HTTP 503 is reported as initialization, never a connected model',async()=>{
  globalThis.fetch=async()=>new Response('Service Initializing',{status:503});
  const status=await llmHealth({force:true});
  assert.equal(status.connected,false);assert.equal(status.status,'initializing');
  await assert.rejects(resolveModel(),/starting/);
});
test('a single served chat model is discovered without hardcoding its name',async()=>{
  globalThis.fetch=async(url)=>{assert.ok(url.endsWith('/v1/models'));return Response.json({data:[{id:'served-research-model'},{id:'embedding-model'}]});};
  const health=await llmHealth({force:true});assert.equal(health.connected,true);
  assert.equal(await resolveModel(),'served-research-model');
});
test('ambiguous chat models require explicit configuration',async()=>{
  globalThis.fetch=async()=>Response.json({data:[{id:'model-a'},{id:'model-b'}]});
  const health=await llmHealth({force:true});assert.equal(health.status,'model_required');assert.equal(health.connected,false);
  process.env.LLM_MODEL='model-b';assert.equal(await resolveModel(),'model-b');
});
test('authentication failures remain actionable',async()=>{
  globalThis.fetch=async()=>new Response('',{status:401});
  const health=await llmHealth({force:true});assert.equal(health.status,'authentication_required');assert.match(health.message,/LLM_API_KEY/);
});
