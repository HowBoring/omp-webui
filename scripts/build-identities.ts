/** File-level build identities shared by standalone DSH shells. Source admission stays with each build. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { z } from "zod";

export const sha256=(value:string|Uint8Array):string=>createHash("sha256").update(value).digest("hex");
interface InputIdentity { package:string; version:string; file:string; sha256:string }
const metadata=z.object({name:z.string().optional(),version:z.string().optional()});

export class BuildIdentities {
  #inputs=new Map<string,InputIdentity>();
  #owners=new Map<string,{root:string;name:string;version:string}>();
  async record(path:string,contents:string):Promise<void> {
    let cursor=dirname(path);
    while(!this.#owners.has(cursor)) {
      try {
        const manifest=metadata.parse(JSON.parse(await readFile(resolve(cursor,"package.json"),"utf8")));
        if(typeof manifest.name === "string" && typeof manifest.version === "string") {
          this.#owners.set(cursor,{root:cursor,name:manifest.name,version:manifest.version});continue;
        }
      }catch(error) {
        if(!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT")throw error;
      }
      const parent=dirname(cursor);
      if(parent === cursor)throw new Error("Unidentified build input");
      cursor=parent;
    }
    const owner=this.#owners.get(cursor);
    if(!owner)throw new Error("Unidentified build input");
    this.#inputs.set(path,{package:owner.name,version:owner.version,file:relative(owner.root,path),sha256:sha256(contents)});
  }
  snapshot() {
    const inputs=[...this.#inputs.values()].sort((a,b)=>
      `${a.package}@${a.version}/${a.file}`.localeCompare(`${b.package}@${b.version}/${b.file}`,"en"));
    return {sourceInputs:inputs.length,inputs,sourceSha256:sha256(JSON.stringify(inputs))};
  }
}

export async function assetIdentities(outdir:string,names:readonly string[]):Promise<Record<string,string>> {
  return Object.fromEntries(await Promise.all(names.map(async name=>[name,sha256(await readFile(resolve(outdir,name)))])));
}
