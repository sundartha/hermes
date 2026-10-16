import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { startServer, seedState, PLAN_PRICE_BOOT_ENV } from "./helpers.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSrc = fs.readFileSync(path.join(ROOT, "src", "server.js"), "utf8");
const bootSrc = fs.readFileSync(path.join(ROOT, "src", "boot.js"), "utf8");

test("E3B-01: server.js baut makeOutageWatch und reicht outageWatch ins deps-Buendel durch", () => {
  assert.match(serverSrc, /import\s*{\s*makeOutageWatch\s*}\s*from\s*"\.\/telephony\/outage-report\.js"/,
    "makeOutageWatch muss importiert sein");
  assert.match(serverSrc, /const outageWatch = makeOutageWatch\(/,
    "outageWatch muss EINMAL beim Boot konstruiert werden (Muster costTruing/costCrossCheck)");
  const depsStart = serverSrc.indexOf("const deps = {");
  assert.notEqual(depsStart, -1, "deps-Buendel nicht gefunden");
  const depsEnd = serverSrc.indexOf("};", depsStart);
  const depsBlock = serverSrc.slice(depsStart, depsEnd);
  assert.match(depsBlock, /\boutageWatch,/, "outageWatch fehlt im deps-Buendel");
});

test("E3B-01: boot.js reicht outageWatch aus dem deps-Buendel an runSweepTick weiter", () => {
  assert.match(bootSrc, /function runSweepTick\({[^}]*\boutageWatch\b[^}]*}\)/,
    "runSweepTick muss outageWatch destrukturieren");
  assert.match(bootSrc, /outageWatch\s*\n\s*\.runRecoverySweep\(\)/,
    "runSweepTick muss outageWatch.runRecoverySweep() tatsaechlich aufrufen");
  assert.match(bootSrc, /runSweepTick\({\s*costTruing,\s*provisioning,\s*costCrossCheck,\s*outageWatch,\s*paidWithoutNumberWatch,\s*provisionRetryWatch,\s*priceDriftWatch\s*}\)/,
    "der Sweep-Timer muss outageWatch, paidWithoutNumberWatch, provisionRetryWatch UND priceDriftWatch an runSweepTick durchreichen");
});

test("OUTBOUND-E4: server.js baut den echten aniOwnershipRecheck ueber providerConfigRead() und uebergibt ihn an makeOutboundGates", () => {
  assert.match(
    serverSrc,
    /import\s*{\s*makeAniOwnershipRecheck\s*}\s*from\s*"\.\/telephony\/ani-ownership-recheck\.js"/,
    "makeAniOwnershipRecheck muss importiert sein",
  );
  const gatesStart = serverSrc.indexOf(
    "const { gates: outboundGates, callQuotaDenial } = makeOutboundGates({",
  );
  assert.notEqual(gatesStart, -1, "makeOutboundGates(...)-Aufruf nicht gefunden");
  const gatesEnd = serverSrc.indexOf("});", gatesStart);
  const gatesBlock = serverSrc.slice(gatesStart, gatesEnd);
  assert.match(
    gatesBlock,
    /aniOwnershipRecheck:\s*makeAniOwnershipRecheck\(\s*{\s*telnyxRead\s*}\s*\)/,
    "aniOwnershipRecheck muss ueber makeAniOwnershipRecheck({ telnyxRead }) an makeOutboundGates uebergeben werden",
  );
  const telnyxReadDefIndex = serverSrc.indexOf("const telnyxRead = providerConfigRead();");
  assert.notEqual(telnyxReadDefIndex, -1, "telnyxRead muss ueber providerConfigRead() gebaut werden");
  assert.ok(telnyxReadDefIndex < gatesStart, "telnyxRead muss VOR makeOutboundGates(...) definiert sein");
});

test("GP-P0: server.js baut makePaidWithoutNumberWatch und reicht paidWithoutNumberWatch ins deps-Buendel durch", () => {
  assert.match(
    serverSrc,
    /import\s*{\s*makePaidWithoutNumberWatch\s*}\s*from\s*"\.\/billing\/paid-without-number-watch\.js"/,
    "makePaidWithoutNumberWatch muss importiert sein",
  );
  assert.match(serverSrc, /const paidWithoutNumberWatch = makePaidWithoutNumberWatch\(/,
    "paidWithoutNumberWatch muss EINMAL beim Boot konstruiert werden (Muster outageWatch)");
  const depsStart = serverSrc.indexOf("const deps = {");
  assert.notEqual(depsStart, -1, "deps-Buendel nicht gefunden");
  const depsEnd = serverSrc.indexOf("};", depsStart);
  const depsBlock = serverSrc.slice(depsStart, depsEnd);
  assert.match(depsBlock, /\bpaidWithoutNumberWatch,/, "paidWithoutNumberWatch fehlt im deps-Buendel");
});

test("GP-P0: boot.js destrukturiert paidWithoutNumberWatch und ruft runPaidWithoutNumberSweep() (achter Zweig)", () => {
  assert.match(bootSrc, /function runSweepTick\({[^}]*\bpaidWithoutNumberWatch\b[^}]*}\)/,
    "runSweepTick muss paidWithoutNumberWatch destrukturieren");
  assert.match(bootSrc, /paidWithoutNumberWatch\s*\n\s*\.runPaidWithoutNumberSweep\(\)/,
    "runSweepTick muss paidWithoutNumberWatch.runPaidWithoutNumberSweep() tatsaechlich aufrufen (achter Zweig)");
  assert.match(bootSrc, /export async function bootServer\({[^]*?\bpaidWithoutNumberWatch,[^]*?}\)/,
    "bootServer muss paidWithoutNumberWatch aus dem deps-Buendel destrukturieren");
});

test("GP-P4: server.js baut makeProvisionRetryWatch und reicht provisionRetryWatch ins deps-Buendel durch", () => {
  assert.match(
    serverSrc,
    /import\s*{\s*makeProvisionRetryWatch\s*}\s*from\s*"\.\/billing\/provision-retry-sweep\.js"/,
    "makeProvisionRetryWatch muss importiert sein",
  );
  assert.match(serverSrc, /const provisionRetryWatch = makeProvisionRetryWatch\(/,
    "provisionRetryWatch muss EINMAL beim Boot konstruiert werden (Muster paidWithoutNumberWatch)");
  const depsStart = serverSrc.indexOf("const deps = {");
  assert.notEqual(depsStart, -1, "deps-Buendel nicht gefunden");
  const depsEnd = serverSrc.indexOf("};", depsStart);
  const depsBlock = serverSrc.slice(depsStart, depsEnd);
  assert.match(depsBlock, /\bprovisionRetryWatch,/, "provisionRetryWatch fehlt im deps-Buendel");
});

test("GP-P4: boot.js destrukturiert provisionRetryWatch und ruft runProvisionRetrySweep() (neunter Zweig)", () => {
  assert.match(bootSrc, /function runSweepTick\({[^}]*\bprovisionRetryWatch\b[^}]*}\)/,
    "runSweepTick muss provisionRetryWatch destrukturieren");
  assert.match(bootSrc, /provisionRetryWatch\s*\n\s*\.runProvisionRetrySweep\(\)/,
    "runSweepTick muss provisionRetryWatch.runProvisionRetrySweep() tatsaechlich aufrufen (neunter Zweig)");
  assert.match(bootSrc, /export async function bootServer\({[^]*?\bprovisionRetryWatch,[^]*?}\)/,
    "bootServer muss provisionRetryWatch aus dem deps-Buendel destrukturieren");
});

test("GP-P6: server.js baut makePriceDriftWatch und reicht priceDriftWatch ins deps-Buendel durch", () => {
  assert.match(
    serverSrc,
    /import\s*{\s*makePriceDriftWatch\s*}\s*from\s*"\.\/billing\/price-drift-watch\.js"/,
    "makePriceDriftWatch muss importiert sein",
  );
  assert.match(serverSrc, /const priceDriftWatch = makePriceDriftWatch\(/,
    "priceDriftWatch muss EINMAL beim Boot konstruiert werden");
  assert.match(serverSrc, /lesePreis:\s*\(priceId\)\s*=>\s*stripeBilling\.retrievePriceAmount\(priceId\)/,
    "lesePreis muss der rein lesende Stripe-Abruf des bestehenden Adapters sein (kein zweiter HTTP-Client)");
  const depsStart = serverSrc.indexOf("const deps = {");
  assert.notEqual(depsStart, -1, "deps-Buendel nicht gefunden");
  const depsEnd = serverSrc.indexOf("};", depsStart);
  const depsBlock = serverSrc.slice(depsStart, depsEnd);
  assert.match(depsBlock, /\bpriceDriftWatch,/, "priceDriftWatch fehlt im deps-Buendel");
});

test("GP-P6: boot.js destrukturiert priceDriftWatch, ruft runPriceDriftSweep() (zehnter Zweig) UND runBootProbe()", () => {
  assert.match(bootSrc, /function runSweepTick\({[^}]*\bpriceDriftWatch\b[^}]*}\)/,
    "runSweepTick muss priceDriftWatch destrukturieren");
  assert.match(bootSrc, /priceDriftWatch\s*\n\s*\.runPriceDriftSweep\(\)/,
    "runSweepTick muss priceDriftWatch.runPriceDriftSweep() tatsaechlich aufrufen (zehnter Zweig)");
  assert.match(bootSrc, /export async function bootServer\({[^]*?\bpriceDriftWatch,[^]*?}\)/,
    "bootServer muss priceDriftWatch aus dem deps-Buendel destrukturieren");
  assert.match(bootSrc, /priceDriftWatch\.runBootProbe\(\)/,
    "bootServer muss priceDriftWatch.runBootProbe() im app.listen-Callback aufrufen (Boot-Lauf)");
});

const SWEEP_TAKT_MS = 61_000;
const KURZER_TAKT_MS = 50;
const WARTEFRIST = { timeout: 30_000 };
const AUSGABE_FRIST_MS = 15_000;
const TAG_MS = 86_400_000;
const HTTP_ANI_ABGELEHNT = 503;
const ANI_ABLEHNUNG = /Absendernummer der Plattform ist beim Anbieter nicht mehr verfuegbar/;
const PLATTFORM_ANI = "+13125550111";
const ZIEL = "+4915112345678";
const AUSFALL_EIMER = "not-placed:invite-403";
const ABWEICHENDER_PREIS = { unit_amount: 1, currency: "eur" };
const PREIS_ABWEICHUNG_BEIM_START =
  /\[price-drift\] anlass=boot geprueft=\d+ abweichungen=[1-9]\d* unbekannt=0/;

const taktVerkuerzen = [
  "const takt = Number(process.env.COST_TRUING_SWEEP_INTERVAL_MS);",
  "const echt = globalThis.setInterval;",
  `globalThis.setInterval = (fn, ms, ...rest) => echt(fn, ms === takt ? ${KURZER_TAKT_MS} : ms, ...rest);`,
].join("\n");
const SCHNELLER_TAKT = {
  COST_TRUING_SWEEP_INTERVAL_MS: String(SWEEP_TAKT_MS),
  OUTAGE_ALERT_SELF_TEST_INTERVAL_MS: String(TAG_MS),
  PAID_WITHOUT_NUMBER_GRACE_MS: String(TAG_MS),
  PROVISIONING_RETRY_MIN_INTERVAL_MS: String(TAG_MS),
  OUTAGE_ALERT_WINDOW_MS: String(TAG_MS),
  NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(taktVerkuerzen)}`,
};

async function mitAttrappe(antworten, ablauf) {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    anfragen.push(req.url);
    const treffer = antworten.find(([praefix]) => req.url.startsWith(praefix));
    res.writeHead(treffer ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(treffer ? treffer[1] : {}));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await ablauf({ url: `http://127.0.0.1:${server.address().port}`, anfragen });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function mitServer(optionen, ablauf) {
  const srv = await startServer(optionen);
  try {
    return await ablauf(srv);
  } finally {
    await srv.stop();
  }
}

function warteAufAusgabe(srv, zeile) {
  const frist = AbortSignal.timeout(AUSGABE_FRIST_MS);
  return new Promise((resolve, reject) => {
    const aufhoeren = () => {
      frist.removeEventListener("abort", abbrechen);
      srv.child.stdout.off("data", pruefen);
      srv.child.stderr.off("data", pruefen);
    };
    const abbrechen = () => {
      aufhoeren();
      reject(new Error(`keine Ausgabe "${zeile}" binnen ${AUSGABE_FRIST_MS} ms:\n${srv.stdout}`));
    };
    const pruefen = () => {
      if (!srv.stdout.includes(zeile)) return;
      aufhoeren();
      resolve();
    };
    frist.addEventListener("abort", abbrechen);
    srv.child.stdout.on("data", pruefen);
    srv.child.stderr.on("data", pruefen);
    pruefen();
  });
}

function standMitErholtemAusfall() {
  const stand = seedState();
  const vorhin = new Date(Date.now() - 60_000).toISOString();
  stand.outageAlerts = [
    { code: AUSFALL_EIMER, firstSeenAt: vorhin, lastSeenAt: vorhin, closedAt: null },
  ];
  stand.calls = [
    {
      id: "call_ok",
      direction: "outbound",
      to: ZIEL,
      endedAt: vorhin,
      answeredAt: vorhin,
      failureReason: null,
    },
  ];
  return stand;
}

const stripeEnv = (stripeUrl) => ({
  PAYMENT_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test_x",
  STRIPE_API_BASE: stripeUrl,
  NUMBER_SETUP_FEE_CENTS: "500",
  PRICE_DRIFT_MIN_INTERVAL_MS: "1",
  ...PLAN_PRICE_BOOT_ENV,
});

test(
  "E3B-01 / GP-P0 / GP-P4 / GP-P6: der laufende Server ruft im Sweep-Takt jede Wache auf",
  WARTEFRIST,
  () =>
    mitAttrappe([], (stripe) =>
      mitServer(
        { seed: standMitErholtemAusfall(), env: { ...SCHNELLER_TAKT, ...stripeEnv(stripe.url) } },
        async (srv) => {
          for (const zeile of [
            `[outage] outage_recovered klasse=${AUSFALL_EIMER}`,
            "[outage] alert_channel_self_test",
            "[paid-no-number] kandidaten=",
            "[provision-retry-sweep] geprueft=",
            "[price-drift] anlass=sweep",
          ])
            await warteAufAusgabe(srv, zeile);
        },
      ),
    ),
);

test(
  "GP-P6: beim Start fragt die Preissonde die Tarifpreise ueber den Stripe-Adapter ab",
  WARTEFRIST,
  () =>
    mitAttrappe([["/v1/prices/", ABWEICHENDER_PREIS]], (stripe) =>
      mitServer({ env: stripeEnv(stripe.url) }, async (srv) => {
        await warteAufAusgabe(srv, "[price-drift] anlass=boot");
        assert.match(srv.stdout, PREIS_ABWEICHUNG_BEIM_START, srv.stdout);
        for (const preis of Object.values(PLAN_PRICE_BOOT_ENV))
          assert.ok(
            stripe.anfragen.some((anfrage) => anfrage.endsWith(`/prices/${preis}`)),
            `kein Abruf von ${preis}: ${stripe.anfragen.join(", ")}`,
          );
      }),
    ),
);

function aniStand() {
  const stand = seedState();
  stand.outageAlerts = [
    { code: "drift:ownership_lost", closedAt: null, lastSeenAt: new Date().toISOString() },
  ];
  return stand;
}

function anrufMitNachmessung(telnyxNummern) {
  return mitAttrappe([["/v2/phone_numbers", { data: telnyxNummern }]], (telnyx) =>
    mitServer(
      {
        seed: aniStand(),
        env: {
          OUTBOUND_ANI_GATE_ENABLED: "true",
          PLATFORM_ANI_E164: PLATTFORM_ANI,
          ALLOWED_NUMBERS: ZIEL,
          TELNYX_API_KEY: "KEYtest-secret",
          TELNYX_CONNECTION_ID: "conn_test",
          TELNYX_ACCOUNT_SID: "acct_test",
          TELNYX_API_BASE: telnyx.url,
        },
      },
      async (srv) => {
        const antwort = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: ZIEL, objective: "Termin vereinbaren" }),
        });
        return {
          status: antwort.status,
          text: await antwort.text(),
          anfragen: [...telnyx.anfragen],
        };
      },
    ),
  );
}

test("OUTBOUND-E4: der laufende Server misst die Absendernummer beim Anbieter nach und lehnt bei Verlust ab", async () => {
  const verloren = await anrufMitNachmessung([]);
  assert.equal(verloren.status, HTTP_ANI_ABGELEHNT, verloren.text);
  assert.match(verloren.text, ANI_ABLEHNUNG);
  assert.ok(
    verloren.anfragen.some((anfrage) => anfrage.includes(encodeURIComponent(PLATTFORM_ANI))),
    verloren.anfragen.join(", "),
  );
  const besessen = await anrufMitNachmessung([{ phone_number: PLATTFORM_ANI, status: "active" }]);
  assert.notEqual(besessen.status, HTTP_ANI_ABGELEHNT, besessen.text);
  assert.doesNotMatch(besessen.text, ANI_ABLEHNUNG);
});
