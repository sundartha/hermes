import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const SEITENGROESSE = 20;
const EINTRAEGE_GESAMT = 25;
const EINTRAEGE_HINTER_DER_ERSTEN_SEITE = EINTRAEGE_GESAMT - SEITENGROESSE;
const SEHR_GROSSES_OFFSET = 1000000;
const OFFSET_FEHLER = "offset muss eine ganze Zahl ab 0 sein";
const MINUTE_MS = 60_000;
const ERSTER_START_MS = Date.parse("2026-08-21T08:00:00.000Z");
const CALLER = "+4915112345678";
const EINGETRAGEN = "2026-08-21T10:00:00.000Z";
const GESEHEN = "2026-08-21T11:00:00.000Z";

function eintragsId(index) {
  return `call_seite_${String(index).padStart(2, "0")}`;
}

function seedEintraege({ gesehen }) {
  const calls = Array.from({ length: EINTRAEGE_GESAMT }, (_, index) =>
    seedCall({
      id: eintragsId(index),
      direction: "inbound",
      from: CALLER,
      status: "completed",
      startedAt: new Date(ERSTER_START_MS + index * MINUTE_MS).toISOString(),
      summary: `Anliegen ${index}`,
      inboxEntryAt: EINGETRAGEN,
      inboxSeenAt: gesehen ? GESEHEN : null,
    }),
  );
  return seedState({ calls });
}

function idsVon(von, bis) {
  return Array.from({ length: bis - von }, (_, index) => eintragsId(von + index));
}

function poll(srv, body) {
  return abrufMitFrist(`${srv.localUrl}/api/inbox/poll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function mitServer({ gesehen }, ablauf) {
  const srv = await startServer({ seed: seedEintraege({ gesehen }) });
  try {
    await ablauf(srv);
  } finally {
    await srv.stop();
  }
}

const callIds = (body) => body.entries.map((entry) => entry.call_id);

test("Rückschau mit offset 20 liefert die 5 jüngsten Einträge hinter der ersten Seite", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const res = await poll(srv, { include_seen: true, offset: SEITENGROESSE });
    assert.equal(res.status, HTTP_OK);
    const body = await res.json();
    assert.equal(body.remaining, 0, `remaining ${body.remaining} !== 0`);
    assert.deepEqual(callIds(body), idsVon(SEITENGROESSE, EINTRAEGE_GESAMT));
  });
});

test("Rückschau mit negativem offset wird mit 400 abgelehnt", async () => {
  await mitServer({ gesehen: false }, async (srv) => {
    const res = await poll(srv, { include_seen: true, offset: -1 });
    assert.equal(res.status, HTTP_BAD_REQUEST);
    assert.deepEqual(await res.json(), { error: OFFSET_FEHLER });
  });
});

test("include_seen als Text ignoriert offset und markiert nur die 20 gelieferten Einträge", async () => {
  await mitServer({ gesehen: false }, async (srv) => {
    const first = await poll(srv, { include_seen: "true", offset: SEITENGROESSE });
    assert.equal(first.status, HTTP_OK);
    const firstBody = await first.json();
    assert.deepEqual(callIds(firstBody), idsVon(0, SEITENGROESSE));
    assert.equal(firstBody.remaining, EINTRAEGE_HINTER_DER_ERSTEN_SEITE);

    const second = await poll(srv, {});
    const secondBody = await second.json();
    assert.deepEqual(callIds(secondBody), idsVon(SEITENGROESSE, EINTRAEGE_GESAMT));
  });
});

test("[NIE1] ohne include_seen ignoriert der Abruf offset und markiert die gelieferten Einträge als gesehen", async () => {
  await mitServer({ gesehen: false }, async (srv) => {
    const first = await (await poll(srv, { offset: SEITENGROESSE })).json();
    assert.deepEqual(callIds(first), idsVon(0, SEITENGROESSE));
    const second = await (await poll(srv, {})).json();
    assert.deepEqual(callIds(second), idsVon(SEITENGROESSE, EINTRAEGE_GESAMT));
    const third = await (await poll(srv, {})).json();
    assert.deepEqual(third.entries, []);
  });
});

test("[NIE2] ohne offset bleibt es bei einer Seite von 20 und dem Rest aus dem Store", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const body = await (await poll(srv, { include_seen: true })).json();
    assert.deepEqual(callIds(body), idsVon(0, SEITENGROESSE));
    assert.equal(body.remaining, EINTRAEGE_HINTER_DER_ERSTEN_SEITE);
  });
});

test("[NIE3] offset als Text, Bruch oder negative Zahl ergibt 400 mit Fehlertext", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    for (const offset of ["20", 1.5, -1]) {
      const res = await poll(srv, { include_seen: true, offset });
      assert.equal(res.status, HTTP_BAD_REQUEST, `offset ${JSON.stringify(offset)}`);
      assert.deepEqual(await res.json(), { error: OFFSET_FEHLER });
    }
  });
});

test("[NIE4] sehr großes offset liefert 200 mit leerer Liste und remaining 0", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const res = await poll(srv, { include_seen: true, offset: SEHR_GROSSES_OFFSET });
    assert.equal(res.status, HTTP_OK);
    assert.deepEqual(await res.json(), { entries: [], remaining: 0 });
  });
});

test("[NIE5] ohne offset liefert der Abruf mit include_seen genau die erste Seite", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const body = await (await poll(srv, { include_seen: true })).json();
    assert.equal(body.entries.length, SEITENGROESSE);
    assert.equal(body.remaining, EINTRAEGE_HINTER_DER_ERSTEN_SEITE);
  });
});

test("[NIE6] der Abruf ohne include_seen liefert weiter 20 Einträge und Rest 5", async () => {
  await mitServer({ gesehen: false }, async (srv) => {
    const body = await (await poll(srv, {})).json();
    assert.deepEqual(callIds(body), idsVon(0, SEITENGROESSE));
    assert.equal(body.remaining, EINTRAEGE_HINTER_DER_ERSTEN_SEITE);
  });
});

test("[NIE7] die Audit-Zeile bleibt ein Zähler und nennt offset nicht", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const offset = 7;
    await poll(srv, { include_seen: true, offset });
    const zeile = srv.stdout.split("\n").find((text) => text.includes("[audit] inbox_poll "));
    assert.ok(zeile, "Audit-Zeile fehlt");
    assert.match(zeile, /neu=\d+ rest=\d+$/);
    assert.ok(!zeile.includes("offset"));
  });
});

test("[NIE8] die Antwort besteht nur aus entries und remaining", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const body = await (await poll(srv, { include_seen: true, offset: SEITENGROESSE })).json();
    assert.deepEqual(Object.keys(body).sort(), ["entries", "remaining"]);
  });
});

test("[NIE9] ein offset im verbrauchenden Abruf markiert übersprungene Einträge nicht als gesehen", async () => {
  await mitServer({ gesehen: false }, async (srv) => {
    await poll(srv, { offset: SEITENGROESSE });
    const rueckschau = await (await poll(srv, { include_seen: true })).json();
    assert.equal(rueckschau.entries.length, SEITENGROESSE);
    const verbrauch = await (await poll(srv, {})).json();
    assert.deepEqual(callIds(verbrauch), idsVon(SEITENGROESSE, EINTRAEGE_GESAMT));
  });
});

test("[NIE10] offset als Text bleibt abgelehnt und wird nicht in eine Zahl umgewandelt", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const res = await poll(srv, { include_seen: true, offset: "0" });
    assert.equal(res.status, HTTP_BAD_REQUEST);
    assert.deepEqual(await res.json(), { error: OFFSET_FEHLER });
  });
});

test("[NIE11] sehr großes offset lässt remaining 0 aus der Store-Abfrage kommen", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const body = await (
      await poll(srv, { include_seen: true, offset: EINTRAEGE_GESAMT + SEITENGROESSE })
    ).json();
    assert.equal(body.entries.length, 0);
    assert.equal(body.remaining, 0);
  });
});

test("[NIE12] offset als Bruch wird mit 400 abgelehnt statt abgerundet", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const res = await poll(srv, { include_seen: true, offset: 1.5 });
    assert.equal(res.status, HTTP_BAD_REQUEST);
    assert.deepEqual(await res.json(), { error: OFFSET_FEHLER });
  });
});

test("[NIE13] check_inbox-Abruf ohne offset liefert unverändert die erste Seite", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const body = await (await poll(srv, { include_seen: true })).json();
    assert.deepEqual(callIds(body), idsVon(0, SEITENGROESSE));
  });
});

test("[NIE14] die Fortsetzung zählt Stellen, ein Cursor-Feld im Body bleibt wirkungslos", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const body = await (await poll(srv, { include_seen: true, cursor: "x" })).json();
    assert.deepEqual(callIds(body), idsVon(0, SEITENGROESSE));
  });
});

test("[NIE15] offset ohne include_seen wird nicht gelesen, auch ein ungültiges offset nicht", async () => {
  await mitServer({ gesehen: false }, async (srv) => {
    const res = await poll(srv, { offset: -1 });
    assert.equal(res.status, HTTP_OK);
    assert.deepEqual(callIds(await res.json()), idsVon(0, SEITENGROESSE));
  });
});

test("[NIE16] ein limit vom Aufrufer ändert die Seitengröße von 20 nicht", async () => {
  const angefragtesLimit = 50;
  const faelle = [
    { gesehen: true, body: { include_seen: true, limit: angefragtesLimit } },
    { gesehen: false, body: { limit: angefragtesLimit } },
  ];
  for (const { gesehen, body } of faelle) {
    await mitServer({ gesehen }, async (srv) => {
      const antwort = await (await poll(srv, body)).json();
      assert.equal(antwort.entries.length, SEITENGROESSE);
      assert.equal(antwort.remaining, EINTRAEGE_HINTER_DER_ERSTEN_SEITE);
    });
  }
});

test("[NIE17] offset zählt nur Stellen, ein Cursor ändert die gelieferte Seite nicht", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const ohneCursor = await (await poll(srv, { include_seen: true, offset: SEITENGROESSE })).json();
    const mitCursor = await (
      await poll(srv, { include_seen: true, offset: SEITENGROESSE, cursor: "x" })
    ).json();
    assert.deepEqual(mitCursor, ohneCursor);
    assert.deepEqual(callIds(mitCursor), idsVon(SEITENGROESSE, EINTRAEGE_GESAMT));
  });
});

const UNGUELTIGE_OFFSETS = Object.freeze([-1, 1.5, "20"]);

test("[NIE1] ungültiges offset antwortet 400 mit bisherigem Text und markiert keinen Eintrag als gesehen", async () => {
  await mitServer({ gesehen: false }, async (srv) => {
    for (const offset of UNGUELTIGE_OFFSETS) {
      const res = await poll(srv, { include_seen: true, offset });
      assert.equal(res.status, HTTP_BAD_REQUEST, `offset ${JSON.stringify(offset)}`);
      assert.deepEqual(
        await res.json(),
        { error: OFFSET_FEHLER },
        `offset ${JSON.stringify(offset)}`,
      );
    }
    const verbrauch = await (await poll(srv, {})).json();
    assert.deepEqual(callIds(verbrauch), idsVon(0, SEITENGROESSE));
    assert.equal(verbrauch.remaining, EINTRAEGE_HINTER_DER_ERSTEN_SEITE);
  });
});

const KARTEN_TENANT = "owner";
const KARTEN_SUB = "sub-nie2";
const STRIPE_KUNDE = "cus_nie2";
const STRIPE_KARTE = "pm_nie2";
const SESSION_FEHLER = "session_id ist Pflicht";
const UNGUELTIGE_SESSION_ANFRAGEN = Object.freeze([
  ["ohne session_id", ""],
  ["leere session_id", "session_id="],
  ["doppelte session_id", "session_id=cs_nie2_a&session_id=cs_nie2_b"],
]);

async function starteStripeAttrappe() {
  const { createServer } = await import("node:http");
  const sitzungsAbrufe = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.url.startsWith("/v1/checkout/sessions/")) sitzungsAbrufe.push(req.url);
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ customer: STRIPE_KUNDE, setup_intent: { payment_method: STRIPE_KARTE } }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    sitzungsAbrufe,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function mitZahlungsServer(ablauf) {
  const { PLAN_PRICE_BOOT_ENV } = await import("../helpers.js");
  const stripe = await starteStripeAttrappe();
  const srv = await startServer({
    env: {
      MULTI_TENANT: "true",
      PAYMENT_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_nie2",
      STRIPE_WEBHOOK_SECRET: "whsec_test_nie2",
      STRIPE_API_BASE: stripe.url,
      NUMBER_SETUP_FEE_CENTS: "500",
      ...PLAN_PRICE_BOOT_ENV,
    },
    seed: seedState({
      tenants: [
        {
          id: KARTEN_TENANT,
          status: "active",
          idpSubject: KARTEN_SUB,
          stripeCustomerId: STRIPE_KUNDE,
        },
      ],
    }),
  });
  try {
    await ablauf(srv, stripe);
  } finally {
    await srv.stop();
    await stripe.close();
  }
}

const kartenRueckweg = (srv, query) =>
  abrufMitFrist(`${srv.localUrl}/api/billing/checkout-return?${query}`, {
    headers: { "X-Internal-Identity": KARTEN_SUB },
  });
const kartenTenant = (srv) => srv.readStore().tenants.find((tenant) => tenant.id === KARTEN_TENANT);

test("[NIE2] Stripe-Rückweg ohne, mit leerer oder doppelter session_id antwortet 400 mit bisherigem Text und bindet keine Karte", async () => {
  await mitZahlungsServer(async (srv, stripe) => {
    for (const [fall, query] of UNGUELTIGE_SESSION_ANFRAGEN) {
      const res = await kartenRueckweg(srv, query);
      assert.equal(res.status, HTTP_BAD_REQUEST, fall);
      assert.deepEqual(await res.json(), { error: SESSION_FEHLER }, fall);
    }
    assert.deepEqual(stripe.sitzungsAbrufe, []);
    assert.equal(kartenTenant(srv).stripePaymentMethodId, undefined);

    const gueltig = await kartenRueckweg(srv, "session_id=cs_nie2_ok");
    assert.equal(gueltig.status, HTTP_OK);
    assert.equal(kartenTenant(srv).stripePaymentMethodId, STRIPE_KARTE);
  });
});

const IDENTITAET_MAX_LAENGE = 254;
const IDENTITAET_REGEL = `(nicht leer, ohne Whitespace, <=${IDENTITAET_MAX_LAENGE} Zeichen)`;
const TENANT_FEHLER = `tenantId ist Pflicht ${IDENTITAET_REGEL}`;
const SUBJECT_FEHLER = `idpSubject ungueltig ${IDENTITAET_REGEL}`;
const GUELTIGER_BODY_TENANT = "t_nie3_body";
const KONTROLL_TENANT = "t_nie3_kontrolle";
const LEERZEICHEN_TENANT = "t nie3 leer";
const ZU_LANGER_TENANT = "t".repeat(IDENTITAET_MAX_LAENGE + 1);
const UNGUELTIGE_ONBOARD_KOERPER = Object.freeze([
  ["tenantId fehlt", {}, TENANT_FEHLER],
  ["tenantId leer", { tenantId: "" }, TENANT_FEHLER],
  ["tenantId mit Leerzeichen", { tenantId: LEERZEICHEN_TENANT }, TENANT_FEHLER],
  ["tenantId zu lang", { tenantId: ZU_LANGER_TENANT }, TENANT_FEHLER],
  ["tenantId als Zahl", { tenantId: 42 }, TENANT_FEHLER],
  ["idpSubject leer", { idpSubject: "", tenantId: GUELTIGER_BODY_TENANT }, SUBJECT_FEHLER],
  [
    "idpSubject mit Leerzeichen",
    { idpSubject: "sub nie3", tenantId: GUELTIGER_BODY_TENANT },
    SUBJECT_FEHLER,
  ],
  ["idpSubject als Zahl", { idpSubject: 42, tenantId: GUELTIGER_BODY_TENANT }, SUBJECT_FEHLER],
]);
const ONBOARD_FRIST_MS = 5000;
const ONBOARD_TAKT_MS = 20;

async function tenantZeilen(hermes, tenantId) {
  const { rows } = await hermes.db.query("SELECT id FROM tenant WHERE id = $1", [tenantId]);
  return rows.length;
}

function nummernZeilen(hermes, tenantId) {
  return hermes.db.transaction(async (tx) => {
    await tx.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    const { rows } = await tx.query("SELECT id FROM number WHERE tenant_id = $1", [tenantId]);
    return rows.length;
  });
}

async function warteAufNummer(hermes, tenantId) {
  const { echtWarten } = await import("../echt-warten.js");
  const frist = Date.now() + ONBOARD_FRIST_MS;
  while ((await nummernZeilen(hermes, tenantId)) === 0) {
    if (Date.now() > frist)
      throw new Error(
        `Testaufbau: Kontroll-Onboarding von ${tenantId} kam nicht in der Datenbank an`,
      );
    await echtWarten(ONBOARD_TAKT_MS);
  }
}

test("[NIE3] POST /api/onboard mit ungültiger idpSubject oder tenantId antwortet 400 mit bisherigem Text und legt weder Tenant noch Nummer an", async () => {
  const { starteHermesMitPglite, LOGIN_SUB } =
    await import("../abrechnung/server-mit-testdatenbank.js");
  const hermes = (await starteHermesMitPglite({ alarmPostfach: "postfach@nie3.invalid" }))();
  const { sessionCookie } = await hermes.anmelden();
  await hermes.db.query(
    "UPDATE tenant SET status = 'active' WHERE id IN (SELECT tenant_id FROM account WHERE sub = $1)",
    [LOGIN_SUB],
  );
  const onboard = (koerper) =>
    hermes.anfrage("/api/onboard", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify(koerper),
    });

  for (const [fall, koerper, fehler] of UNGUELTIGE_ONBOARD_KOERPER) {
    const res = await onboard(koerper);
    assert.equal(res.status, HTTP_BAD_REQUEST, fall);
    assert.deepEqual(await res.json(), { error: fehler }, fall);
  }

  const kontrolle = await onboard({ tenantId: KONTROLL_TENANT });
  assert.equal(kontrolle.status, HTTP_OK);
  await warteAufNummer(hermes, KONTROLL_TENANT);
  assert.equal(await tenantZeilen(hermes, KONTROLL_TENANT), 1);

  for (const tenantId of [GUELTIGER_BODY_TENANT, LEERZEICHEN_TENANT, ZU_LANGER_TENANT, ""]) {
    assert.equal(await tenantZeilen(hermes, tenantId), 0, `Tenant ${tenantId}`);
    assert.equal(await nummernZeilen(hermes, tenantId), 0, `Nummer ${tenantId}`);
  }
});
