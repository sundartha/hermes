import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  seedState,
  seedCall,
  waitUntil,
  makeTelnyxSigner,
  nowSeconds,
  DOMESTIC_TEST_NUMBER,
} from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const FRIST = { timeout: 60_000 };
const WARTEZEIT_MS = 30_000;
const ANGENOMMEN_UM = "2026-01-01T00:00:00.000Z";
const BEENDET_UM = "2026-01-01T00:05:00.000Z";
const KURZ_BEENDET_UM = "2026-01-01T00:01:00.000Z";
const GEBUCHT = "wdh_gebucht";
const MARKE = "wdh_marke";

const signer = makeTelnyxSigner();

function meldeCompleted(srv, callId) {
  const body = new URLSearchParams({ CallStatus: "completed" }).toString();
  const zeit = String(nowSeconds());
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "telnyx-timestamp": zeit,
    "telnyx-signature-ed25519": signer.sign(zeit, body),
  };
  return abrufMitFrist(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    headers,
    body,
  });
}

const anrufVon = (srv, id) => srv.readStore().calls.find((c) => c.id === id);

const nutzungVon = (srv) => srv.readStore().usage[BOOTSTRAP_TENANT_ID];

const buchungsstand = (srv) => {
  const call = anrufVon(srv, GEBUCHT);
  return {
    billedAt: call.billedAt,
    estimatedCostCents: call.estimatedCostCents,
    tenantCostCents: nutzungVon(srv).costCents,
  };
};

const beendeterAnruf = (id, endedAt) =>
  seedCall({
    id,
    from: DOMESTIC_TEST_NUMBER.e164,
    to: "+4915112345678",
    status: "completed",
    answeredAt: ANGENOMMEN_UM,
    endedAt,
    transcript: [{ role: "caller", text: "Guten Tag", at: ANGENOMMEN_UM }],
    summary: "Termin steht.",
  });

test(
  "wiederholte signierte Endemeldung nach Neustart laesst Buchung, Anrufkosten und Tenant-Nutzung unveraendert",
  FRIST,
  async () => {
    const umgebung = {
      VOICE_TARIFF_DOMESTIC_CENTS: "20",
      VOICE_TARIFF_DEFAULT_CENTS: "30",
      SKIP_TWILIO_SIGNATURE_CHECK: "false",
      TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    };
    const seed = seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas" }],
      numbers: [
        {
          id: "num_wdh",
          e164: DOMESTIC_TEST_NUMBER.e164,
          tenantId: BOOTSTRAP_TENANT_ID,
          provider: "telnyx",
          status: "active",
          providerNumberId: null,
        },
      ],
      calls: [beendeterAnruf(GEBUCHT, BEENDET_UM), beendeterAnruf(MARKE, KURZ_BEENDET_UM)],
    });
    const srv = await startServer({ seed, env: umgebung });
    let davor;
    try {
      assert.equal((await meldeCompleted(srv, GEBUCHT)).status, HTTP_OK);
      await waitUntil(() => buchungsstand(srv).billedAt, { timeoutMs: WARTEZEIT_MS });
      davor = buchungsstand(srv);
      assert.equal(davor.estimatedCostCents, 100);
      assert.equal(davor.tenantCostCents, 100);
    } finally {
      await srv.stop();
    }
    const neu = await startServer({ seed: null, dataDir: srv.dataDir, env: umgebung });
    try {
      assert.equal((await meldeCompleted(neu, GEBUCHT)).status, HTTP_OK);
      assert.equal((await meldeCompleted(neu, MARKE)).status, HTTP_OK);
      await waitUntil(() => anrufVon(neu, MARKE).billedAt, { timeoutMs: WARTEZEIT_MS });
      assert.deepEqual(
        {
          ...buchungsstand(neu),
          tenantCostCents:
            buchungsstand(neu).tenantCostCents - anrufVon(neu, MARKE).estimatedCostCents,
        },
        davor,
      );
    } finally {
      await neu.stop();
    }
  },
);
