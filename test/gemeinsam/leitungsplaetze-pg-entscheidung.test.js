import assert from "node:assert/strict";
import pg from "pg";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

import { POSTGRES_VARIABLE } from "./echtes-postgres.js";
import { mitGestartetemHermes, pgStartUmgebung } from "./pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "./test-rolle.js";
import { ANBIETER, LEITUNGSPLATZ_ENTSCHEIDUNG, leitungsplaetze } from "../../src/store.js";
import { postgresVorhanden } from "../anrufe/hermes-mit-postgres.js";

const execFileAsync = promisify(execFile);
const ZEITGRENZE_MS = 120_000;
const ELEVENLABS_PLAETZE = 4;
const SPERRE_NEHMEN_SQL = "SELECT pg_advisory_lock(2665, 1)";
const SPERRE_GEBEN_SQL = "SELECT pg_advisory_unlock(2665, 1)";
const EINTRAG_SQL = `INSERT INTO leitungsplatz (call_id, anbieter, tenant_id, ablauf_um)
  VALUES ($1, 'elevenlabs', $2, now() + $3::interval)`;
const ABLAUF_SQL = "UPDATE leitungsplatz SET ablauf_um = now() - interval '1 minute'";
const ANFRAGE = Object.freeze({ tenantId: "tenant_pg_entscheidung", weg: "elevenlabs", hoechstzahlKunde: 2 });

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

const STORE_URL = new URL("../../src/store.js", import.meta.url).href;
const KIND_SKRIPT = `
const speicher = await import(${JSON.stringify(STORE_URL)});
await speicher.oeffneSpeicher();
const [aktion, anfrage] = [process.argv[1], JSON.parse(process.argv[2])];
const ergebnis = await speicher.leitungsplaetze[aktion](anfrage);
process.stdout.write(JSON.stringify(ergebnis));
process.exit(0);
`;

async function mitKindProzess(t, lauf) {
  const db = await echteDatenbankMitRolle(t);
  await mitGestartetemHermes(db.adresse, {}, async () => {});
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const frage = async (aktion, anfrage) => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", KIND_SKRIPT, aktion, JSON.stringify(anfrage)],
      { env: { ...process.env, ...pgStartUmgebung(db.adresse) } },
    );
    return JSON.parse(stdout);
  };
  try {
    return await lauf({ frage, sql: (text, parameter) => verwaltung.query(text, parameter) });
  } finally {
    await verwaltung.end();
  }
}

test("Pruefen liest die Tabelle: volle ElevenLabs-Plaetze lehnen ab, abgelaufene zaehlen nicht", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitKindProzess(t, async ({ frage, sql }) => {
    assert.equal(await frage("pruefenAusgehend", ANFRAGE), "frei");
    for (let index = 0; index < ELEVENLABS_PLAETZE; index += 1)
      await sql(EINTRAG_SQL, [`alt_${index}`, `tenant_alt_${index}`, "1 hour"]);
    assert.equal(await frage("pruefenAusgehend", ANFRAGE), "anbieter_voll");
    await sql(ABLAUF_SQL);
    assert.equal(await frage("pruefenAusgehend", ANFRAGE), "frei");
  });
});

test("Belegen: antwortet die Datenbank nicht, lautet die Entscheidung Anbieter voll und kein Platz wird belegt", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitKindProzess(t, async ({ frage, sql }) => {
    await sql(SPERRE_NEHMEN_SQL);
    let ergebnis;
    try {
      ergebnis = await frage("belegenAusgehend", { ...ANFRAGE, callId: "call_pg_entscheidung", maxDauerS: 600 });
    } finally {
      await sql(SPERRE_GEBEN_SQL);
    }
    assert.deepEqual(ergebnis, { entscheidung: "anbieter_voll" });
    assert.equal((await sql("SELECT count(*)::int AS anzahl FROM leitungsplatz")).rows[0].anzahl, 0);
  });
});

const BELEGUNG = Object.freeze({
  callId: "call_vor_dem_oeffnen",
  tenantId: "tenant_vor_dem_oeffnen",
  weg: ANBIETER.TELNYX,
  maxDauerS: 600,
  hoechstzahlKunde: 1,
});

test("Leitungsplaetze arbeiten im Speicher des Prozesses, solange noch kein Speicher geoeffnet ist", async () => {
  assert.equal(await leitungsplaetze.pruefenAusgehend(BELEGUNG), LEITUNGSPLATZ_ENTSCHEIDUNG.FREI);
  assert.deepEqual(await leitungsplaetze.belegenAusgehend(BELEGUNG), { entscheidung: LEITUNGSPLATZ_ENTSCHEIDUNG.FREI });
  assert.equal(await leitungsplaetze.pruefenAusgehend(BELEGUNG), LEITUNGSPLATZ_ENTSCHEIDUNG.KUNDE_VOLL);
  await leitungsplaetze.freigeben(BELEGUNG.callId);
  assert.equal(await leitungsplaetze.pruefenAusgehend(BELEGUNG), LEITUNGSPLATZ_ENTSCHEIDUNG.FREI);
});
