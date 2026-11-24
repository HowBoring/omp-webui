import { readdir, mkdir, symlink, readFile, lstat, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod";
const root = resolve(process.argv[2] ?? "vendor/dsh");
const packageSchema = z.object({ name: z.string() });
await mkdir("node_modules/@deepseek-ai", { recursive: true });
const paths: string[] = [];
for (const domain of await readdir(join(root, "packages"), { withFileTypes: true })) {
  if (!domain.isDirectory()) continue;
  for (const name of await readdir(join(root, "packages", domain.name))) paths.push(join(root, "packages", domain.name, name));
}
for (const name of await readdir(join(root, "vendor"))) paths.push(join(root, "vendor", name));
for (const path of paths) {
  let name: string;
  try { name = packageSchema.parse(JSON.parse(await readFile(join(path, "package.json"), "utf8"))).name; }
  catch { continue; }
  if (!name.startsWith("@deepseek-ai/")) continue;
  const destination = resolve("node_modules", name);
  try {
    if (!(await lstat(destination)).isSymbolicLink()) throw new Error("Will not replace installed package " + name);
    await rm(destination);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Will not")) throw error;
  }
  await symlink(path, destination);
}
