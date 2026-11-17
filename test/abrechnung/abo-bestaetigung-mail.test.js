import assert from "node:assert/strict";
import { test } from "node:test";

import request from "../gemeinsam/testserver-anfrage.mjs";
import { makePgTestStore } from "../pg-helpers.js";
import {
  SESSION_COOKIE_NAME,
  webAuth,
  webAuthAllowPending,
  makeAccounts,
  makeSessions,
  signValue,
} from "../../src/web-auth.js";
import { makeSelfServiceRoutes } from "../../src/self-service-routes.js";
import { startRouterApp } from "../operator-route-app.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const SECRET = "wb2-mail-secret-0123456789abcdef";
const SUB = "sub-wb2";
const TENANT = "t_sub-wb2";
const EMAIL = "wb2@kundin.de";
const CUSTOMER = "cus_wb2";
const SESSION = "cs_wb2";
const ZUSTIMMUNG_AT = "2026-11-17T09:30:00.000Z";
const CONFIG = {
  paymentEnabled: true,
  publicUrl: "https://test.local",
  stripeStarterPriceId: "price_starter",
  stripeBusinessPriceId: "price_business",
  stripeCustomerRetryDelayMs: 0,
};
const DE_ZUSTIMMUNG =
  "Ich verlange ausdrücklich, dass Sundartha vor Ablauf der Widerrufsfrist mit der Leistung beginnt. Mir ist bekannt, dass ich bei Widerruf einen anteiligen Wertersatz für die bis dahin erbrachte Leistung zahle und mein Widerrufsrecht bei vollständiger Erfüllung erlischt.";

function fakeBilling(planSlug) {
  return {
    getSubscriptionCheckoutResult: async () => ({
      customerId: CUSTOMER,
      paymentMethodId: "pm_wb2",
      subscriptionId: "sub_wb2",
      currentPeriodStart: 1890864000,
      currentPeriodEnd: 1893456000,
      planSlug,
    }),
  };
}

async function setup({ sprache = "de", planSlug = "starter", mailer, zustimmung = true, webhookZuerst = false }) {
  const { store, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  await accounts.upsertOnFirstLogin({ sub: SUB, email: EMAIL });
  await store.ensureTenant(TENANT);
  await store.setTenantStripe(TENANT, { customerId: CUSTOMER });
  await store.setTenantGeo(TENANT, { defaultLanguage: sprache });
  if (zustimmung) await store.setWiderrufBeginn(TENANT, { at: ZUSTIMMUNG_AT, text: "widerruf-beginn-v1" });
  if (webhookZuerst) await store.setTenantSubscription(TENANT, { subscriptionId: "sub_wb2", planSlug });
  const { id: sessionId } = await sessions.create({ sub: SUB, tenantId: TENANT, ttlSeconds: 3600 });
  const { base, close } = await startRouterApp(
    makeSelfServiceRoutes({
      store,
      webAuthMw: webAuth({ secret: SECRET, sessions, accounts }),
      webAuthPendingMw: webAuthAllowPending({ secret: SECRET, sessions, accounts }),
      audit: () => {},
      config: withConfigNamespaces(CONFIG),
      billing: fakeBilling(planSlug),
      accounts,
      provision: async () => ({ ok: true, reason: "queued" }),
      mailer,
    }),
  );
  const cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(sessionId, SECRET))}`;
  const rueckkehr = () =>
    request("GET", `${base}/api/self-service/billing/return?session_id=${SESSION}&plan=${planSlug}`, { cookie });
  return { rueckkehr, close };
}

function postfach() {
  const mails = [];
  return { mails, sendMail: async (mail) => mails.push(mail) };
}

test("Bestätigungs-Mail DE nach erfolgreicher Buchung: Tarif, Preis, Wortlaut und Zeitpunkt der Zustimmung, Links zu AGB und Widerrufsbelehrung", async () => {
  const post = postfach();
  const s = await setup({ mailer: post });
  try {
    const res = await s.rueckkehr();
    assert.equal(res.status, 302);
    assert.equal(post.mails.length, 1);
    const [mail] = post.mails;
    assert.equal(mail.to, EMAIL);
    assert.match(mail.subject, /Bestätigung/);
    assert.match(mail.subject, /Starter/);
    assert.match(mail.text, /Tarif: Starter/);
    assert.match(mail.text, /4,99\s€ pro Monat/u);
    assert.ok(mail.text.includes(`„${DE_ZUSTIMMUNG}“`), "Wortlaut der Zustimmung fehlt");
    assert.ok(mail.text.includes("am 17.11.2026, 09:30 Uhr (UTC)"), "Zeitpunkt der Zustimmung fehlt");
    assert.ok(mail.text.includes("https://sundartha.com/agb"), "Link zu den AGB fehlt");
    assert.match(mail.text, /Widerrufsbelehrung.*https:\/\/sundartha\.com\/agb/s);
  } finally {
    await s.close();
  }
});

test("Bestätigungs-Mail EN: englischer Text, englische AGB-Adresse, Preis und Zeitpunkt", async () => {
  const post = postfach();
  const s = await setup({ sprache: "en", planSlug: "business", mailer: post });
  try {
    await s.rueckkehr();
    assert.equal(post.mails.length, 1);
    const [mail] = post.mails;
    assert.match(mail.subject, /confirmation/i);
    assert.match(mail.text, /Plan: Pro/);
    assert.match(mail.text, /€9\.99 per month/);
    assert.match(mail.text, /I expressly request that Sundartha begin providing the service/);
    assert.ok(mail.text.includes("on 2026-11-17 09:30 UTC"), "Zeitpunkt fehlt");
    assert.ok(mail.text.includes("https://sundartha.com/legal/terms"), "englische AGB-Adresse fehlt");
    assert.equal(mail.text.includes("sundartha.com/agb"), false);
  } finally {
    await s.close();
  }
});

test("Bestätigungs-Mail geht höchstens einmal: erneute Rückkehr mit derselben Session schickt keine zweite", async () => {
  const post = postfach();
  const s = await setup({ mailer: post });
  try {
    await s.rueckkehr();
    await s.rueckkehr();
    assert.equal(post.mails.length, 1);
  } finally {
    await s.close();
  }
});

test("Ohne gespeicherte Zustimmung (Checkout vor dem Update begonnen) geht die Mail ohne Zustimmungsabschnitt, das Fehlen wird mit Tenant geloggt", async (t) => {
  const warnung = t.mock.method(console, "warn", () => {});
  const post = postfach();
  const s = await setup({ mailer: post, zustimmung: false });
  try {
    await s.rueckkehr();
    assert.equal(post.mails.length, 1);
    const [mail] = post.mails;
    assert.match(mail.text, /Tarif: Starter/);
    assert.equal(mail.text.includes("Erklärung abgegeben"), false);
    assert.equal(mail.text.includes(DE_ZUSTIMMUNG), false);
    const zeilen = warnung.mock.calls.map((aufruf) => String(aufruf.arguments[0]));
    const treffer = zeilen.filter((zeile) => zeile.includes("abo-bestaetigung") && zeile.includes(`tenant=${TENANT}`));
    assert.equal(treffer.length, 1, "fehlende Zustimmung wird genau einmal mit Tenant geloggt");
    assert.equal(treffer[0].includes(EMAIL), false, "keine Mailadresse im Log");
  } finally {
    await s.close();
  }
});

test("Webhook vor der Rückkehr (Abo schon gesetzt): genau eine Bestätigungs-Mail, ein Reload danach schickt keine weitere", async () => {
  const post = postfach();
  const s = await setup({ mailer: post, webhookZuerst: true });
  try {
    const res = await s.rueckkehr();
    assert.equal(res.status, 302);
    assert.equal(post.mails.length, 1);
    assert.match(post.mails[0].text, /Tarif: Starter/);
    await s.rueckkehr();
    assert.equal(post.mails.length, 1);
  } finally {
    await s.close();
  }
});

test("Scheitert der erste Versand, holt die nächste Rückkehr die Mail nach (Marker erst nach Erfolg)", async (t) => {
  t.mock.method(console, "error", () => {});
  const versuche = [];
  let scheitern = true;
  const s = await setup({
    mailer: {
      sendMail: async (mail) => {
        versuche.push(mail);
        if (scheitern) throw new Error("smtp down");
      },
    },
  });
  try {
    await s.rueckkehr();
    scheitern = false;
    await s.rueckkehr();
    await s.rueckkehr();
    assert.equal(versuche.length, 2, "ein gescheiterter und ein erfolgreicher Versuch, danach keiner mehr");
  } finally {
    await s.close();
  }
});

test("Scheitert der Versand, gelingt die Buchung trotzdem: gleiche Weiterleitung wie mit Mail, Fehler im Log", async (t) => {
  const ok = await setup({ mailer: postfach() });
  const erwartet = (await ok.rueckkehr().finally(() => {})).location;
  await ok.close();
  const fehler = t.mock.method(console, "error", () => {});
  const s = await setup({
    mailer: {
      sendMail: async () => {
        throw new Error("smtp down");
      },
    },
  });
  try {
    const res = await s.rueckkehr();
    assert.equal(res.status, 302);
    assert.equal(res.location, erwartet);
    const zeilen = fehler.mock.calls.map((aufruf) => String(aufruf.arguments[0]));
    assert.ok(zeilen.some((zeile) => zeile.includes("abo-bestaetigung")), "Versandfehler wird geloggt");
  } finally {
    await s.close();
  }
});
