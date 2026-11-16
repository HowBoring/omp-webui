/** Host admission results are typed DSH results, separate from native respond_ui acknowledgements. */
import { expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { interactionsContribution, interactionReplySchema } from "../../packages/contracts/interactions.ts";

test("public DSH interaction Remote decodes Host overload without accepting it as a native acknowledgement",async()=>{
  const overloaded={status:"overloaded",code:"INTERACTION_ANSWER_LIMIT"} as const;
  expect(interactionReplySchema.safeParse(overloaded).success).toBe(false);
  const ctx=new Context();
  installConnection(ctx,{interactions:"none",transport:{
    fetch:async(url,init)=>{
      expect(url).toBe("api/ompInteractions/answer");
      const call:unknown=JSON.parse(String(init.body));
      const envelope=interactionsContribution.methods["ompInteractions/answer"];
      expect(envelope).toBeDefined();
      if(typeof call !== "object" || call === null || !("rpcId" in call))throw new Error("missing correlation");
      return Response.json({type:"server-response",rpcId:call.rpcId,result:{ok:true,value:overloaded}});
    },openStream:async function*(){},
  }});
  registry(ctx);gateway(ctx);
  await ctx.remote.$mount(interactionsContribution);
  try {
    expect(await ctx.remote.ompInteractions.answer("generation","interaction",{type:"value",value:"explicit"}))
      .toEqual({ok:true,value:overloaded});
  }finally{await ctx.fiber.dispose();}
});
