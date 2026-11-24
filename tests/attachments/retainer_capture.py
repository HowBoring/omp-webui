"""Bounded evidence capture for an already-owned binary output stream."""
import hashlib
import errno


def _fault(error):
    return {"type": type(error).__name__, "errno": getattr(error, "errno", None)}


def _save(sink, block):
    saved = 0
    try:
        while saved < len(block):
            written = sink.write(block[saved:])
            if not isinstance(written, int) or not 0 < written <= len(block) - saved:
                raise OSError(errno.EIO, "capture write made invalid progress")
            saved += written
    except Exception as error:
        return saved, _fault(error)
    return saved, None


def drain(source, sink, limit):
    """Drain to actual EOF; record all observed bytes, saving at most limit bytes."""
    if limit < 0:
        raise ValueError("negative capture limit")
    digest = hashlib.sha256()
    observed = captured = 0
    write_error = None
    read_error = None
    eof = False
    while True:
        try:
            block = source.read(65536)
        except Exception as error:
            read_error = _fault(error)
            break
        if block == b"":
            eof = True
            break
        observed += len(block)
        digest.update(block)
        saved = block[:max(0, limit - captured)]
        if saved and write_error is None:
            size, write_error = _save(sink, saved)
            captured += size
    flush_error = None
    try:
        sink.flush()
    except Exception as error:
        flush_error = _fault(error)
        write_error = write_error or flush_error
    return {"observedBytes": observed, "observedSha256": digest.hexdigest(),
            "capturedBytes": captured, "captureLimitBytes": limit, "streamEof": eof, "overflow": observed > limit,
            "readError": read_error,
            "writeError": write_error, "flushError": flush_error,
            "diskError": any(error is not None and error["errno"] in (errno.ENOSPC, errno.EDQUOT)
                             for error in (write_error, flush_error)),
            "pass": eof and observed <= limit and write_error is None and read_error is None}
