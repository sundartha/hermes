import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { laufClients, starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { anrufEinfuegen, wertVon, zeitpunkt } from "./kennzahlen-anrufe.js";
import { clientVerhalten, minuteVergeht, rundenWarten, zeitgeberAn, zeitgeberAus } from "./kennzahlen-lauf-hilfen.js";

const ROLLE = "kennzahlen_leser";
const SPERRE_ABFRAGE = "pg_try_advisory_lock";
const SICHT_ABFRAGE = "SELECT messwert";

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

const WERT = { richtung: "outbound", ergebnis: "angenommen" };

await anrufEinfuegen(laufendesHermes().db, {
  started_at: zeitpunkt(0, "09:00:00"),
  answered_at: zeitpunkt(0, "09:01:00"),
  ended_at: zeitpunkt(0, "09:05:00"),
});

const anrufeHeute = (momentaufnahme) => wertVon(momentaufnahme, "anrufe_heute", WERT);

test("S16: hält ein anderer Prozess die Sperre, liest und meldet dieser Prozess nichts; nach deren Freigabe meldet er", async () => {
  const store = await import("../../src/store.js");
  laufClients.at(-1).emit("error", new Error("neu beginnen"));
  let andererHaeltSperre = true;
  const sperrAnfragen = [];
  let sichtLesungen = 0;
  const verhalten = clientVerhalten((_client, echteAbfrage, ...argumente) => {
    const [text, parameter] = argumente;
    if (String(text).includes(SPERRE_ABFRAGE)) {
      sperrAnfragen.push(parameter);
      return Promise.resolve({ rows: [{ erhalten: !andererHaeltSperre }] });
    }
    if (String(text).startsWith(SICHT_ABFRAGE)) sichtLesungen += 1;
    return echteAbfrage(...argumente);
  });
  mock.method(console, "error", () => {});
  zeitgeberAn(["setTimeout", "setInterval"]);
  try {
    await store.kennzahlenTakt();
    assert.equal(sichtLesungen, 0, "ohne Sperre wird die Sicht nicht gelesen");
    assert.equal(store.kennzahlenMomentaufnahme(), null, "ohne Sperre kein Messwert");
    assert.equal(sperrAnfragen.length, 1);
    assert.equal(sperrAnfragen[0].length, 2);
    assert.equal(sperrAnfragen[0][0], 1_212_369_235);
    assert.equal(sperrAnfragen[0][1], 3);

    await minuteVergeht();
    await store.kennzahlenTakt();
    assert.equal(sichtLesungen, 0, "auch der nächste Takt liest nicht, solange der andere hält");
    assert.equal(verhalten.offen(), 1, "höchstens eine Verbindung, auch ohne Sperre");

    andererHaeltSperre = false;
    await store.kennzahlenTakt();
    await rundenWarten();
    assert.equal(sichtLesungen, 1, "mit Sperre wird die Sicht gelesen");
    assert.equal(anrufeHeute(store.kennzahlenMomentaufnahme()), 1);

    andererHaeltSperre = true;
    await store.kennzahlenTakt();
    assert.equal(sperrAnfragen.length, 3, "wer die Sperre hält, fragt sie nicht erneut an");
    assert.equal(sichtLesungen, 2, "der Halter liest weiter");
  } finally {
    zeitgeberAus();
    verhalten.zuruecksetzen();
  }
});

test("S16: bricht die Verbindung des Halters ab, fragt der nächste Takt die Sperre auf der neuen Verbindung neu an", async () => {
  const store = await import("../../src/store.js");
  let sperrAnfragen = 0;
  const verhalten = clientVerhalten((_client, echteAbfrage, ...argumente) => {
    const [text] = argumente;
    if (String(text).includes(SPERRE_ABFRAGE)) {
      sperrAnfragen += 1;
      return Promise.resolve({ rows: [{ erhalten: true }] });
    }
    return echteAbfrage(...argumente);
  });
  mock.method(console, "error", () => {});
  try {
    laufClients.at(-1).emit("error", new Error("abgebrochen"));
    await store.kennzahlenTakt();
    assert.equal(sperrAnfragen, 1);
    assert.equal(anrufeHeute(store.kennzahlenMomentaufnahme()), 1);
    verhalten.angelegt.at(-1).emit("error", new Error("abgebrochen"));
    assert.equal(store.kennzahlenMomentaufnahme(), null);
    await store.kennzahlenTakt();
    assert.equal(sperrAnfragen, 2, "neue Verbindung, neue Sperranfrage");
    assert.equal(anrufeHeute(store.kennzahlenMomentaufnahme()), 1);
  } finally {
    verhalten.zuruecksetzen();
  }
});
