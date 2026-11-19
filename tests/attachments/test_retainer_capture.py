"""Pure binary I/O boundary checks. No child processes or reader threads run."""
import io
import errno
import unittest

from retainer_capture import drain


class ChunkSource:
    def __init__(self, *chunks):
        self.chunks = iter(chunks)
        self.calls = 0
        self.closed = False

    def close(self):
        self.closed = True

    def read(self, size):
        self.calls += 1
        if self.calls > 6:
            raise AssertionError("unbounded read loop")
        chunk = next(self.chunks, b"")
        if isinstance(chunk, Exception):
            raise chunk
        return chunk


class FailedSink:
    def __init__(self, failure):
        self.failure = failure
        self.calls = 0

    def write(self, block):
        self.calls += 1
        raise self.failure

    def flush(self):
        pass


class CaptureTests(unittest.TestCase):
    def test_complete_stream_at_limit_has_full_count_and_digest(self):
        output = io.BytesIO()
        result = drain(io.BytesIO(b"abc"), output, 3)
        self.assertEqual(output.getvalue(), b"abc")
        self.assertEqual(result["observedBytes"], 3)
        self.assertEqual(result["observedSha256"],
                         "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        self.assertEqual(result["capturedBytes"], 3)
        self.assertTrue(result["streamEof"])
        self.assertTrue(result["pass"])

    def test_overflow_keeps_bounded_prefix_but_hashes_through_eof(self):
        output = io.BytesIO()
        result = drain(io.BytesIO(b"abc"), output, 2)
        self.assertEqual(output.getvalue(), b"ab")
        self.assertEqual(result["capturedBytes"], 2)
        self.assertEqual(result["observedBytes"], 3)
        self.assertEqual(result["observedSha256"],
                         "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        self.assertTrue(result["streamEof"])
        self.assertTrue(result["overflow"])
        self.assertFalse(result["pass"])

    def test_write_fault_stops_saving_but_drains_and_hashes_all_bytes(self):
        for code in (errno.ENOSPC, errno.EIO):
            with self.subTest(errno=code):
                source = ChunkSource(b"a", b"b", b"c")
                sink = FailedSink(OSError(code, "fake write fault"))
                result = drain(source, sink, 4)
                self.assertEqual(source.calls, 4)
                self.assertEqual(sink.calls, 1)
                self.assertEqual(result["capturedBytes"], 0)
                self.assertEqual(result["observedBytes"], 3)
                self.assertEqual(result["observedSha256"],
                                 "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
                self.assertTrue(result["streamEof"])
                self.assertEqual(result["writeError"]["errno"], code)
                self.assertEqual(result["diskError"], code == errno.ENOSPC)
                self.assertFalse(result["pass"])

    def test_read_fault_never_claims_eof_or_complete_hash(self):
        source = ChunkSource(b"a", OSError(errno.EIO, "fake read fault"))
        output = io.BytesIO()
        result = drain(source, output, 4)
        self.assertEqual(output.getvalue(), b"a")
        self.assertEqual(source.calls, 2)
        self.assertEqual(result["observedBytes"], 1)
        self.assertEqual(result["observedSha256"],
                         "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb")
        self.assertFalse(result["streamEof"])
        self.assertEqual(result["readError"]["errno"], errno.EIO)
        self.assertFalse(source.closed)
        self.assertFalse(result["pass"])

    def test_short_writes_save_complete_prefix(self):
        class ShortSink(io.BytesIO):
            def write(self, block):
                return super().write(block[:1])
        sink = ShortSink()
        result = drain(io.BytesIO(b"abc"), sink, 3)
        self.assertEqual(sink.getvalue(), b"abc")
        self.assertEqual(result["capturedBytes"], 3)
        self.assertTrue(result["pass"])

    def test_flush_fault_disqualifies_completed_stream(self):
        class FlushSink(io.BytesIO):
            def flush(self):
                raise OSError(errno.ENOSPC, "fake flush fault")
        result = drain(io.BytesIO(b"abc"), FlushSink(), 3)
        self.assertTrue(result["streamEof"])
        self.assertEqual(result["capturedBytes"], 3)
        self.assertEqual(result["writeError"]["errno"], errno.ENOSPC)
        self.assertTrue(result["diskError"])
        self.assertFalse(result["pass"])

    def test_zero_progress_write_fails_once_and_keeps_draining(self):
        class ZeroSink(FailedSink):
            def write(self, block):
                self.calls += 1
                return 0
        source = ChunkSource(b"a", b"b", b"c")
        sink = ZeroSink(None)
        result = drain(source, sink, 3)
        self.assertEqual(source.calls, 4)
        self.assertEqual(sink.calls, 1)
        self.assertTrue(result["streamEof"])
        self.assertIsNotNone(result["writeError"])
        self.assertFalse(result["pass"])

    def test_empty_stream_with_zero_cap_has_empty_digest(self):
        result = drain(io.BytesIO(), io.BytesIO(), 0)
        self.assertEqual(result["observedBytes"], 0)
        self.assertEqual(result["capturedBytes"], 0)
        self.assertEqual(result["observedSha256"],
                         "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        self.assertTrue(result["pass"])

    def test_disk_flag_survives_an_earlier_non_disk_write_fault(self):
        class MultipleFaultSink(FailedSink):
            def flush(self):
                raise OSError(errno.ENOSPC, "fake flush fault")
        result = drain(io.BytesIO(b"abc"), MultipleFaultSink(OSError(errno.EIO, "write fault")), 3)
        self.assertEqual(result["writeError"]["errno"], errno.EIO)
        self.assertEqual(result["flushError"]["errno"], errno.ENOSPC)
        self.assertTrue(result["diskError"])
        self.assertFalse(result["pass"])


if __name__ == "__main__":
    unittest.main()
