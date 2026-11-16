import type { Context } from "@deepseek-ai/cordis";
import { Peer } from "@deepseek-ai/dsh-client-connection";
import { parseRemoteStreamClientMessage } from "@deepseek-ai/dsh-api-gateway/stream-protocol";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";

export interface DshSocketData { peer:Peer; streams:Map<string,AbortController> }

/** Shared loopback-origin check; each slice still selects its own routes and authorization policy. */
export function permittedFixtureOrigin(request:Request,origin:string):boolean {
  const supplied=request.headers.get("origin");
  return request.headers.get("host") === new URL(origin).host && (supplied === null || supplied === origin)
    && !["cross-site","same-site"].includes(request.headers.get("sec-fetch-site") ?? "");
}

async function* idle(signal:AbortSignal):AsyncGenerator<never> {
  const done=Promise.withResolvers<void>();
  const abort=()=>done.resolve();
  signal.addEventListener("abort",abort,{once:true});
  try {if(!signal.aborted)await done.promise;}
  finally {signal.removeEventListener("abort",abort);}
}

/** Bounded public DSH $events mechanics, with no HTTP method dispatch or native RPC access. */
export class DshEventsCarrier {
  readonly owner:Peer;
  #peers=new Set<Peer>();
  #sockets=new Set<ServerWebSocket<DshSocketData>>();
  #unregister:()=>void|Promise<void>;
  constructor(readonly ctx:Context,home:string) {
    this.owner=new Peer(ctx,{principal:{kind:"owner"}});
    this.#unregister=ctx.typertGateway.registerRemoteEvents(idle,{home});
  }
  async upgrade(request:Request,server:Server<DshSocketData>):Promise<Response|undefined> {
    if(request.headers.get("origin") !== server.url.origin || this.#peers.size>=8) {
      return new Response("Forbidden",{status:403});
    }
    const peer=new Peer(this.ctx,{principal:{kind:"owner"}});
    if(server.upgrade(request,{data:{peer,streams:new Map()}})) {this.#peers.add(peer);return;}
    await peer.dispose();return new Response("Upgrade required",{status:426});
  }
  readonly websocket:WebSocketHandler<DshSocketData>={
    maxPayloadLength:16_384,idleTimeout:60,
    open:socket=>{this.#sockets.add(socket);},
    message:(socket,bytes)=>{
      try {
        const text=typeof bytes === "string" ? bytes : new TextDecoder("utf-8",{fatal:true}).decode(bytes);
        const frame=parseRemoteStreamClientMessage(text);
        if(frame.type === "cancel") {socket.data.streams.get(frame.streamId)?.abort();return;}
        if(frame.type !== "open" || frame.endpoint !== "$events" || socket.data.streams.size>=1) {
          socket.close(1008,"events streams only");return;
        }
        const control=new AbortController();socket.data.streams.set(frame.streamId,control);
        void this.#pump(socket,frame.streamId,frame.payload,control).catch(()=>socket.close(1011,"stream failed"));
      }catch{socket.close(1008,"invalid stream frame");}
    },
    close:socket=>{
      this.#sockets.delete(socket);
      for(const control of socket.data.streams.values())control.abort();
      this.#peers.delete(socket.data.peer);void socket.data.peer.dispose();
    },
  };
  async dispose():Promise<void> {
    for(const socket of this.#sockets) {
      for(const control of socket.data.streams.values())control.abort();
      socket.close(1001,"Host shutdown");
    }
    await this.#unregister();
    await Promise.all([...this.#peers].map(peer=>peer.dispose()));
    await this.owner.dispose();
  }
  async #pump(socket:ServerWebSocket<DshSocketData>,streamId:string,payload:unknown,control:AbortController):Promise<void> {
    try {
      const stream=await this.ctx.typertGateway.wireStream.open("$events",payload,idle(control.signal),
        socket.data.peer,control.signal);
      for await(const value of stream) {
        if(socket.send(JSON.stringify({type:"item",streamId,value}))<0)throw new Error("slow DSH viewer");
      }
    }finally{socket.data.streams.delete(streamId);}
  }
}
