import {readGraphEvidence} from './graph.js';
import {tokens,lexicalRetrieve,synthesize,llmConfigured} from './retrieval.js';

// Select a bounded, workspace-scoped neighborhood. Graph text is untrusted evidence.
export function graphPassages(graph,question,workspaceId){
  const nodes=graph.nodes.filter(n=>n.workspaceId===workspaceId);
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const edges=graph.edges.filter(e=>byId.has(e.source)&&byId.has(e.target));
  const ranked=lexicalRetrieve(nodes.map(n=>({id:n.id,text:[n.name,n.text,JSON.stringify(n.evidence||{})].join('\n')})),question,8);
  const selected=new Set(ranked.map(n=>n.id));
  for(const id of graph.seedIds||[])if(byId.has(id)&&selected.size<8)selected.add(id);
  for(let hop=0;hop<2;hop++){
    const frontier=new Set(selected);
    for(const e of edges){if(frontier.has(e.source)&&selected.size<20)selected.add(e.target);if(frontier.has(e.target)&&selected.size<20)selected.add(e.source);}
  }
  const chosen=[...selected].map(id=>byId.get(id)).filter(Boolean);
  const aliases=new Map(chosen.map((n,i)=>[n.id,`G${i+1}`]));
  let remaining=28000;
  const passageBudget=Math.min(2400,Math.floor(28000/Math.max(1,chosen.length)));
  return chosen.map(n=>{
    const connections=edges.filter(e=>e.source===n.id||e.target===n.id).filter(e=>aliases.has(e.source)&&aliases.has(e.target)).slice(0,12).map(e=>`${aliases.get(e.source)} -[${e.type}]-> ${aliases.get(e.target)}`);
    const body=[`Node type: ${n.labels.join(', ')}`,`Stored fields: ${JSON.stringify(n.evidence||{})}`,n.text||'',`Stored relationships:\n${connections.join('\n')}`].join('\n');
    const text=body.slice(0,Math.min(passageBudget,remaining));remaining-=text.length;
    return {id:aliases.get(n.id),nodeId:n.id,entityId:n.entityId,title:String(n.name).slice(0,200),labels:n.labels,url:n.url,access:n.evidence?.access||'Stored graph record',text};
  }).filter(p=>p.text.length);
}

// The shared model adapter remaps summary citations; graph answers also expose
// citations embedded in descriptions, proposals, and limitations.
export function normalizeGraphCitations(answer,passages){
  const valid=new Set(passages.map(p=>p.id));
  const normalize=text=>text.replace(/\[((?:[SG]\d+\s*,\s*)*[SG]\d+)\]/g,(_,ids)=>'['+ids.split(',').map(value=>{
    const id=value.trim();const mapped=id.startsWith('S')?passages[Number(id.slice(1))-1]?.id:id;
    if(!valid.has(mapped))throw new Error('Graph answer contains an unknown evidence citation');
    return mapped;
  }).join(', ')+']');
  return {...answer,summary:normalize(answer.summary),concepts:answer.concepts.map(c=>({...c,description:normalize(c.description)})),directions:answer.directions.map(d=>({...d,idea:normalize(d.idea)})),limitations:answer.limitations.map(normalize)};
}

export async function answerGraph(workspace,input,{readEvidence=readGraphEvidence,generate=synthesize,configured=llmConfigured}={}){
  const question=input.mode==='propose'?`Propose up to three new experiments for this research question: ${workspace.idea}. ${input.question||''}`:input.question;
  const search=input.mode==='propose'?`${workspace.idea} ${input.question||''}`:question;
  const terms=[...new Set(tokens(search))].slice(0,24);
  const graph=await readEvidence(workspace.id,terms);
  const passages=graphPassages(graph,search,workspace.id);
  const limitations=['This answer uses a bounded keyword-selected neighborhood with up to two graph hops, not an exhaustive review of the workspace.'];
  const empty={summary:passages.length?'Neo4j evidence retrieved. Connect Nosana to generate answers and experiment proposals.':'No matching graph evidence was found. Try a specific method, source, or hypothesis from this workspace.',concepts:[],directions:[],limitations};
  if(!passages.length||!configured())return {mode:'evidence',answer:empty,passages};
  const instruction='The retrieved graph neighborhood is incomplete. If a record or measurement is absent, say it was not found in the retrieved evidence. Never claim it does not exist anywhere in the workspace or graph. Treat numeric targets in proposals as assumptions to test, not measured improvements. Use the stored node types and relationships to explain connections. Chunk/Paper text is source evidence, Concept/InferenceRun is generated interpretation, and only completed ExperimentRun records with stored metrics are measured outcomes. Never infer a successful run from a planned experiment or failed run. Cite graph evidence IDs. Identify missing evidence. '+(input.mode==='propose'?'Return experiment proposals in directions. Each idea must include a short name, a testable hypothesis, baseline, changed variables, measurement metrics, and a brief procedure. Mark these as proposals, not results. Do not repeat an existing experiment unchanged.':'When asked for experiments, put actionable proposals in directions with hypothesis, baseline, variables, metrics, and procedure.');
  let answer;
  try{answer=normalizeGraphCitations(await generate(`${question}\n\n${instruction}`,passages,{purpose:'graph-question'}),passages);}
  catch{
    return {mode:'evidence',answer:{summary:'The graph evidence is ready below. Nosana did not return a validated answer this time; retry the question or inspect the source records directly.',concepts:[],directions:[],limitations:[...limitations,'No generated findings were accepted for this attempt.']},passages};
  }
  answer.limitations=[...answer.limitations,...limitations];
  return {mode:'ai',answer,passages};
}
