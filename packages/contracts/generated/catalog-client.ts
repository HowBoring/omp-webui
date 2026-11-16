/** Narrow public catalog client. No process spawn, configuration or Agent SDK imports. */
import { validCatalogPage, validCatalogSources, validCatalogDescription } from "./catalog.generated";
import type { RpcWireCommands, CatalogPage, CatalogSources, CatalogDescription } from "./omp-wire";
export type CatalogCommand = {id:string;type:"catalog_sources"}
  | ({id:string;type:"catalog_page"} & RpcWireCommands["catalog_page"]["params"])
  | ({id:string;type:"describe_session"} & RpcWireCommands["describe_session"]["params"]);
export class CatalogClient {
  constructor(private readonly request:(command:CatalogCommand)=>Promise<unknown>) {}
  async sources():Promise<CatalogSources> {
    const value = await this.request({id:crypto.randomUUID(),type:"catalog_sources"});
    if (!validCatalogSources(value)) throw new Error("CATALOG_RESULT_SCHEMA");
    return value;
  }
  async page(options:RpcWireCommands["catalog_page"]["params"] = {}):Promise<CatalogPage> {
    const value = await this.request({id:crypto.randomUUID(),type:"catalog_page",...options});
    if (!validCatalogPage(value)) throw new Error("CATALOG_RESULT_SCHEMA");
    return value;
  }
  async describe(reference:string):Promise<CatalogDescription> {
    const value = await this.request({id:crypto.randomUUID(),type:"describe_session",reference});
    if (!validCatalogDescription(value)) throw new Error("CATALOG_RESULT_SCHEMA");
    return value;
  }
}
