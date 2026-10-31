import {forceSimulation,forceLink,forceManyBody,forceCenter,forceCollide} from 'd3-force';
import './graph.css';
import {mountGraphChat} from './graph-chat-ui.js';
import {evidenceProvider,providerColors,providerNames,evidenceTitle,evidenceFields,evidenceHighlights} from './graph-evidence.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const category=n=>n.labels.find(l=>!l.startsWith('__')&&l!=='PocketLabNode') || n.labels[0]?.replaceAll('__','') || 'Node';
const palette=['#95ae76','#b4a3c4','#a2bfc9','#c9b18b','#99bba6','#d0aa9e','#b4c386','#91adc6','#bdba9c','#bd9ea9','#a4b6ac'];
const shorten=(text,n=30)=>text.length>n?text.slice(0,n-1)+'…':text;
const graphCache=new Map();

export async function mountExistingGraph(root,{workspaceId,focusEntityId}={}){
  const cacheKey=workspaceId || "default";
  root.innerHTML='<section class="panel"><div class="empty-mini"><span class="spinner graph-loading"></span> Reading your Neo4j graph…</div></section>';
  async function load(refresh=false){
    try{
      if(!graphCache.has(cacheKey)||refresh){const response=await fetch('/api/graph'+(workspaceId?'?workspaceId='+encodeURIComponent(workspaceId):''));const data=await response.json();if(!response.ok)throw new Error(data.error);graphCache.set(cacheKey,data);}
      if(root.isConnected)drawGraph(root,graphCache.get(cacheKey),()=>load(true),focusEntityId);
    }catch(error){if(root.isConnected){root.innerHTML=`<section class="panel"><div class="inline-error">${esc(error.message)}</div><button class="outline-button" id="retry-existing-graph">Retry connection</button></section>`;root.querySelector('button').onclick=()=>load(true);}}
  }
  await load();
}
function drawGraph(root,data,refresh,focusEntityId){
  const labels=[...new Set(data.nodes.map(category))].sort();
  const colors=new Map(labels.map((label,i)=>[label,palette[i%palette.length]]));
  const nodes=data.nodes.map(n=>({...n,category:category(n),degree:0}));
  const runs=nodes.filter(evidenceProvider).sort((a,b)=>String(b.evidence.startedAt||b.evidence.createdAt||'').localeCompare(String(a.evidence.startedAt||a.evidence.createdAt||'')));
  const evidenceColor=node=>providerColors[evidenceProvider(node)]||colors.get(node.category);
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const links=data.edges.map(e=>({...e}));
  for(const e of links){byId.get(e.source).degree++;byId.get(e.target).degree++;}
  const radius=n=>evidenceProvider(n)?15:5+Math.min(10,Math.sqrt(n.degree)*1.6);
  if(nodes.length){
    forceSimulation(nodes).force('link',forceLink(links).id(n=>n.id).distance(55).strength(.35)).force('charge',forceManyBody().strength(-90)).force('center',forceCenter(550,310)).force('collision',forceCollide(n=>radius(n)+5)).stop().tick(200);
    const minX=Math.min(...nodes.map(n=>n.x)),maxX=Math.max(...nodes.map(n=>n.x)),minY=Math.min(...nodes.map(n=>n.y)),maxY=Math.max(...nodes.map(n=>n.y));
    const scale=Math.min(950/(maxX-minX||1),510/(maxY-minY||1));
    nodes.forEach(n=>{n.x=550+(n.x-(minX+maxX)/2)*scale;n.y=310+(n.y-(minY+maxY)/2)*scale;});
  }
  root.innerHTML=`<section class="panel live-graph-panel"><div class="panel-heading"><div><h3>One idea. Every connection.</h3><p>Sources, generated ideas, and measured results — with a trail back to every run.</p></div><button class="outline-button" id="refresh-live-graph">↻ Refresh graph</button></div><div class="live-graph-stats"><span><i class="live-dot"></i>${data.live===false?'SAVED NEO4J SNAPSHOT':'CONNECTED TO NEO4J'}</span><span><b>${data.totalNodes}</b> nodes</span><span><b>${data.totalEdges}</b> relationships</span><span><b>${labels.length}</b> node types</span></div>${data.live===false?`<div class="graph-snapshot-notice"><b>Saved evidence · ${new Date(data.snapshotAt).toLocaleString('en-SG',{timeZone:'Asia/Singapore'})} SGT</b><span>${esc(data.notice)}</span></div>`:''}<div class="graph-evidence-overview"><div class="graph-evidence-heading"><span class="eyebrow">PROOF OF WORK</span><p>Select a provider to trace its runs and connected evidence.</p></div><div class="graph-provider-cards">${['nosana','daytona'].map(provider=>{const group=runs.filter(n=>evidenceProvider(n)===provider),completed=group.filter(n=>n.evidence.status==='completed').length;return `<button class="graph-provider-card ${provider}" data-evidence-provider="${provider}" aria-pressed="false"><span class="provider-monogram">${provider==='nosana'?'N':'D'}</span><span><b>${providerNames[provider]}</b><small>${provider==='nosana'?'LLM inference · generated interpretations':'Sandbox execution · measured outcomes'}</small><em>${completed} completed · ${group.length-completed} other attempts</em></span><strong>${group.length}<small>runs</small></strong></button>`;}).join('')}</div><div class="graph-evidence-filter"><button data-evidence-provider="" class="selected" aria-pressed="true">All research</button><span>◎ Colored rings mark recorded runs. A container image alone is not provider execution.</span></div>${runs.length?`<div class="graph-run-strip">${runs.map((n,i)=>`<button class="${evidenceProvider(n)}" data-run-provider="${evidenceProvider(n)}" ${i>=8?'hidden':''} data-run-evidence="${esc(n.id)}"><i></i><span>${esc(evidenceTitle(n))}</span><code>${esc(n.entityId?.slice(0,8)||'')}</code></button>`).join('')}</div>`:''}</div><div class="graph-toolbar"><label for="graph-search" class="sr-only">Search graph nodes</label><input id="graph-search" type="search" placeholder="Search methods, papers, tools…"/><label for="graph-category" class="sr-only">Filter node type</label><select id="graph-category"><option value="">All node types</option>${labels.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('')}</select><span id="graph-match-count">${nodes.length} nodes shown</span></div><div class="live-graph-layout"><div class="live-graph-canvas"><svg id="live-graph-svg" viewBox="0 0 1100 620" role="img" aria-label="Existing Neo4j knowledge graph with ${nodes.length} nodes and ${links.length} relationships"><defs><pattern id="live-dots" width="19" height="19" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".75" fill="#dce4d2"/></pattern><marker id="live-arrow" viewBox="0 -4 8 8" refX="18" refY="0" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,-3L7,0L0,3" fill="#b1c0a0"/></marker></defs><rect width="1100" height="620" fill="url(#live-dots)"/><g id="live-viewport">${links.map(e=>`<line class="live-edge" data-edge="${esc(e.id)}" x1="${e.source.x}" y1="${e.source.y}" x2="${e.target.x}" y2="${e.target.y}" stroke="#bdcbb0" stroke-width=".9" opacity=".5" marker-end="url(#live-arrow)"><title>${esc(e.source.name)} → ${esc(e.type)} → ${esc(e.target.name)}</title></line>`).join('')}${nodes.map(n=>`<g class="live-node ${evidenceProvider(n)?'provider-run '+evidenceProvider(n):''}" data-live-node="${esc(n.id)}" role="button" tabindex="0" aria-label="Inspect ${esc(n.name)}" transform="translate(${n.x},${n.y})"><title>${esc(n.name)} · ${esc(n.category)} · ${n.degree} relationships</title><circle class="node-halo" r="${radius(n)+5}" fill="${evidenceColor(n)}" opacity="0"/><circle r="${radius(n)}" fill="${evidenceColor(n)}" stroke="#fff" stroke-width="1.5"/>${evidenceProvider(n)?`<circle class="provider-run-ring" r="${radius(n)+4}" fill="none" stroke="${evidenceColor(n)}" stroke-width="1.8"/><text class="provider-node-mark" text-anchor="middle" y="4">${evidenceProvider(n)==='nosana'?'N':'D'}</text>`:''}<text class="node-caption ${evidenceProvider(n)||n.degree>=8||n.category==='ResearchTopic'?'always-visible':''}" x="0" y="${radius(n)+12}" text-anchor="middle">${esc(shorten(evidenceTitle(n),36))}</text></g>`).join('')}</g></svg>${!nodes.length?'<div class="graph-zero">This database has no nodes yet.</div>':''}<div class="graph-zoom"><button data-zoom="in" aria-label="Zoom in">+</button><button data-zoom="out" aria-label="Zoom out">−</button><button data-zoom="fit" aria-label="Fit graph">⊙</button></div><div class="graph-gesture-hint">Scroll to zoom · drag to pan · select a node to explore</div></div><aside class="node-inspector" id="node-inspector"><span class="eyebrow">FOLLOW THE CONNECTIONS</span><div class="inspector-symbol">⌘</div><h3>A living map of your research.</h3><p>Select a node to inspect its details and the ideas connected to it.</p><div class="inspector-types">${labels.map(l=>`<button data-inspector-category="${esc(l)}"><i style="background:${colors.get(l)}"></i>${esc(l)}<span>${nodes.filter(n=>n.category===l).length}</span></button>`).join('')}</div></aside></div><div class="live-graph-footer"><span>${data.truncated?`Showing a bounded view: ${nodes.length} nodes and ${links.length} relationships.`:'Showing every node and relationship currently in this database.'}</span><span>Read at ${new Date(data.fetchedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></div></section>`;
  root.insertAdjacentHTML('afterbegin','<section class="panel graph-chat-panel"></section>');
  let providerFilter='',selected=null,zoom=1,panX=0,panY=0,drag,suppressNodeClick=false;
  const svg=root.querySelector('#live-graph-svg'),viewport=root.querySelector('#live-viewport');
  const search=root.querySelector('#graph-search'),filter=root.querySelector('#graph-category');
  const nodeEls=[...root.querySelectorAll('[data-live-node]')],edgeEls=[...root.querySelectorAll('[data-edge]')];
  const incidentEdges=new Map(nodes.map(n=>[n.id,[]]));
  links.forEach((edge,i)=>{incidentEdges.get(edge.source.id).push(i);if(edge.target.id!==edge.source.id)incidentEdges.get(edge.target.id).push(i);});
  // Use SVG coordinates so dragging stays aligned under zoom, pan, and letterboxing.
  const pointIn=(element,event)=>new DOMPoint(event.clientX,event.clientY).matrixTransform(element.getScreenCTM().inverse());
  function moveNode(node,x,y){
    node.x=x;node.y=y;
    nodeEls[nodes.indexOf(node)].setAttribute('transform',`translate(${x},${y})`);
    for(const i of incidentEdges.get(node.id)){
      const edge=links[i],line=edgeEls[i];
      line.setAttribute('x1',edge.source.x);line.setAttribute('y1',edge.source.y);
      line.setAttribute('x2',edge.target.x);line.setAttribute('y2',edge.target.y);
    }
  }
  function highlight(){
    const query=search.value.toLowerCase().trim();
    const matches=new Set(nodes.filter(n=>(!providerFilter||evidenceProvider(n)===providerFilter)&&(!filter.value||n.category===filter.value)&&(!query||[n.name,n.category,...Object.values(n.evidence||{})].join(' ').toLowerCase().includes(query))).map(n=>n.id));
    const focus=selected?new Set([selected.id]):matches;
    const visible=new Set(focus);
    const filtering=Boolean(query||filter.value||selected||providerFilter);
    let shownRuns=0;root.querySelectorAll('[data-run-evidence]').forEach(el=>{el.hidden=(providerFilter&&el.dataset.runProvider!==providerFilter)||shownRuns>=8;if(!el.hidden)shownRuns++;});
    root.querySelectorAll('[data-evidence-provider]').forEach(el=>{const active=el.dataset.evidenceProvider===providerFilter;el.classList.toggle('selected',active);el.setAttribute('aria-pressed',String(active));});
    if(filtering)for(const e of links)if(focus.has(e.source.id)||focus.has(e.target.id)){visible.add(e.source.id);visible.add(e.target.id);}
    nodeEls.forEach((el,i)=>{const n=nodes[i];el.style.opacity=filtering&&!visible.has(n.id)?'.08':'1';el.classList.toggle('focused',selected?.id===n.id||Boolean(query)&&matches.has(n.id));});
    edgeEls.forEach((el,i)=>{const e=links[i];el.style.opacity=filtering?(focus.has(e.source.id)||focus.has(e.target.id)?'.9':'.04'):'.5';});
    root.querySelector('#graph-match-count').textContent=query||filter.value||providerFilter?`${matches.size} matches · neighbors included`:`${nodes.length} nodes shown`;
  }
  function inspect(node){
    selected=node;highlight();
    // Put the selected node above its neighbors so its visible center stays draggable.
    viewport.appendChild(nodeEls[nodes.indexOf(node)]);
    const edges=links.filter(e=>e.source.id===node.id||e.target.id===node.id);
    const inspector=root.querySelector('#node-inspector');
    const provider=evidenceProvider(node),receipt=evidenceFields(node),highlights=evidenceHighlights(node);
    inspector.dataset.provider=provider||'';
    let url='';try{const u=new URL(node.url);if(['http:','https:'].includes(u.protocol))url=u.href;}catch{}
    inspector.innerHTML=`<div class="inspector-header"><span class="eyebrow">${esc(node.category)}</span><button id="close-node-inspector" aria-label="Clear selected node">×</button></div><h3 class="inspector-node-title">${esc(node.name)}</h3><div class="node-labels">${node.labels.map(l=>`<span>${esc(l)}</span>`).join('')}</div>${provider?`<div class="graph-evidence-badge ${provider}">${providerNames[provider]} · ${esc(node.evidence.status||'recorded')}</div><p class="graph-evidence-caveat">${provider==='nosana'?'Generated interpretation from retrieved passages. This is not a measured experimental result.':node.evidence.status==='completed'?'Measured by the battery benchmark in a Daytona sandbox using fixed illustrative prices.':node.evidence.sandboxId?'An execution attempt, not a successful measurement.':'Provisioning attempt only. No sandbox execution occurred.'}</p>${highlights.length?`<div class="graph-evidence-highlights">${highlights.map(([label,value])=>`<div><small>${esc(label)}</small><b>${esc(value)}</b></div>`).join('')}</div>`:''}<dl class="graph-evidence-receipt">${receipt.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${provider==='daytona'?`<a class="node-source-link" href="#/workspaces/${encodeURIComponent(data.workspaceId)}/experiments">Open experiment logs & run history ↗</a>`:`<a class="node-source-link" href="#/workspaces/${encodeURIComponent(data.workspaceId)}/literature?notebook=1">Open research notebook ↗</a>`}`:''}${node.description?`<p class="node-description">${esc(node.description)}</p>`:'<p>No description is stored for this node.</p>'}${url?`<a class="node-source-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>`:''}<div class="inspector-connection-heading">${edges.length} CONNECTIONS</div><div class="inspector-connections">${edges.slice(0,40).map(e=>{const other=e.source.id===node.id?e.target:e.source;return `<button data-neighbor="${esc(other.id)}"><small>${e.source.id===node.id?'→':'←'} ${esc(e.type)}</small><span>${esc(shorten(other.name,65))}</span></button>`;}).join('')}${edges.length>40?'<p>Showing the first 40 connections.</p>':''}</div>`;
    inspector.querySelector('#close-node-inspector').onclick=()=>{inspector.dataset.provider='';selected=null;highlight();inspector.innerHTML='<span class="eyebrow">EXPLORE YOUR GRAPH</span><h3>Select another node.</h3><p>Search or filter the graph to follow a different idea.</p>';};
    inspector.querySelectorAll('[data-neighbor]').forEach(b=>b.onclick=()=>inspect(byId.get(b.dataset.neighbor)));
  }
  nodeEls.forEach((el,i)=>{el.onclick=e=>{e.stopPropagation();if(suppressNodeClick){suppressNodeClick=false;return;}inspect(nodes[i]);};el.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();inspect(nodes[i]);}};});
  root.querySelectorAll('[data-inspector-category]').forEach(b=>b.onclick=()=>{filter.value=b.dataset.inspectorCategory;selected=null;highlight();});
  search.oninput=filter.onchange=()=>{selected=null;highlight();};
  root.querySelectorAll('[data-evidence-provider]').forEach(b=>b.onclick=()=>{
    providerFilter=b.dataset.evidenceProvider;selected=null;search.value='';filter.value='';highlight();
    const inspector=root.querySelector('#node-inspector'),group=runs.filter(n=>!providerFilter||evidenceProvider(n)===providerFilter);inspector.dataset.provider=providerFilter;
    inspector.innerHTML=`<span class="eyebrow">${providerFilter?providerNames[providerFilter].toUpperCase():'ALL'} RUN EVIDENCE</span><h3>${providerFilter==='nosana'?'From passages to interpretations.':providerFilter==='daytona'?'From code to measured outcomes.':'Every recorded attempt.'}</h3><p>${providerFilter==='nosana'?'Inspect a call to see its model, response receipt, and source passages.':providerFilter==='daytona'?'Inspect a run to see its sandbox, exit code, metrics, and execution provenance.':'Select a run or a research node to follow its connections.'}</p><div class="inspector-connections">${group.map(n=>`<button data-show-run="${esc(n.id)}"><small>${esc(n.entityId?.slice(0,8)||'')} · ${esc(n.evidence.status)}</small><span>${esc(shorten(n.name,70))}</span></button>`).join('')||'<p>No recorded runs yet.</p>'}</div>`;
    inspector.querySelectorAll('[data-show-run]').forEach(button=>button.onclick=()=>inspect(byId.get(button.dataset.showRun)));
  });
  root.querySelectorAll('[data-run-evidence]').forEach(b=>b.onclick=()=>{providerFilter='';search.value='';filter.value='';inspect(byId.get(b.dataset.runEvidence));});
  edgeEls.forEach((el,i)=>{const e=links[i],provider=evidenceProvider(e.source)||evidenceProvider(e.target);if(provider){el.setAttribute('stroke',providerColors[provider]);el.setAttribute('stroke-width','1.8');el.classList.add('provider-edge');}});
  root.querySelector('#refresh-live-graph').onclick=()=>{graphCache.delete(data.workspaceId || 'default');refresh();};
  const transform=()=>viewport.setAttribute('transform',`translate(${panX},${panY}) scale(${zoom})`);
  function zoomTo(value){const next=Math.max(.35,Math.min(5,value));panX=550-(550-panX)*next/zoom;panY=310-(310-panY)*next/zoom;zoom=next;transform();}
  root.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>{if(b.dataset.zoom==='fit'){zoom=1;panX=panY=0;transform();}else zoomTo(zoom*(b.dataset.zoom==='in'?1.25:.8));});
  svg.addEventListener('wheel',e=>{e.preventDefault();if(!drag)zoomTo(zoom*(e.deltaY<0?1.12:.89));},{passive:false});
  svg.onpointerdown=e=>{
    if(e.button!==0||e.isPrimary===false||drag)return;
    suppressNodeClick=false;
    const nodeEl=e.target.closest('[data-live-node]');
    const node=nodeEl?byId.get(nodeEl.dataset.liveNode):null;
    const capture=nodeEl||svg;
    drag={pointerId:e.pointerId,node,nodeEl,capture,start:pointIn(node?viewport:svg,e),clientX:e.clientX,clientY:e.clientY,x:node?.x,y:node?.y,panX,panY,moved:false};
    capture.setPointerCapture(e.pointerId);
  };
  svg.onpointermove=e=>{
    if(!drag||e.pointerId!==drag.pointerId)return;
    if(!drag.moved&&Math.hypot(e.clientX-drag.clientX,e.clientY-drag.clientY)<4)return;
    drag.moved=true;
    const point=pointIn(drag.node?viewport:svg,e),dx=point.x-drag.start.x,dy=point.y-drag.start.y;
    if(drag.node){
      suppressNodeClick=true;drag.nodeEl.classList.add('dragging');svg.classList.add('is-node-dragging');
      moveNode(drag.node,drag.x+dx,drag.y+dy);
    }else{panX=drag.panX+dx;panY=drag.panY+dy;transform();}
  };
  const endDrag=e=>{
    if(!drag||e.pointerId!==drag.pointerId)return;
    const previous=drag;drag=null;
    previous.nodeEl?.classList.remove('dragging');svg.classList.remove('is-node-dragging');
    if(previous.capture.hasPointerCapture(e.pointerId))previous.capture.releasePointerCapture(e.pointerId);
  };
  svg.onpointerup=svg.onpointercancel=svg.onlostpointercapture=endDrag;
  root.querySelector('.graph-gesture-hint').textContent='Drag nodes to arrange · drag background to pan · scroll to zoom';
  mountGraphChat(root.querySelector('.graph-chat-panel'),{workspaceId:data.workspaceId,
    onInspect:id=>{const node=byId.get(id);if(node){inspect(node);root.querySelector('#node-inspector').scrollIntoView({behavior:'smooth',block:'nearest'});}else{const sources=root.querySelector('.graph-chat-sources');sources?.setAttribute('open','');}},
    onSaved:()=>{graphCache.delete(data.workspaceId||'default');refresh();}
  });
  if(focusEntityId){const focus=nodes.find(n=>n.entityId===focusEntityId);if(focus)inspect(focus);}
}

export function invalidateGraph(workspaceId){graphCache.delete(workspaceId || "default");}
