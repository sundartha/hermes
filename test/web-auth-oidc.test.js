import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOidc } from "../src/web-auth.js";

// ---- F3: jwksCache-Invalidierung nach Discovery-Refresh ----
// makeOidc cached Discovery-Dokument (TTL) UND die RemoteJWKSet-Instanz. Nach
// TTL-Ablauf laedt discover() das Dokument neu und muss jwksCache zuruecksetzen,
// damit getJwks() eine (evtl. neue) jwks_uri neu aufloest. Sonst brechen nach
// einer IdP-jwks_uri-Rotation alle Logins bis zum Prozess-Neustart.

const ISSUER = "https://idp.test";
// makeOidc nutzt fetch global -> kontrollierter Stub fuer die Test-Dauer.
const ORIGINAL_FETCH = globalThis.fetch;

// Baut eine makeOidc-Instanz mit gestubbtem global fetch. discover() ruft
// `${issuer}/.well-known/openid-configuration` ab; der Stub liefert ein
// Discovery-Dokument mit der jeweils aktuellen jwks_uri und zaehlt die Aufrufe.
// `_discoveryTtlMs` steuert das TTL-Verhalten (0 = immer Refresh).
function makeOidcWithFakeFetch({ discoveryTtlMs } = {}) {
  let jwksUri = `${ISSUER}/jwks`;
  let discoveryFetches = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/.well-known/openid-configuration")) {
      discoveryFetches += 1;
      return {
        ok: true,
        json: async () => ({
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: `${ISSUER}/token`,
          jwks_uri: jwksUri,
        }),
      };
    }
    throw new Error(`unerwarteter fetch: ${url}`);
  };
  const opts = discoveryTtlMs === undefined ? undefined : { _discoveryTtlMs: discoveryTtlMs };
  const oidc = makeOidc({ oauthIssuerUrl: ISSUER }, opts);
  return {
    oidc,
    getDiscoveryFetches: () => discoveryFetches,
    setJwksUri: (uri) => {
      jwksUri = uri;
    },
  };
}

function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH;
}

// getJwks ist nicht direkt exportiert. _getJwksForTest stellt den internen
// getJwks-Aufruf fuer den Test bereit (siehe makeOidc-Implementierung).

test("T-F3-01: jwksCache wird beim ersten Aufruf befuellt und bei gueltigem TTL gehalten", async () => {
  const { oidc, getDiscoveryFetches } = makeOidcWithFakeFetch();
  try {
    const first = await oidc._getJwksForTest();
    assert.ok(first, "erster getJwks-Aufruf liefert eine Instanz");
    const second = await oidc._getJwksForTest();
    assert.equal(second, first, "zweiter Aufruf liefert dieselbe Instanz (Cache warm)");
    assert.equal(getDiscoveryFetches(), 1, "discover() nur einmal aufgerufen (TTL gueltig)");
  } finally {
    restoreFetch();
  }
});

test("T-F3-02: jwksCache wird nach Discovery-Refresh (TTL abgelaufen) neu aufgeloest", async () => {
  // TTL=0 -> jeder discover()-Aufruf laedt neu, jwksCache muss zuruckgesetzt werden.
  const { oidc, getDiscoveryFetches, setJwksUri } = makeOidcWithFakeFetch({ discoveryTtlMs: 0 });
  try {
    const first = await oidc._getJwksForTest();
    assert.ok(first);
    // IdP rotiert die jwks_uri
    setJwksUri(`${ISSUER}/jwks-rotated`);
    const second = await oidc._getJwksForTest();
    assert.notEqual(second, first, "nach Refresh neue RemoteJWKSet-Instanz (rotierte URI)");
    assert.equal(getDiscoveryFetches(), 2, "discover() bei abgelaufenem TTL erneut aufgerufen");
  } finally {
    restoreFetch();
  }
});

test("T-F3-03: kein jwksCache-Reset wenn TTL noch gueltig", async () => {
  const { oidc, getDiscoveryFetches } = makeOidcWithFakeFetch({ discoveryTtlMs: 3600_000 });
  try {
    const first = await oidc._getJwksForTest();
    const second = await oidc._getJwksForTest();
    assert.equal(second, first, "dieselbe Objekt-Referenz bei gueltigem TTL");
    assert.equal(getDiscoveryFetches(), 1, "discover() nur einmal (kein unnoetiger Refresh)");
  } finally {
    restoreFetch();
  }
});
