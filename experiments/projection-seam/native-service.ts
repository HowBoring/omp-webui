import {Remote,TypertRemoteService} from '@deepseek-ai/dsh-typert-protocol';
import type {Context} from '@deepseek-ai/cordis';
import type {InteractionBridge} from '../../packages/interactions/bridge.ts';
import type {UIAnswer} from '../../packages/contracts/interactions.ts';
/** The accepted typed Interaction namespace; no raw native command is exposed. */
export class ProjectionNativeInteractions extends TypertRemoteService{
  constructor(ctx:Context,readonly bridge:InteractionBridge){super(ctx,'ompInteractions');}
  @Remote('snapshot') snapshot(){return this.bridge.snapshot();}
  @Remote('answer') answer(generation:string,interactionId:string,answer:UIAnswer){return this.bridge.answer(generation,interactionId,answer);}
  @Remote('start') start(){throw Error('projection_fixture_start_is_literal_only');}
}
