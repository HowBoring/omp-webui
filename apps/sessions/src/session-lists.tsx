import { useRef, useState } from "react";
import type { RemoteResult, TypertRemoteNamespaceMap } from "@deepseek-ai/dsh-typert-protocol";
import type { PublicSessionView, SessionSelectionId } from "../../../packages/contracts/sessions.ts";
import type { RegisteredPage } from "../../../packages/contracts/workspaces.ts";

type Registration = PublicSessionView["registration"];
type Workspace = RegisteredPage["items"][number];
type RegisteredCursors = { workspace?: string; index?: string; errors: string[] };
type RegisteredRow = { workspace: Workspace; record?: Registration } | { workspace?: undefined; record: Registration };
type Registered = {
  rows: RegisteredRow[];
  errors: string[];
  next?: RegisteredCursors;
};

const pageSize = 32;
const workingDirectory = "Unknown working directory";
const options = (cursor?: string) => ({ pageSize, ...(cursor === undefined ? {} : { cursor }) });
const message = (failure: unknown) => failure instanceof Error ? failure.message : String(failure);

export function resultValue<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function loadRegistered(
  remote: Pick<TypertRemoteNamespaceMap, "ompSessions" | "ompWorkspaces">, cursor?: RegisteredCursors,
): Promise<Registered> {
  const [workspace, index] = await Promise.allSettled([
    cursor && !cursor.workspace ? undefined : remote.ompWorkspaces.registered(options(cursor?.workspace)).then(resultValue),
    cursor && !cursor.index ? undefined : remote.ompSessions.index(options(cursor?.index)).then(resultValue),
  ]);
  const saved = workspace.status === "fulfilled" ? workspace.value : undefined;
  const history = index.status === "fulfilled" ? index.value : undefined;
  const attempts = new Map<string, Registration>(history?.records.map(record => [record.id, record]));
  const rows: Registered["rows"] = saved ? saved.items.map(item => {
    const record = attempts.get(item.id);
    return { workspace: item, ...(record?.nativeSessionId === item.nativeSessionId ? { record } : {}) };
  }) : (history?.records ?? []).map(record => ({ record }));
  const errors = [
    ...(cursor?.errors ?? []),
    workspace.status === "rejected" ? `Workspace status unavailable. ${message(workspace.reason)}` : "",
    index.status === "rejected" ? `Session attempts unavailable. ${message(index.reason)}` : "",
  ].filter(Boolean);
  // Each Remote owns a distinct, single-use cursor. Only publish observations matched by durable ID.
  const next: RegisteredCursors = {
    errors,
    ...(saved?.nextCursor ? { workspace: saved.nextCursor } : {}),
    ...(history?.nextCursor ? { index: history.nextCursor } : {}),
  };
  return { rows, errors, ...((next.workspace || next.index) ? { next } : {}) };
}

type PageState<Page> = { page?: Page; error?: string; loading?: boolean };
function usePage<Cursor, Page>(request: (cursor?: Cursor) => Promise<Page>) {
  const revision = useRef(0);
  const [state, setState] = useState<PageState<Page>>({});
  const clear = () => { ++revision.current; setState({}); };
  const load = async (cursor?: Cursor) => {
    const current = ++revision.current;
    setState({ loading: true });
    try {
      const page = await request(cursor);
      if (current === revision.current) setState({ page });
    } catch (error) {
      if (current === revision.current) setState({ error: message(error) });
    }
  };
  return { ...state, load, clear };
}

export function useSessionLists(remote: Pick<TypertRemoteNamespaceMap, "ompSessions" | "ompWorkspaces">) {
  const discovered = usePage((cursor?: string) => remote.ompSessions.catalog(options(cursor)).then(resultValue));
  const registered = usePage((cursor?: RegisteredCursors) => loadRegistered(remote, cursor));
  return { discovered, registered, clear: () => { discovered.clear(); registered.clear(); } };
}

function groupByDirectory<Row>(rows: readonly Row[], directory: (row: Row) => string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = directory(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

export function DiscoveredSessions({ list, disabled, open }: {
  list: ReturnType<typeof useSessionLists>["discovered"]; disabled: boolean;
  open(id: SessionSelectionId, switching: boolean): void;
}) {
  const groups = groupByDirectory(list.page?.choices ?? [], choice => choice.cwd ?? workingDirectory);
  const next = list.page?.nextCursor;
  return <section aria-labelledby="discovered-sessions">
    <h2 id="discovered-sessions">Discovered native Sessions</h2>
    <p role="status">{list.loading ? "Loading discovered Sessions…" : list.error ?? list.page?.status}</p>
    {Array.from(groups, ([cwd, choices]) => <div key={cwd}>
      <h3>{cwd}</h3>
      {choices.map(choice => <article key={choice.selectionId} data-native-id={choice.nativeSessionId}>
        <h4>{choice.title ?? choice.nativeSessionId}</h4>
        <p>{choice.nativeSessionId} · {choice.sourceId} · {choice.instanceId}</p>
        <p>{choice.ownership} · directory {choice.directory}</p>
        <button disabled={disabled} onClick={() => open(choice.selectionId, false)}>Open Session</button>
        <button disabled={disabled} onClick={() => open(choice.selectionId, true)}>Switch to Session</button>
      </article>)}
    </div>)}
    {next && <button disabled={disabled} onClick={() => void list.load(next)}>Next discovered page</button>}
  </section>;
}

export function RegisteredSessions({ list, disabled }: {
  list: ReturnType<typeof useSessionLists>["registered"]; disabled: boolean;
}) {
  const groups = groupByDirectory(list.page?.rows ?? [], row => row.workspace?.workspace ?? row.record?.cwd ?? workingDirectory);
  const next = list.page?.next;
  const status = list.page?.errors.join(" ") || (list.page?.rows.length === 0 ? "No registered Sessions." : "");
  return <section aria-labelledby="registered-sessions" data-session-index="true">
    <h2 id="registered-sessions">Registered Sessions</h2>
    <p role="status">{list.loading ? "Loading registered Sessions…" : list.error ?? status}</p>
    {Array.from(groups, ([cwd, rows]) => <div key={cwd}>
      <h3>{cwd}</h3>
      {rows.map(({ workspace, record }) => {
        const { id, nativeSessionId } = workspace ?? record;
        const attempt = record?.attempt;
        return <article key={id} data-native-id={nativeSessionId}>
          <h4>{workspace?.title ?? record?.title ?? nativeSessionId}</h4>
          <p>{nativeSessionId}{record && <> · {record.sourceId} · {record.instanceId}</>}</p>
          {workspace && <p title={workspace.observedAt}>
            Native {workspace.nativeStatus} · ownership {workspace.ownership.state} · directory {workspace.directory.status}
          </p>}
          <p>Last attempt {attempt?.state ?? "unavailable"}{attempt?.code && <> · {attempt.code}</>}</p>
          {attempt?.state === "outcome_unknown" && <p>{attempt.code?.endsWith("_MANUAL_OPEN_REQUIRED")
            ? "Manual Open required. Verify the native identity in discovery." : "Check the outcome before another explicit Open."}</p>}
        </article>;
      })}
    </div>)}
    {next && <button disabled={disabled} onClick={() => void list.load(next)}>Next registered page</button>}
  </section>;
}
