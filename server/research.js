import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import * as cheerio from 'cheerio';
import { downloadDocument, jsonRequest } from './network.js';
import { chunkText, embed, retrieve, synthesize, evidenceOnly, llmConfigured } from './retrieval.js';
import { neo4jConfigured, persistGraph, persistInferenceRun, graphData } from './graph.js';

const dataDir = path.resolve(process.env.POCKETLAB_DATA_DIR || 'data');
export const jobs = new Map();
export async function loadJobs() {
  await fs.mkdir(dataDir,{recursive:true});
  for (const name of await fs.readdir(dataDir)) {
    if (!name.endsWith('.json')) continue;
    try { const job=JSON.parse(await fs.readFile(path.join(dataDir,name),'utf8')); if(job.status==='running'||job.status==='queued'){job.status='failed';job.error='Research was interrupted by a server restart. Start a new search.';} jobs.set(job.id,job); } catch { /* Ignore incomplete cache files. */ }
  }
}
export async function save(job) {
  const target=path.join(dataDir,`${job.id}.json`);
  const temp=`${target}.${randomUUID()}.tmp`;
  await fs.writeFile(temp,JSON.stringify(job)); await fs.rename(temp,target);
}
/** Retain provider receipts even when the response fails validation. */
export async function synthesizeForJob(job,question,passages,purpose='consolidation') {
  return synthesize(question,passages,{purpose,onRun:async run=>{
    (job.inferenceRuns ||= []).push(run);
    if(run.status==='completed'&&purpose==='consolidation')job.synthesisRunId=run.id;
    await save(job);
    if(neo4jConfigured()){
      try{await persistInferenceRun(job,run);run.graphSync={status:'synced'};}
      catch{run.graphSync={status:'pending'};}
      await save(job);
    }
  }});
}
async function event(job,stage,message) {job.stage=stage;job.events.push({stage,message,at:new Date().toISOString()});await save(job);}
export function publicJob(job) {
  const {chunks,...rest}=job;
  return {...rest,chunkCount:chunks.length,chunks:chunks.map(({embedding,...c})=>c),graph:graphData(job)};
}
function abstract(index) {
  const words=[];for(const [word,positions] of Object.entries(index || {}))for(const i of positions)words[i]=word;
  return words.join(' ');
}
export async function discover(idea,provider,limit) {
  if(provider==='scholar') {
    if(!process.env.SERPAPI_API_KEY)throw new Error('Google Scholar requires SERPAPI_API_KEY in .env. You can also choose OpenAlex.');
    const url=new URL('https://serpapi.com/search.json');url.search=new URLSearchParams({engine:'google_scholar',q:idea,num:String(limit),hl:'en',api_key:process.env.SERPAPI_API_KEY});
    const result=await jsonRequest(url);
    return (result.organic_results || []).slice(0,limit).map(p=>({title:p.title,url:p.link || '',year:null,authors:p.publication_info?.summary || '',abstract:p.snippet || '',fallback:'Search snippet',documentUrl:p.resources?.find(r=>r.file_format==='PDF')?.link || '',openAccess:Boolean(p.resources?.some(r=>r.file_format==='PDF'))}));
  }
  const url=new URL('https://api.openalex.org/works');url.search=new URLSearchParams({search:idea,per_page:String(limit)});if(process.env.OPENALEX_API_KEY)url.searchParams.set('api_key',process.env.OPENALEX_API_KEY);
  const result=await jsonRequest(url);
  return (result.results || []).map(p=>{const location=p.best_oa_location;return {title:p.title || p.display_name,url:p.doi || p.primary_location?.landing_page_url || p.id,year:p.publication_year,authors:(p.authorships || []).map(a=>a.author.display_name).slice(0,4).join(', '),abstract:abstract(p.abstract_inverted_index),fallback:'Abstract',documentUrl:location?.pdf_url || location?.landing_page_url || '',openAccess:Boolean(location?.is_oa)};});
}

export async function ingest(paper) {
  let text=paper.abstract;paper.access=text?paper.fallback:'Metadata only';paper.ingestionError=null;
  if(paper.documentUrl && paper.openAccess) {
    try {
      const doc=await downloadDocument(paper.documentUrl);let extracted='';
      if(doc.buffer.subarray(0,5).toString()==='%PDF-') {
        const parser=new PDFParse({data:doc.buffer});
        try { extracted=(await parser.getText({first:30})).text; } finally { await parser.destroy(); }
        paper.access='PDF text';
      } else if(doc.type.includes('text/html')) {
        const $=cheerio.load(doc.buffer.toString());$('script,style,nav,header,footer,form,aside,noscript').remove();
        // Prefer article bodies. A generic landing page must not masquerade as full text.
        const body=$('.jats-body, .article-body, #body, [itemprop="articleBody"]');
        if(body.length) { extracted=body.text();paper.access='Article text'; }
        else { const value=$('meta[name="citation_abstract"],meta[name="dc.description"],meta[name="DC.Description"]').first().attr('content');if(value){extracted=value;paper.access='Abstract';} }
      } else if(doc.type.includes('text/plain')) {extracted=doc.buffer.toString();paper.access='Plain text';}
      if(extracted.replace(/\s/g,'').length>150)text=extracted;else paper.access=text?paper.fallback:'Metadata only';
    } catch {paper.ingestionError='Full text could not be read; indexed available abstract or snippet instead.';paper.access=text?paper.fallback:'Metadata only';}
  }
  const chunks=chunkText(text || '',paper.id).map(c=>({...c,title:paper.title,access:paper.access}));
  paper.chunkCount=chunks.length;paper.truncated=Boolean(text && text.replace(/\s+/g,' ').length>33800);
  delete paper.abstract;
  return chunks;
}

export async function createJob({idea,provider,limit,workspaceId}) {
  const job={id:randomUUID(),idea,provider,limit,...(workspaceId?{workspaceId}:{}),status:'queued',stage:'search',createdAt:new Date().toISOString(),events:[],papers:[],chunks:[],synthesis:null,retrieval:'lexical',graphSync:{status:'pending'},error:null};
  jobs.set(job.id,job);await save(job);return job;
}
export async function runResearch(job) {
  try {
    job.status='running';await event(job,'search',`Searching ${job.provider==='scholar'?'Google Scholar via SerpApi':'OpenAlex'} for relevant papers…`);
    const found=await discover(job.idea,job.provider,job.limit);
    const seen=new Set();
    job.papers=found.filter(p=>{const key=p.title?.toLowerCase().trim();if(!key||seen.has(key))return false;seen.add(key);return true;}).map((p,i)=>({...p,id:`${job.id}-p${i+1}`}));
    if(!job.papers.length)throw new Error('No papers found. Try a more specific research query.');
    await event(job,'ingest',`Found ${job.papers.length} papers. Reading accessible documents and abstracts…`);
    // Two document workers keep progress visible and bound outbound concurrency.
    let cursor=0;
    await Promise.all(Array.from({length:2},async()=>{while(cursor<job.papers.length){const p=job.papers[cursor++];job.chunks.push(...await ingest(p));await event(job,'ingest',`Indexed ${p.title.slice(0,90)} · ${p.access} · ${p.chunkCount} passages`);}}));
    if(!job.chunks.length)throw new Error('Papers were found, but no readable text was available. Try another query.');
    await event(job,'retrieve',`Indexing ${job.chunks.length} passages for retrieval…`);
    if(process.env.EMBEDDING_MODEL && (process.env.EMBEDDING_BASE_URL || process.env.LLM_BASE_URL)) {
      try {const vectors=await embed(job.chunks.map(c=>c.text));job.chunks.forEach((c,i)=>c.embedding=vectors[i]);job.retrieval='semantic';job.embeddingModel=process.env.EMBEDDING_MODEL;}
      catch {await event(job,'retrieve','Embeddings unavailable. Using BM25 keyword retrieval.');}
    }
    const passages=await retrieve(job,job.idea,8).catch(()=>{job.retrieval='lexical';return retrieve(job,job.idea,8);});
    job.evidence=passages.map(c=>c.id);
    await event(job,'synthesize',llmConfigured()?'Consolidating retrieved evidence into cited concepts and research directions…':'Evidence indexed. AI consolidation awaits your Nosana endpoint.');
    if(llmConfigured()) {
      try {job.synthesis=await synthesizeForJob(job,job.idea,passages);job.synthesisMode='ai';}
      catch {job.synthesis=evidenceOnly(passages);job.synthesis.limitations.unshift('AI synthesis failed. Check API access, model configuration, and quota.');job.synthesisMode='evidence';await event(job,'synthesize','AI synthesis unavailable. Retained source evidence for inspection.');}
    } else {job.synthesis=evidenceOnly(passages);job.synthesisMode='evidence';}
    await event(job,'graph','Preparing the evidence graph and preserving source lineage…');
    if(neo4jConfigured()) {
      try {job.graphSync=await persistGraph(job);await event(job,'graph',`Committed ${job.graphSync.nodes} nodes to Neo4j.`);}
      catch {job.graphSync={status:'failed',error:'Could not write to Neo4j. Check connection and credentials, then retry sync.'};}
    } else job.graphSync={status:'not_configured',error:'Neo4j is not configured. Graph is saved locally and can be synced later.'};
    job.status='complete';await event(job,'complete','Research complete. Sources, retrieved evidence, and graph are ready to explore.');
  } catch(error) {job.status='failed';job.error=error.message;await event(job,'failed',error.message);}
}
