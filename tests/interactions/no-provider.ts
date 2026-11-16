/** Native fixture boundary: installed before OMP imports; provider HTTP is forbidden. */
globalThis.fetch = (() => {
  process.stderr.write("S0_FIXTURE_FORBIDDEN_PROVIDER_HTTP\n");
  return Promise.reject(new Error("S0 fixture forbids provider/model HTTP"));
}) as unknown as typeof fetch;
