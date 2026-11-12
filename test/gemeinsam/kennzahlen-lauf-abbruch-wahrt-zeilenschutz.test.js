import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { LOGIN_SUB, laufClients, starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { zeitpunkt } from "./kennzahlen-anrufe.js";
import { clientVerhalten, FRIST_MS, haengt, rundenWarten, zeitgeberAn, zeitgeberAus } from "./kennzahlen-lauf-hilfen.js";

const ROLLE = "kennzahlen_leser";

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

async function anrufFuer(db, tenantId, kennung) {
  await db.transaction(async (transaktion) => {
    await transaktion.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    await transaktion.query(
      `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
       VALUES ($1, $2, 'kennzahlen-test', 'outbound', 'completed', $3)`,
      [kennung, tenantId, zeitpunkt(0, "09:00:00")],
    );
  });
}

test("B2: nach einem durch die Frist abgebrochenen Lauf enthält der Portal-Status von Kunde A nur den Anruf von Kunde A", async () => {
  const hermes = laufendesHermes();
  const { sessionCookie } = await hermes.anmelden();
  const store = await import("../../src/store.js");
  const kundeA = store.resolveTenant(LOGIN_SUB);
  await hermes.db.query("UPDATE tenant SET status = 'active' WHERE id = $1", [kundeA]);
  await hermes.db.query("INSERT INTO tenant (id, status) VALUES ('tenant_kunde_b', 'active')");
  await anrufFuer(hermes.db, kundeA, "call_kunde_a");
  await anrufFuer(hermes.db, "tenant_kunde_b", "call_kunde_b");

  laufClients.at(-1).emit("error", new Error("neu beginnen"));
  const verhalten = clientVerhalten(haengt);
  mock.method(console, "error", () => {});
  zeitgeberAn(["setTimeout"]);
  const takt = store.kennzahlenTakt();
  await rundenWarten();
  mock.timers.tick(FRIST_MS);
  await takt;
  zeitgeberAus();
  verhalten.zuruecksetzen();
  assert.equal(store.kennzahlenMomentaufnahme(), null);

  const antwort = await hermes.anfrage("/api/portal/state", { headers: { cookie: sessionCookie } });
  assert.equal(antwort.status, 200);
  const koerper = await antwort.json();
  assert.equal(koerper.tenantId, kundeA);
  assert.deepEqual(koerper.calls.map((anruf) => anruf.id), ["call_kunde_a"]);
});
