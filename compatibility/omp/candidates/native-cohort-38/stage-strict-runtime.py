#!/usr/bin/env python3
"""Stage or verify the unregistered Source38 StrictStart runtime without starting it."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys
import tempfile

from replay import CANDIDATE, read_pinned

NATIVE = Path("vendor/omp")
RECEIPT = "strict-runtime.json"


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def digest(path, algorithm, bytes_):
    hasher = hashlib.new(algorithm)
    with path.open("rb") as stream:
        remaining = bytes_
        while remaining:
            block = stream.read(min(65_536, remaining))
            if not block:
                raise ValueError(f"File ended before its recorded size: {path}")
            hasher.update(block)
            remaining -= len(block)
        if stream.read(1):
            raise ValueError(f"File exceeds its recorded size: {path}")
    return hasher


def verify_registry_lock(lock, archives):
    locked = set(re.findall(r'^\s*"[^"]+": \["([^"]+)", .*?, "(sha512-[^"]+)"\],$', lock, re.MULTILINE))
    for pin in archives:
        if (f'{pin["name"]}@{pin["version"]}', pin["integrity"]) not in locked:
            raise ValueError(f"Archive disagrees with the Native lock: {pin['name']}")


def verify_registry_inputs(registry, inputs):
    for pin in inputs["registry"]["archives"]:
        archive = registry / pin["archive"]
        require_regular(archive, pin["bytes"])
        archive_hash = digest(archive, "sha512", pin["bytes"])
        integrity = "sha512-" + base64.b64encode(archive_hash.digest()).decode("ascii")
        if integrity != pin["integrity"]:
            raise ValueError(f"Archive SHA-512 differs: {pin['archive']}")
    verify_regular_file(registry / inputs["puppeteerPatch"]["path"], inputs["puppeteerPatch"])


def prepare_registry(registry, inputs):
    output = registry / "node_modules"
    if os.path.lexists(output):
        raise ValueError(f"Registry expansion already exists: {output}")
    verify_registry_inputs(registry, inputs)
    with tempfile.TemporaryDirectory(dir=registry) as directory:
        private = Path(directory)
        expanded = private / "node_modules"
        env = {"PATH": os.defpath, "HOME": directory, "TMPDIR": directory,
               "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull}
        for pin in inputs["registry"]["archives"]:
            package = expanded / pin["name"]
            package.mkdir(parents=True)
            subprocess.run(["tar", "-xzf", registry / pin["archive"], "--strip-components=1", "-C", package],
                           cwd=private, env=env, check=True)
        git = private / "patch.git"
        subprocess.run(["git", "init", "-q", "--bare", "--template=", git], cwd=private, env=env, check=True)
        puppeteer = expanded / "puppeteer-core"
        patch = registry / inputs["puppeteerPatch"]["path"]
        subprocess.run(["git", f"--git-dir={git}", f"--work-tree={puppeteer}", "apply", patch],
                       cwd=puppeteer, env=env, check=True)
        verify_registry_tree(expanded, inputs["registry"]["expanded"])
        if os.path.lexists(output):
            raise ValueError(f"Registry expansion already exists: {output}")
        expanded.rename(output)
    return {"status": "STRICT_RUNTIME_REGISTRY_PREPARED", "path": str(output),
            "sha256": inputs["registry"]["expanded"]["sha256"]}


def verify_registry_tree(root, expected):
    if not stat.S_ISDIR(root.lstat().st_mode):
        raise ValueError("The expanded registry must be a real directory")
    rows, stack = {}, [root]
    size = depth = 0
    while stack:
        with os.scandir(stack.pop()) as entries:
            for entry in entries:
                path = Path(entry.path)
                relative = path.relative_to(root)
                depth = max(depth, len(relative.parts))
                if len(rows) >= expected["entries"] or depth > expected["maxDepth"]:
                    raise ValueError("Expanded registry exceeds inventory bounds")
                if entry.is_dir(follow_symlinks=False):
                    rows[str(relative)] = "dir\0"
                    stack.append(path)
                    continue
                info = entry.stat(follow_symlinks=False)
                size += info.st_size
                if not stat.S_ISREG(info.st_mode) or size > expected["fileBytes"]:
                    raise ValueError(f"Unexpected expanded registry entry: {relative}")
                rows[str(relative)] = f"file\0{info.st_size}\0{digest(path, 'sha256', info.st_size).hexdigest()}\0"
    hasher = hashlib.sha256()
    for name in sorted(rows, key=str.encode):
        hasher.update(f"{name}\0{rows[name]}".encode())
    if (len(rows), size, depth, hasher.hexdigest()) != (
        expected["entries"], expected["fileBytes"], expected["maxDepth"], expected["sha256"]
    ):
        raise ValueError("Expanded registry differs from the frozen patched tree")


def require_regular(path, bytes_):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size != bytes_:
        raise ValueError(f"Unexpected file type or size: {path}")


def verify_regular_file(path, expected):
    require_regular(path, expected["bytes"])
    if digest(path, "sha256", expected["bytes"]).hexdigest() != expected["sha256"]:
        raise ValueError(f"File SHA-256 differs: {path}")


def verify_catalog(catalog, bun, env):
    subprocess.run(
        [bun, "--no-env-file", "--no-install", CANDIDATE / "catalog-runtime-identity.ts", catalog],
        cwd=env["HOME"], env=env, check=True, stdout=subprocess.PIPE,
    )
    return load_json(catalog / "catalog-runtime.json")


def stage_inputs(catalog, compiler, registry, inputs, catalog_inputs, identity):
    native = catalog / NATIVE
    lock = read_pinned(native, inputs["lock"]).decode()
    verify_regular_file(native / inputs["legacyPlugin"]["path"], inputs["legacyPlugin"])
    expected_receipt = catalog_inputs["compilerReceipt"]
    require_regular(compiler / expected_receipt["path"], expected_receipt["bytes"])
    compiler_receipt = json.loads(read_pinned(compiler, expected_receipt))
    if (compiler_receipt["status"], compiler_receipt["sourceTree"], compiler_receipt["identity"]) != (
        "UNREGISTERED_COMPILER_ONLY", identity["sourceTree"], identity["identity"]
    ):
        raise ValueError("Compiler and Catalog identity differ")
    for expected in inputs["generatedOutputs"]:
        verify_regular_file(compiler / NATIVE / expected["path"], expected)
    verify_registry_lock(lock, inputs["registry"]["archives"])
    verify_registry_inputs(registry, inputs)
    expanded = registry / "node_modules"
    verify_registry_tree(expanded, inputs["registry"]["expanded"])
    return expanded


def stage_paths(catalog):
    return {
        "native": catalog / NATIVE / "packages/natives/native",
        "package": catalog / NATIVE / "packages/coding-agent",
        "bundle/omp": Path("cli.js"),
    }


def record(catalog, identity, inputs, catalog_inputs, candidate):
    return {
        "status": "UNREGISTERED_STRICT_RUNTIME",
        "sourceTree": identity["sourceTree"],
        "identity": identity["identity"],
        "catalog": str(catalog),
        "catalogInventorySha256": catalog_inputs["stagedInventory"]["sha256"],
        "bunSha256": catalog_inputs["bun"]["sha256"],
        "compilerReceiptSha256": catalog_inputs["compilerReceipt"]["sha256"],
        "registryLockSha256": inputs["lock"]["sha256"],
        "registryTreeSha256": inputs["registry"]["expanded"]["sha256"],
        "guardSha256": candidate["verification"]["guard"]["sha256"],
        "attachmentWorkerSource": inputs["attachmentWorkerSource"],
        "bundle": inputs["bundleOutputs"],
        "links": {path: str(target) for path, target in stage_paths(catalog).items()},
        "argvTail": ["bundle/omp", "--mode", "rpc-ui", "--strict-start"],
    }


def verify_layout(directory, names):
    if not stat.S_ISDIR(directory.lstat().st_mode):
        raise ValueError(f"Expected a stage directory: {directory}")
    missing = set(names)
    with os.scandir(directory) as entries:
        for entry in entries:
            if entry.name not in missing:
                raise ValueError(f"Unexpected stage entry: {entry.path}")
            missing.remove(entry.name)
    if missing:
        raise ValueError(f"Stage entries missing in {directory}: {sorted(missing)}")


def verify_outputs(output, catalog, inputs, candidate):
    verify_layout(output, ("bundle", "native", "package", "no-provider.ts", "rpc-wire.schema.json", RECEIPT))
    bundle = output / "bundle"
    verify_layout(bundle, ("omp", *(item["path"] for item in inputs["bundleOutputs"])))
    for link, target in stage_paths(catalog).items():
        if os.readlink(output / link) != os.fspath(target):
            raise ValueError(f"Unexpected StrictStart link target: {link}")
    for expected in inputs["bundleOutputs"]:
        verify_regular_file(bundle / expected["path"], expected)
    verify_regular_file(output / "no-provider.ts", candidate["verification"]["guard"])
    verify_regular_file(output / "rpc-wire.schema.json", inputs["schema"])


def reject_ancestor_dependencies(*roots):
    for root in roots:
        for parent in root.parents:
            path = parent / "node_modules"
            try:
                path.lstat()
            except FileNotFoundError:
                continue
            raise ValueError(f"Competing dependency directory: {path}")


def write_stage(args, inputs, catalog_inputs, candidate, identity, env):
    catalog, compiler, registry, bun, output = args.catalog, args.compiler, args.registry, args.bun, args.output
    expanded = stage_inputs(catalog, compiler, registry, inputs, catalog_inputs, identity)
    build = Path(env["HOME"]) / "strict-runtime-build.ts"
    shutil.copyfile(CANDIDATE / build.name, build)
    shutil.copyfile(CANDIDATE / "strict-runtime-inputs.json", build.parent / "strict-runtime-inputs.json")
    output.mkdir(mode=0o700)
    try:
        bundle = output / "bundle"
        bundle.mkdir()
        for link, target in stage_paths(catalog).items():
            (output / link).symlink_to(target)
        shutil.copyfile(catalog / "no-provider.ts", output / "no-provider.ts")
        shutil.copyfile(catalog / inputs["schema"]["path"], output / "rpc-wire.schema.json")
        subprocess.run(
            [bun, "--no-env-file", "--no-install", "--preload", output / "no-provider.ts",
             build, catalog / NATIVE, compiler / NATIVE, expanded, bundle],
            cwd=catalog / NATIVE, env={**env, "NODE_PATH": str(expanded)}, check=True,
        )
        expected = record(catalog, identity, inputs, catalog_inputs, candidate)
        (output / RECEIPT).write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")
        verify_outputs(output, catalog, inputs, candidate)
    except BaseException:
        shutil.rmtree(output)
        raise
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare-registry")
    prepare.add_argument("registry", type=Path)
    stage = commands.add_parser("stage")
    verify = commands.add_parser("verify")
    for command in (stage, verify):
        command.add_argument("catalog", type=Path)
        command.add_argument("bun", type=Path)
        command.add_argument("output", type=Path)
    stage.add_argument("compiler", type=Path)
    stage.add_argument("registry", type=Path)
    args = parser.parse_args()
    if sys.platform != "linux" or platform.machine() != "x86_64":
        raise ValueError("The StrictStart runtime pin is for Linux x64")
    os.umask(0o077)
    inputs = load_json(CANDIDATE / "strict-runtime-inputs.json")
    if args.command == "prepare-registry":
        print(json.dumps(prepare_registry(args.registry.resolve(strict=True), inputs)))
        return
    args.catalog, args.bun = (value.resolve(strict=True) for value in (args.catalog, args.bun))
    args.output = args.output.parent.resolve(strict=True) / args.output.name
    protected = [args.catalog, args.bun.parent, CANDIDATE.parents[3]]
    if args.command == "stage":
        args.compiler, args.registry = (value.resolve(strict=True) for value in (args.compiler, args.registry))
        protected.extend((args.compiler, args.registry))
        reject_ancestor_dependencies(args.catalog / NATIVE, args.registry)
    if any(args.output.is_relative_to(path) for path in protected):
        raise ValueError("Choose scratch outside the frozen inputs")

    catalog_inputs = load_json(CANDIDATE / "catalog-runtime-inputs.json")
    candidate = load_json(CANDIDATE / "candidate.json")
    verify_regular_file(args.bun, catalog_inputs["bun"])
    with tempfile.TemporaryDirectory(dir=args.output.parent) as home:
        if args.command == "stage":
            reject_ancestor_dependencies(Path(home) / "strict-runtime-build.ts")
        env = {"PATH": os.defpath, "LANG": "C.UTF-8", "HOME": home, "TMPDIR": home,
               "BUN_RUNTIME_TRANSPILER_CACHE_PATH": "0", "NODE_DISABLE_COMPILE_CACHE": "1"}
        catalog = verify_catalog(args.catalog, args.bun, env)
        if inputs["schema"]["sha256"] != catalog["identity"]["schemaSha256"]:
            raise ValueError("Schema and Catalog identity differ")
        worker_source = inputs["attachmentWorkerSource"]
        verify_regular_file(args.catalog / NATIVE / worker_source["path"], worker_source)
        if args.command == "stage":
            result = write_stage(args, inputs, catalog_inputs, candidate, catalog, env)
        else:
            info = args.output.lstat()
            if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700 or info.st_uid != os.getuid():
                raise ValueError("Expected a private StrictStart stage owned by the verifier")
            verify_outputs(args.output, args.catalog, inputs, candidate)
            expected = record(args.catalog, catalog, inputs, catalog_inputs, candidate)
            receipt = (json.dumps(expected, indent=2) + "\n").encode()
            require_regular(args.output / RECEIPT, len(receipt))
            if (args.output / RECEIPT).read_bytes() != receipt:
                raise ValueError("StrictStart receipt differs")
            result = {**expected, "status": "STRICT_RUNTIME_IDENTITY"}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
