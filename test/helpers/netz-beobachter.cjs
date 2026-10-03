"use strict";
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const dns = require("node:dns");
const dgram = require("node:dgram");
const util = require("node:util");
const childProcess = require("node:child_process");
const { syncBuiltinESMExports } = require("node:module");

const PROTOKOLL = process.env.NETZ_BEOBACHTER_LOG || "";
const WEITERGABE = ["NODE_OPTIONS", "NETZ_BEOBACHTER_LOG"];
const KIND_FUNKTIONEN = [
  "spawn",
  "spawnSync",
  "execFile",
  "execFileSync",
  "exec",
  "execSync",
  "fork",
];
const LESE_FUNKTIONEN = ["readFileSync", "readFile", "open"];
const LOOPBACK_V4 = "127.";
const LOKALE_ADRESSEN = new Set(["::1", "::", "0.0.0.0", "::ffff:127.0.0.1"]);
const KIND_ZIEL_LAENGE = 200;

const eigeneAdressen = new Set(
  Object.values(os.networkInterfaces())
    .flat()
    .map((schnittstelle) => schnittstelle.address),
);

function schreibe(eintrag) {
  if (!PROTOKOLL) return;
  fs.appendFileSync(PROTOKOLL, `${JSON.stringify({ pid: process.pid, ...eintrag })}\n`);
}

function istLokal(ziel) {
  if (!ziel) return true;
  const host = String(ziel)
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (net.isIPv4(host) && host.startsWith(LOOPBACK_V4)) return true;
  return LOKALE_ADRESSEN.has(host) || eigeneAdressen.has(host);
}

function gesperrt(art, ziel) {
  const fehler = new Error(`netz-beobachter: ${art} nach ${ziel} gesperrt`);
  fehler.code = "ECONNREFUSED";
  return fehler;
}

function melde(art, ziel, mehr = {}) {
  const extern = !istLokal(ziel);
  schreibe({ art, ziel, extern, ...mehr });
  return extern;
}

function objektZiel(optionen) {
  if (optionen.path) return { ziel: "localhost", port: optionen.path };
  return { ziel: optionen.host || "localhost", port: optionen.port };
}

function verbindungsZiel(args) {
  const erstes = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (erstes && typeof erstes === "object") return objektZiel(erstes);
  if (typeof erstes === "string" && Number.isNaN(Number(erstes)))
    return { ziel: "localhost", port: erstes };
  return { ziel: typeof args[1] === "string" ? args[1] : "localhost", port: erstes };
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function beobachteteVerbindung(...args) {
  const { ziel, port } = verbindungsZiel(args);
  if (!melde("verbindung", ziel, { port })) return originalConnect.apply(this, args);
  process.nextTick(() => this.destroy(gesperrt("verbindung", ziel)));
  return this;
};

const originalSend = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function beobachteteSendung(...args) {
  const ziel = args.slice(1).find((arg) => typeof arg === "string") || "localhost";
  if (!melde("udp", ziel)) return originalSend.apply(this, args);
  const rueckruf = args.find((arg) => typeof arg === "function");
  if (rueckruf) process.nextTick(() => rueckruf(gesperrt("udp", ziel)));
  return undefined;
};

function istAufloesung(name, wert) {
  return typeof wert === "function" && (name === "lookup" || name.startsWith("resolve"));
}

function beobachteAufloesung(name, original, mitVersprechen) {
  return function beobachteteAufloesung(...args) {
    if (!melde("namensaufloesung", args[0], { funktion: name })) return original.apply(this, args);
    const fehler = gesperrt("namensaufloesung", args[0]);
    if (mitVersprechen) return Promise.reject(fehler);
    process.nextTick(() => args.at(-1)(fehler));
    return undefined;
  };
}

const AUFLOESER = [
  [dns, false],
  [dns.Resolver.prototype, false],
  [dns.promises, true],
  [dns.promises.Resolver.prototype, true],
];
for (const [objekt, mitVersprechen] of AUFLOESER) {
  for (const name of Object.getOwnPropertyNames(objekt).filter((eigenschaft) =>
    istAufloesung(eigenschaft, objekt[eigenschaft]),
  )) {
    objekt[name] = beobachteAufloesung(name, objekt[name], mitVersprechen);
  }
}

function abrufZiel(eingabe) {
  const ziel = String(eingabe?.url ?? eingabe?.href ?? eingabe);
  return { ziel, host: URL.canParse(ziel) ? new URL(ziel).hostname : "" };
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async function beobachteterAbruf(eingabe, optionen) {
  const { ziel, host } = abrufZiel(eingabe);
  const extern = !istLokal(host);
  schreibe({ art: "abruf", ziel, extern });
  if (extern) throw new TypeError("fetch failed", { cause: gesperrt("abruf", ziel) });
  return originalFetch(eingabe, optionen);
};

function istEnvDatei(datei) {
  return typeof datei !== "number" && path.basename(String(datei)) === ".env";
}

function beobachteLesen(original) {
  return function beobachtetesLesen(datei, ...rest) {
    if (istEnvDatei(datei))
      schreibe({ art: "env-datei", ziel: path.resolve(String(datei)), extern: false });
    return original.call(this, datei, ...rest);
  };
}

for (const objekt of [fs, fs.promises]) {
  for (const name of LESE_FUNKTIONEN.filter(
    (eigenschaft) => typeof objekt[eigenschaft] === "function",
  )) {
    objekt[name] = beobachteLesen(objekt[name]);
  }
}

function fehlendeWerte(umgebung) {
  const fehlend = WEITERGABE.filter(
    (name) => umgebung[name] === undefined && process.env[name] !== undefined,
  );
  return Object.fromEntries(fehlend.map((name) => [name, process.env[name]]));
}

function ergaenzeUmgebung(args) {
  const index = args.findLastIndex((arg) => arg && typeof arg === "object" && !Array.isArray(arg));
  if (index < 0 || !args[index].env) return args;
  const neu = [...args];
  neu[index] = { ...args[index], env: { ...args[index].env, ...fehlendeWerte(args[index].env) } };
  return neu;
}

for (const name of KIND_FUNKTIONEN) {
  const original = childProcess[name];
  const umhuellt = function beobachteterKindprozess(...args) {
    schreibe({
      art: "kindprozess",
      ziel: String(args[0]).slice(0, KIND_ZIEL_LAENGE),
      extern: false,
    });
    return original.apply(this, ergaenzeUmgebung(args));
  };
  const versprochen = original[util.promisify.custom];
  if (versprochen)
    umhuellt[util.promisify.custom] = (...args) => versprochen(...ergaenzeUmgebung(args));
  childProcess[name] = umhuellt;
}

syncBuiltinESMExports();
schreibe({ art: "start", ppid: process.ppid, skript: process.argv[1] || "", extern: false });
