/** Explicit public readonly-catalog stdio fault fixture, never native runtime evidence. */
const mode=process.argv[2];
const received=new Set<string>();
const requests:object[]=[];
const write=(frame:object):void=>{process.stdout.write(JSON.stringify(frame)+"\n");};
await Bun.sleep(Number(process.argv[3]??0));
write({type:"ready",protocolVersion:1,supportedProtocolVersions:[1,2],maxFrameBytes:1048576,maxReassembledFrameBytes:67108864});
for await(const line of console){
  if(!line)continue;
  const command:unknown=JSON.parse(line);
  if(typeof command!=="object"||command===null||!("id"in command)||!("type"in command))throw new Error("fixture command");
  if(command.type==="negotiate_protocol"){
    await Bun.sleep(Number(process.argv[4]??0));
    const ack={type:"response",id:command.id,command:command.type,success:true,data:{protocolVersion:2}};
    if(mode==="chunk-after-ack")process.stdout.write(JSON.stringify(ack)+"\n"+JSON.stringify({type:"rpc_chunk",
      chunkId:"catalog-forbidden",index:0,count:5,byteLength:1048576,data:Buffer.alloc(64,32).toString("base64")})+"\n");
    else write(ack);
    if(mode==="never-read")await Bun.sleep(60000);
    if(mode==="resume-read")await Bun.sleep(1000);
  }else if(mode==="resume-read"&&"reference"in command&&typeof command.reference==="string"){
    const reference=command.reference;
    const status=reference.startsWith("probe:")&&received.has(reference.slice(6))?"replaced":"missing";
    if(!reference.startsWith("probe:"))received.add(reference);
    write({type:"response",id:command.id,command:command.type,success:true,data:{status,observedAt:"2026-11-16T00:00:00Z"}});
  }else if(mode==="no-response"){
    continue;
  }else if(mode==="out-of-order"){
    requests.push({type:"response",id:command.id,command:command.type,success:true,
      data:{status:"missing",observedAt:"2026-11-16T00:00:00Z"}});
    if(requests.length===2){write(requests[1]!);write(requests[0]!);}
  }else if(mode==="wrong-id"||mode==="wrong-command"){
    write({type:"response",id:mode==="wrong-id"?"wrong":command.id,
      command:mode==="wrong-command"?"catalog_page":command.type,success:true,
      data:{status:"missing",observedAt:"2026-11-16T00:00:00Z"}});
  }else if(mode==="unknown-notification"){
    write({type:"available_commands_update",commands:[]});
  }else if(mode==="late"){
    await Bun.sleep(100);
    write({type:"response",id:command.id,command:command.type,success:true,data:{status:"missing",observedAt:"2026-11-16T00:00:00Z"}});
  }else{
    write({type:"response",id:command.id,command:command.type,success:true,
      data:{status:"missing",observedAt:"2026-11-16T00:00:00Z"}});
  }
}
if(mode==="tail")process.stdout.write('{"type":');
export{};
