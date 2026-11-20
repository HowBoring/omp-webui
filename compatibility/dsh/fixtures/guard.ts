/** Pure DSH/React fixture: prohibit network, processes, listeners and Native imports before loading the graph. */
import '../../../tests/preferences/no-provider.ts'
const deny = (): never => { throw new Error('TOOL_ARGUMENT_PRESENTATION_EXTERNAL_RUNTIME_DENIED') }
Bun.plugin({ name: 'tool-argument-presentation-pure-imports', setup(build) {
  build.onResolve({ filter: /(?:@oh-my-pi|pi-coding-agent|bun:ffi|@deepseek-ai\/node-addon-system)/ }, deny)
  build.onLoad({ filter: /\.node$/ }, deny)
} })
