/** Synthetic child-only literal wire loss/crash after native execution. Loaded before OMP imports. */
import * as fs from "node:fs";
import * as path from "node:path";
const home = process.env.HOME, target = process.env.OMP_STRICT_FAULT_TARGET, fault = process.env.OMP_STRICT_FAULT;
if (!home?.includes("submission-") || !target?.startsWith(home + "/") || !fault?.startsWith("submission-"))
  throw Error("SUBMISSION_SYNTHETIC_FAULT_REQUIRED");
let fired = false;
const output = process.stdout.write;
process.stdout.write = ((...args: unknown[]): boolean => {
  const text = args[0];
  if (!fired && typeof text === "string") {
    let frame: unknown; try { frame = JSON.parse(text); } catch {}
    if (typeof frame === "object" && frame !== null && "command" in frame && "success" in frame && frame.success === true
      && ((fault === "submission-drop-ack" && frame.command === "submission_submit")
        || (fault === "submission-receipt-crash" && frame.command === "submission_query" && "data" in frame
          && typeof frame.data === "object" && frame.data !== null && "terminal" in frame.data && frame.data.terminal === true))) {
      fired = true;
      fs.writeFileSync(path.join(home, "submission-wire-fault.json"), JSON.stringify({ fault, fired: true }));
      if (fault === "submission-receipt-crash") process.exit(92);
      const callback = args.find(value => typeof value === "function");
      if (typeof callback === "function") queueMicrotask(() => callback());
      return true;
    }
  }
  return Reflect.apply(output, process.stdout, args) === true;
}) as typeof process.stdout.write;
