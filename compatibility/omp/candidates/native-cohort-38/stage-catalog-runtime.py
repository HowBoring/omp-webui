#!/usr/bin/env python3
"""Stage and statically verify the unregistered Source38 Linux x64 catalog runtime."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile

from replay import CANDIDATE, COMPATIBILITY, RPC, read_pinned, run


NATIVE = Path("vendor/omp")
LAUNCHER = Path("vendor/omp-candidate/omp")
WORKSPACES = re.compile(r'^\s+"(@oh-my-pi/[a-z-]+)": \["\1@workspace:(packages/[a-z-]+)"\],$', re.M)
CATALOG_VALIDATORS = ("command", "description", "page", "sources")


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest


def verify_file(path, expected):
    if path.stat().st_size != expected["bytes"] or file_hash(path).hexdigest() != expected["sha256"]:
        raise ValueError(f"Pinned file differs: {path}")


def archive_source(compiler_native, native, tree, env):
    # The tree is addressed by the 12-patch manifest. Archive it from immutable Git objects,
    # since the compiler checkout also contains generated files and scratch state.
    native.mkdir(parents=True)
    with subprocess.Popen(["git", "-C", compiler_native, "archive", "--format=tar", tree,
                           "package.json", "bun.lock", "packages"], env=env, stdout=subprocess.PIPE) as archive:
        subprocess.run(["tar", "-x"], cwd=native, env=env, stdin=archive.stdout, check=True)
        if archive.wait() != 0:
            raise ValueError("Pinned source tree could not be archived")


def stage_workspace_links(native):
    scope = native / "node_modules/@oh-my-pi"
    scope.mkdir(parents=True)
    entries = WORKSPACES.findall((native / "bun.lock").read_text(encoding="utf-8"))
    manifests = {load_json(path)["name"]: str(path.parent.relative_to(native))
                 for path in (native / "packages").glob("*/package.json")}
    if len(entries) != len(manifests) or dict(entries) != manifests:
        raise ValueError("Pinned Native workspace manifests differ from the workspace lock links")
    for name, directory in entries:
        link = scope / name.removeprefix("@oh-my-pi/")
        link.symlink_to(Path("../..") / directory, target_is_directory=True)
        if link.resolve(strict=True) != native / directory:
            raise ValueError(f"Native workspace link differs: {name}")
    return dict(entries)


def stage_dependencies(dependencies, native, inputs):
    ajv = dependencies / "ajv"
    if ajv.is_symlink() or any(path.is_symlink() for path in ajv.rglob("*")):
        raise ValueError("Frozen Ajv must contain only package files and directories")
    copied = native / "node_modules/ajv"
    shutil.copytree(ajv, copied)
    digest = hashlib.sha256()
    files = sorted(path for path in copied.rglob("*") if path.is_file())
    for path in files:
        digest.update(str(path.relative_to(copied)).encode() + b"\0" + file_hash(path).digest())
    expected = inputs["ajv"]
    metadata = load_json(copied / "package.json")
    if (metadata["name"], metadata["version"], len(files), digest.hexdigest()) != (
            "ajv", expected["version"], expected["files"], expected["treeSha256"]):
        raise ValueError("Frozen Ajv tree differs")

    expected = inputs["linuxX64BaselineAddon"]
    source = (dependencies / expected["path"]).resolve(strict=True)
    if not source.is_relative_to(dependencies):
        raise ValueError("Native add-on escapes the dependency donor")
    # The source loader detects a workspace and checks its own native directory for the add-on.
    addon = Path("packages/natives/native") / Path(expected["path"]).name
    shutil.copyfile(source, native / addon)
    verify_file(native / addon, expected)
    return str(addon)


def stage_compiler_outputs(compiler, scratch, receipt, inputs, candidate):
    validator_pins = {Path(item["path"]).name: item for item in receipt["nativeValidators"]}
    catalog = [validator_pins[f"catalog-{suffix}.generated.js"] for suffix in CATALOG_VALIDATORS]
    wire = [{**item, "path": str(NATIVE / item["path"])} for item in candidate["verification"]["wireArtifacts"]
            if Path(item["path"]).is_relative_to(RPC)]
    for expected in [*receipt["launcher"], *wire, *catalog, inputs["catalogValidatorModule"]]:
        path = scratch / expected["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(read_pinned(compiler, expected))
    (scratch / LAUNCHER).symlink_to("cli.js")
    (scratch / "no-provider.ts").write_bytes(read_pinned(COMPATIBILITY, candidate["verification"]["guard"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("compiler", type=Path, help="existing exact compiler proof directory")
    parser.add_argument("dependencies", type=Path, help="frozen runtime node_modules donor")
    parser.add_argument("bun", type=Path, help="exact Linux x64 Bun 1.4.4 executable")
    parser.add_argument("output", type=Path, help="new isolated scratch directory")
    args = parser.parse_args()
    compiler, dependencies, bun = (p.resolve(strict=True) for p in (args.compiler, args.dependencies, args.bun))
    scratch = args.output.parent.resolve(strict=True) / args.output.name
    if any(scratch.is_relative_to(root) for root in (compiler, dependencies.parent, bun.parent, COMPATIBILITY.parent.parent)):
        raise ValueError("Choose a new scratch directory outside the inputs")
    if sys.platform != "linux" or platform.machine() != "x86_64":
        raise ValueError("The catalog runtime pin is for Linux x64")

    candidate = load_json(CANDIDATE / "candidate.json")
    inputs = load_json(CANDIDATE / "catalog-runtime-inputs.json")
    receipt = json.loads(read_pinned(compiler, inputs["compilerReceipt"]))
    tree = candidate["patches"][-1]["treeAfter"]
    if receipt["status"] != "UNREGISTERED_COMPILER_ONLY" or receipt["sourceTree"] != tree:
        raise ValueError("Compiler receipt differs from the candidate tree")
    verify_file(bun, inputs["bun"])
    scratch.mkdir(mode=0o700)
    home = scratch / "home"
    home.mkdir()
    env = {"PATH": os.defpath, "HOME": str(home), "TMPDIR": str(home),
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_OPTIONAL_LOCKS": "0",
           "BUN_RUNTIME_TRANSPILER_CACHE_PATH": "0", "NODE_DISABLE_COMPILE_CACHE": "1"}
    if run(env, scratch, bun, "--version", capture=True) != candidate["verification"]["bun"]:
        raise ValueError("Unexpected Bun version")

    native = scratch / NATIVE
    archive_source(compiler / NATIVE, native, tree, env)
    links = stage_workspace_links(native)
    addon = stage_dependencies(dependencies, native, inputs)
    stage_compiler_outputs(compiler, scratch, receipt, inputs, candidate)
    with tempfile.TemporaryDirectory(dir=scratch) as check:
        run(env, scratch, bun, "--no-env-file", "build", "--target=bun", f"--outfile={check}/catalog.js",
            native / RPC / "catalog-mode.ts")
    result = {"status": "UNREGISTERED_CATALOG_RUNTIME", "sourceTree": tree,
              "identity": receipt["identity"], "launcher": str(LAUNCHER), "workspaceLinks": links,
              "ajvTreeSha256": inputs["ajv"]["treeSha256"], "addon": str(NATIVE / addon),
              "addonSha256": inputs["linuxX64BaselineAddon"]["sha256"], "staticCatalogBuild": "passed"}
    (scratch / "catalog-runtime.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "receipt": str(scratch / "catalog-runtime.json")}))


if __name__ == "__main__":
    main()
