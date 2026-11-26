import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../../src/store.js";
import { TENANT_STATUS, KYC_LEVEL } from "../../src/begriffe/mandant.ts";
import { NUMBER_STATUS } from "../../src/begriffe/nummern.ts";

const JETZT_MS = Date.parse("2026-09-11T12:00:00.000Z");
const FRIST_MS = 3600000;
const SEKUNDE_MS = 1000;
const ZWEI = 2;

const zahlend = (id) => ({
  id,
  status: TENANT_STATUS.ACTIVE,
  kycLevel: KYC_LEVEL.CARD,
  stripeSubscriptionId: `sub_${id}`,
  stripePlanSlug: "starter",
  stripeCurrentPeriodStart: Math.floor((JETZT_MS - ZWEI * FRIST_MS) / SEKUNDE_MS),
});

const auswahl = { nowMs: JETZT_MS, graceMs: FRIST_MS, kycMinLevel: KYC_LEVEL.CARD };

test("abgleich: zahlendOhneNummerKandidaten liefert zahlende Mandanten ohne aktive Nummer als Promise und liest load erst beim Aufruf", async () => {
  const zustand = {
    tenants: [zahlend("t_ohne"), zahlend("t_mit")],
    numbers: [{ id: "n1", tenantId: "t_mit", status: NUMBER_STATUS.ACTIVE, e164: "+4930123456" }],
    outageAlerts: [],
  };
  const speicher = {};
  const { abgleich } = speicherBereiche(speicher);
  speicher.load = () => zustand;
  const antwort = abgleich.zahlendOhneNummerKandidaten(auswahl);
  assert.ok(antwort instanceof Promise);
  assert.deepEqual((await antwort).map(({ tenantId }) => tenantId), ["t_ohne"]);
  speicher.load = () => {
    throw new Error("kaputt");
  };
  await assert.rejects(abgleich.zahlendOhneNummerKandidaten(auswahl), /kaputt/);
});

test("abgleich: zahlendOhneNummerKandidaten beachtet die Frist aus der Auswahl", async () => {
  const zustand = { tenants: [zahlend("t_ohne")], numbers: [], outageAlerts: [] };
  const { abgleich } = speicherBereiche({ load: () => zustand });
  assert.equal((await abgleich.zahlendOhneNummerKandidaten(auswahl)).length, 1);
  const lang = { ...auswahl, graceMs: ZWEI * FRIST_MS * ZWEI };
  assert.deepEqual(await abgleich.zahlendOhneNummerKandidaten(lang), []);
});
