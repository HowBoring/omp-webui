/**
 * Read every page of the stock Sessions catalog. A choice is the only admission token the public
 * Open accepts, so a Session listed past the first page must still contribute its choice.
 *
 * Cursors are Host-issued: a repeated, empty or absent cursor ends the walk. The step bound matches
 * the product catalog's own ceiling and keeps a misbehaving Host from looping forever.
 */
export const SESSION_CATALOG_PAGE_SIZE = 32;

export const readSessionCatalog = async (sessions, unwrap, live = () => true) => {
  const choices = [];
  const seen = new Set();
  const cursors = new Set();
  let cursor, status = "complete";
  for (let step = 0; step < 1000; step++) {
    const page = unwrap(await sessions.catalog({
      pageSize: SESSION_CATALOG_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    }));
    if (!live()) return undefined;
    status = page.status;
    for (const choice of page.choices) {
      if (seen.has(choice.selectionId)) continue;
      seen.add(choice.selectionId);
      choices.push(choice);
    }
    if (typeof page.nextCursor !== "string" || page.nextCursor === "" || cursors.has(page.nextCursor)) break;
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return { choices, status };
};
