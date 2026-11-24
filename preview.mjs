import {createServer} from 'node:http';
import worker from './dist/server/index.js';

const portArg = process.argv.indexOf('--port');
const port = Number(process.env.PORT || (portArg >= 0 && process.argv[portArg+1]) || 3000);
const host = '127.0.0.1';
const env = {MYP_API_TOKEN:process.env.MYP_API_TOKEN};
createServer(async (incoming,outgoing)=>{
  try {
    const request = new Request(`http://${host}:${port}${incoming.url}`,{method:incoming.method,headers:incoming.headers});
    const result = await worker.fetch(request,env);
    outgoing.writeHead(result.status,Object.fromEntries(result.headers));
    outgoing.end(Buffer.from(await result.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end(); }
}).listen(port,host,()=>process.stdout.write(`Comparador disponível em http://${host}:${port}\n`));
