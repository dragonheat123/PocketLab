const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sessions=new Map();
async function request(path,body){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||'The request failed. Please retry.');return data;}
const sourceUrl=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}};

export function mountGraphChat(root,{workspaceId,onInspect,onSaved}){
  if(!sessions.has(workspaceId))sessions.set(workspaceId,{turns:[],busy:false,error:''});
  const state=sessions.get(workspaceId);
  function draw(){
    if(!root.isConnected)return;
    root.innerHTML=`<div class="panel-heading"><div><h3>Ask your knowledge graph</h3><p>Questions and experiment ideas grounded in this workspace’s Neo4j evidence.</p></div><span class="graph-chat-label">GRAPH EVIDENCE + NOSANA</span></div><form class="graph-chat-form"><label for="graph-question">Your question</label><div><textarea id="graph-question" rows="2" minlength="5" maxlength="1000" required placeholder="How does battery degradation affect our strategy, and what should we test next?" ${state.busy?'disabled':''}>${esc(state.draft||'')}</textarea><button class="primary" type="submit" ${state.busy?'disabled':''}>${state.busy?'Reading graph…':'Ask graph ↗'}</button></div></form><div class="graph-chat-actions"><button class="outline-button" data-propose ${state.busy?'disabled':''}>✧ AI: propose experiments</button><small>Suggestions stay as drafts until you save them. Saving does not execute a run.</small></div><div class="graph-chat-error" role="alert">${esc(state.error)}</div><div class="graph-chat-turns" aria-live="polite" aria-busy="${state.busy}">${state.turns.map((turn,index)=>{
      const result=turn.result,answer=result.answer;
      return `<article class="graph-chat-turn"><h4>${esc(turn.question)}</h4><span class="graph-chat-label">${result.mode==='ai'?'NOSANA · GRAPH-GROUNDED ANSWER':'RETRIEVED GRAPH EVIDENCE'}</span><p class="graph-chat-copy">${esc(answer.summary)}</p>${answer.concepts.map(c=>`<h5>${esc(c.name)}</h5><p class="graph-chat-copy">${esc(c.description)}</p><small>Evidence: ${c.chunkIds.map(esc).join(', ')}</small>`).join('')}${answer.directions.length?`<h5>Proposed experiments and directions</h5>${answer.directions.map((d,i)=>`<div class="graph-chat-proposal"><p class="graph-chat-copy">${esc(d.idea)}</p><small>Evidence: ${d.chunkIds.map(esc).join(', ')}</small>${turn.saved?.[i]?`<p>✓ Saved as a planned experiment. <a href="#/workspaces/${encodeURIComponent(workspaceId)}/experiments">View experiments ↗</a></p>`:`<details><summary>Review and save experiment</summary><form data-save-proposal="${index}:${i}"><label>Name<input name="name" minlength="3" maxlength="120" required value="${esc(d.idea.split(/[\n.!?]/)[0].replace(/^\s*(name|title):\s*/i,'').slice(0,120)||'Graph research proposal')}"/></label><label>Hypothesis and test plan<textarea name="hypothesis" minlength="12" maxlength="2000" rows="5" required>${esc(d.idea)}</textarea></label><button class="outline-button" type="submit">Save planned experiment</button><p class="graph-chat-save-error" role="alert"></p></form></details>`}</div>`).join('')}`:''}${answer.limitations.length?`<ul class="graph-chat-limits">${answer.limitations.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>`:''}<details class="graph-chat-sources"><summary>Inspect ${result.passages.length} graph evidence records</summary>${result.passages.map(p=>{const url=sourceUrl(p.url);return `<article><h5><button type="button" data-graph-source="${index}:${esc(p.id)}">[${esc(p.id)}] ${esc(p.title)}</button></h5><small>${esc(p.labels.join(', '))} · ${esc(p.access)}</small><pre>${esc(p.text)}</pre>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>`:''}</article>`;}).join('')}</details></article>`;
    }).join('')}</div>`;
    const input=root.querySelector('#graph-question');input.oninput=()=>{state.draft=input.value;};
    root.querySelector('.graph-chat-form').onsubmit=e=>{e.preventDefault();void ask('ask',input.value.trim());};
    root.querySelector('[data-propose]').onclick=()=>void ask('propose',input.value.trim());
    root.querySelectorAll('[data-graph-source]').forEach(button=>button.onclick=()=>{const [index,id]=button.dataset.graphSource.split(':');const p=state.turns[index].result.passages.find(p=>p.id===id);onInspect(p.nodeId);});
    root.querySelectorAll('[data-save-proposal]').forEach(form=>form.onsubmit=async e=>{
      e.preventDefault();const [index,i]=form.dataset.saveProposal.split(':');const turn=state.turns[index],d=turn.result.answer.directions[i];
      const source=turn.result.passages.find(p=>d.chunkIds.includes(p.id));
      const button=form.querySelector('button'),error=form.querySelector('[role="alert"]');button.disabled=true;error.textContent='';
      try{await request(`/api/workspaces/${encodeURIComponent(workspaceId)}/experiments`,{name:form.elements.name.value.trim(),hypothesis:form.elements.hypothesis.value.trim(),...(source?{sourceNodeId:source.nodeId}:{})});(turn.saved||=([]))[i]=true;draw();onSaved();}
      catch(err){error.textContent=err.message;button.disabled=false;}
    });
  }
  async function ask(mode,question){
    if(state.busy)return;
    state.busy=true;state.error='';state.draft=question;draw();
    try{
      const result=await request('/api/graph/ask',{workspaceId,mode,...(question.length>=5?{question}:{})});
      state.turns.unshift({question:mode==='propose'?'AI-proposed experiments'+(question?' · '+question:''):question,result});state.turns=state.turns.slice(0,10);state.draft='';
    }catch(error){state.error=error.message;}
    finally{state.busy=false;state.render();}
  }
  state.render=draw;
  draw();
}
