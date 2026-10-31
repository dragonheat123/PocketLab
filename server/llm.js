let cached, inflight;
const configKey=()=>[process.env.LLM_BASE_URL,process.env.LLM_MODEL,process.env.LLM_API_KEY].join('|');
export const llmConfigured=()=>Boolean(process.env.LLM_BASE_URL);
export const inferenceHeaders=()=>({'Content-Type':'application/json',...(process.env.LLM_API_KEY?{Authorization:`Bearer ${process.env.LLM_API_KEY}`}:{})});

/** Discover the deployed model without assuming its name or reporting warmup as ready. */
export async function llmHealth({force=false}={}) {
  if(!llmConfigured())return {configured:false,connected:false,status:'not_configured',message:'Nosana endpoint is not configured.'};
  const key=configKey();
  if(!force&&cached?.key===key&&Date.now()-cached.at<10000)return cached.value;
  if(inflight?.key===key)return inflight.promise;
  const promise=(async()=>{
    let value;
    try{
      const response=await fetch(`${process.env.LLM_BASE_URL.replace(/\/$/,'')}/models`,{headers:inferenceHeaders(),signal:AbortSignal.timeout(8000)});
      if(!response.ok){
        const status=response.status===503?'initializing':[401,403].includes(response.status)?'authentication_required':'unavailable';
        value={configured:true,connected:false,status,httpStatus:response.status,message:status==='initializing'?'Nosana is starting the model. Retry shortly.':status==='authentication_required'?'Nosana requires a valid LLM_API_KEY.':`Nosana model discovery returned HTTP ${response.status}.`};
      }else{
        const payload=await response.json();
        const models=(payload.data || []).filter(m=>typeof m.id==='string'&&!/embed|rerank/i.test(m.id)).map(m=>m.id);
        const selected=process.env.LLM_MODEL || (models.length===1?models[0]:null);
        if(selected&&models.includes(selected))value={configured:true,connected:true,status:'ready',model:selected,message:'Nosana model is available.'};
        else value={configured:true,connected:false,status:'model_required',models,message:selected?'Configured LLM_MODEL was not returned by the endpoint.':models.length?'Multiple models are available. Set LLM_MODEL in .env.':'No chat model is available yet.'};
      }
    }catch{value={configured:true,connected:false,status:'unavailable',message:'Nosana model discovery failed. The endpoint may still be starting or unreachable.'};}
    cached={key,at:Date.now(),value};return value;
  })();
  inflight={key,promise};
  try{return await promise;}finally{if(inflight?.promise===promise)inflight=null;}
}
export async function resolveModel(){
  if(process.env.LLM_MODEL)return process.env.LLM_MODEL;
  const health=await llmHealth();
  if(!health.connected)throw new Error(health.message);
  return health.model;
}
