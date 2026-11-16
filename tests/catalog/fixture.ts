/** Synthetic native fixture authoring only. Product Host never imports this file. */
import { mkdir, readdir, lstat, readlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
export async function nativeFixture(home:string,count=1,profile?:string,buckets=1):Promise<string> {
  const root = join(home,".omp",...(profile ? ["profiles",profile]:[]),"agent/sessions");
  await mkdir(join(root,"bucket"),{recursive:true});
  await mkdir(join(home,"project"),{recursive:true});
  for (let index=0; index<count; index++) {
    const id = `native-${String(index).padStart(4,"0")}`;
    const bucket = buckets === 1 ? "bucket" : `bucket-${String(index % buckets).padStart(4,"0")}`;
    await mkdir(join(root,bucket),{recursive:true});
    await Bun.write(join(root,bucket,`${id}.jsonl`),JSON.stringify({type:"session",version:3,id,
      timestamp:"2026-01-01T00:00:00.000Z",cwd:join(home,"project"),title:`Native Session ${index}`}) + "\n"
      + JSON.stringify({type:"message",id:`entry-${index}`,parentId:null,timestamp:"2026-01-01T00:00:01.000Z",
        message:{role:"user",content:[{type:"text",text:"Synthetic fixture input"}],timestamp:1767225601000}}) + "\n");
  }
  return root;
}
export async function filesystemManifest(root:string):Promise<Record<string,string>> {
  const result:Record<string,string> = {};
  for (const path of ["",...await readdir(root,{recursive:true})].sort()) {
    const full = join(root,path), info = await lstat(full,{bigint:true});
    const contents = info.isFile() ? await Bun.file(full).arrayBuffer() : info.isSymbolicLink() ? await readlink(full):"";
    const hash = createHash("sha256").update(typeof contents === "string" ? contents:Buffer.from(contents)).digest("hex");
    result[path] = `${info.mode}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${hash}`;
  }
  return result;
}
