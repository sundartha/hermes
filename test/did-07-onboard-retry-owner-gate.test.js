// DID-07 (i18n-Testkatalog, tasks/i18n-tests/06-nummern-provisioning.md:197) -
// /api/onboard/retry bleibt Owner-only, auch von aussen (Regressions-Pin).
//
// Mechanismus (gruen), KEIN Launch-Gate: dieser Test pinnt eine bereits vorhandene,
// bestehende Sicherung fest, damit ein spaeterer Umbau (z.B. eine oeffentliche
// Self-Service-Retry-Route, siehe DID-06) das Owner-Gate des Geld-Endpunkts nicht
// versehentlich aufweicht. Kein Sollzustand-Konflikt (R1 trifft hier nicht zu) - siehe
// tasks/i18n-tests/00-kanonische-liste.md Tabelle 4.2, Spalte "heute erwartbar" = gruen,
// keine SOLL-Gegenfassung.
//
// Eigene Datei (Datei-Eigentum Block B6): der beleghafte Bestandstest liegt bereits in
// test/p2-onboard-retry.test.js ("(d) proxied ohne Admin-Sitzung -> 404") - das Muster
// dort wird hier 1:1 wiederholt statt die fremde Datei anzufassen (Regel 4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, startIdp } from "./helpers.js";
import { KYC_LEVEL } from "../src/store/defaults.js";

// Offline-Diskriminator: 500 = alle Gates passiert (originateCall wirft ohne
// TELNYX_API_KEY, s. BASE_ENV in helpers.js), 403/429/400 = ein Gate hat gesperrt.
const PW = "did-07-retry-secret";

const env = (idp) => ({
  MCP_AUTH: "oauth",
  OAUTH_ISSUER_URL: idp.issuer,
  MULTI_TENANT: "true",
  DASHBOARD_PASSWORD: PW,
  MAX_NUMBERS: "100",
  MAX_NUMBERS_PER_TENANT: "100",
});

function subscriberTenant(id, idpSubject) {
  return { id, status: "active", idpSubject, ownerName: `${id} Tester`, kycLevel: KYC_LEVEL.CARD };
}

const retry = (srv, body, headers = {}) =>
  fetch(`${srv.localUrl}/api/onboard/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("DID-07 (Mechanismus gruen, Regressions-Pin): proxied ohne Admin-Sitzung -> 404, auch fuer einen zahlenden Subscriber", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: env(idp),
    seed: seedState({ tenants: [subscriberTenant("t_did07", "sub-did07")] }),
  });
  try {
    // X-Forwarded-For simuliert eine externe IP (kein trusted-localhost). Kein
    // SESSION_SECRET im Fixture -> operatorAuth existiert nicht -> die Route ist gar
    // nicht gemountet, unabhaengig vom Header.
    const res = await retry(srv, { tenantId: "t_did07" }, { "X-Forwarded-For": "1.2.3.4" });
    assert.equal(res.status, 404, "Route ohne operatorAuth nicht gemountet -> 404, auch fuer active+CARD-Subscriber");
  } finally {
    await srv.stop();
    await idp.close();
  }
});
