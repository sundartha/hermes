// PROV-01 (F7): HTTP-Wiring von POST /api/onboard/retry, das resolveProvisionRetry NUR
// unit-testet (prov01-retry-redrive.test.js). Hier: die server.js-Verdrahtung selbst
// End-to-End - (1) der redrive-Zweig (`if (reqRes.reason === "redrive")` + die
// numberId-Ternary) und (2) der needs_manual_reconcile-Zweig (409 + RETRY_REASON_MESSAGE).
//
// Race mit dem Boot-Sweep (F5, reconcileOrphanedProvisioning): ein beim Boot bereits
// persistierter 'requested'+'queued' Job wird VOM BOOT-SWEEP SELBST geclaimt, bevor ein
// HTTP-Request ueberhaupt ankommen kann (reconcileOrphanedProvisioning laeuft synchron im
// app.listen-Callback bis zum ersten echten Provider-await - empirisch verifiziert: der
// Retry-Call sieht dann sofort 'already_provisioned'). Der redrive-Erfolgsfall wird daher
// NICHT ueber einen beim Boot geseedeten Job getestet, sondern ueber einen WAEHREND DES
// LAUFENDEN PROZESSES echten "stuck"-Zustand: ein zweiter Tenant (t_hang) haelt den
// single-flight-Drain (F3) mit einem absichtlich haengenden Telnyx-Mock besetzt, WAEHREND
// t_stuck seine eigene Nummer anfragt - deren Job bleibt dadurch garantiert 'queued' +
// 'requested' (Drain kommt nicht dazu), genau das Szenario, das der Retry-Lever adressiert.
// needs_manual_reconcile ist unproblematisch direkt seedbar: Boot-Sweep UND Retry-Lever
// nutzen dasselbe Alters-Gate (redriveAgeHoldReason) und kommen bei einem zu alten Job
// UNABHAENGIG voneinander zum selben Schluss (hold) - keine Race, kein Kauf.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState } from "./helpers.js";
import { makeDefaultState } from "../src/store/state-ops.js";
import {
  NUMBER_STATUS,
  TENANT_STATUS,
  KYC_LEVEL,
  PROVISION_NUMBER_JOB,
  PROVISIONING_JOB_STATUS,
  PROVIDER,
} from "../src/store/defaults.js";

const ORDERED_E164 = "+4915799990001";
const PROVIDER_NUMBER_ID = "num_ext_1";
const ONE_HOUR_MS = 3600000;

const PROVISION_ENV = {
  PROVISIONING_ENABLED: "true",
  PROVISIONING_COUNTRY: "DE",
  PROVISIONING_REDRIVE_MAX_AGE_MS: String(ONE_HOUR_MS),
  TELNYX_API_KEY: "KEYtest",
  TELNYX_CONNECTION_ID: "conn_1",
  MAX_NUMBERS: "10",
  MAX_NUMBERS_PER_TENANT: "5",
};

const onboard = (srv, tenantId) =>
  fetch(`${srv.localUrl}/api/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId }),
  });

const retry = (srv, tenantId) =>
  fetch(`${srv.localUrl}/api/onboard/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId }),
  });

function subscriberTenant(id) {
  return { id, status: TENANT_STATUS.ACTIVE, ownerName: `${id} Tester`, kycLevel: KYC_LEVEL.CARD };
}

async function pollNumberStatus(srv, id, status, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const num = srv.readStore().numbers.find((n) => n.id === id);
    if (num && num.status === status) return num;
    if (Date.now() > deadline) return num;
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function until(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("until: Bedingung nicht innerhalb des Timeouts erfuellt");
    await new Promise((r) => setTimeout(r, 10));
  }
}

// Telnyx-Mock, dessen ERSTE Nummernsuche absichtlich haengt (kein res.end, bis release()
// aufgerufen wird) - simuliert einen Provider-Call, der noch laeuft, waehrend der
// single-flight-Drain (F3) dadurch fuer JEDEN weiteren Job besetzt bleibt. Jede weitere
// Suche antwortet sofort. orderRequests zeichnet den Idempotency-Key jeder Order auf
// (Beweis "kein Doppelkauf": derselbe Key darf nur einmal bestellen).
async function startHangableTelnyxMock() {
  let heldRes = null;
  let searchCount = 0;
  const orderRequests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v2/available_phone_numbers")) {
        searchCount++;
        if (searchCount === 1) {
          heldRes = res; // haengt bis release()
          return;
        }
        return res.end(JSON.stringify({ data: [{ phone_number: ORDERED_E164 }] }));
      }
      if (req.url === "/v2/number_orders" && req.method === "POST") {
        orderRequests.push(req.headers["idempotency-key"]);
        return res.end(
          JSON.stringify({ data: { phone_numbers: [{ id: "ord_sub_1", phone_number: ORDERED_E164 }] } }),
        );
      }
      if (req.url.startsWith("/v2/phone_numbers?"))
        return res.end(JSON.stringify({ data: [{ id: PROVIDER_NUMBER_ID, phone_number: ORDERED_E164 }] }));
      res.end(JSON.stringify({ data: {} })); // release u.a.
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    orderRequests,
    searchCount: () => searchCount,
    release() {
      if (!heldRes) return;
      heldRes.end(JSON.stringify({ data: [{ phone_number: ORDERED_E164 }] }));
      heldRes = null;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

test("redrive-Erfolg: 200, reason=redrive, jobId gesetzt, danach GENAU EIN Kauf (kein Doppelkauf)", async () => {
  const telnyx = await startHangableTelnyxMock();
  const srv = await startServer({
    seed: seedState({ tenants: [subscriberTenant("t_stuck")] }),
    env: { ...PROVISION_ENV, TELNYX_API_BASE: telnyx.url },
  });
  try {
    // t_hang besetzt den single-flight-Drain: seine Nummernsuche haengt absichtlich.
    const hangRes = await onboard(srv, "t_hang");
    assert.equal(hangRes.status, 200);
    const hangJson = await hangRes.json();
    await until(() => telnyx.searchCount() >= 1, 4000); // Drain ist jetzt busy (haengt)

    // t_stuck fragt WAEHREND des haengenden Drains seine Nummer an - der Job bleibt
    // 'queued', die Nummer 'requested' (der Drain kommt nicht dazu, sie zu bearbeiten).
    const stuckRes = await onboard(srv, "t_stuck");
    assert.equal(stuckRes.status, 200);
    const stuckJson = await stuckRes.json();
    assert.equal(stuckJson.provisioning, "queued");
    assert.equal(telnyx.searchCount(), 1, "t_stuck wurde NICHT bearbeitet (Drain haengt noch)");

    // Der Retry-Lever findet den echten stuck-Zustand: redrive statt Neuanfrage.
    const retryRes = await retry(srv, "t_stuck");
    assert.equal(retryRes.status, 200);
    const retryJson = await retryRes.json();
    assert.equal(retryJson.reason, "redrive");
    assert.equal(retryJson.numberId, stuckJson.numberId, "dieselbe Nummer, kein Neuanfrage");
    assert.equal(retryJson.jobId, stuckJson.jobId, "derselbe Job, kein Doppel-Enqueue");

    // Drain freigeben (t_hang zuerst) - danach verarbeitet die Kette auch t_stuck.
    telnyx.release();
    const num = await pollNumberStatus(srv, stuckJson.numberId, "active");
    assert.equal(num.status, "active");
    assert.equal(num.e164, ORDERED_E164);
    assert.equal(num.providerNumberId, PROVIDER_NUMBER_ID);

    // Money-Safety: fuer den redrive-Job (idempotencyKey provision_<numberId> ->
    // Telnyx-Order-Key order_<numberId>) wurde GENAU EINE Order aufgegeben - der Retry
    // hat den bestehenden Job nachgefuehrt, NICHT einen zweiten Kauf ausgeloest.
    const stuckOrderKey = `order_${stuckJson.numberId}`;
    const stuckOrders = telnyx.orderRequests.filter((k) => k === stuckOrderKey);
    assert.equal(stuckOrders.length, 1, "genau EIN Order-Call fuer die redrive-Nummer");
    assert.ok(hangJson.numberId, "t_hang-Zweig lief unabhaengig durch (Aufraeum-Kontrolle)");
  } finally {
    await srv.stop();
    await telnyx.close();
  }
});

// Alters-Gate (redriveAgeHoldReason) ist geteilt mit dem Boot-Sweep (F5): ein zu alter
// Job wird von BEIDEN unabhaengig als 'hold' klassifiziert - keine Race, boot-sweep-sicher
// seedbar. Beweist die RETRY_REASON_STATUS/MESSAGE-Verdrahtung (409 + Runbook-Text).
function seedTooOldStuck() {
  const s = makeDefaultState();
  s.tenants = [{ id: "t_old", status: TENANT_STATUS.ACTIVE, kycLevel: KYC_LEVEL.CARD, ownerName: "Old Tester" }];
  s.numbers = [
    {
      id: "num_old_stuck",
      tenantId: "t_old",
      status: NUMBER_STATUS.REQUESTED,
      e164: null,
      provider: PROVIDER.TELNYX,
      country: "DE",
      providerNumberId: null,
    },
  ];
  s.provisioningJobs = [
    {
      id: "job_old_stuck",
      numberId: "num_old_stuck",
      tenantId: "t_old",
      kind: PROVISION_NUMBER_JOB,
      status: PROVISIONING_JOB_STATUS.QUEUED,
      idempotencyKey: "provision_num_old_stuck",
      attempts: 0,
      lastError: null,
      createdAt: new Date(Date.now() - 2 * ONE_HOUR_MS).toISOString(), // > maxAgeMs (1h)
    },
  ];
  return s;
}

test("needs_manual_reconcile: 409 + Runbook-Message bei zu altem stuck-Job, KEIN Kauf", async () => {
  const telnyx = await startHangableTelnyxMock(); // hier nur als schlichter Recorder genutzt
  const srv = await startServer({ seed: seedTooOldStuck(), env: { ...PROVISION_ENV, TELNYX_API_BASE: telnyx.url } });
  try {
    const res = await retry(srv, "t_old");
    assert.equal(res.status, 409);
    const json = await res.json();
    assert.match(json.error, /Haengender Nummernkauf/, "Runbook-Hinweis (PROV-01) in der Antwort");
    assert.match(json.error, /Auto-Retry/);
    assert.equal(telnyx.orderRequests.length, 0, "kein Kauf-Versuch");
    assert.equal(
      srv.readStore().numbers.find((n) => n.id === "num_old_stuck").status,
      "requested",
      "Nummer bleibt unangetastet",
    );
  } finally {
    await srv.stop();
    await telnyx.close();
  }
});
