import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { starteTelemetrie } from "../src/utils/telemetrie.js";
import { messwerte, startEmpfaenger, warteAufExport, wert } from "./gemeinsam/otlp-empfaenger.js";
import { neueUhr, pgBossUmgebung, wackeligeWarteschlange } from "./gemeinsam/pgboss-umgebung.js";

const TOKEN = "t".repeat(20);
const LAENGE = "hermes.queue.length";
const ALTER = "hermes.queue.oldest_age";
const POOL = "hermes.db.pool.open";
const KIND = "provision_number";
const EXPORT_INTERVALL_MS = 50;
const SEKUNDE_MS = 1000;
const AELTESTER_ALTER_S = 90;
const ZWEITER_ALTER_S = 30;

const auftrag = (nummer) => ({
  kind: KIND,
  payload: { numberId: `num_${nummer}`, to: "+4915112345678", tenantId: "tenant_geheim" },
  idempotencyKey: `k4_${nummer}`,
});

async function mitMessung(optionen, lauf) {
  const empfaenger = await startEmpfaenger();
  const warnungen = mock.method(console, "warn", () => {});
  const telemetrie = await starteTelemetrie({
    url: empfaenger.url,
    token: TOKEN,
    intervallMs: EXPORT_INTERVALL_MS,
    poolZustand: () => ({ offen: 1, wartend: 0 }),
    ...optionen,
  });
  try {
    return await lauf({ empfaenger, meldungen: () => warnungen.mock.calls.map((a) => a.arguments[0]) });
  } finally {
    await telemetrie.stoppe();
    await empfaenger.stop();
    warnungen.mock.restore();
  }
}

const punkt = (werte, name) => werte[name].punkte[0];
const labels = (p) => Object.fromEntries(p.attributes.map((a) => [a.key, a.value.stringValue]));

test("K4-1: Länge und Alter des ältesten wartenden Auftrags stehen genau in der Telemetrie", async (t) => {
  const uhr = neueUhr();
  const umgebung = await pgBossUmgebung(t, { clock: uhr });
  const start = uhr.now();
  await umgebung.queue.enqueue(auftrag(1));
  await uhr.setTime(start + ZWEITER_ALTER_S * SEKUNDE_MS);
  await umgebung.queue.enqueue(auftrag(2));
  await uhr.setTime(start + AELTESTER_ALTER_S * SEKUNDE_MS);
  await mitMessung({ warteschlangeZustand: umgebung.queue.warteschlangeZustand }, async ({ empfaenger }) => {
    const werte = await warteAufExport(empfaenger, (m) => m[LAENGE] && m[ALTER]);
    assert.equal(wert(werte[LAENGE].punkte), 2);
    assert.equal(wert(werte[ALTER].punkte), AELTESTER_ALTER_S);
    assert.equal(werte[ALTER].einheit, "s");
    assert.deepEqual(labels(punkt(werte, LAENGE)), { art: KIND });
    assert.deepEqual(labels(punkt(werte, ALTER)), { art: KIND });
    const alles = JSON.stringify(empfaenger.exporte);
    for (const fremd of ["num_1", "+4915112345678", "tenant_geheim", "k4_1"]) assert.ok(!alles.includes(fremd));
  });
});

test("K4-2: eine leere Warteschlange meldet Länge 0 und Alter 0", async (t) => {
  const uhr = neueUhr();
  const umgebung = await pgBossUmgebung(t, { clock: uhr });
  await umgebung.queue.enqueue(auftrag(3));
  await uhr.setTime(uhr.now() + AELTESTER_ALTER_S * SEKUNDE_MS);
  await umgebung.queue.drain(async () => undefined);
  await mitMessung({ warteschlangeZustand: umgebung.queue.warteschlangeZustand }, async ({ empfaenger }) => {
    const werte = await warteAufExport(empfaenger, (m) => m[LAENGE] && m[ALTER]);
    assert.equal(wert(werte[LAENGE].punkte), 0);
    assert.equal(wert(werte[ALTER].punkte), 0);
  });
});

test("K4-3: fällt die Datenbankabfrage aus, wird geloggt und geschluckt, die übrigen Messwerte kommen weiter", async (t) => {
  const { queue } = await wackeligeWarteschlange(t);
  await mitMessung({ warteschlangeZustand: queue.warteschlangeZustand }, async ({ empfaenger, meldungen }) => {
    const werte = await warteAufExport(empfaenger, (m) => m[POOL]);
    assert.equal(werte[LAENGE], undefined);
    assert.ok(meldungen().some((m) => m.includes("warteschlange") && m.includes("Datenbank nicht erreichbar")));
  });
});

test("K4-4: ohne Telemetrie wird die Datenbank nicht gefragt", async () => {
  let aufrufe = 0;
  const telemetrie = await starteTelemetrie({
    warteschlangeZustand: async () => {
      aufrufe += 1;
      return [];
    },
  });
  assert.equal(telemetrie.aktiv, false);
  assert.equal(aufrufe, 0);
});

test("K4-5: eine Warteschlange ohne Messmöglichkeit liefert keine Warteschlangen-Messwerte", async () => {
  await mitMessung({ warteschlangeZustand: async () => null }, async ({ empfaenger }) => {
    const werte = await warteAufExport(empfaenger, (m) => m[POOL]);
    assert.deepEqual(Object.keys(werte).filter((n) => n.startsWith("hermes.queue.")), []);
    assert.equal(messwerte(empfaenger.exporte[0])[LAENGE], undefined);
  });
});

test("K4-6: mehr wartende Aufträge als eine Seite fasst werden vollständig gezählt", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  const SEITE_PLUS_EINS = 1001;
  const nummern = Array.from({ length: SEITE_PLUS_EINS }, (_, i) => i);
  await Promise.all(nummern.map((n) => umgebung.queue.enqueue(auftrag(n))));
  const [zustand] = await umgebung.queue.warteschlangeZustand();
  assert.equal(zustand.laenge, SEITE_PLUS_EINS);
});
