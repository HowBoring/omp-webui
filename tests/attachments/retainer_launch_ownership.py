"""Retain the exact original object before any unsafe constructor initialization."""


def hold_step(owner, persist, pause):
    """Bounded reporting/pause faults cannot release uncertain original ownership."""
    try:
        persist({"status": "HOLD_ORIGINAL_OWNERSHIP_UNRESOLVED", "pass": False,
                 "launchAttempted": owner["launchAttempted"],
                 "originalObjectRetained": owner["child"] is not None,
                 "initializerReturned": owner["initializerReturned"],
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


def retain_available_pipes(owner):
    """Keep available public pipe references even after partial initialization."""
    for label in ("stdout", "stderr"):
        if label in owner["pipes"]:
            continue
        try:
            owner["pipes"][label] = getattr(owner["child"], label)
        except BaseException:
            pass


def run_owned(allocate, initialize, make_reader, started, captures, hold):
    owner = {"child": None, "pipes": {}, "readers": [], "joined": [], "captures": captures,
             "launchAttempted": False, "initializerReturned": False,
             "waitObserved": False, "state": "PREPARED"}
    try:
        # Publish attempt state before allocation, and the exact object before __init__.
        # Missing/None handles and partial construction are never proof of no child.
        owner["launchAttempted"] = True
        owner["state"] = "ALLOCATING_ORIGINAL"
        owner["child"] = allocate()
        if owner["child"] is None:
            raise RuntimeError("original object unavailable")
        owner["state"] = "INITIALIZING_ORIGINAL"
        initialize(owner["child"])
        owner["initializerReturned"] = True
        owner["state"] = "OWNED"
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
        owner["state"] = "HOLD"
        owner["failure"] = {"type": type(error).__name__}
        retain_available_pipes(owner)
    # Outside the lifecycle catch: finite pure fake HOLD uses a BaseException sentinel.
    # Production HOLD never returns. Unknown wait/EOF/domain grants no release authority.
    while True:
        hold(owner)
