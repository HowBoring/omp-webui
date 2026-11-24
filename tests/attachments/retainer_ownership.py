"""Lifecycle seam for an original child and its two original output readers."""


def hold_step(owner, persist, pause):
    """One bounded HOLD report/pause; failures grant no release or cleanup authority."""
    try:
        persist({"status": "HOLD_ORIGINAL_OWNERSHIP_UNRESOLVED", "pass": False,
                 "originalWaitObserved": owner["waitObserved"],
                 "originalReaderJoinsObserved": list(owner["joined"]),
                 "originalStreamEof": {label: owner["captures"].get(label, {}).get("streamEof") is True
                                       for label in ("stdout", "stderr")},
                 "failure": owner["failure"], "retry": "NONE", "release": "NONE"})
    except BaseException:
        pass
    try:
        pause()
    except BaseException:
        pass


def run_owned(spawn, make_reader, started, captures, hold):
    owner = {"child": None, "pipes": {}, "readers": [], "joined": [],
             "captures": captures, "waitObserved": False, "state": "OWNED"}
    try:
        owner["child"] = spawn()
        for label in ("stdout", "stderr"):
            owner["pipes"][label] = getattr(owner["child"], label)
        for label, pipe in owner["pipes"].items():
            reader = make_reader(label, pipe)
            owner["readers"].append((label, reader))
            reader.start()
        started(owner)
        owner["waitStatus"] = owner["child"].wait()
        owner["waitObserved"] = True
        for label, reader in owner["readers"]:
            reader.join()
            owner["joined"].append(label)
        if not all(captures.get(label, {}).get("streamEof") is True for label in ("stdout", "stderr")):
            raise RuntimeError("original output EOF not proven")
        owner["state"] = "COMPLETE"
        return owner
    except BaseException as error:
        if owner["child"] is None:
            raise
        owner["state"] = "HOLD"
        owner["failure"] = {"type": type(error).__name__, "errno": getattr(error, "errno", None)}
    # Outside the lifecycle catch: a finite fake HOLD escapes using a BaseException sentinel.
    # A production HOLD never returns, even when reporting or sleeping is interrupted.
    while True:
        hold(owner)
