// Keep the production server alive within the dedicated app sandbox.
import {spawn} from 'node:child_process';
let child,stopping=false;
function start(){
  child=spawn(process.execPath,['server/index.js'],{stdio:'inherit',env:{...process.env,NODE_ENV:'production'}});
  child.on('exit',(code,signal)=>{if(stopping)process.exit(code||0);console.error(`Web server exited (${signal||code}); restarting in 2 seconds.`);setTimeout(start,2000);});
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;child?.kill(signal);});
start();
