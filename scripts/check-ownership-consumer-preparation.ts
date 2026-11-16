import * as fs from "node:fs/promises";
import * as path from "node:path";

interface FileIdentity { path: string; sha256: string }
interface ConsumerPreparation {
  basePreparedTree: string;
  preparedTree: string;
  delta: { file: string; sha256: string };
  files: FileIdentity[];
}

/** Source identities, exact patch application and TypeScript syntax only; never imports a Native module. */
const argument = process.argv[2];
if (!argument || process.argv.length !== 3) {
  throw new Error("USAGE: check-ownership-consumer-preparation.ts <owned-native-source>");
}
const source = await fs.realpath(path.resolve(argument));
const directory = path.resolve(import.meta.dir, "../compatibility/omp");
const manifest = await Bun.file(path.join(directory, "execution-ownership-consumers.preparation.json"))
  .json() as ConsumerPreparation;
const patch = path.join(directory, manifest.delta.file);
const digest = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (digest(await fs.readFile(patch)) !== manifest.delta.sha256) throw new Error("CONSUMER_DELTA_IDENTITY");
const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });
let compiledFiles = 0;
for (const file of manifest.files) {
  const bytes = await fs.readFile(path.join(source, file.path));
  if (digest(bytes) !== file.sha256) throw new Error(`CONSUMER_SOURCE_IDENTITY:${file.path}`);
  if (file.path.endsWith(".ts")) { transpiler.transformSync(bytes); compiledFiles++; }
}
const temporary = await fs.mkdtemp("/tmp/consumer-source-index-");
try {
  const env = { PATH: "/usr/bin:/bin", HOME: temporary, TMPDIR: "/tmp",
    GIT_INDEX_FILE: path.join(temporary, "index"), GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args: string[]): string => {
    const result = Bun.spawnSync(["git", "-C", source, ...args], {
      env, stdout: "pipe", stderr: "pipe", timeout: 10_000,
    });
    if (result.exitCode !== 0) throw new Error(`CONSUMER_SOURCE_GIT:${result.stderr.toString()}`);
    return result.stdout.toString().trim();
  };
  git("read-tree", manifest.basePreparedTree);
  git("apply", "--cached", "--check", patch);
  git("apply", "--cached", patch);
  if (git("write-tree") !== manifest.preparedTree) throw new Error("CONSUMER_PREPARED_TREE");
  process.stdout.write(JSON.stringify({ scope: "consumer-source-only", files: manifest.files.length, compiledFiles,
    patchApplication: "PASS_EXACT_TREE", nativeModulesImported: false, nativeRuntime: "NOT RUN",
    actualGlobal: "BLOCKED", capabilityGranted: false }) + "\n");
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
