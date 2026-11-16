/** Child-only network boundary, loaded before any OMP/SDK module. No real network dispatch is permitted. */
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import { syncBuiltinESMExports } from "node:module";
import { resolve, sep } from "node:path";

let deniedCount = 0;
const deny = (entry: string): never => {
  deniedCount++;
  // Sanitized evidence only: never write URLs, headers or credential values.
  console.error(`S0_FIXTURE_NETWORK_DENIED:${entry}`);
  throw new Error(`S0_FIXTURE_NETWORK_DENIED:${entry}`);
};
const home = resolve(process.env.HOME ?? "/invalid-s0-home");
function localUnix(args: unknown[]): boolean {
  const first = args[0];
  let path: unknown = typeof first === "object" && first !== null ? Reflect.get(first,"path") : first;
  if (typeof first === "object" && first !== null) path ??= Reflect.get(first,"unix");
  return typeof path === "string" && path.startsWith(home + sep) && resolve(path).startsWith(home + sep);
}
const fetchGuard = (() => deny("fetch")) as unknown as typeof fetch;
fetchGuard.preconnect = (() => deny("fetch.preconnect")) as typeof fetch.preconnect;
globalThis.fetch = fetchGuard;
globalThis.WebSocket = class { constructor() { deny("WebSocket"); } } as unknown as typeof WebSocket;
http.request = (() => deny("http.request")) as typeof http.request;
http.get = (() => deny("http.get")) as typeof http.get;
http.ClientRequest = class { constructor() { deny("http.ClientRequest"); } } as unknown as typeof http.ClientRequest;
https.request = (() => deny("https.request")) as typeof https.request;
https.get = (() => deny("https.get")) as typeof https.get;
http2.connect = (() => deny("http2.connect")) as typeof http2.connect;
tls.connect = (() => deny("tls.connect")) as typeof tls.connect;
dgram.createSocket = (() => deny("dgram.createSocket")) as typeof dgram.createSocket;
dgram.Socket.prototype.send = (() => deny("dgram.Socket.send")) as typeof dgram.Socket.prototype.send;
dgram.Socket.prototype.connect = (() => deny("dgram.Socket.connect")) as typeof dgram.Socket.prototype.connect;
dgram.Socket.prototype.bind = (() => deny("dgram.Socket.bind")) as typeof dgram.Socket.prototype.bind;
const socketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(this: net.Socket,...args: unknown[]) {
  if (!localUnix(args)) deny("net.Socket.connect");
  return Reflect.apply(socketConnect,this,args);
} as typeof net.Socket.prototype.connect;
const netConnect=net.connect;
net.connect = ((...args: unknown[]) => {
  if (!localUnix(args)) deny("net.connect");
  return Reflect.apply(netConnect,net,args);
}) as typeof net.connect;
net.createConnection = net.connect;
const bunConnect=Bun.connect;
Bun.connect = ((...args: unknown[]) => {
  if (!localUnix(args)) deny("Bun.connect");
  return Reflect.apply(bunConnect,Bun,args);
}) as typeof Bun.connect;
syncBuiltinESMExports();
Object.defineProperty(globalThis,Symbol.for("omp.s0.network-guard"),{
  value:Object.freeze({denied:()=>deniedCount}),
});
