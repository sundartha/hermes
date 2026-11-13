import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../../src/store.js";

const MANDANT = "tenant-bereiche-news-1";

function attrappe() {
  const aufrufe = [];
  const merke = (name, ergebnis) => (...args) => {
    aufrufe.push([name, ...args]);
    return ergebnis;
  };
  const speicher = {
    tenantNewsletterConsent: merke("tenantNewsletterConsent", { consent: true }),
    tenantNewsletterRecipients: merke("tenantNewsletterRecipients", [{ email: "a@example.com" }]),
    confirmedNewsletterRecipients: merke("confirmedNewsletterRecipients", [
      { email: "b@example.com", unsubToken: "u1" },
    ]),
    setNewsletterConsent: merke("setNewsletterConsent", undefined),
    removeNewsletterRecipient: merke("removeNewsletterRecipient", true),
    confirmNewsletterRecipientByToken: merke("confirmNewsletterRecipientByToken", {
      tenantId: MANDANT,
      email: "a@example.com",
    }),
    unsubscribeNewsletterRecipientByToken: merke("unsubscribeNewsletterRecipientByToken", {
      tenantId: MANDANT,
      email: "b@example.com",
    }),
  };
  return { speicher, aufrufe };
}

test("Newsletter: jede Bereichsfunktion liefert ein Promise mit dem Ergebnis der Speicherfunktion", async () => {
  const { speicher, aufrufe } = attrappe();
  const newsletter = speicherBereiche(speicher).newsletter;
  const lesen = newsletter.tenantNewsletterConsent(MANDANT);
  assert.ok(lesen instanceof Promise);
  assert.deepEqual(await lesen, { consent: true });
  assert.deepEqual(await newsletter.tenantNewsletterRecipients(MANDANT), [{ email: "a@example.com" }]);
  assert.deepEqual(await newsletter.confirmedNewsletterRecipients(MANDANT), [
    { email: "b@example.com", unsubToken: "u1" },
  ]);
  assert.equal(await newsletter.setNewsletterConsent(MANDANT, false), undefined);
  assert.equal(await newsletter.removeNewsletterRecipient(MANDANT, "a@example.com"), true);
  assert.deepEqual(await newsletter.confirmNewsletterRecipientByToken("hash", "2026-11-13T10:00:00.000Z"), {
    tenantId: MANDANT,
    email: "a@example.com",
  });
  assert.deepEqual(await newsletter.unsubscribeNewsletterRecipientByToken("tok"), {
    tenantId: MANDANT,
    email: "b@example.com",
  });
  assert.deepEqual(aufrufe, [
    ["tenantNewsletterConsent", MANDANT],
    ["tenantNewsletterRecipients", MANDANT],
    ["confirmedNewsletterRecipients", MANDANT],
    ["setNewsletterConsent", MANDANT, false],
    ["removeNewsletterRecipient", MANDANT, "a@example.com"],
    ["confirmNewsletterRecipientByToken", "hash", "2026-11-13T10:00:00.000Z"],
    ["unsubscribeNewsletterRecipientByToken", "tok"],
  ]);
});

test("Newsletter: Speicherfunktionen werden erst beim Aufruf gelesen", async () => {
  const { speicher } = attrappe();
  const newsletter = speicherBereiche(speicher).newsletter;
  speicher.tenantNewsletterConsent = () => ({ consent: false, spaet: true });
  assert.deepEqual(await newsletter.tenantNewsletterConsent(MANDANT), { consent: false, spaet: true });
});

test("Newsletter: ein Wurf der Speicherfunktion wird zur Ablehnung", async () => {
  const { speicher } = attrappe();
  speicher.setNewsletterConsent = () => {
    throw new Error("ungueltige Einwilligung");
  };
  await assert.rejects(
    speicherBereiche(speicher).newsletter.setNewsletterConsent(MANDANT, "x"),
    /ungueltige Einwilligung/,
  );
});
