import {startLiveFixture} from './server.ts';
const fixture=await startLiveFixture();console.log(`Isolated controlled-provider live acceptance: ${fixture.server.url}`);
process.on('SIGTERM',()=>{void fixture.stop().then(()=>process.exit(0));});
process.on('SIGINT',()=>{void fixture.stop().then(()=>process.exit(0));});
