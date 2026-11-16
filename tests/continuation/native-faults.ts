/** Child-only native OS/wire boundary faults on an explicitly synthetic profile, installed before OMP imports. */
const home = process.env.HOME, target = process.env.OMP_STRICT_FAULT_TARGET, fault = process.env.OMP_STRICT_FAULT;
if (!home || !target?.startsWith(home + "/") || !fault) throw new Error("STRICT_SYNTHETIC_FAULT_REQUIRED");
let fired = false;
const output = process.stdout.write;
process.stdout.write = ((...args: unknown[]): boolean => {
  const line = args[0];
  if (!fired && typeof line === "string" && ["drop-start-result", "crash-before-start-result"].includes(fault)) {
    let value: unknown; try { value = JSON.parse(line); } catch {}
    if (typeof value === "object" && value !== null && "command" in value && value.command === "strict_start"
      && "success" in value && value.success === true) {
      fired = true;
      Bun.write(home + "/strict-wire-fault.json", JSON.stringify({ fault, nativeResult: "strict_start_success_dropped" }));
      if (fault === "crash-before-start-result") process.exit(92);
      const callback = args.find(value => typeof value === "function");
      if (typeof callback === "function") queueMicrotask(() => callback());
      return true;
    }
  }
  return Reflect.apply(output, process.stdout, args) === true;
}) as typeof process.stdout.write;
