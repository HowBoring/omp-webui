/** Synthetic profile evidence for the complete no-provider preload. */
import './no-provider.ts';
import fs from 'node:fs';
import { join } from 'node:path';
const profile = process.env.OMP_HISTORY_FIXTURE_PROFILE;
if (!profile || process.env.HOME !== profile || process.env.PI_CODING_AGENT_DIR !== profile) throw new Error('synthetic_profile_required');
const guard = globalThis[Symbol.for('omp.s0.network-guard')];
function audit() { fs.writeFileSync(join(profile,'network-audit.json'), JSON.stringify({
  guard:'history-egress-v1', actualNetworkDispatches:guard.dispatched(), denied:guard.denied(),
})); }
audit(); process.on('exit', audit);
process.on('SIGTERM', () => { audit(); process.exit(0); });
