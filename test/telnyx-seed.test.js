// P5: config-derived Telnyx-Nummer-Seed in BEIDEN Backends. Verhindert "Nummer
// gesetzt, routet aber nicht": die Telnyx-Owner-Nummer landet idempotent in der
// number-Tabelle (provider=telnyx) und ist ueber findTenantByNumber routbar; leer
// -> kein Seed (fail-closed). Offline (state-ops direkt + pglite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDefaultState, seedOwnerNumber, findTenantByNumber } from "../src/store/state-ops.js";
import { OWNER_TENANT_ID, PROVIDER } from "../src/store/defaults.js";
import { config } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { makePgTestStore } from "./pg-helpers.js";
import { PGlite } from "@electric-sql/pglite";

const TELNYX_NR = "+13125550100";

// ---- json-Pfad (state-ops, der json-load() identisch nutzt) ----
test("json: gesetzte Telnyx-Nummer -> routbar, provider=telnyx", () => {
  const s = makeDefaultState();
  seedOwnerNumber(s, TELNYX_NR, OWNER_TENANT_ID, PROVIDER.TELNYX);
  assert.equal(findTenantByNumber(s, TELNYX_NR), OWNER_TENANT_ID);
  assert.equal(s.numbers.find((n) => n.e164 === TELNYX_NR).provider, PROVIDER.TELNYX);
});

test("json: leere Telnyx-Nummer -> kein Seed (fail-closed)", () => {
  const s = makeDefaultState();
  seedOwnerNumber(s, "", OWNER_TENANT_ID, PROVIDER.TELNYX);
  assert.equal(s.numbers.length, 0);
});

test("json: bestehende e164 gewinnt (idempotent, kein Duplikat)", () => {
  const s = makeDefaultState();
  seedOwnerNumber(s, TELNYX_NR, OWNER_TENANT_ID, PROVIDER.TELNYX);
  seedOwnerNumber(s, TELNYX_NR, OWNER_TENANT_ID, PROVIDER.TELNYX);
  assert.equal(s.numbers.filter((n) => n.e164 === TELNYX_NR).length, 1);
});

// TD-2: config-Nummer mit Trennzeichen (Whitespace/Bindestrich) wird normalisiert
// gespeichert, damit der normalisierte Inbound-To-Lookup (findTenantByNumber) sie
// trifft - sonst routet sie nicht (defense-in-depth, fail-closed).
test("json: Nummer mit Trennzeichen wird normalisiert -> routbar (TD-2)", () => {
  const s = makeDefaultState();
  seedOwnerNumber(s, "+49 151-1234 567", OWNER_TENANT_ID, PROVIDER.TELNYX);
  assert.equal(s.numbers[0].e164, "+491511234567", "gespeicherte Form ist normalisiert");
  assert.equal(findTenantByNumber(s, "+491511234567"), OWNER_TENANT_ID);
});

test("json: Trennzeichen- und Klar-Form derselben Nummer -> 1 Zeile (Idempotenz, TD-2)", () => {
  const s = makeDefaultState();
  seedOwnerNumber(s, "+49 151-1234 567", OWNER_TENANT_ID, PROVIDER.TELNYX);
  seedOwnerNumber(s, "+491511234567", OWNER_TENANT_ID, PROVIDER.TELNYX);
  assert.equal(s.numbers.length, 1, "Idempotenz-Check laeuft gegen die normalisierte Form");
});

// ---- pg-Pfad (migrate.seedDefaults gegen pglite) ----
test("pg: gesetzte Telnyx-Nummer ueberlebt Re-Hydrierung, provider=telnyx", async () => {
  // config.telnyxNumber temporaer setzen, damit seedDefaults sie seedet; danach
  // die Hydrierung der frischen Store-Instanz pruefen. Twilio-Nummer leer halten,
  // damit der Test allein die Telnyx-Achse prueft.
  const prevTelnyx = config.telnyxNumber;
  const prevTwilio = config.twilioNumber;
  config.telnyxNumber = TELNYX_NR;
  config.twilioNumber = "";
  try {
    const db = new PGlite();
    const runner = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }) };
    await runner.withClient(async (client) => {
      await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [OWNER_TENANT_ID]);
      await migrate(client, OWNER_TENANT_ID);
    });
    const rows = (await db.query(`SELECT e164, provider FROM number WHERE e164 = $1`, [TELNYX_NR])).rows;
    assert.equal(rows.length, 1, "Telnyx-Nummer wurde geseedet");
    assert.equal(rows[0].provider, PROVIDER.TELNYX);
  } finally {
    config.telnyxNumber = prevTelnyx;
    config.twilioNumber = prevTwilio;
  }
});

test("pg: leere Telnyx-Nummer -> kein Seed (fail-closed)", async () => {
  const prevTelnyx = config.telnyxNumber;
  config.telnyxNumber = "";
  try {
    const { db } = await makePgTestStore();
    const rows = (await db.query(`SELECT e164 FROM number WHERE provider = $1`, [PROVIDER.TELNYX])).rows;
    assert.equal(rows.length, 0, "ohne TELNYX_NUMBER kein Telnyx-Seed");
  } finally {
    config.telnyxNumber = prevTelnyx;
  }
});

// TD-2 (pg-Seite): identisch zur json-Seite - config-Nummer mit Trennzeichen
// landet normalisiert in der number-Tabelle (eine Norm-Quelle, beide Backends).
test("pg: config-Nummer mit Trennzeichen wird normalisiert geseedet (TD-2)", async () => {
  const prevTelnyx = config.telnyxNumber;
  const prevTwilio = config.twilioNumber;
  config.telnyxNumber = "+49 151-1234 567";
  config.twilioNumber = "";
  try {
    const db = new PGlite();
    const runner = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }) };
    await runner.withClient(async (client) => {
      await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [OWNER_TENANT_ID]);
      await migrate(client, OWNER_TENANT_ID);
    });
    const rows = (await db.query(`SELECT e164 FROM number WHERE e164 = $1`, ["+491511234567"])).rows;
    assert.equal(rows.length, 1, "normalisierte Form gespeichert (routbar)");
  } finally {
    config.telnyxNumber = prevTelnyx;
    config.twilioNumber = prevTwilio;
  }
});
