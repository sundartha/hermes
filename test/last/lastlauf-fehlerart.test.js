import assert from "node:assert/strict";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import * as ergebnis from "../../scripts/last/ergebnis.js";
import { laufeMitDateien } from "../../scripts/last/lauf.mjs";

const K6_ATTRAPPE = fileURLToPath(new URL("./k6-attrappe-fehler.mjs", import.meta.url));
const KONFIG = {
  ziele: ["http://z"],
  tokens: ["t"],
  webhooks: { gueltig: [{ kopf: {}, koerper: "gueltig" }], ungueltig: [{ kopf: {}, koerper: "ungueltig" }] },
  appSub: "s",
  appEmail: "e",
};
const ZEILE = "ablauf_fehler | ";
const HTTP_FEHLER = "HTTP 500";

globalThis.__k6 = { antwort: null, zaehler: [], exec: { scenario: { name: "", iterationInTest: 0 }, vu: { idInTest: 1, iterationInScenario: 0 } } };
globalThis.__ENV = { LAST_KONFIG: "k", LAST_ERGEBNIS: "e" };
globalThis.open = () => JSON.stringify(KONFIG);
register("./k6-module-attrappe.mjs", import.meta.url);
const ablaeufe = await import("../../scripts/last/ablaeufe.js");

const antwort = (status, body = "") => ({ status, body, timings: { duration: 1 }, cookies: {} });
const rpc = (ergebnis) => antwort(200, JSON.stringify({ jsonrpc: "2.0", id: 1, result: ergebnis }));

const k6 = globalThis.__k6;

function laufe(t, { szenario, antworten, aufruf }) {
  const zeilen = [];
  t.mock.method(console, "error", (zeile) => zeilen.push(zeile));
  k6.exec.scenario.name = szenario;
  k6.zaehler = [];
  k6.antwort = antworten;
  aufruf();
  const gezaehlt = k6.zaehler.filter(([name, wert]) => name === "ablauf_fehler" && wert === 1).length;
  return { zeilen, gezaehlt };
}

const place = (antworten, t) => laufe(t, { szenario: "anruf", antworten, aufruf: () => ablaeufe.anruf() });

test("Fehlerart: HTTP-Fehler bei place_call schreibt eine Zeile mit Szenario, Route und Status", (t) => {
  const { zeilen, gezaehlt } = place(() => antwort(500), t);
  assert.deepEqual(zeilen, [`${ZEILE}anruf | route_place_call | ${HTTP_FEHLER}`]);
  assert.equal(gezaehlt, 1);
});

test("Fehlerart: isError nimmt den Text aus content[0].text, schwaerzt die Nummer und kuerzt auf 120 Zeichen", (t) => {
  const text = `Fehler +4915112345678 ${"x".repeat(200)}`;
  const { zeilen } = place(() => rpc({ isError: true, content: [{ type: "text", text }] }), t);
  assert.deepEqual(zeilen, [`${ZEILE}anruf | route_place_call | ${`Fehler <nummer> ${"x".repeat(200)}`.slice(0, 120)}`]);
});

test("Fehlerart: Antwort ohne Ergebnis wird als ohne Ergebnis gemeldet", (t) => {
  const { zeilen, gezaehlt } = place(() => antwort(200, JSON.stringify({ jsonrpc: "2.0", id: 1 })), t);
  assert.deepEqual(zeilen, [`${ZEILE}anruf | route_place_call | ohne Ergebnis`]);
  assert.equal(gezaehlt, 1);
});

test("Fehlerart: isError ohne Text wird als isError ohne Text gemeldet", (t) => {
  const { zeilen } = place(() => rpc({ isError: true }), t);
  assert.deepEqual(zeilen, [`${ZEILE}anruf | route_place_call | isError ohne Text`]);
});

test("Fehlerart: erfolgreicher place_call schreibt keine Zeile und zaehlt nichts", (t) => {
  let aufrufe = 0;
  const { zeilen, gezaehlt } = place(() => {
    aufrufe += 1;
    return rpc({ structuredContent: { call_id: "c", status: "completed" } });
  }, t);
  assert.deepEqual(zeilen, []);
  assert.equal(gezaehlt, 0);
  assert.equal(aufrufe, 3);
});

test("Fehlerart: mcpAnmeldung meldet beide Fehlerzweige mit den Statuscodes", (t) => {
  const stati = [200, 500];
  const { zeilen, gezaehlt } = laufe(t, { szenario: "mcp_anmeldung", antworten: () => antwort(stati.shift()), aufruf: () => ablaeufe.mcpAnmeldung() });
  assert.deepEqual(zeilen, [
    `${ZEILE}mcp_anmeldung | route_mcp_anmeldung | erwartet 401, erhalten 200`,
    `${ZEILE}mcp_anmeldung | route_mcp_anmeldung | erwartet 200 mit Werkzeugliste, erhalten 500`,
  ]);
  assert.equal(gezaehlt, 2);
});

test("Fehlerart: mcpAnmeldung ohne Fehler schreibt nichts", (t) => {
  const antworten = [antwort(401), rpc({ tools: [] })];
  const { zeilen, gezaehlt } = laufe(t, { szenario: "mcp_anmeldung", antworten: () => antworten.shift(), aufruf: () => ablaeufe.mcpAnmeldung() });
  assert.deepEqual(zeilen, []);
  assert.equal(gezaehlt, 0);
});

test("Fehlerart: webhooks meldet angenommen und abgelehnt mit den Statuscodes", (t) => {
  const stati = { gueltig: 500, ungueltig: 200 };
  const { zeilen, gezaehlt } = laufe(t, { szenario: "webhooks", antworten: (m, u, koerper) => antwort(stati[koerper]), aufruf: () => ablaeufe.webhooks() });
  assert.deepEqual(zeilen, [`${ZEILE}webhooks | route_webhook_telnyx | erwartet 200/403, erhalten 500/200`]);
  assert.equal(gezaehlt, 1);
});

test("Fehlerart: webhooks ohne Fehler schreibt nichts", (t) => {
  const stati = { gueltig: 200, ungueltig: 403 };
  const { zeilen, gezaehlt } = laufe(t, { szenario: "webhooks", antworten: (m, u, koerper) => antwort(stati[koerper]), aufruf: () => ablaeufe.webhooks() });
  assert.deepEqual(zeilen, []);
  assert.equal(gezaehlt, 0);
});

test("Fehlerart: appLogin meldet Login- und Stand-Status", (t) => {
  const stati = [200, 401];
  const { zeilen, gezaehlt } = laufe(t, { szenario: "app_login", antworten: () => antwort(stati.shift()), aufruf: () => ablaeufe.appLogin() });
  assert.deepEqual(zeilen, [`${ZEILE}app_login | route_app_login | erwartet 302/200, erhalten 200/401`]);
  assert.equal(gezaehlt, 1);
});

test("Fehlerart: appLogin ohne Fehler schreibt nichts", (t) => {
  const stati = [302, 200];
  const { zeilen, gezaehlt } = laufe(t, { szenario: "app_login", antworten: () => antwort(stati.shift()), aufruf: () => ablaeufe.appLogin() });
  assert.deepEqual(zeilen, []);
  assert.equal(gezaehlt, 0);
});

const ZEILEN_FAELLE = [
  ["Rufnummer mit Plus", "an +4915112345678 gescheitert", "an <nummer> gescheitert"],
  ["Plus mit fuenf Ziffern bleibt", "an +12345 x", "an +12345 x"],
  ["Plus mit sechs Ziffern wird ersetzt", "an +123456 x", "an <nummer> x"],
  ["acht Ziffern ohne Plus werden ersetzt", "Nr 12345678 x", "Nr <nummer> x"],
  ["sieben Ziffern ohne Plus bleiben", "Nr 1234567 x", "Nr 1234567 x"],
  ["Bearer-Wert", "Header Bearer abc.def-123 abgelehnt", "Header <geheim> abgelehnt"],
  ["Token-Wert mit Gleichheitszeichen", "token=abc123 fehlt", "token=<geheim> fehlt"],
  ["Token-Wert in JSON", 'bad {"token":"abc123"}', "bad {\"token\":\"<geheim>\"}"],
  ["Zeilenumbruch wird Leerzeichen", "a\nb", "a b"],
];

for (const [name, eingabe, erwartet] of ZEILEN_FAELLE) {
  test(`Fehlerart Zeile: ${name}`, () => {
    assert.equal(ergebnis.fehlerZeile({ szenario: "s", route: "r", text: eingabe }), `${ZEILE}s | r | ${erwartet.replaceAll('"', "'")}`);
  });
}

test("Fehlerart Zeile: genau 120 Zeichen bleiben, 121 werden gekuerzt", () => {
  const zeile = (laenge) => ergebnis.fehlerZeile({ szenario: "s", route: "r", text: "y".repeat(laenge) });
  assert.equal(zeile(120), `${ZEILE}s | r | ${"y".repeat(120)}`);
  assert.equal(zeile(121), `${ZEILE}s | r | ${"y".repeat(120)}`);
});

async function laufMitStderr(t, stderrZeilen) {
  const geschrieben = [];
  t.mock.method(process.stderr, "write", (teil) => {
    geschrieben.push(String(teil));
    return true;
  });
  await laufeMitDateien([process.execPath, K6_ATTRAPPE], { stderrZeilen, ergebnis: { fehlerquoteProzent: 0 } });
  return geschrieben.join("").split("\n");
}

test("Fehlerart Zusammenfassung: je Fehlertext eine Zeile mit Anzahl, absteigend, k6-Rahmen ignoriert, Ausgabe weitergereicht", async (t) => {
  const rahmen = (text) => `time="2026-01-01T00:00:00Z" level=error msg="${ZEILE}anruf | route_place_call | ${text}" source=console`;
  const ausgabe = await laufMitStderr(t, [
    `${ZEILE}anruf | route_place_call | A | B`,
    rahmen("B | x"),
    `${ZEILE}webhooks | route_webhook_telnyx | B | x`,
    rahmen("A | B"),
    `${ZEILE}app_login | route_app_login | C`,
    "sonstige k6-Ausgabe",
  ]);
  const zusammenfassung = ausgabe.filter((zeile) => zeile.startsWith("ablauf_fehler Zusammenfassung"));
  assert.deepEqual(zusammenfassung, [
    "ablauf_fehler Zusammenfassung | 2x | A | B",
    "ablauf_fehler Zusammenfassung | 2x | B | x",
    "ablauf_fehler Zusammenfassung | 1x | C",
  ]);
  assert.ok(ausgabe.includes("sonstige k6-Ausgabe"));
  assert.ok(ausgabe.includes(`${ZEILE}app_login | route_app_login | C`));
});

test("Fehlerart Zusammenfassung: der haeufigere Text steht vorn", async (t) => {
  const ausgabe = await laufMitStderr(t, [`${ZEILE}s | r | selten`, `${ZEILE}s | r | oft`, `${ZEILE}s | r | oft`]);
  assert.deepEqual(
    ausgabe.filter((zeile) => zeile.startsWith("ablauf_fehler Zusammenfassung")),
    ["ablauf_fehler Zusammenfassung | 2x | oft", "ablauf_fehler Zusammenfassung | 1x | selten"],
  );
});

test("Fehlerart Zusammenfassung: ohne Ablauf-Fehler keine Zeile", async (t) => {
  const ausgabe = await laufMitStderr(t, ["sonstige k6-Ausgabe"]);
  assert.deepEqual(ausgabe.filter((zeile) => zeile.includes("Zusammenfassung")), []);
});
