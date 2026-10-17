import assert from "node:assert/strict";
import { test } from "node:test";

import * as anfrageMitFristModul from "../gemeinsam/anfrage-mit-frist.mjs";
import * as antwortfristModul from "../gemeinsam/antwortfrist.mjs";
import { REPO_ROOT } from "./probe-repo.js";
import { befundTexte, befundZeilen } from "./testregeln-probe.js";

const REGEL = "hermes-tests/anfrage-mit-frist";
const DATEI = "test/anrufe/probe.test.js";
const ABRUF = "await fetch(`${srv.localUrl}/api/calls`);";
const HILFSMODULE = new Map([
  ["test/gemeinsam/antwortfrist.mjs", antwortfristModul],
  ["test/gemeinsam/anfrage-mit-frist.mjs", anfrageMitFristModul],
]);
const HILFSNAME_ODER_DATEI = /\b[a-z]+(?:[A-Z][a-z]+)+\b|test\/[\w/.-]+\.mjs/g;

function befunde(zeilen) {
  return befundZeilen({ verzeichnis: REPO_ROOT, datei: DATEI, regel: REGEL }, zeilen);
}

function nurBefunde(kopf, aufrufe) {
  return befunde([...kopf, ...aufrufe]);
}

function exportiert(modul, name) {
  return name in modul || modul.default?.name === name;
}

function genannteHilfen(meldung) {
  const hilfen = [];
  let namen = [];
  for (const [treffer] of meldung.matchAll(HILFSNAME_ODER_DATEI)) {
    if (treffer.startsWith("test/")) {
      hilfen.push({ datei: treffer, namen });
      namen = [];
    } else {
      namen.push(treffer);
    }
  }
  return { hilfen, ohneDatei: namen };
}

test("anfrage-mit-frist: ein nackter fetch an den Testserver wird gemeldet", () => {
  const aufrufe = [
    ABRUF,
    "await fetch(`${srv.localUrl}/api/calls`, { method: 'POST', body: '{}' });",
    "await fetch(url, optionen);",
    "await fetch(url, { signal: abbruch.signal });",
    "await fetch(url, { signal });",
    "await fetch(url, { signal: irgendwas() });",
    "await fetch(url, { signal: AbortSignal.abort() });",
    "await fetch(url, { signal: AbortSignal.timeout });",
    "await fetch(url, { ...optionen });",
    "await globalThis.fetch(`${srv.localUrl}/healthz`);",
    "await global.fetch(`${srv.localUrl}/healthz`);",
    'await globalThis["fetch"](`${srv.localUrl}/healthz`);',
  ];
  assert.deepEqual(befunde(aufrufe), aufrufe);
});

test("anfrage-mit-frist: fetch mit AbortSignal.timeout, AbortSignal.any oder fristSignal bleibt frei", () => {
  const aufrufe = [
    "await fetch(url, { signal: AbortSignal.timeout(5000) });",
    "await fetch(url, { method: 'POST', signal: AbortSignal.any([abbruch.signal, AbortSignal.timeout(5000)]) });",
    "await fetch(url, { ...optionen, signal: fristSignal() });",
    "await fetch(url, { signal: fristSignal({ wartezeitMs: 200 }) });",
    "await fetch(url, { 'signal': fristSignal() });",
    "await globalThis.fetch(url, { signal: AbortSignal.timeout(5000) });",
  ];
  assert.deepEqual(befunde(aufrufe), []);
});

test("anfrage-mit-frist: abrufMitFrist und anfrageMitFrist sind frei", () => {
  const kopf = [
    'import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";',
    'import anfrageMitFrist from "../gemeinsam/anfrage-mit-frist.mjs";',
  ];
  const aufrufe = [
    ABRUF.replace("fetch", "abrufMitFrist"),
    "await abrufMitFrist(url, { method: 'POST' }, { wartezeitMs: 300 });",
    "anfrageMitFrist({ port, path: '/x' }, (res) => res.resume()).end();",
  ];
  assert.deepEqual(nurBefunde(kopf, aufrufe), []);
});

test("anfrage-mit-frist: ein lokal gebundenes fetch ist eine Attrappe und bleibt frei", () => {
  const faelle = [
    ["const fetch = async () => ({ ok: true });", ABRUF],
    ["function lauf(fetch) {", "  return fetch(url);", "}"],
    ['import { fetch } from "./attrappe.js";', ABRUF],
    ["const { fetch } = harness;", ABRUF],
    ["test('x', async () => {", "  const fetch = () => null;", `  ${ABRUF}`, "});"],
  ];
  for (const zeilen of faelle) assert.deepEqual(befunde(zeilen), [], zeilen.join("\n"));
});

test("anfrage-mit-frist: ein fetch außerhalb der Attrappe wird trotz einer fremden Bindung gemeldet", () => {
  const zeilen = [
    "function attrappe() {",
    "  const fetch = () => null;",
    "  return fetch;",
    "}",
    ABRUF,
  ];
  assert.deepEqual(befunde(zeilen), [ABRUF]);
});

test("anfrage-mit-frist: http.request und http.get ohne Hülle werden gemeldet", () => {
  const kopf = ['import http from "node:http";', 'import https from "https";'];
  const aufrufe = [
    "http.request({ port, path: '/x' }, (res) => res.resume()).end();",
    "http.get(`${srv.localUrl}/x`, (res) => res.resume());",
    "https.get(url, (res) => res.resume());",
    "https.request(url, { method: 'POST' }, callback);",
  ];
  assert.deepEqual(nurBefunde(kopf, aufrufe), aufrufe);
});

test("anfrage-mit-frist: Namensraum-, benannte und umbenannte Importe von http und https werden gemeldet", () => {
  const faelle = [
    ['import * as http from "node:http";', "http.get(url, callback);"],
    ['import { request } from "node:http";', "request(optionen, callback);"],
    ['import { get } from "http";', "get(url, callback);"],
    ['import { request as anfrage } from "node:https";', "anfrage(optionen, callback);"],
    ['import { get as hole, Agent } from "https";', "hole(url, callback);"],
  ];
  for (const [import_, aufruf] of faelle) assert.deepEqual(befunde([import_, aufruf]), [aufruf]);
});

test("anfrage-mit-frist: require und dynamischer Import von http werden gemeldet", () => {
  const faelle = [
    ['const http = require("http");', "http.get(url, callback);"],
    ['const { request } = require("node:http");', "request(optionen, callback);"],
    ['const https = await import("node:https");', "https.get(url, callback);"],
    ['const { get } = await import("node:http");', "get(url, callback);"],
    ["", 'require("node:http").get(url, callback);'],
  ];
  for (const [import_, aufruf] of faelle) assert.deepEqual(befunde([import_, aufruf]), [aufruf]);
});

test("anfrage-mit-frist: mitAntwortfrist als Hülle um den http-Aufruf ist frei", () => {
  const kopf = [
    'import http from "node:http";',
    'import { request } from "node:https";',
    'import { mitAntwortfrist } from "../gemeinsam/antwortfrist.mjs";',
  ];
  const aufrufe = [
    "mitAntwortfrist(http.get(`${srv.localUrl}/x`, (res) => res.resume()));",
    "mitAntwortfrist(http.request({ port }, callback), { wartezeitMs: 200 }).end();",
    "const anfrage = mitAntwortfrist(request(optionen, callback));",
  ];
  assert.deepEqual(nurBefunde(kopf, aufrufe), []);
});

test("anfrage-mit-frist: ein http-Aufruf, der nicht das erste Argument der Hülle ist, wird gemeldet", () => {
  const kopf = ['import http from "node:http";', 'import { mitAntwortfrist } from "./hilfe.mjs";'];
  const aufrufe = [
    "mitAntwortfrist(anfrage, http.get(url, callback));",
    "ergebnis(http.get(url, callback));",
    "const roh = http.get(url, callback);",
  ];
  assert.deepEqual(nurBefunde(kopf, aufrufe), aufrufe);
});

test("anfrage-mit-frist: andere Aufrufe namens request oder get bleiben frei", () => {
  const kopf = [
    'import express from "express";',
    'import http from "node:http";',
    'import { request } from "./eigene-hilfe.js";',
    "const app = express();",
    "const client = { request() {}, get() {} };",
  ];
  const aufrufe = [
    "app.get('/x', (req, res) => res.end());",
    "client.request(url);",
    "client.get(url);",
    "client.fetch(url);",
    "srv.fetch(url);",
    "globalThis.structuredClone(wert);",
    "global.queueMicrotask(weiter);",
    "request(url);",
    "const server = http.createServer(app);",
    "const agent = new http.Agent({ keepAlive: false });",
    "map.get(schluessel);",
  ];
  assert.deepEqual(nurBefunde(kopf, aufrufe), []);
});

test("anfrage-mit-frist: die Meldung nennt nur Hilfen, die ihre genannte Datei auch exportiert", () => {
  const [meldung] = befundTexte({ verzeichnis: REPO_ROOT, datei: DATEI, regel: REGEL }, [ABRUF]);
  const { hilfen, ohneDatei } = genannteHilfen(meldung);
  assert.deepEqual(ohneDatei, [], meldung);
  assert.ok(hilfen.length > 0, meldung);
  for (const { datei, namen } of hilfen) {
    const modul = HILFSMODULE.get(datei);
    assert.ok(modul, `${datei} ist keine bekannte Hilfsdatei: ${meldung}`);
    assert.ok(namen.length > 0, `${datei} ohne Namen: ${meldung}`);
    for (const name of namen) assert.ok(exportiert(modul, name), `${name} fehlt in ${datei}`);
  }
});
