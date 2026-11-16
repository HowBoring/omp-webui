import { readFile,writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { digest } from "../packages/compatibility/installation.ts";
const inputs:{path:string;sha256:string}[]=[];
const built=await Bun.build({entrypoints:["apps/host/src/interactions-fixture-main.ts"],target:"bun",outdir:"vendor/host-interactions",
  plugins:[{name:"audited-S0-host-inputs",setup(build){build.onLoad({filter:/\.[cm]?[jt]s$/},async args=>{
    const contents=await readFile(args.path,"utf8");
    // No heavy native public client/SDK/runtime closure may enter the Host.
    if(args.path.includes("/pi-coding-agent/") && !args.path.endsWith("/modes/rpc/rpc-frame.ts")) {
      throw new Error("S0_HOST_OMP_IMPORT_BOUNDARY");
    }
    inputs.push({path:relative(process.cwd(),args.path),sha256:digest(contents)});
    return {contents,loader:args.path.endsWith("ts") ? "ts" : "js"};
  });}}]});
if(!built.success)throw new AggregateError(built.logs,"Isolated interaction Host build failed");
for(const path of ["tests/interactions/native-extension.ts","tests/interactions/no-provider.ts"]) {
  inputs.push({path,sha256:digest(await readFile(path))});
}
await writeFile("vendor/host-interactions/manifest.json",JSON.stringify({kind:"S0-isolated-interactions",
  runtime:{name:"bun",version:Bun.version,executableSha256:digest(await readFile(process.execPath))},
  inputs:inputs.sort((a,b)=>a.path.localeCompare(b.path)),
  bundle:{file:"interactions-fixture-main.js",sha256:digest(await readFile("vendor/host-interactions/interactions-fixture-main.js"))},
},null,2)+"\n");
console.info(JSON.stringify({status:"S0-host-built",inputs:inputs.length,bytes:built.outputs[0]?.size}));
