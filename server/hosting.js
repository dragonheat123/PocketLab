import {createHash,createHmac,timingSafeEqual,randomBytes} from 'node:crypto';

const cookieName='pocketlab_owner';
const digest=value=>createHash('sha256').update(value).digest();
const same=(a,b)=>timingSafeEqual(digest(a),digest(b));
export function hostingAccess({code=process.env.DEMO_ACCESS_CODE||'',origin=process.env.PUBLIC_ORIGIN||'',port=process.env.PORT||5173,now=Date.now}={}){
  const allowed=new Set([`http://localhost:${port}`,`http://127.0.0.1:${port}`,...origin.split(',').map(x=>x.trim()).filter(Boolean)]);
  const sign=value=>createHmac('sha256',code).update(value).digest('base64url');
  const access=req=>{
    if(!code)return true;
    const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
    const [expiry,nonce,signature,...extra]=cookie.split('.');
    return !extra.length&&/^\d+$/.test(expiry||'')&&Number(expiry)>now()&&Boolean(nonce&&signature)&&same(sign(expiry+'.'+nonce),signature);
  };
  const attempts=new Map();
  const secure=origin.startsWith('https://')?'; Secure':'';
  return {access,install(app){
    app.use('/api',(req,res,next)=>{
      if(req.headers.origin&&!allowed.has(req.headers.origin))return res.status(403).json({error:'Cross-origin request rejected'});
      next();
    });
    app.get('/api/access',(req,res)=>res.json({protected:Boolean(code),unlocked:access(req)}));
    app.post('/api/access/unlock',(req,res)=>{
      if(!code)return res.json({unlocked:true});
      const key=req.ip||'unknown',attempt=attempts.get(key),at=now();
      if(attempt&&at-attempt.at<60000&&attempt.count>=10)return res.status(429).json({error:'Too many attempts. Try again in a minute.'});
      if(!same(typeof req.body?.code==='string'?req.body.code:'',code)){
        if(attempts.size>1000)attempts.clear();attempts.set(key,{at:attempt&&at-attempt.at<60000?attempt.at:at,count:attempt&&at-attempt.at<60000?attempt.count+1:1});
        return res.status(401).json({error:'That access code is not correct.'});
      }
      attempts.delete(key);const payload=(at+12*60*60*1000)+'.'+randomBytes(16).toString('hex');
      res.setHeader('Set-Cookie',`${cookieName}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure}`);
      res.setHeader('Cache-Control','no-store');res.json({unlocked:true});
    });
    app.post('/api/access/lock',(_req,res)=>{res.setHeader('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);res.json({unlocked:false});});
    app.use('/api',(req,res,next)=>{
      if(code&&!['GET','HEAD','OPTIONS'].includes(req.method)&&!access(req))return res.status(401).json({error:'This shared demo is open for browsing. Use Unlock lab to enable research, edits, and experiment execution.'});
      next();
    });
  }};
}
