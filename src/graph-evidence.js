// Provider identity comes from recorded run nodes, never from an image name.
export const evidenceProvider=node=>node.labels.includes('InferenceRun')&&node.evidence?.provider==='Nosana'?'nosana':node.labels.includes('ExperimentRun')&&node.evidence?.provider==='Daytona'?'daytona':null;
export const providerColors={nosana:'#9a60cd',daytona:'#218ca1'};
export const providerNames={nosana:'Nosana',daytona:'Daytona'};
export const evidenceTitle=node=>{
  const p=evidenceProvider(node),e=node.evidence||{};
  return p?`${providerNames[p]} · ${e.status||'recorded'}${p==='daytona'&&e.status==='completed'?' · measured':' · '+(p==='nosana'?'inference':'attempt')}`:node.name;
};
export function evidenceHighlights(node){
  const e=node.evidence||{};
  if(evidenceProvider(node)==='nosana')return [['Model',e.model],['Input passages',e.inputChunkIds?.length],['Tokens',e.totalTokens]].filter(([,value])=>value!==undefined&&value!==null&&value!=='');
  if(evidenceProvider(node)==='daytona'&&e.status==='completed')return [['Benchmark profit',e.profit_usd==null?null:'$'+Number(e.profit_usd).toFixed(4)],['Change vs. baseline',e.delta_usd==null?null:(e.delta_usd>=0?'+':'−')+'$'+Math.abs(e.delta_usd).toFixed(4)],['Violations',e.violations]].filter(([,value])=>value!==null&&value!==undefined);
  return [];
}
export function evidenceFields(node){
  const p=evidenceProvider(node),e=node.evidence||{};
  if(!p)return [];
  const date=value=>value?new Date(value).toLocaleString('en-SG',{timeZone:'Asia/Singapore',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})+' SGT':null;
  const common=[['Status',e.status],['Run ID',node.entityId],['Started',date(e.startedAt||e.createdAt)],['Finished',date(e.completedAt)]];
  const values=p==='nosana'?[
    ['Model',e.model],['Purpose',e.purpose],['HTTP status',e.httpStatus],['Request ID',e.requestId],['Completion ID',e.responseId],['Input passages',e.inputChunkIds?.length],['Prompt tokens',e.promptTokens],['Completion tokens',e.completionTokens],['Total tokens',e.totalTokens],['Duration',e.durationMs==null?null:(e.durationMs/1000).toFixed(2)+' s'],['Endpoint',e.endpoint],['Prompt SHA-256',e.promptSha256],['Output SHA-256',e.outputSha256],
  ]:[
    ['Sandbox ID',e.sandboxId],['Sandbox lifecycle',e.sandboxState],['Command IDs',e.commandIds?.join('\n')],['Exit code',e.exitCode],['Recipe variant',e.variant],['Epochs',e.epochs],['Measured profit',e.profit_usd==null?null:'$'+Number(e.profit_usd).toFixed(4)],['Baseline profit',e.baseline_profit_usd==null?null:'$'+Number(e.baseline_profit_usd).toFixed(4)],['Change vs. baseline',e.delta_usd==null?null:'$'+Number(e.delta_usd).toFixed(4)],['Constraint violations',e.violations],['Execution time',e.execution_time_sec==null?null:Number(e.execution_time_sec).toFixed(2)+' s'],['PyTorch',e.pytorch],['Execution device',e.executionDevice?.toUpperCase()],['Runtime image',e.image],['Image digest',e.imageDigest],['Code SHA-256',e.codeSha256],
  ];
  return [...common,...values,['Error',e.error]].filter(([,value])=>value!==undefined&&value!==null&&value!=='');
}
