import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import { validCatalogPage, validCatalogSources, validCatalogDescription } from "./generated/catalog.generated.ts";
import type { CatalogPage, CatalogSources, CatalogDescription } from "./generated/omp-wire.ts";
export type { CatalogPage, CatalogSources, CatalogDescription, CatalogDescriptor } from "./generated/omp-wire.ts";
export const catalogPageInput = z.strictObject({cursor:z.string().max(128).optional(),pageSize:z.number().int().min(1).max(32).optional()});
const reference = z.string().min(1).max(4096);
const page = z.custom<CatalogPage>(validCatalogPage), sources = z.custom<CatalogSources>(validCatalogSources);
const description = z.custom<CatalogDescription>(validCatalogDescription);
const pageResult = z.discriminatedUnion("status",[z.strictObject({status:z.literal("ok"),page}),
  z.strictObject({status:z.literal("error"),code:z.string().regex(/^CATALOG_[A-Z_]+$/).max(96)})]);
export type CatalogPageResult = z.infer<typeof pageResult>;
export type CatalogPageInput = z.infer<typeof catalogPageInput>;
const codec = <T>(schema:z.ZodType<T>,typeSymbol:string) => ({mode:"strict" as const,typeSymbol,create:()=>schema,decode:(value:unknown)=>schema.parse(value)});
const pageCodec = codec(catalogPageInput,"CatalogPageInput"), referenceCodec = codec(reference,"string");
/** Explicit fixture contribution. Does not grant product/browser private Session admission. */
export const catalogContribution = createTypertRemoteInfo({package:"@omp-webui/catalog-fixture",methods:{
  "ompCatalogFixture/sources":{service:"ompCatalogFixture",invocation:{kind:"direct"},parameters:[],
    result:{...codec(sources,"CatalogSources")}},
  "ompCatalogFixture/page":{service:"ompCatalogFixture",invocation:{kind:"direct"},
    parameters:[{name:"options",source:"json",codec:pageCodec,strictCodec:pageCodec}],
    result:{...codec(pageResult,"CatalogPageResult")}},
  "ompCatalogFixture/describe":{service:"ompCatalogFixture",invocation:{kind:"direct"},
    parameters:[{name:"reference",source:"json",codec:referenceCodec,strictCodec:referenceCodec}],
    result:{...codec(description,"CatalogDescription")}},
}},z);
export const catalogHostContribution:TypertContribution = {package:catalogContribution.package,face:"host",
  schemas:[{name:"CatalogPage",create:()=>page},{name:"CatalogSources",create:()=>sources},{name:"CatalogDescription",create:()=>description}],
  model:{services:[],events:[],objects:[]},invocations:catalogContribution.descriptors};
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompCatalogFixture:{sources():Promise<RemoteResult<CatalogSources>>;
      page(options:CatalogPageInput):Promise<RemoteResult<CatalogPageResult>>;
      describe(reference:string):Promise<RemoteResult<CatalogDescription>>};
  }
}
