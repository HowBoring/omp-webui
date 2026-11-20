#!/usr/bin/env python3
"""Compile the isolated Source38 preflight launcher and generate its RPC validators."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

from replay import CANDIDATE, COMPATIBILITY, RPC, materialize, read_pinned, run


VALIDATORS = (
    "preflight-validator", "catalog-command", "catalog-description", "catalog-page", "catalog-sources",
    "strict-command", "strict-state", "interactions-command", "interactions-policy", "interactions-result",
    "history-command", "history-open", "history-page", "history-poll", "history-content", "history-notification",
    "submission-command", "submission-result", "navigation-command", "navigation-result", "navigation-preview",
    "attachment-command", "attachment-receipt",
)
STATIC_CLOSURE = ("attachments/deny-network", "attachments/worker", "modes/rpc/catalog-mode",
                  "modes/rpc/strict-mode", "cli-runtime")
COMPILER_OUTPUT = Path("vendor/omp-candidate")
HOST_GENERATED = Path("packages/contracts/generated")
IDENTITY_KEYS = ("base", "sourceSha256", "patchSha256", "schemaSha256")


def digest(contents):
    return hashlib.sha256(contents).hexdigest()


def stage_recipe(candidate, compiler, host, scratch, native, env):
    for expected in compiler["recipeFiles"]:
        revision = compiler["source38Commit"] + ":" + expected["path"]
        contents = subprocess.check_output(["git", "show", revision], cwd=host, env=env)
        if (len(contents), digest(contents)) != (expected["bytes"], expected["sha256"]):
            raise ValueError(f"Source38 recipe file differs: {expected['path']}")
        target = scratch / expected["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(contents)

    patches = candidate["patches"]
    staged = scratch / "compatibility/omp"
    staged.mkdir(parents=True)
    for patch in patches:
        (staged / Path(patch["path"]).name).write_bytes(read_pinned(COMPATIBILITY, patch))
    additions = run(env, native, "git", "diff", "--name-only", patches[9]["treeAfter"], patches[-1]["treeAfter"],
                    capture=True).splitlines()
    extras = [Path(patch["path"]).name for patch in patches[10:]]
    with (scratch / "scripts/omp-source.ts").open("a", encoding="utf-8") as source:
        source.write(f"\nompPatches.push(...{json.dumps(extras)});\n")
        source.write(f"authoredPaths.push(...{json.dumps(additions)}.filter(path => !authoredPaths.includes(path)));\n")


def stage_modules(dependencies, packages, scratch, native):
    modules = scratch / "node_modules"
    (modules / "@oh-my-pi").mkdir(parents=True)
    for name, directory in (("pi-coding-agent", "coding-agent"), ("omptype", "omptype"), ("pi-utils", "utils")):
        (modules / "@oh-my-pi" / name).symlink_to(native / "packages" / directory, target_is_directory=True)
    for name, expected in packages.items():
        package = dependencies / name
        metadata = json.loads((package / "package.json").read_text(encoding="utf-8"))
        if (metadata["name"], metadata["version"]) != (name, expected):
            raise ValueError(f"Compiler requires {name}@{expected}")
        shutil.copytree(package, modules / name)


def run_guarded(scratch, bun, guard, env, phase, entry, *args):
    wrapper = scratch / f"{phase}-entry.ts"
    wrapper.write_text(f'''const audit = Reflect.get(globalThis, Symbol.for("omp.s0.network-guard"));
if (!audit || audit.denied() !== 0 || audit.dispatched() !== 0) throw Error("COMPILER_GUARD_REQUIRED");
await import({json.dumps("./" + entry)});
if (audit.denied() !== 0 || audit.dispatched() !== 0) throw Error("COMPILER_GUARD_NONZERO");
console.log(JSON.stringify({{ phase: {json.dumps(phase)}, status: "COMPILER_NETWORK_GUARD",
  denied: audit.denied(), dispatched: audit.dispatched() }}));
''', encoding="utf-8")
    run(env, scratch, bun, "--no-env-file", "--no-install", "--preload", guard, wrapper, *args)


def stage_launcher(scratch):
    output = scratch / COMPILER_OUTPUT
    marker = json.loads((output / "NOT_BUILT.json").read_text(encoding="utf-8"))
    if marker["status"] != "NOT_BUILT":
        raise ValueError("Source38 wire-only generation did not write its marker")
    identity = {key: marker[key] for key in IDENTITY_KEYS}
    recipe = (scratch / "scripts/build-compatibility.ts").read_text(encoding="utf-8")
    start = "\nif (!checkGenerated && !wireOnly) {\nconst built = await Bun.build("
    end = "\n}\n\n// The runtime startup-fast interaction dispatcher"
    if recipe.count(start) != 1 or recipe.count(end) != 1:
        raise ValueError("Source38 launcher build block differs")
    block = "const built = await Bun.build(" + recipe.split(start, 1)[1].split(end, 1)[0]
    shutil.copyfile(scratch / HOST_GENERATED / "omp.schema.json", output / "rpc-wire.schema.json")
    (scratch / "compile-launcher.ts").write_text(f'''import {{ rm, symlink }} from "node:fs/promises";
import {{ resolve, join }} from "node:path";
const source = resolve("vendor/omp/packages/coding-agent/src");
const output = resolve("vendor/omp-candidate");
const build = {json.dumps(identity)};
{block}
''', encoding="utf-8")


def artifact(root, path):
    contents = path.read_bytes()
    if not contents:
        raise ValueError(f"Empty compiler output: {path.name}")
    return {"path": str(path.relative_to(root)), "bytes": len(contents), "sha256": digest(contents)}


def readback(candidate, scratch, native, tree, env):
    guard = candidate["verification"]
    for expected in guard["wireArtifacts"]:
        read_pinned(native, expected)
    if run(env, native, "git", "write-tree", capture=True) != tree:
        raise ValueError("The compiler changed the staged source tree")
    changed = run(env, native, "git", "diff", "--name-only", capture=True).splitlines()
    if set(changed) != {entry["path"] for entry in guard["wireArtifacts"]}:
        raise ValueError("Unexpected tracked Native output files")

    output = scratch / COMPILER_OUTPUT
    if (output / "omp").readlink() != Path("cli.js"):
        raise ValueError("The local compiler launcher has an unexpected target")
    wire = (native / RPC / "wire/rpc-wire.schema.json").read_text(encoding="utf-8")
    bundled_schema = output / "rpc-wire.schema.json"
    if json.loads(wire) != json.loads(bundled_schema.read_bytes()):
        raise ValueError("Launcher schema differs from the generated Native wire")

    patches = b"".join(read_pinned(COMPATIBILITY, entry) for entry in candidate["patches"])
    base = candidate["baseCommit"]
    identity = {"base": base, "sourceSha256": digest(base.encode() + b"\n" + patches),
                "patchSha256": digest(patches), "schemaSha256": digest(bundled_schema.read_bytes())}
    binary = output / "cli.js"
    compiled = binary.read_bytes()
    if any(value.encode() not in compiled for value in identity.values()):
        # The launcher embeds the report in one of its split source chunks.
        compiled += b"".join(path.read_bytes() for path in output.glob("chunk-*.js"))
    if any(value.encode() not in compiled for value in identity.values()):
        raise ValueError("Compiled launcher identity differs from the selected tuple")
    targets = [f"../omp/packages/coding-agent/src/{path}.ts" for path in STATIC_CLOSURE]
    if any(target.encode() not in compiled or not (output / target).is_file() for target in targets):
        raise ValueError("A deferred Native entry is missing")
    return {
        "status": "UNREGISTERED_COMPILER_ONLY", "sourceTree": tree, "identity": identity,
        "launcher": [artifact(scratch, path) for path in sorted(output.iterdir())
                     if path.name not in {"omp", "NOT_BUILT.json"}],
        "deferredEntries": targets,
        "nativeValidators": [artifact(scratch, native / RPC / f"{name}.generated.js") for name in VALIDATORS],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("native_donor", type=Path, help="local Git repository containing the pinned OMP commit")
    parser.add_argument("host_donor", type=Path, help="local Git repository containing the pinned Source38 commit")
    parser.add_argument("output", type=Path, help="new isolated scratch directory")
    parser.add_argument("bun", type=Path, help="local Bun binary")
    parser.add_argument("dependencies", type=Path, help="local node_modules with the pinned compiler dependencies")
    args = parser.parse_args()
    donor, host, bun, dependencies = (path.resolve(strict=True) for path in
                                     (args.native_donor, args.host_donor, args.bun, args.dependencies))
    scratch = args.output.parent.resolve(strict=True) / args.output.name
    if any(scratch.is_relative_to(repo) for repo in (donor, host, dependencies, COMPATIBILITY.parent.parent)):
        raise ValueError("Choose a scratch directory outside source and dependency inputs")
    scratch.mkdir(mode=0o700)
    home = scratch / "home"
    home.mkdir()
    env = {"PATH": os.defpath, "HOME": str(home), "TMPDIR": str(home),
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_OPTIONAL_LOCKS": "0",
           "BUN_RUNTIME_TRANSPILER_CACHE_PATH": "0", "NODE_DISABLE_COMPILE_CACHE": "1"}
    candidate = json.loads((CANDIDATE / "candidate.json").read_text(encoding="utf-8"))
    compiler = json.loads((CANDIDATE / "compiler-inputs.json").read_text(encoding="utf-8"))
    if run(env, scratch, bun, "--version", capture=True) != candidate["verification"]["bun"]:
        raise ValueError(f"Compiler requires Bun {candidate['verification']['bun']}")
    guard = scratch / "no-provider.ts"
    guard.write_bytes(read_pinned(COMPATIBILITY, candidate["verification"]["guard"]))
    (scratch / "COMPILER_ONLY.json").write_text('{"status":"UNREGISTERED_COMPILER_ONLY"}\n', encoding="utf-8")

    replayed, tree = materialize(candidate, donor, scratch, env)
    native = scratch / "vendor/omp"
    native.parent.mkdir()
    replayed.rename(native)
    stage_recipe(candidate, compiler, host, scratch, native, env)
    stage_modules(dependencies, compiler["compilerDependencies"], scratch, native)
    run_guarded(scratch, bun, guard, env, "generate-wire", "scripts/build-compatibility.ts", "--wire-only")
    stage_launcher(scratch)
    run_guarded(scratch, bun, guard, env, "compile-launcher", "compile-launcher.ts")
    receipt = readback(candidate, scratch, native, tree, env)
    (scratch / COMPILER_OUTPUT / "NOT_BUILT.json").rename(scratch / "WIRE_ONLY.json")
    (scratch / "compiler-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": receipt["status"], "sourceTree": tree,
                      "receipt": str(scratch / "compiler-receipt.json")}))


if __name__ == "__main__":
    main()
