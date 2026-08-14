// F2-Newsletter-Recipients: Bestaetigung (Double-Opt-in) + Abmeldung - reine state-ops-Unit-
// Tests (Muster newsletter-consent-store.test.js): offline/F.I.R.S.T., kein IO. Deckt
// confirmNewsletterRecipientByToken/unsubscribeNewsletterRecipientByToken ab:
//   - gueltiger Token -> confirmed + Token entwertet (Einmalverwendung)
//   - abgelaufen/falsch/doppelt verwendet -> kein Treffer, kein Zustandswechsel
//   - Scan findet den RICHTIGEN Tenant unter mehreren (kein Cross-Tenant-Leck)
//   - Abmeldung traegt aus, idempotent, funktioniert fuer pending UND confirmed
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  registerTenant,
  addNewsletterRecipient,
  confirmNewsletterRecipientByToken,
  unsubscribeNewsletterRecipientByToken,
  tenantNewsletterRecipients,
} from "../src/store/state-ops.js";
import { newNewsletterTokens, hashNewsletterToken } from "../src/newsletter-recipients.js";

const TENANT_A = "t_nl_confirm_a";
const TENANT_B = "t_nl_confirm_b";
const NOW_ISO = "2026-08-14T12:00:00.000Z";
const EXPIRED_ISO = "2026-08-10T12:00:00.000Z"; // vor NOW_ISO -> bereits abgelaufen

function seededState() {
  const s = makeDefaultState();
  registerTenant(s, TENANT_A, { firstName: "A" });
  registerTenant(s, TENANT_B, { firstName: "B" });
  return s;
}

function addPending(s, tenantId, email, { expiresAt = "2099-01-01T00:00:00.000Z" } = {}) {
  const tokens = newNewsletterTokens();
  addNewsletterRecipient(s, tenantId, {
    email,
    tokenHash: tokens.tokenHash,
    tokenExpiresAt: expiresAt,
    unsubToken: tokens.unsubToken,
  });
  return tokens;
}

// ---- confirmNewsletterRecipientByToken -------------------------------------------------

test("gueltiger Token -> confirmed + confirmedAt gesetzt, tokenHash/tokenExpiresAt geleert (Einmalverwendung)", () => {
  const s = seededState();
  const tokens = addPending(s, TENANT_A, "freund@example.test");

  const result = confirmNewsletterRecipientByToken(s, tokens.tokenHash, NOW_ISO);
  assert.deepEqual(result, { tenantId: TENANT_A, email: "freund@example.test" });

  const [recipient] = tenantNewsletterRecipients(s, TENANT_A);
  assert.equal(recipient.status, "confirmed");
  assert.equal(recipient.confirmedAt, NOW_ISO);
  assert.equal(recipient.tokenHash, null, "Token nach Erfolg geleert");
  assert.equal(recipient.tokenExpiresAt, null);
});

test("doppelte Verwendung desselben Tokens -> zweiter Versuch findet nichts mehr (kein Zustandswechsel)", () => {
  const s = seededState();
  const tokens = addPending(s, TENANT_A, "freund@example.test");
  confirmNewsletterRecipientByToken(s, tokens.tokenHash, NOW_ISO);

  const second = confirmNewsletterRecipientByToken(s, tokens.tokenHash, NOW_ISO);
  assert.equal(second, null, "Einmalverwendung - der leere tokenHash matcht nie wieder");
});

test("abgelaufener Token (tokenExpiresAt <= nowIso) -> kein Treffer, Eintrag bleibt pending", () => {
  const s = seededState();
  const tokens = addPending(s, TENANT_A, "freund@example.test", { expiresAt: EXPIRED_ISO });

  const result = confirmNewsletterRecipientByToken(s, tokens.tokenHash, NOW_ISO);
  assert.equal(result, null);
  assert.equal(tenantNewsletterRecipients(s, TENANT_A)[0].status, "pending", "kein Zustandswechsel");
});

test("falscher/geratener Token -> kein Treffer, neutral (keine Unterscheidung zu 'abgelaufen')", () => {
  const s = seededState();
  addPending(s, TENANT_A, "freund@example.test");

  const result = confirmNewsletterRecipientByToken(s, hashNewsletterToken("komplett-falscher-token"), NOW_ISO);
  assert.equal(result, null);
});

test("Scan findet den RICHTIGEN Tenant unter mehreren (kein Cross-Tenant-Leck)", () => {
  const s = seededState();
  addPending(s, TENANT_A, "a@example.test");
  const tokensB = addPending(s, TENANT_B, "b@example.test");

  const result = confirmNewsletterRecipientByToken(s, tokensB.tokenHash, NOW_ISO);
  assert.deepEqual(result, { tenantId: TENANT_B, email: "b@example.test" });
  assert.equal(tenantNewsletterRecipients(s, TENANT_A)[0].status, "pending", "Tenant A unberuehrt");
});

test("leerer/undefined tokenHash-Kandidat wird nie faelschlich als Treffer gewertet", () => {
  // Ein Eintrag, dessen tokenHash bereits geleert ist (z.B. schon bestaetigt), darf mit
  // einem LEEREN eingehenden Wert nicht matchen - sonst waere ein leerer Query-Parameter
  // ein universeller Bypass.
  const s = seededState();
  const tokens = addPending(s, TENANT_A, "freund@example.test");
  confirmNewsletterRecipientByToken(s, tokens.tokenHash, NOW_ISO); // -> tokenHash=null

  const result = confirmNewsletterRecipientByToken(s, "", NOW_ISO);
  assert.equal(result, null);
});

// ---- unsubscribeNewsletterRecipientByToken ---------------------------------------------

test("gueltiger Unsub-Token -> Eintrag wird vollstaendig entfernt", () => {
  const s = seededState();
  const tokens = addPending(s, TENANT_A, "freund@example.test");

  const result = unsubscribeNewsletterRecipientByToken(s, tokens.unsubToken);
  assert.deepEqual(result, { tenantId: TENANT_A, email: "freund@example.test" });
  assert.deepEqual(tenantNewsletterRecipients(s, TENANT_A), []);
});

test("Abmeldung funktioniert AUCH fuer bereits bestaetigte Eintraege (unsubToken bleibt permanent)", () => {
  const s = seededState();
  const tokens = addPending(s, TENANT_A, "freund@example.test");
  confirmNewsletterRecipientByToken(s, tokens.tokenHash, NOW_ISO);

  const result = unsubscribeNewsletterRecipientByToken(s, tokens.unsubToken);
  assert.deepEqual(result, { tenantId: TENANT_A, email: "freund@example.test" });
  assert.deepEqual(tenantNewsletterRecipients(s, TENANT_A), []);
});

test("idempotent: zweiter Abmelde-Versuch mit demselben Token findet nichts mehr, wirft nicht", () => {
  const s = seededState();
  const tokens = addPending(s, TENANT_A, "freund@example.test");
  unsubscribeNewsletterRecipientByToken(s, tokens.unsubToken);

  const second = unsubscribeNewsletterRecipientByToken(s, tokens.unsubToken);
  assert.equal(second, null);
});

test("falscher Unsub-Token -> kein Treffer, Eintrag bleibt bestehen", () => {
  const s = seededState();
  addPending(s, TENANT_A, "freund@example.test");

  const result = unsubscribeNewsletterRecipientByToken(s, "komplett-falscher-token");
  assert.equal(result, null);
  assert.equal(tenantNewsletterRecipients(s, TENANT_A).length, 1);
});
