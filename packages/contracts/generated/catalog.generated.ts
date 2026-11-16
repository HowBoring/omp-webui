// Generated from authored catalog wire.
import command from "./catalog-command.js";
import page from "./catalog-page.js";
import sources from "./catalog-sources.js";
import description from "./catalog-description.js";
import type { CatalogCommand } from "./catalog-client";
import type { CatalogPage,CatalogSources,CatalogDescription,RpcWireCommands } from "./omp-wire";
export const validateCatalogCommand = (v:unknown):v is CatalogCommand | ({id:string;type:"negotiate_protocol"} & RpcWireCommands["negotiate_protocol"]["params"]) => command(v);
export const validCatalogPage = (v:unknown):v is CatalogPage => page(v);
export const validCatalogSources = (v:unknown):v is CatalogSources => sources(v);
export const validCatalogDescription = (v:unknown):v is CatalogDescription => description(v);
