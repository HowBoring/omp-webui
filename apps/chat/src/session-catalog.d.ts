/** Paginated Host catalog reader used by the stock Sessions overlay. */
export interface SessionCatalogInput {
  pageSize: number;
  cursor?: string;
}

export interface SessionCatalogChoice {
  selectionId: string;
  nativeSessionId: string;
  [key: string]: unknown;
}

export interface SessionCatalogPage {
  status: string;
  choices: SessionCatalogChoice[];
  nextCursor?: string;
}

export interface SessionCatalogSessions {
  catalog(input: SessionCatalogInput): Promise<unknown>;
}

export declare const SESSION_CATALOG_PAGE_SIZE: number;

export declare function readSessionCatalog(
  sessions: SessionCatalogSessions,
  unwrap: (result: unknown) => SessionCatalogPage,
  live?: () => boolean,
): Promise<{ choices: SessionCatalogChoice[]; status: string } | undefined>;
