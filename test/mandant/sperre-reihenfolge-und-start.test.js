import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOOTSTRAP_TENANT_ID,
  KYC_BOOTSTRAP,
  KYC_SETZEN_SQL,
  KYC_ZIEL,
  SPAETERE_SPERRE,
  SPERRE_LESEN,
  SPERRE_SCHREIBEN,
  SPERRE_SETZEN_SQL,
  TENANT,
  ZAHLUNGSSPERRE,
  angehalten,
  bootstrapKyc,
  instanz,
  pgliteAlsRolleOhneSuperuser,
  runnerFuer,
  sperreVon,
  zweiInstanzen,
} from "./sperre-hilfe.js";

test("Kriterium 17: zwei Sperr-Schreiben hintereinander: die Kopie springt nicht auf den aelteren Wert zurueck", async () => {
  const zweites = angehalten(SPERRE_SCHREIBEN, 2);
  const { db, b } = await zweiInstanzen(undefined, zweites.vorQuery);

  const erst = b.setBillingHold(TENANT, { reason: ZAHLUNGSSPERRE });
  const dann = b.clearBillingHold(TENANT);
  await erst;
  assert.equal(b.billingHoldActive(TENANT), null, "die Kopie behaelt den neueren Wert");

  const lesen = sperreVon(b);
  zweites.freigeben();
  assert.equal((await lesen).billingHold(), null, "das Lesen wartet auf das eigene Schreiben");
  await dann;

  await db.query(SPERRE_SETZEN_SQL, [TENANT, SPAETERE_SPERRE]);
  await sperreVon(b);
  assert.equal(b.billingHoldActive(TENANT), SPAETERE_SPERRE, "danach zieht die Kopie wieder aus der Datenbank nach");
});

test("Kriterium 17: ein spaet ankommendes aelteres Lesen setzt die Kopie von B nicht zurueck", async () => {
  const erstesLesen = angehalten(SPERRE_LESEN, 1);
  const { a, b } = await zweiInstanzen(undefined, erstesLesen.vorQuery);

  const alt = sperreVon(b);
  await a.setBillingHold(TENANT, { reason: ZAHLUNGSSPERRE });
  assert.equal((await sperreVon(b)).billingHold(), ZAHLUNGSSPERRE);
  erstesLesen.freigeben();
  await alt;

  assert.equal(b.billingHoldActive(TENANT), ZAHLUNGSSPERRE);
});

test("Bootstrap: eine frische Datenbank gibt dem Bootstrap-Mandanten beim Start die KYC-Stufe", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await instanz(runnerFuer(db));

  assert.equal(await bootstrapKyc(db), KYC_BOOTSTRAP);
});

test("Bootstrap: hat der Bootstrap-Mandant schon eine KYC-Stufe, setzt ein neuer Start sie nicht zurueck", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await instanz(runnerFuer(db));
  await db.query(KYC_SETZEN_SQL, [BOOTSTRAP_TENANT_ID, KYC_ZIEL]);

  const neu = await instanz(runnerFuer(db));

  assert.equal(await bootstrapKyc(db), KYC_ZIEL);
  assert.equal(neu.kycReached(BOOTSTRAP_TENANT_ID, KYC_BOOTSTRAP), false);
});
