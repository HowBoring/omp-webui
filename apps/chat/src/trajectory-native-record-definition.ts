import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatch,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Keep Host-native records visible when a bounded window contains no standard turn events. */
export const trajectoryNativeRecordDefinition: ConversationNodeDefinition<ConversationMatch> = {
  kind: 'trajectory-native-record',
  target: 'trajectory',
  match: event => event.type === 'omp/native-record' ? { id: String(event.seq), role: 'start' } : null,
  start: (_context, match) => match,
  update: context => context.state,
  buildViewNode: (context) => {
    const match = context.state
    if (match === undefined) return null
    return {
      key: context.key,
      kind: context.kind,
      id: context.id,
      target: 'trajectory',
      anchorSeq: match.event.seq,
      location: match.location ?? { kind: 'unresolved' },
      data: { kind: 'node', node: match.event },
    }
  },
}

export function registerTrajectoryNativeRecordDefinition(ctx: Context): void {
  ctx.uiConversation.events.register(trajectoryNativeRecordDefinition)
}
