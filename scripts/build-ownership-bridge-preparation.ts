import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

/** Compile only an owned source-preparation bridge. Never dlopen/probe it or select a global installation. */
const sourceRoot = process.argv[2], outputParent = process.argv[3];
if (!sourceRoot || !outputParent || process.argv.length !== 4) {
  throw new Error("USAGE: build-ownership-bridge-preparation.ts <owned-native-source> <owned-output-parent>");
}
const source = resolve(sourceRoot, "packages/coding-agent/src/launch/ownership/linux-bridge.c");
if (!isAbsolute(outputParent) || resolve(outputParent) !== outputParent) throw new Error("OWNERSHIP_BUILD_OUTPUT_CANONICAL");
await mkdir(outputParent, { recursive: true, mode: 0o700 });
if (await realpath(outputParent) !== outputParent) throw new Error("OWNERSHIP_BUILD_OUTPUT_SYMLINK");
const directory = await mkdtemp(join(outputParent, "ownership-bridge-"));
const file = join(directory, "libomp-execution-ownership.so");
const environment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", SOURCE_DATE_EPOCH: "0" };
function execute(argv: string[]): string {
  const result = Bun.spawnSync(argv, { env: environment, cwd: directory, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
  if (result.exitCode !== 0) throw new Error(`OWNERSHIP_COMPILE_FAILED: ${result.stderr.toString().slice(0, 8192)}`);
  return result.stdout.toString();
}
const sha = async (path: string): Promise<string> => new Bun.CryptoHasher("sha256").update(await readFile(path)).digest("hex");
const compiler = await realpath("/usr/bin/gcc");
const compilerSha256 = await sha(compiler), sourceSha256 = await sha(source);
const args = ["-std=c11", "-Wall", "-Wextra", "-Werror", "-Wpedantic", "-Wconversion", "-Wshadow", "-Wformat=2",
  "-O2", "-fPIC", "-fstack-protector-strong", "-D_FORTIFY_SOURCE=2", "-shared", "-Wl,-z,relro,-z,now",
  "-Wl,--no-undefined", `-ffile-prefix-map=${resolve(sourceRoot)}=.`, "-o", file, source];
const version = execute([compiler, "--version"]).split("\n")[0];
const target = execute([compiler, "-dumpmachine"]).trim();
execute([compiler, ...args]);
if (await sha(compiler) !== compilerSha256 || await sha(source) !== sourceSha256) throw new Error("OWNERSHIP_BUILD_INPUT_CHANGED");
const stat = await lstat(file);
if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1_048_576) throw new Error("OWNERSHIP_BUILD_ARTIFACT_INVALID");
const dynamic = execute(["/usr/bin/readelf", "-d", file]);
const needed = [...dynamic.matchAll(/\(NEEDED\).*?\[([^\]]+)\]/g)].map(match => match[1]);
const manifest = { format: "omp-execution-ownership-bridge-preparation-v1", status: "unaccepted-compile-only",
  abi: 1, sourceSha256, compiler: { file: compiler, sha256: compilerSha256, version, target }, args,
  artifact: { file, sha256: await sha(file), bytes: stat.size, needed },
  libraryLoaded: false, kernelProbe: "NOT RUN", nativeRuntime: "NOT RUN", actualGlobal: "BLOCKED", capabilityGranted: false };
await writeFile(join(directory, "build.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
process.stdout.write(JSON.stringify({ build: join(directory, "build.json"), artifactSha256: manifest.artifact.sha256,
  bytes: stat.size, libraryLoaded: false, kernelProbe: "NOT RUN" }) + "\n");
