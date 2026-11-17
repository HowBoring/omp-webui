import "../preferences/no-provider.ts";

const deny = (): never => { throw new Error("ATTACHMENT_FIXTURE_NATIVE_IMPORT_DENIED"); };
Bun.plugin({ name: "attachment-no-native", setup(build) {
  build.onResolve({ filter: /(?:@oh-my-pi|pi-coding-agent|bun:ffi)/ }, deny);
} });
