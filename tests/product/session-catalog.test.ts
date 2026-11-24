/**
 * A stock Sessions open needs the catalog choice that lists that exact Session. The catalog pages at
 * 32 choices, so a Host with more authorized Sessions must be walked to the end — otherwise a
 * Session admitted past page one renders "not discovered now" with no usable Open.
 */
import { expect, test } from "bun:test";
import { readSessionCatalog, SESSION_CATALOG_PAGE_SIZE } from "../../apps/chat/src/session-catalog.js";
import type { SessionCatalogChoice, SessionCatalogInput, SessionCatalogPage } from "../../apps/chat/src/session-catalog.js";

type Envelope = { ok: true; value: SessionCatalogPage } | { ok: false; error: { message: string } };

const unwrap = (result: unknown) => {
  const envelope = result as Envelope;
  if (envelope.ok === true) return envelope.value;
  throw new Error(envelope.error.message);
};

const choice = (nativeSessionId: string, selectionId: string): SessionCatalogChoice =>
  ({ nativeSessionId, selectionId, ownership: "free" });

const pages = (fakePages: Record<string, SessionCatalogPage>) => {
  const calls: SessionCatalogInput[] = [];
  const catalog = async (input: SessionCatalogInput) => {
    calls.push(input);
    const page = fakePages[input.cursor ?? "first"];
    if (page === undefined) throw new Error(`unexpected cursor ${String(input.cursor)}`);
    return { ok: true, value: page };
  };
  return { calls, catalog };
};

test("a Session admitted past 32 catalog choices becomes selectable through nextCursor", async () => {
  const admitted = "01a2090e-beyond-page-one";
  const first = Array.from({ length: SESSION_CATALOG_PAGE_SIZE }, (_, index) =>
    choice(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, `selection-${index}`));
  const second = [...Array.from({ length: 7 }, (_, index) =>
    choice(`00000000-0000-4000-8000-${String(index + 32).padStart(12, "0")}`, `selection-${index + 32}`)),
    choice(admitted, "selection-admitted")];
  const { calls, catalog } = pages({
    first: { status: "complete", choices: first, nextCursor: "snap:32" },
    "snap:32": { status: "complete", choices: second },
  });

  const catalogResult = await readSessionCatalog({ catalog }, unwrap);

  expect(calls).toEqual([{ pageSize: 32 }, { pageSize: 32, cursor: "snap:32" }]);
  expect(catalogResult!.choices).toHaveLength(40);
  expect(catalogResult!.choices.at(-1)!.nativeSessionId).toBe(admitted);
  // The admitted row is selectable only because its own choice was listed, not minted from page one.
  expect(first.some(listed => listed.nativeSessionId === admitted)).toBe(false);
  expect(catalogResult!.status).toBe("complete");
});

test("duplicate choices and cycled or empty cursors terminate safely", async () => {
  const duplicate = choice("native-duplicate", "selection-duplicate");
  const { calls, catalog } = pages({
    first: { status: "partial", choices: [duplicate], nextCursor: "snap:0" },
    "snap:0": { status: "partial", choices: [duplicate, choice("native-two", "selection-two")], nextCursor: "snap:0" },
  });

  const catalogResult = await readSessionCatalog({ catalog }, unwrap);

  expect(calls).toHaveLength(2);
  expect(catalogResult!.choices.map(listed => listed.nativeSessionId)).toEqual(["native-duplicate", "native-two"]);
  expect(catalogResult!.status).toBe("partial");

  const empty = pages({ first: { status: "complete", choices: [], nextCursor: "" } });
  expect((await readSessionCatalog({ catalog: empty.catalog }, unwrap))!.choices).toEqual([]);
  expect(empty.calls).toHaveLength(1);
});

test("closing the panel stops the walk before the next page is used", async () => {
  const pageOne: SessionCatalogPage = { status: "complete", choices: [choice("native-one", "selection-one")], nextCursor: "snap:32" };
  const { catalog } = pages({ first: pageOne });
  const calls: SessionCatalogInput[] = [];
  let live = true;
  const gated = async (input: SessionCatalogInput) => {
    calls.push(input);
    const result = await catalog(input);
    live = false; // the panel closes while this page is in flight
    return result;
  };

  expect(await readSessionCatalog({ catalog: gated }, unwrap, () => live)).toBeUndefined();
  expect(calls).toEqual([{ pageSize: 32 }]);
  expect(await readSessionCatalog({ catalog }, unwrap, () => false)).toBeUndefined();
});
