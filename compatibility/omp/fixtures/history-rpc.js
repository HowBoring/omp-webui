/** Real native RPC fixture. Parent chooses an empty synthetic profile before imports. No models/tools. */
import './history-network-guard.js';
import { resolve } from 'node:path';
if (!process.env.OMP_HISTORY_FIXTURE_PROFILE || process.env.HOME !== process.env.OMP_HISTORY_FIXTURE_PROFILE
  || process.env.PI_CODING_AGENT_DIR !== process.env.OMP_HISTORY_FIXTURE_PROFILE) throw new Error('synthetic_profile_required');
process.chdir(process.env.OMP_HISTORY_FIXTURE_PROFILE);
const source = resolve(import.meta.dir, '../../../vendor/omp/packages/coding-agent/src');
const { Agent } = await import('@oh-my-pi/pi-agent-core');
const { getBundledModel } = await import('@oh-my-pi/pi-catalog/models');
const { ModelRegistry } = await import(source + '/config/model-registry.ts');
const { Settings } = await import(source + '/config/settings.ts');
const { AgentSession } = await import(source + '/session/agent-session.ts');
const { AuthStorage } = await import(source + '/session/auth-storage.ts');
const { SessionManager } = await import(source + '/session/session-manager.ts');
const { runRpcMode } = await import(source + '/modes/rpc/rpc-mode.ts');
const profile = process.env.OMP_HISTORY_FIXTURE_PROFILE;
const authStorage = await AuthStorage.create(resolve(profile, 'auth.db'));
const resumeFile = process.env.OMP_HISTORY_FIXTURE_RESUME;
if (resumeFile && !resolve(resumeFile).startsWith(profile + '/')) throw new Error('synthetic_reference_required');
const manager = resumeFile ? await SessionManager.open(resumeFile, resolve(profile, 'sessions'), undefined,
  {initialCwd:profile,throwIfMissing:true,suppressBreadcrumb:true}) : SessionManager.create(profile, resolve(profile, 'sessions'));
if (!resumeFile) {
const root = manager.appendMessage({role:'user',content:'Before native compaction',timestamp:1});
for (let index=0;index<140;index++) manager.appendMessage({role:'user',content:`Retained older record ${index}`,timestamp:10+index});
const abandoned = manager.appendMessage({role:'user',content:'Abandoned branch',timestamp:2});
manager.branch(manager.getEntry(abandoned).parentId);
manager.appendCompaction('Native summary', undefined, root, 100);
manager.appendResetBoundary();
manager.appendCustomEntry('synthetic-private-state', {credential:'SYNTHETIC_PRIVATE_TOKEN'});
manager.appendCustomMessageEntry('visible', 'Visible native notice', true, {secret:'SYNTHETIC_PRIVATE_TOKEN'});
manager.appendMessage({role:'user',content:[{type:'text',text:'Retained native image'},
  {type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='}],timestamp:150});
for (let index=0;index<140;index++) manager.appendMessage({role:'user',content:`Synthetic current record ${index}`,timestamp:200+index});
manager.appendMessage({role:'user',content:'After native reset',timestamp:3});
manager.appendMessageToBranch({role:'user',content:'Background branch',timestamp:4}, abandoned);
await manager.ensureOnDisk();
await manager.flush();
}
const agent = new Agent({getApiKey:()=>{throw new Error('model_access_forbidden')},
  initialState:{model:getBundledModel('openai','gpt-4.1'), systemPrompt:['Isolated fixture'], tools:[]},
  streamFn:()=>{throw new Error('model_execution_forbidden')}});
agent.replaceMessages(manager.buildSessionContext().messages);
const session = new AgentSession({agent,sessionManager:manager,
  settings:Settings.isolated({'compaction.enabled':false, 'goal.continuationModes':[]}),
  modelRegistry:new ModelRegistry(authStorage,resolve(profile,'models.yml'))});
await runRpcMode(session);
