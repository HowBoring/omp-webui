/** Fixture loader for an already-verified TypeScript source file. */
export function loadExactSource(path: string, contents: string, onLoad: () => void): void {
  const filter = new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  Bun.plugin({
    name: "fixture-exact-typescript-source",
    setup(build) {
      build.onLoad({ filter }, args => {
        if (args.path !== path) return;
        onLoad();
        return { contents, loader: "ts" };
      });
    },
  });
}
