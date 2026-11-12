import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { laufClients, starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { anrufEinfuegen, wertVon, zeitpunkt } from "./kennzahlen-anrufe.js";
import { clientVerhalten, haengt, minuteVergeht, rundenWarten, zeitgeberAn, zeitgeberAus, FRIST_MS } from "./kennzahlen-lauf-hilfen.js";

const ROLLE = "kennzahlen_leser";
const MINUTEN = 12;
const WERT = { richtung: "outbound", ergebnis: "angenommen" };

mock.timers.enable({ apis: ["setInterval"] });

const laufendesHermes = await starteHermesMitPglite({
  alarmPostfach: "",
  zusatzRollen: [ROLLE],
  appRolleDatenbankAnlegen: true,
  appRolleVerwaltetZusatzRollen: true,
  appRolleErstelltRollen: true,
  clientBruecke: true,
  unterKennzahlenLeser: true,
  kennzahlenAdresse: "postgres://kennzahlen-leser-attrappe.invalid/hermes",
  ohneStartanruf: true,
});

await anrufEinfuegen(laufendesHermes().db, {
  status: "completed",
  started_at: zeitpunkt(0, "09:00:00"),
  answered_at: zeitpunkt(0, "09:01:00"),
  ended_at: zeitpunkt(0, "09:05:00"),
});

let verhalten = null;

afterEach(() => {
  zeitgeberAus();
  mock.restoreAll();
  verhalten?.zuruecksetzen();
  verhalten = null;
});

async function speicher() {
  laufClients.at(-1)?.emit("error", new Error("neu beginnen"));
  return import("../../src/store.js");
}

async function gesund() {
  const antwort = await laufendesHermes().anfrage("/healthz");
  assert.equal(antwort.status, 200);
}

async function einTaktMitFrist(store) {
  zeitgeberAn(["setTimeout", "setInterval"]);
  const takt = store.kennzahlenTakt();
  await rundenWarten();
  mock.timers.tick(FRIST_MS);
  await takt;
  zeitgeberAus();
}

test("S11: scheitert der erste Takt, liefert der Takt eine Minute später anrufe_heute outbound angenommen = 1", async () => {
  const store = await speicher();
  let abfragen = 0;
  verhalten = clientVerhalten((_client, echt, ...argumente) => {
    abfragen += 1;
    return abfragen === 1 ? Promise.reject(new Error("weg")) : echt(...argumente);
  });
  mock.method(console, "error", () => {});
  await store.kennzahlenTakt();
  assert.equal(store.kennzahlenMomentaufnahme(), null);
  await store.kennzahlenTakt();
  assert.equal(wertVon(store.kennzahlenMomentaufnahme(), "anrufe_heute", WERT), 1);
});

test("S12: antwortet die Abfrage nicht, endet der Takt nach 5 Sekunden ohne Messwert und /healthz antwortet 200", async () => {
  const store = await speicher();
  verhalten = clientVerhalten(haengt);
  const zeilen = [];
  mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  await einTaktMitFrist(store);
  assert.equal(store.kennzahlenMomentaufnahme(), null);
  assert.deepEqual(zeilen, ["[kennzahlen] Lauf fehlgeschlagen: KENNZAHLEN_FRIST"]);
  await gesund();
});

test("S15: hängt die Abfrage zwölf Minuten lang, hält der Lauf höchstens eine Verbindung und /healthz antwortet 200", async () => {
  const store = await speicher();
  verhalten = clientVerhalten(haengt);
  mock.method(console, "error", () => {});
  zeitgeberAn(["setTimeout", "setInterval"]);
  let hoechstens = 0;
  for (let minute = 0; minute < MINUTEN; minute += 1) {
    const takt = store.kennzahlenTakt();
    await rundenWarten();
    hoechstens = Math.max(hoechstens, verhalten.offen());
    await minuteVergeht();
    await takt;
  }
  zeitgeberAus();
  assert.ok(verhalten.angelegt.length >= MINUTEN);
  assert.equal(hoechstens, 1);
  assert.equal(verhalten.offen(), 0);
  await gesund();
});

test("S21: bricht die Verbindung im Leerlauf ab, öffnet der nächste Takt neu und liefert 1; /healthz antwortet 200", async () => {
  const store = await speicher();
  verhalten = clientVerhalten((_client, echt, ...argumente) => echt(...argumente));
  await store.kennzahlenTakt();
  const alt = verhalten.angelegt.at(-1);
  alt.emit("error", new Error("Connection terminated unexpectedly"));
  assert.equal(store.kennzahlenMomentaufnahme(), null);
  await store.kennzahlenTakt();
  const neu = verhalten.angelegt.at(-1);
  assert.notEqual(neu, alt);
  assert.equal(wertVon(store.kennzahlenMomentaufnahme(), "anrufe_heute", WERT), 1);
  await gesund();
});
