import {Context} from '@deepseek-ai/cordis';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access';
import {TypertGatewayService} from '@deepseek-ai/dsh-api-gateway';
import sessionContribution from '@deepseek-ai/dsh-api-session-controller/remote';
import {Peer,clientRequestSchema} from '@deepseek-ai/dsh-client-connection';
import {parseRemoteStreamClientMessage} from '@deepseek-ai/dsh-api-gateway/stream-protocol';
import {liveHostContribution} from '../../packages/contracts/live-fixture.ts';
import {LiveFixtureActions,LiveFixtureState,LiveSessionService} from './service.ts';
import {openLiveFixture} from '../../compatibility/omp/fixtures/live-worker.ts';
import * as path from 'node:path';
import {z} from 'zod';
import type {ServerWebSocket} from 'bun';
interface SocketData{peer:Peer;streams:Map<string,AbortController>}
async function* idle(signal:AbortSignal):AsyncGenerator<never>{while(!signal.aborted)await Bun.sleep(25);}
const unary=new Set(['session/list','session/page','session/projections','ompLiveFixture/action']);
const streams=new Set(['$events','session/follow','session/control']);
/** Public DSH carrier for one explicitly isolated synthetic native Session. */
export async function startLiveFixture(port=3185,options:{warmup?:boolean;trace?:boolean}={}){
  const fixture=await openLiveFixture(options.warmup??true,options);const ctx=new Context();
  try {
  const state=await LiveFixtureState.open(fixture.transport);
  await ctx.plugin(TypertRegistry);await ctx.plugin(RemoteAccessService);await ctx.plugin(TypertGatewayService,{});
  ctx.typert.register({package:sessionContribution.package,face:"host",schemas:[],model:{services:[],events:[],objects:[]},invocations:sessionContribution.descriptors});ctx.typert.register(liveHostContribution);
  new LiveSessionService(ctx,state);new LiveFixtureActions(ctx,state);
  const unregister=ctx.typertGateway.registerRemoteEvents(idle,{home:'/synthetic-live'});
  const owner=new Peer(ctx,{principal:{kind:'owner'}});const sockets=new Set<ServerWebSocket<SocketData>>();
  const server=Bun.serve<SocketData>({hostname:'127.0.0.1',port,maxRequestBodySize:16384,
    async fetch(request,carrier){
      const url=new URL(request.url),origin=request.headers.get('origin');
      if(request.headers.get('host')!==new URL(carrier.url).host||(origin!==null&&origin!==carrier.url.origin)
        ||['cross-site','same-site'].includes(request.headers.get('sec-fetch-site')??''))return new Response('Forbidden',{status:403});
      if(url.pathname==='/api/remote.mux'){
        if(origin!==carrier.url.origin||sockets.size>=4)return new Response('Forbidden',{status:403});
        const peer=new Peer(ctx,{principal:{kind:'owner'}});
        if(carrier.upgrade(request,{data:{peer,streams:new Map()}}))return;
        await peer.dispose();return new Response('Upgrade required',{status:426});
      }
      if(url.pathname.startsWith('/api/')&&request.method==='POST'){
        if(origin!==carrier.url.origin)return new Response('Forbidden',{status:403});
        try {const envelope=clientRequestSchema.parse(await request.json());
          if(!unary.has(envelope.method)||url.pathname!=='/api/'+envelope.method)return new Response('Private admission blocked',{status:501});
          const payload=z.strictObject({args:z.record(z.string(),z.unknown())}).parse(envelope.payload);
          const slash=envelope.method.indexOf('/');
          try {const value=await ctx.typertGateway.invoke({namespace:envelope.method.slice(0,slash),method:envelope.method.slice(slash+1),
            args:payload.args,peer:owner,signal:request.signal});
            return Response.json({type:'server-response',rpcId:envelope.rpcId,result:{ok:true,value}});
          }catch(error){const failure=ctx.typertGateway.wireStream.failure(error);
            return Response.json({type:'server-response',rpcId:envelope.rpcId,result:{ok:false,error:failure}});}
        }catch{return new Response('Invalid fixture request',{status:400});}
      }
      if(url.pathname==='/healthz')return Response.json({status:'ok',stage:'isolated-live-fixture',sessionAdmission:'blocked'});
      if(request.method!=='GET'||!['/','/client.js'].includes(url.pathname))return new Response('Not found',{status:404});
      return new Response(Bun.file(path.resolve('vendor/dsh-live',url.pathname==='/'?'index.html':'client.js')));
    },websocket:{maxPayloadLength:16384,idleTimeout:60,
      open(socket){sockets.add(socket);},
      message(socket,bytes){
        try {const text=typeof bytes==='string'?bytes:new TextDecoder('utf-8',{fatal:true}).decode(bytes);
          const frame=parseRemoteStreamClientMessage(text);
          if(frame.type==='cancel'){socket.data.streams.get(frame.streamId)?.abort();return;}
          if(frame.type!=='open'||!streams.has(frame.endpoint)||socket.data.streams.size>=4||socket.data.streams.has(frame.streamId)){
            socket.close(1008,'Invalid fixture stream');return;}
          const control=new AbortController();socket.data.streams.set(frame.streamId,control);
          void (async()=>{
            try {const values=await ctx.typertGateway.wireStream.open(frame.endpoint,frame.payload,idle(control.signal),socket.data.peer,control.signal);
              for await(const value of values){if(control.signal.aborted)break;
                if(socket.send(JSON.stringify({type:'item',streamId:frame.streamId,value}))<=0){state.journal.invalidate('live_slow_viewer');throw Error('live_slow_viewer');}}
              if(!control.signal.aborted)socket.send(JSON.stringify({type:'end',streamId:frame.streamId}));
            }catch(error){if(!control.signal.aborted)socket.send(JSON.stringify({type:'error',streamId:frame.streamId,error:ctx.typertGateway.wireStream.failure(error)}));}
            finally{socket.data.streams.delete(frame.streamId);}
          })();
        }catch{socket.close(1008,'Invalid fixture frame');}
      },close(socket){sockets.delete(socket);for(const control of socket.data.streams.values())control.abort();void socket.data.peer.dispose();},
    },
  });
  return {server,state,profile:fixture.profile,async stop(){state.closed=true;for(const socket of sockets)socket.close(1001,'Fixture shutdown');
    await unregister();await owner.dispose();await ctx.fiber.dispose();await server.stop(true);return await fixture.close();}};
  }catch(error){await ctx.fiber.dispose();await fixture.close();throw error;}
}
