#!/usr/bin/env python3
"""Apply the dormant overlay in scratch and run the guarded synthetic Source38 fixture."""

import argparse
from hashlib import sha256
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory


HERE = Path(__file__).resolve().parent
RPC = Path('packages/coding-agent/src/modes/rpc')
CHANGES = {
    RPC / 'rpc-history.ts': 'e456394266d244d33f987ae7391305affd9d3c0dce2b4a0aa4695a1c5137d44e',
    RPC / 'rpc-mode.ts': '7fc5594f2a1866cf2d59ccbb34dea2542102b161d6c85a36c5f39e07ecfb71e8',
    RPC / 'rpc-types.ts': 'cefa46b4127002914eee541884b3a85960327420a82c4b2811095a56f4f37cb3',
    RPC / 'wire/history.ts': 'a30bc02bea4c62b906e5f06ca570388796de543947372a3f69230c8a3eec74dd',
}
MANAGER = Path('packages/coding-agent/src/session/session-manager.ts')
GUARD = Path('compatibility/omp/fixtures/no-provider.ts')


def check(path: Path, expected: str) -> None:
    if sha256(path.read_bytes()).hexdigest() != expected:
        raise SystemExit(f'Unexpected Source38 fixture input {path}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source38', required=True, type=Path)
    parser.add_argument('--bun', required=True, type=Path)
    parser.add_argument('--baseline', action='store_true', help='Run the same fixture before applying the candidate')
    parser.add_argument('--volume', action='store_true', help='Also read every synthetic 100 MiB record')
    args = parser.parse_args()
    source38 = args.source38.resolve(strict=True)
    native = (source38 / 'vendor/omp').resolve(strict=True)
    bun = args.bun.resolve(strict=True)
    guard = (source38 / GUARD).resolve(strict=True)
    check(native / MANAGER, 'd9f7db127cb91f6852a50c865eaa8e97fc9b86c37252f3cbb4f6742bb6ee02c9')
    check(guard, 'c413f208c3a0849c2b37726d05e4533144a36bf420b8ec3cbfb3fdfa28346497')

    with (
        TemporaryDirectory(prefix='omp-active-index-overlay-', dir='/tmp') as scratch,
        TemporaryDirectory(prefix='omp-active-history-', dir='/tmp') as profile,
    ):
        destination = Path(scratch)
        for path, digest in CHANGES.items():
            check(native / path, digest)
            target = destination / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(native / path, target)
        env = {
            'PATH': '/usr/bin:/bin', 'HOME': profile, 'PI_CODING_AGENT_DIR': profile,
            'OMP_ACTIVE_HISTORY_SOURCE': str(native),
            'BUN_RUNTIME_TRANSPILER_CACHE_PATH': '0', 'NODE_DISABLE_COMPILE_CACHE': '1',
        }
        if not args.baseline:
            patch = HERE / 'native-active-history-index.patch'
            subprocess.run(['git', 'apply', '--check', str(patch)], cwd=destination, env=env, check=True)
            subprocess.run(['git', 'apply', str(patch)], cwd=destination, env=env, check=True)
            env['OMP_ACTIVE_HISTORY_OVERLAY'] = scratch
        if args.volume:
            env['OMP_ACTIVE_HISTORY_VOLUME'] = '1'
        result = subprocess.run([str(bun), '--no-env-file', '--preload', str(guard),
                                 str(HERE / 'active-index.fixture.mjs')], cwd=profile, env=env)
        raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
