// Kuendigung ohne Anmeldung (§ 312k BGB) - oeffentliches Formular auf sundartha.com.
// Reine Pruefung (parseCancellationDeclaration) + Kompositions-Integrationstest ueber die
// echte Route auf pglite (offline, kein Server-Spawn; Muster 312k-p3-self-service-cancel).
// Kern der Abwaegung, die hier festgehalten wird: der Selbstlaeufer macht genau das, was
// der Knopf im Kundenbereich tut; alles andere landet bei einem Menschen; die Antwort
// verraet nie, ob eine Email Kunde ist; Mails gehen nie an die Formular-Adresse.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { makeAccounts } from "../src/web-auth.js";
import { makeTenantByEmail } from "../src/account-email-lookup.js";
import { makeAuditStore } from "../src/audit-store.js";
import {
  makePublicCancellationRoutes,
  PUBLIC_CANCELLATION_PATH,
  CANCELLATION_FORM_ORIGINS,
} from "../src/public-cancellation-routes.js";
import {
  parseCancellationDeclaration,
  isCalendarDate,
} from "../src/billing/public-cancellation.js";
import * as ops from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SUB = "sub-pc";
const TENANT = "t_sub-pc";
const ACCOUNT_EMAIL = "kunde@beispiel.de";
const INBOX = "kontakt@sundartha.com";
const PERIOD_END = 1896134400;
const LIVE_ORIGIN = CANCELLATION_FORM_ORIGINS[0];
const HTTP = Object.freeze({ OK: 200, BAD_REQUEST: 400, TOO_MANY: 429, UNAVAILABLE: 503 });

const ORDINARY = Object.freeze({
  name: "Kim Kunde",
  email: ACCOUNT_EMAIL,
  kind: "ordinary",
  timing: "next",
});

function fakeBilling(spy) {
  return {
    scheduleCancellation: async (params) => {
      spy.push(params);
      return {
        subscriptionId: params.subscriptionId,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: PERIOD_END,
      };
    },
  };
}

function fakeMailer(sent, { failing = false } = {}) {
  return {
    sendMail: async (mail) => {
      if (failing) throw Object.assign(new Error("down"), { code: "EDOWN" });
      sent.push(mail);
    },
  };
}

async function setup({ withSubscription = true, mailer = "ok" } = {}) {
  const { store, db, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const auditStore = makeAuditStore(runner);
  ops.registerTenant(store.load(), TENANT, { firstName: "Kim", lastName: "Kunde" });
  await accounts.upsertOnFirstLogin({ sub: SUB, email: ACCOUNT_EMAIL });
  if (withSubscription) {
    store.setTenantSubscription(TENANT, {
      subscriptionId: "sub_pc1",
      planSlug: "starter",
      currentPeriodEnd: PERIOD_END,
    });
  }
  const scheduled = [];
  const sent = [];
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.urlencoded({ extended: false }));
  app.use(
    makePublicCancellationRoutes({
      store,
      billing: fakeBilling(scheduled),
      accounts,
      tenantByEmail: makeTenantByEmail(runner),
      auditStore,
      mailer: mailer ? fakeMailer(sent, { failing: mailer === "failing" }) : null,
      config: withConfigNamespaces({
        paymentEnabled: true,
        mailFrom: INBOX,
        publicUrl: "https://app.example",
      }),
    }),
  );
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}${PUBLIC_CANCELLATION_PATH}`,
    store,
    db,
    scheduled,
    sent,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function submit(lab, fields, { origin = LIVE_ORIGIN } = {}) {
  const res = await fetch(lab.url, {
    method: "POST",
    headers: { Origin: origin },
    body: new URLSearchParams(fields),
  });
  return {
    status: res.status,
    cors: res.headers.get("access-control-allow-origin"),
    body: await res.json(),
  };
}

async function auditActions(lab) {
  const { rows } = await lab.db.query(
    `SELECT action, tenant_id, detail FROM audit_log ORDER BY id`,
  );
  return rows;
}

const mailsTo = (lab, to) => lab.sent.filter((mail) => mail.to === to);

test("Formular-Pruefung: vollstaendige ordentliche Kuendigung wird angenommen und normalisiert", () => {
  const { declaration } = parseCancellationDeclaration({
    ...ORDINARY,
    email: "  Kunde@Beispiel.DE ",
  });
  assert.equal(declaration.email, ACCOUNT_EMAIL);
  assert.equal(declaration.reason, "");
});

test("Formular-Pruefung: jedes fehlerhafte Feld wird einzeln benannt", () => {
  const { invalid } = parseCancellationDeclaration({
    name: "K",
    email: "kein-mail",
    kind: "x",
    timing: "y",
  });
  assert.deepEqual(invalid, ["name", "email", "kind", "timing"]);
});

test("Formular-Pruefung: ausserordentlich verlangt einen Grund, Wunschtermin ein echtes Datum", () => {
  const { invalid } = parseCancellationDeclaration({
    ...ORDINARY,
    kind: "extraordinary",
    timing: "date",
    date: "2026-02-31",
  });
  assert.deepEqual(invalid, ["reason", "date"]);
  assert.equal(isCalendarDate("2026-12-31"), true);
});

test("Selbstlaeufer: bekannte Konto-Email kuendigt zum Periodenende, Bestaetigung an die Konto-Adresse", async () => {
  const lab = await setup();
  try {
    const res = await submit(lab, ORDINARY);
    assert.equal(res.status, HTTP.OK);
    assert.ok(res.body.receivedAt, "Eingangszeitpunkt fehlt");
    assert.equal(lab.scheduled.length, 1);
    assert.equal(lab.store.tenantSubscription(TENANT).cancelAtPeriodEnd, true);
    assert.equal(mailsTo(lab, ACCOUNT_EMAIL).length, 1, "Kuendigungsbestaetigung fehlt");
    assert.equal(mailsTo(lab, INBOX).length, 0, "Selbstlaeufer braucht keinen Menschen");
    assert.deepEqual(
      (await auditActions(lab)).map((row) => row.action),
      ["public_cancel_scheduled", "cancellation_mail_sent"],
    );
  } finally {
    await lab.close();
  }
});

test("Selbstlaeufer: eine zweite Einsendung ist idempotent (kein zweiter Stripe-Call, keine zweite Mail)", async () => {
  const lab = await setup();
  try {
    await submit(lab, ORDINARY);
    const again = await submit(lab, ORDINARY);
    assert.equal(again.status, HTTP.OK);
    assert.equal(lab.scheduled.length, 1);
    assert.equal(lab.sent.length, 1);
  } finally {
    await lab.close();
  }
});

test("Weitergabe: unbekannte Email -> gleiche Antwort, Erklaerung ans Kundenpostfach, NIE an die Formular-Adresse", async () => {
  const lab = await setup();
  try {
    const stranger = "fremd@example.org";
    const res = await submit(lab, { ...ORDINARY, email: stranger });
    assert.equal(res.status, HTTP.OK);
    assert.deepEqual(
      Object.keys(res.body),
      ["receivedAt"],
      "Antwort darf keine Konto-Zuordnung verraten",
    );
    assert.equal(lab.scheduled.length, 0);
    assert.equal(mailsTo(lab, stranger).length, 0);
    const [notice] = mailsTo(lab, INBOX);
    assert.match(notice.text, /Kim Kunde/);
    assert.match(notice.text, /fremd@example\.org/);
    const [row] = await auditActions(lab);
    assert.equal(row.action, "public_cancel_forwarded");
    assert.doesNotMatch(row.detail, /@/, "keine Email im audit_log (Regel 4)");
  } finally {
    await lab.close();
  }
});

test("Weitergabe: ausserordentliche Kuendigung wird nicht automatisch vorgemerkt, Eingang an die Konto-Adresse", async () => {
  const lab = await setup();
  try {
    const res = await submit(lab, {
      ...ORDINARY,
      kind: "extraordinary",
      reason: "Umzug ins Ausland",
    });
    assert.equal(res.status, HTTP.OK);
    assert.equal(lab.scheduled.length, 0);
    assert.match(mailsTo(lab, INBOX)[0].text, /Grund: Umzug ins Ausland/);
    assert.match(mailsTo(lab, ACCOUNT_EMAIL)[0].text, /außerordentliche Kündigung/);
  } finally {
    await lab.close();
  }
});

test("Weitergabe: ohne erreichbares Kundenpostfach 503 - der Kunde sieht nie ein falsches 'eingegangen'", async () => {
  const lab = await setup({ mailer: "failing" });
  try {
    const res = await submit(lab, { ...ORDINARY, email: "fremd@example.org" });
    assert.equal(res.status, HTTP.UNAVAILABLE);
    assert.equal((await auditActions(lab))[0].action, "public_cancel_forward_failed");
  } finally {
    await lab.close();
  }
});

test("Honeypot: ausgefuelltes Verstecktfeld -> gleiche Antwort, aber keine Wirkung", async () => {
  const lab = await setup();
  try {
    const res = await submit(lab, { ...ORDINARY, website: "http://spam.example" });
    assert.equal(res.status, HTTP.OK);
    assert.equal(lab.scheduled.length, 0);
    assert.equal(lab.sent.length, 0);
  } finally {
    await lab.close();
  }
});

test("Eingabefehler -> 400 mit den betroffenen Feldern", async () => {
  const lab = await setup();
  try {
    const res = await submit(lab, { ...ORDINARY, email: "nope" });
    assert.equal(res.status, HTTP.BAD_REQUEST);
    assert.deepEqual(res.body.fields, ["email"]);
  } finally {
    await lab.close();
  }
});

test("CORS: nur die Formular-Seiten duerfen die Antwort lesen", async () => {
  const lab = await setup();
  try {
    assert.equal((await submit(lab, ORDINARY)).cors, LIVE_ORIGIN);
    assert.equal((await submit(lab, ORDINARY, { origin: "https://evil.example" })).cors, null);
  } finally {
    await lab.close();
  }
});

test("Drossel: die sechste Einsendung einer IP binnen 15 Minuten -> 429", async () => {
  const lab = await setup();
  const ATTEMPTS_ALLOWED = 5;
  try {
    for (let i = 0; i < ATTEMPTS_ALLOWED; i++) await submit(lab, { ...ORDINARY, email: "nope" });
    assert.equal((await submit(lab, ORDINARY)).status, HTTP.TOO_MANY);
  } finally {
    await lab.close();
  }
});

test("Konto-Zuordnung: dieselbe Email an zwei Tenants ist mehrdeutig -> keine Zuordnung", async () => {
  const { runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const tenantByEmail = makeTenantByEmail(runner);
  await accounts.upsertOnFirstLogin({ sub: "sub-a", email: "doppelt@beispiel.de" });
  assert.equal(await tenantByEmail("Doppelt@Beispiel.de"), "t_sub-a");
  await runner.withClient(async (client) => {
    await client.query(`INSERT INTO tenant (id, status) VALUES ('t_sub-b', 'active')`);
    await client.query(
      `INSERT INTO account (sub, tenant_id, email, role) VALUES ('sub-b', 't_sub-b', 'doppelt@beispiel.de', 'member')`,
    );
  });
  assert.equal(await tenantByEmail("doppelt@beispiel.de"), null);
});

test("Formular-Ziel: CANCELLATION_URL der Website endet auf PUBLIC_CANCELLATION_PATH", async () => {
  process.env.PUBLIC_GATEWAY_URL ??= "https://gateway.example";
  const { CANCELLATION_URL } = await import("../apps/web/src/lib/routes.js");
  assert.equal(CANCELLATION_URL, `${process.env.PUBLIC_GATEWAY_URL}${PUBLIC_CANCELLATION_PATH}`);
});
