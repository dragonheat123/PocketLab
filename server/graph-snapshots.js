import path from 'node:path';
import {readJson} from './storage.js';
const directory=()=>path.resolve(process.env.POCKETLAB_DATA_DIR||'data','graph-snapshots');
export async function readGraphSnapshot(workspaceId){
  const graph=await readJson(path.join(directory(),encodeURIComponent(workspaceId)+'.json'));
  if(graph.workspaceId!==workspaceId||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))throw new Error('Graph snapshot does not match this workspace.');
  return {...graph,source:'neo4j-snapshot',live:false,snapshotAt:graph.fetchedAt,notice:'Saved Neo4j graph. Daytona organization networking currently blocks live Neo4j and Nosana access; existing evidence is available for browsing.'};
}
export async function snapshotStats(ids){
  const entries=await Promise.all(ids.map(async id=>{try{const graph=await readGraphSnapshot(id);return [id,{nodes:graph.totalNodes,sources:graph.snapshotStats?.sources??graph.nodes.filter(n=>n.labels.some(l=>['Paper','ResearchPaper','__Document__'].includes(l))).length}];}catch{return [id,{nodes:null,sources:null}];}}));
  return Object.fromEntries(entries);
}
