import { startInteractionsFixtureServer } from "./interactions-fixture-server.ts";
const wait=process.env.S0_INTERACTION_WAIT_MS === undefined ? undefined : Number(process.env.S0_INTERACTION_WAIT_MS);
const fixture=await startInteractionsFixtureServer({port:Number(process.env.S0_INTERACTION_PORT ?? 3183),
  ...(wait === undefined ? {} : {waitMs:wait})});
console.info(`S0 isolated interactions at ${fixture.server.url.origin}; product Session admission blocked`);
let stopping=false;
const stop=()=>{if(!stopping){stopping=true;void fixture.stop().then(outcome=>{console.info(JSON.stringify(outcome));process.exit(0);});}};
process.on("SIGINT",stop);process.on("SIGTERM",stop);
