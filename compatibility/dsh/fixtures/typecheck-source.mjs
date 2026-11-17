import ts from 'typescript'
import path from 'node:path'
import fs from 'node:fs'
const shared = process.env.DSH_BASE_SOURCE
if (!shared) throw new Error('DSH_BASE_SOURCE_REQUIRED: exact read-only patches 1–5 source')
const owned = path.resolve('vendor/dsh')
const parsed = ts.readConfigFile(path.join(shared, 'tsconfig.base.client.json'), ts.sys.readFile)
const config = ts.parseJsonConfigFileContent(parsed.config, ts.sys, shared)
const options = { ...config.options, noEmit: true, composite: false, incremental: false,
  types: ['node', 'client-build-environment', 'client-assets'] }
// Public ./src/* exports use explicit source locations for this source-only Bun fixture.
options.paths = { ...options.paths,
  '@deepseek-ai/dsh-client-ui-conversation/src/client/conversation/assembler':
    [path.join(shared, 'packages/client/ui-conversation/src/client/conversation/assembler.ts')],
  '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/chat-snapshot-builder':
    [path.join(shared, 'packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts')],
}
const host = ts.createCompilerHost(options)
const read = host.readFile
host.readFile = file => {
  const replacement = file.startsWith(shared + '/') ? owned + file.slice(shared.length) : file
  return read(process.env.TOOL46_BASELINE !== '1' && fs.existsSync(replacement) ? replacement : file)
}
const roots = [...process.argv.slice(2).map(p => path.isAbsolute(p) ? p : path.join(shared,p)), path.join(shared, 'packages/client/ui-chat/src/css-modules.d.ts')]
const program = ts.createProgram(roots, options, host)
const diagnostics = ts.getPreEmitDiagnostics(program)
process.stdout.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: p => p, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
}))
process.stdout.write(`SOURCE_OVERLAY_DIAGNOSTICS=${diagnostics.length}\n`)
process.exitCode = diagnostics.length === 0 ? 0 : 1
