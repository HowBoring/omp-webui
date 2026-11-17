"""Pure verifier boundary tests: fake special files; ordinary temporary files only."""
import os
from pathlib import Path
import runpy
import stat
import tempfile
import types
import unittest
from unittest.mock import patch

PACKET = Path('/workspace/work/mvp-implementation/recovery/ticket41-r11-stage-source-v2')
F = runpy.run_path(str(PACKET / 'preflight-r11-helper-drain-source.py'))
V = runpy.run_path(str(PACKET / 'verify-r11-helper-drain-stage.py'))


def metadata(mode=stat.S_IFREG | 0o600, size=3, **change):
    values = dict(st_dev=1, st_ino=2, st_mode=mode, st_nlink=1, st_uid=os.getuid(), st_size=size,
                  st_mtime_ns=4, st_ctime_ns=5, st_blocks=1)
    return types.SimpleNamespace(**(values | change))


class BoundedInspection(unittest.TestCase):
    def fake_read(self, before, chunks, after=None, opened=None, path_after=None):
        file = Path('/synthetic/regular')
        with patch.object(Path, 'lstat', side_effect=[before, path_after or after or before]), \
             patch.object(Path, 'resolve', return_value=file), \
             patch('os.open', return_value=55) as opener, \
             patch('os.fstat', side_effect=[opened or before, after or before]), \
             patch('os.read', side_effect=chunks) as reader, patch('os.close') as closer:
            try:
                result = F['read_regular'](file, limit=8)
            except AssertionError:
                result = None
            return result, opener.call_count, reader.call_count, closer.call_count, reader.call_args_list

    def test_special_oversized_linked_or_wrong_owner_rejected_before_open_or_read(self):
        for before in [metadata(stat.S_IFIFO | 0o600), metadata(stat.S_IFCHR | 0o600),
                       metadata(size=9), metadata(st_nlink=2), metadata(st_uid=999999)]:
            with self.subTest(before=before):
                result, opened, reads, closed, _ = self.fake_read(before, [b'abc', b''])
                self.assertIsNone(result)
                self.assertEqual((opened, reads, closed), (0, 0, 0))

    def test_descriptor_substitution_rejected_before_reader(self):
        result, opened, reads, closed, _ = self.fake_read(metadata(), [], opened=metadata(stat.S_IFIFO | 0o600))
        self.assertIsNone(result)
        self.assertEqual((opened, reads, closed), (1, 0, 1))

    def test_growth_reads_at_most_limit_plus_one_and_replacement_fails(self):
        result, _, reads, closed, calls = self.fake_read(metadata(size=8), [b'123456789'])
        self.assertIsNone(result)
        self.assertEqual((reads, closed, calls[0].args[1]), (1, 1, 9))
        result, _, _, closed, _ = self.fake_read(metadata(), [b'abc', b''], after=metadata(st_ino=9))
        self.assertIsNone(result)
        self.assertEqual(closed, 1)
        result, _, _, closed, _ = self.fake_read(metadata(), [b'abc', b''], path_after=metadata(st_ino=9))
        self.assertIsNone(result)
        self.assertEqual(closed, 1)

    def test_regular_file_bytes_and_digest_and_eight_platform_members(self):
        with tempfile.TemporaryDirectory(prefix='r11-pure-inspection-') as name:
            root = Path(name)
            rows = []
            for index in range(8):
                file = root / str(index)
                file.write_bytes(b'abc')
                file.chmod(0o600)
                rows.append(dict(path=str(file), kind='file', identity=
                                 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', mode=0o600))
            before, digest, data = F['read_regular'](root / '0', limit=8)
            self.assertEqual((before.st_size, digest, data), (3, rows[0]['identity'], b'abc'))
            original = V['verify_platform'].__globals__['SOURCE']
            V['verify_platform'].__globals__['SOURCE'] = {'runtime': F['snapshot']((root / '7').lstat()) | {'path': rows[7]['path']}}
            try:
                V['verify_platform'](rows)
            finally:
                V['verify_platform'].__globals__['SOURCE'] = original

    def test_private_keys_are_never_opened_by_raw_or_json_reader(self):
        with patch('os.open') as opener:
            for name in ['reply-key.json', 'approval-key.json']:
                with self.assertRaises(AssertionError):
                    F['obj'](F['S'] / 'operator' / name)
            opener.assert_not_called()

    def test_traversal_rejects_depth_and_allocation_before_member_reads(self):
        with tempfile.TemporaryDirectory(prefix='r11-pure-walk-') as name:
            root = Path(name)
            child = root
            for _ in range(33):
                child = child / 'd'
                child.mkdir()
            with self.assertRaises(AssertionError):
                list(V['walk_bounded'](root))
        file = Path('/synthetic/regular')
        with patch.object(Path, 'lstat', return_value=metadata(st_blocks=32769)), \
             patch.object(Path, 'resolve', return_value=file), patch('os.open') as opener:
            with self.assertRaises(AssertionError):
                V['members'](file, None)
            opener.assert_not_called()

    def test_traversal_stops_large_directory_enumeration_at_budget(self):
        root = Path('/synthetic/directory')
        consumed = []
        def entries():
            for index in range(9999):
                consumed.append(index)
                yield types.SimpleNamespace(name=str(index))
        scanner = unittest.mock.MagicMock()
        scanner.__enter__.return_value = entries()
        with patch.object(Path, 'lstat', return_value=metadata(stat.S_IFDIR | 0o700)), \
             patch.object(Path, 'resolve', return_value=root), patch('os.scandir', return_value=scanner):
            with self.assertRaises(AssertionError):
                list(V['walk_bounded'](root))
        self.assertEqual(len(consumed), 2048)


if __name__ == '__main__':
    unittest.main()
