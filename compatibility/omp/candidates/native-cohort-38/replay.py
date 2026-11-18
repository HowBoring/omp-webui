#!/usr/bin/env python3
"""Materialize and optionally verify the unregistered Native source candidate."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


CANDIDATE = Path(__file__).resolve().parent
COMPATIBILITY = CANDIDATE.parent.parent
RPC = Path("packages/coding-agent/src/modes/rpc")
GENERATOR = "packages/coding-agent/scripts/gen-rpc/index.ts"
FRESHNESS_TEST = "packages/coding-agent/test/rpc-wire/generated.test.ts"
STRICT_ENTRIES = (
    "wire/index.ts", "wire/rpc-wire.generated.ts", "attachment-client.ts",
    "submission-client.ts", "navigation-client.ts", "branch-inspect-client.ts",
    "branch-inspect-wire.ts", "rpc-branch-inspect.ts",
)


def read_pinned(root, expected):
    path = (root / expected["path"]).resolve(strict=True)
    if not path.is_relative_to(root):
        raise ValueError(f"Input escapes its root: {expected['path']}")
    contents = path.read_bytes()
    if len(contents) != expected["bytes"] or hashlib.sha256(contents).hexdigest() != expected["sha256"]:
        raise ValueError(f"Bytes differ from candidate manifest: {expected['path']}")
    return contents


def run(env, cwd, *argv, contents=None, capture=False):
    result = subprocess.run(argv, cwd=cwd, env=env, check=True, input=contents,
                            stdout=subprocess.PIPE if capture else None)
    return os.fsdecode(result.stdout).strip() if capture else None


def materialize(manifest, donor, scratch, env):
    base = manifest["baseCommit"]
    tree = run(env, donor, "git", "rev-parse", "--verify", f"{base}^{{tree}}", capture=True)
    if tree != manifest["baseTree"]:
        raise ValueError("The local Native repository must contain the pinned base tree")
    donor_objects = run(env, donor, "git", "rev-parse", "--path-format=absolute", "--git-path", "objects", capture=True)
    patches = [(patch, read_pinned(COMPATIBILITY, patch)) for patch in manifest["patches"]]

    native = scratch / "native"
    run(env, scratch, "git", "init", "-q", "--template=", native)
    (native / ".git/objects/info/alternates").write_text(donor_objects + "\n", encoding="utf-8")
    run(env, native, "git", "config", "core.hooksPath", "/dev/null")
    run(env, native, "git", "checkout", "--quiet", "--detach", base)
    for patch, contents in patches:
        run(env, native, "git", "apply", "--index", "--whitespace=nowarn", "-", contents=contents)
        tree = run(env, native, "git", "write-tree", capture=True)
        if tree != patch["treeAfter"]:
            raise ValueError(f"Unexpected Native tree after {patch['path']}: {tree}")
    run(env, native, "git", "diff", "--exit-code")
    return native, tree


def stage_typecheck_dependencies(source, native, packages):
    modules = native / "node_modules"
    (modules / "@oh-my-pi").mkdir(parents=True)
    (modules / "@oh-my-pi/omptype").symlink_to("../../packages/omptype", target_is_directory=True)
    for name, expected in packages.items():
        package = source / name
        metadata = json.loads((package / "package.json").read_text(encoding="utf-8"))
        if (metadata["name"], metadata["version"]) != (name, expected):
            raise ValueError(f"Verification requires {name}@{expected}")
        shutil.copytree(package, modules / name)


def verify_wire(manifest, native, scratch, bun, node, dependencies, env):
    guard = scratch / "no-provider.ts"
    guard.write_bytes(read_pinned(COMPATIBILITY, manifest["guard"]))
    if run(env, scratch, bun, "--version", capture=True) != manifest["bun"]:
        raise ValueError(f"Verification requires Bun {manifest['bun']}")
    stage_typecheck_dependencies(dependencies, native, manifest["strictPackages"])
    guarded = ("--no-env-file", "--no-install", "--preload", guard)
    run(env, native, bun, *guarded, GENERATOR)
    run(env, native, bun, "--no-env-file", "test", "--preload", guard, FRESHNESS_TEST)
    for expected in manifest["wireArtifacts"]:
        read_pinned(native, expected)
    changed = run(env, native, "git", "diff", "--name-only", capture=True).splitlines()
    if set(changed) != {artifact["path"] for artifact in manifest["wireArtifacts"]}:
        raise ValueError("Unexpected worktree changes after wire generation")

    run(env, native, node, "node_modules/typescript/bin/tsc", "--ignoreConfig", "--noEmit", "--strict",
        "--target", "es2024", "--module", "esnext", "--moduleResolution", "bundler", "--moduleDetection", "force",
        "--lib", "es2024,dom.asynciterable", "--types", "bun", "--skipLibCheck", "--verbatimModuleSyntax",
        "--pretty", "false", GENERATOR, *(RPC / path for path in STRICT_ENTRIES))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("donor", type=Path, help="local Git repository containing the pinned OMP commit")
    parser.add_argument("output", type=Path, help="new isolated scratch directory")
    parser.add_argument("--verify-wire", nargs=3, metavar=("BUN", "NODE", "DEPENDENCIES"), type=Path,
                        help="local Bun and Node executables and node_modules containing pinned TypeScript/types")
    args = parser.parse_args()
    manifest = json.loads((CANDIDATE / "candidate.json").read_text(encoding="utf-8"))
    if manifest["schemaVersion"] != 1 or manifest["status"] != "UNREGISTERED_SOURCE_ONLY":
        raise ValueError("Unsupported Native source candidate manifest")

    donor = args.donor.resolve(strict=True)
    scratch = args.output.parent.resolve(strict=True) / args.output.name
    toolchain = [path.resolve(strict=True) for path in args.verify_wire] if args.verify_wire else None
    if scratch.is_relative_to(donor) or scratch.is_relative_to(COMPATIBILITY.parent.parent):
        raise ValueError("Choose a scratch directory outside both source repositories")
    scratch.mkdir(mode=0o700)
    home = scratch / "home"
    home.mkdir()
    env = {"PATH": os.defpath, "HOME": str(home), "TMPDIR": str(home),
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_OPTIONAL_LOCKS": "0",
           "BUN_RUNTIME_TRANSPILER_CACHE_PATH": "0", "NODE_DISABLE_COMPILE_CACHE": "1"}
    native, tree = materialize(manifest, donor, scratch, env)
    if toolchain:
        verify_wire(manifest["verification"], native, scratch, *toolchain, env)
    print(json.dumps({"status": manifest["status"], "native": str(native), "sourceTree": tree,
                      "wireAndScopedSourceChecks": "passed" if toolchain else "skipped"}))


if __name__ == "__main__":
    main()
