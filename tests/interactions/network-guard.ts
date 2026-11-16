import { expect } from "bun:test";
// --preload must install the deny boundary before these module entrypoints are imported.
import { request as httpRequest, get as httpGet, ClientRequest } from "node:http";
import { request as httpsRequest, get as httpsGet } from "node:https";
import { connect as netConnect, createConnection, Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { connect as h2Connect } from "node:http2";
import { createSocket } from "node:dgram";

const cases: Array<() => unknown> = [
  ()=>fetch("https://provider.invalid"),()=>fetch.preconnect("https://provider.invalid"),
  ()=>httpRequest("http://provider.invalid"),()=>httpGet("http://provider.invalid"),
  ()=>new ClientRequest("http://provider.invalid"),()=>httpsRequest("https://provider.invalid"),
  ()=>httpsGet("https://provider.invalid"),()=>netConnect(443,"provider.invalid"),
  ()=>createConnection(443,"provider.invalid"),()=>new Socket().connect(443,"provider.invalid"),
  ()=>tlsConnect(443,"provider.invalid"),()=>h2Connect("https://provider.invalid"),
  ()=>createSocket("udp4").send("fixture",9,"provider.invalid"),()=>Bun.connect({hostname:"provider.invalid",port:443,socket:{}}),
  ()=>new WebSocket("wss://provider.invalid"),
];
for(const invoke of cases) expect(invoke).toThrow("S0_FIXTURE_NETWORK_DENIED");
const guard=Reflect.get(globalThis,Symbol.for("omp.s0.network-guard")) as {denied():number};
expect(guard.denied()).toBe(cases.length);
console.log(`network-guard: ${cases.length} denied before dispatch`);
