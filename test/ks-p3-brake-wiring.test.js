// KS-P3 (b), Verdrahtung: die reine Notbremse (test/ks-p3-emergency-brake.test.js) an
// ihren ZWEI Aufrufstellen - dem compute_reserve-Gate (Outbound) und /voice/incoming
// (Inbound). Im Bestand stand an beiden Stellen eine feste Zahl aus der Konfiguration;
// seit dieser Phase faellt die Frist aus dem Restguthaben.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOutboundGates } from "../src/telephony/outbound-gates.js";
import { config } from "../src/config.js";
import { MAX_CALL_DURATION_CAP_S } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { startServer, seedState, OWNER_TEST_NUMBER } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const US_TARGET = "+15551234567"; // Auslandssatz (30 ct/min) - der Worst Case
const DE_OWN_DID = "+4930111222333";
const TENANT = "T";

// 300 ct Rest zum 30-ct-Satz = 10 bezahlbare Minuten + 1 Puffer-Minute = 660 s.
const REST_FUER_ZEHN_MINUTEN = 300;
const FRIST_BEI_ZEHN_MINUTEN = 660;

function gateWithRemaining(remainingCents) {
  const store = {
    tenantBudgetSnapshot: () => ({ capCents: 100000, spentCents: 0, remainingCents }),
  };
  return makeOutboundGates({ store, config }).gates.find((g) => g.name === "compute_reserve");
}

async function maxDurFor(remainingCents, rawMaxDurationS) {
  const ctx = {
    b: { max_duration_s: rawMaxDurationS },
    to: US_TARGET,
    fromNumber: DE_OWN_DID,
    tenantId: TENANT,
  };
  await gateWithRemaining(remainingCents).run(ctx);
  return ctx.maxDur;
}

test("KS-P3: compute_reserve leitet die Frist aus dem Restguthaben ab (Bestand: feste 180 s)", async () => {
  assert.equal(await maxDurFor(REST_FUER_ZEHN_MINUTEN, undefined), FRIST_BEI_ZEHN_MINUTEN);
  assert.equal(
    await maxDurFor(1_000_000, undefined),
    MAX_CALL_DURATION_CAP_S,
    "viel Guthaben -> die absolute Obergrenze, nicht mehr",
  );
});

test("KS-P3: der Body-Override kann die Frist nur VERKUERZEN, nie verlaengern", async () => {
  // Die schaerfste Aussage der Phase: ein Client kann sich keine Zeit erkaufen, die sein
  // Guthaben nicht traegt.
  assert.equal(await maxDurFor(REST_FUER_ZEHN_MINUTEN, 60), 60, "kuerzerer Wunsch gewinnt");
  assert.equal(
    await maxDurFor(REST_FUER_ZEHN_MINUTEN, 99999),
    FRIST_BEI_ZEHN_MINUTEN,
    "ein ueberlanger Wunsch faellt auf die Notbremse - NICHT auf die absolute Obergrenze",
  );
  for (const hostile of [-300, 0, NaN, "abc"])
    assert.equal(
      await maxDurFor(REST_FUER_ZEHN_MINUTEN, hostile),
      FRIST_BEI_ZEHN_MINUTEN,
      `${hostile}: faellt auf die Notbremse zurueck`,
    );
});

test("KS-P3: unlesbares Guthaben (D7) gibt die Obergrenze, sperrt aber weiterhin im Geld-Gate", async () => {
  assert.equal(
    await maxDurFor(null, undefined),
    MAX_CALL_DURATION_CAP_S,
    "die Frist ist nie unbegrenzt",
  );

  // Und die Frist ist KEINE Umgehung der Geld-Achse: dasselbe unlesbare Guthaben faellt im
  // nachfolgenden reserve_budget-Gate mit dem ziffernfreien Sperrtext durch.
  const store = {
    tenantBudgetSnapshot: () => ({ capCents: 100000, spentCents: null, remainingCents: null }),
    tenantLanguage: () => "de",
    withStoreLock: (fn) => fn(),
    tryReserveOutboundBudget: () => false,
    reserveExceedsBudget: () => true,
  };
  const gates = makeOutboundGates({
    store,
    config: withConfigNamespaces({ ...config.safety, ...config.billing }),
  }).gates;
  const ctx = {
    b: {},
    to: US_TARGET,
    fromNumber: DE_OWN_DID,
    tenantId: TENANT,
    requestedBy: "owner",
  };
  await gates.find((g) => g.name === "compute_reserve").run(ctx);
  const denial = await gates.find((g) => g.name === "reserve_budget").run(ctx);
  assert.equal(denial.status, 402, "das Geld-Gate lehnt trotz langer Frist ab");
  assert.ok(!/\d/.test(denial.body.error), "ziffernfreier Sperrtext bei unlesbarem Bucket");
});

// ---- Inbound: /voice/incoming legt eine Frist AN DEN CALL ------------------------

test("KS-P3: /voice/incoming persistiert eine guthaben-abgeleitete maxDurationS (Bestand: null)", async () => {
  const srv = await startServer({
    seed: seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }],
      numbers: [
        {
          id: "num_owner",
          e164: OWNER_TEST_NUMBER.e164,
          tenantId: BOOTSTRAP_TENANT_ID,
          provider: "twilio",
          status: "active",
          country: "US",
          language: "en",
        },
      ],
    }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({
        CallSid: "CAksp3",
        From: "+4915112345678",
        To: OWNER_TEST_NUMBER.e164,
      }),
    });
    assert.equal(res.status, 200);
    const [call] = srv.readStore().calls;
    assert.ok(call, "Vorbedingung: der Inbound-Call ist angelegt");
    assert.ok(
      Number.isInteger(call.maxDurationS) && call.maxDurationS > 0,
      `maxDurationS ist gesetzt (war im Bestand null), ist: ${call.maxDurationS}`,
    );
    assert.ok(
      call.maxDurationS <= MAX_CALL_DURATION_CAP_S,
      "und niemals ueber der absoluten Obergrenze",
    );
  } finally {
    await srv.stop();
  }
});
