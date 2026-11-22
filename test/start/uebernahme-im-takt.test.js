import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { mitVerbindung, POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { gemeinsameUmgebung } from "../gemeinsam/zwei-prozesse.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { seedCall, startServer } from "../helpers.js";

const ZEITGRENZE_MS = 120_000;
const TAKT_MS = 10_000;
const TAKT_FRIST_MS = 30_000;
const MANDANT = seedCall().tenantId;
const ANDERER_MANDANT = "t_ohne_anruf";
const ALT = "alt-host:00000000-0000-4000-8000-000000000011";
const FREMDER = "fremd-host:00000000-0000-4000-8000-000000000012";

async function mitOffenemSpeicher(t, lauf) {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return;
  const schema = await startServer({ env: gemeinsameUmgebung(db.adresse, {}) });
  await schema.stop();
  Object.assign(process.env, gemeinsameUmgebung(db.adresse, {}));
  const speicher = await import("../../src/store.js");
  await speicher.oeffneSpeicher();
  const verwaltung = new URL(process.env[POSTGRES_VARIABLE]);
  verwaltung.pathname = new URL(db.adresse).pathname;
  await mitVerbindung(verwaltung.href, (sql) => lauf({ sql, speicher }));
}

async function bisAufrufe(zaehler, erwartet) {
  const frist = AbortSignal.timeout(TAKT_FRIST_MS);
  while (zaehler() < erwartet) {
    assert.ok(!frist.aborted, `Aufrufe ${zaehler()} statt ${erwartet}`);
    await new Promise((fertig) => setImmediate(fertig));
  }
}

async function aktiverAnruf(sql, { id, besitzer, status = "active" }) {
  await sql.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, max_duration_s, instanz)
     VALUES ($1, $2, 'token', 'outbound', $4, now()::text, 3600, $3)`,
    [id, MANDANT, besitzer, status],
  );
}

async function besitzer(sql, id) {
  const { rows } = await sql.query(`SELECT instanz FROM call WHERE id = $1`, [id]);
  return rows[0].instanz;
}

async function eintragen(speicher, { callId, tenantId = MANDANT, alt }) {
  const lage = await speicher.besitzLage();
  return { lage, gewonnen: await speicher.uebernimmAnruf({ callId, tenantId, alt }) };
}

test("Uebernahme im Takt: Eintragung des Besitzers und Aufruf im Takt", { timeout: ZEITGRENZE_MS }, (haupt) =>
  mitOffenemSpeicher(haupt, async ({ sql, speicher }) => {
    await haupt.test("Eintragung: ein aktiver Anruf wechselt nur beim erwarteten Besitzer und nur einmal zur eigenen Kennung", async () => {
      await aktiverAnruf(sql, { id: "call_eintragung", besitzer: ALT });
      const falsch = await eintragen(speicher, { callId: "call_eintragung", alt: FREMDER });
      assert.equal(falsch.gewonnen, false);
      assert.equal(await besitzer(sql, "call_eintragung"), ALT);
      const richtig = await eintragen(speicher, { callId: "call_eintragung", alt: ALT });
      assert.equal(richtig.gewonnen, true);
      assert.equal(await besitzer(sql, "call_eintragung"), richtig.lage.eigene);
      const zweiter = await eintragen(speicher, { callId: "call_eintragung", alt: ALT });
      assert.equal(zweiter.gewonnen, false);
    });
    await haupt.test("Eintragung: ein Anruf ohne Besitzer wechselt, wenn kein Besitzer erwartet wird, und nicht, wenn einer erwartet wird", async () => {
      await aktiverAnruf(sql, { id: "call_ohne_besitzer", besitzer: null });
      assert.equal((await eintragen(speicher, { callId: "call_ohne_besitzer", alt: ALT })).gewonnen, false);
      assert.equal(await besitzer(sql, "call_ohne_besitzer"), null);
      const lage = await eintragen(speicher, { callId: "call_ohne_besitzer" });
      assert.equal(lage.gewonnen, true);
      assert.equal(await besitzer(sql, "call_ohne_besitzer"), lage.lage.eigene);
    });
    await haupt.test("Eintragung: ein beendeter Anruf und ein Anruf eines anderen Mandanten bleiben unveraendert", async () => {
      await aktiverAnruf(sql, { id: "call_beendet_eintragung", besitzer: ALT, status: "completed" });
      await aktiverAnruf(sql, { id: "call_anderer_mandant", besitzer: ALT });
      assert.equal((await eintragen(speicher, { callId: "call_beendet_eintragung", alt: ALT })).gewonnen, false);
      assert.equal((await eintragen(speicher, { callId: "call_anderer_mandant", tenantId: ANDERER_MANDANT, alt: ALT })).gewonnen, false);
      assert.equal(await besitzer(sql, "call_beendet_eintragung"), ALT);
      assert.equal(await besitzer(sql, "call_anderer_mandant"), ALT);
    });
    await haupt.test("Eintragung: ein Fehler beim Schreiben wirft, und die Verbindung ist danach fuer die naechste Eintragung brauchbar", async () => {
      await aktiverAnruf(sql, { id: "call_fehler", besitzer: ALT });
      await sql.query(`
        CREATE FUNCTION sperre_instanz() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'instanz gesperrt'; END $$;
        CREATE TRIGGER sperre_instanz BEFORE UPDATE ON call FOR EACH ROW EXECUTE FUNCTION sperre_instanz()`);
      await assert.rejects(eintragen(speicher, { callId: "call_fehler", alt: ALT }), /instanz gesperrt/);
      await sql.query(`DROP TRIGGER sperre_instanz ON call`);
      assert.equal((await eintragen(speicher, { callId: "call_fehler", alt: ALT })).gewonnen, true);
    });
    await haupt.test("Takt: der Start meldet ohne Uebernahme, jeder Takt danach ruft die Uebernahme genau einmal, und ein Fehler darin steht im Log und haelt den Takt nicht an", async (t) => {
      const meldungen = mock.method(console, "error", () => {});
      t.after(() => meldungen.mock.restore());
      mock.timers.enable({ apis: ["setInterval"] });
      t.after(() => mock.timers.reset());
      let aufrufe = 0;
      const takt = await speicher.starteInstanzTakt({
        nachMeldung: async () => {
          aufrufe += 1;
          throw new Error("Lesen kaputt");
        },
      });
      assert.equal(aufrufe, 0, "der Start ruft die Uebernahme nicht");
      mock.timers.tick(TAKT_MS);
      await bisAufrufe(() => aufrufe, 1);
      mock.timers.tick(TAKT_MS);
      await bisAufrufe(() => aufrufe, 2);
      await takt.stoppen();
      const texte = meldungen.mock.calls.map((aufruf) => aufruf.arguments.join(" "));
      assert.ok(texte.includes("[instanz] Uebernahme verwaister Arbeit fehlgeschlagen: Lesen kaputt"), texte.join("|"));
    });
  }),
);
