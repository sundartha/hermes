import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";
import { mitZweiInstanzenUndGespraechsende, sendeEnde } from "./zwei-instanzen-kernwege-hilfen.js";

const ZEITGRENZE_MS = 120_000;
const VORSPANN_ZEILEN = 1;
const GESPRAECH = Object.freeze([
  { role: "agent", message: "Guten Tag, ich rufe wegen des Termins an." },
  { role: "user", message: "Ja, worum geht es genau?" },
  { role: "agent", message: "Ich moechte einen Termin am Donnerstag vereinbaren." },
  { role: "user", message: "Donnerstag um zehn Uhr passt." },
]);
const GESPRAECH_TEXTE = GESPRAECH.map((zeile) => zeile.message);
const ZEILEN_SQL = "SELECT text FROM transcript_segment WHERE call_id = $1 ORDER BY id";

async function endeInReihenfolge(t, [erste, zweite]) {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiInstanzenUndGespraechsende(t, async ({ a, b, sql, rufeAn, transkriptVon, beendeGespraech }) => {
    const instanzen = { a, b };
    const callId = await rufeAn(a);
    const lies = async () => (await sql(ZEILEN_SQL, [callId])).rows.map((zeile) => zeile.text);
    const [vorspann] = await zeilenBis(lies, (zeilen) => zeilen.length >= VORSPANN_ZEILEN);
    beendeGespraech(`conv_${callId}`, GESPRAECH);
    await sendeEnde(instanzen[erste], callId);
    await zeilenBis(lies, (zeilen) => zeilen.length >= VORSPANN_ZEILEN + GESPRAECH.length);
    await sendeEnde(instanzen[zweite], callId);
    const erwartet = [vorspann, ...GESPRAECH_TEXTE];
    assert.deepEqual(await lies(), erwartet);
    assert.deepEqual(await transkriptVon(a, callId), erwartet);
    assert.deepEqual(await transkriptVon(b, callId), erwartet);
  });
}

test("T8 Ende auf A, dann auf B: beide Instanzen zeigen den Vorspann zuerst und jede Anbieter-Zeile genau einmal in gesprochener Reihenfolge", { timeout: ZEITGRENZE_MS }, (t) =>
  endeInReihenfolge(t, ["a", "b"]));
