// Tests fuer den duennen API-Wrapper (lib/api.js). Reine Logik, kein DOM: wir
// stubben das globale fetch und pruefen Request-Form (same-origin, Methode, KEIN
// Authorization-Header), Fehler-Mapping (ApiError) und die Auth-Zustands-
// Ableitung (200/401/403/Fehler). Laeuft mit node:test ohne Netz/Dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ApiError,
  AUTH_STATE,
  agentInfo,
  cardStatus,
  fetchTenantState,
  logout,
  loadAuthState,
  startBillingSetupCheckout,
} from "../src/lib/api.js";

// Ersetzt globalThis.fetch durch einen Stub, der die Aufrufe aufzeichnet und
// eine vorgegebene Antwort liefert. Gibt eine restore-Funktion zurueck.
function stubFetch(responder) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    return responder(path, options);
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

// Baut eine minimale fetch-Response-Attrappe (nur das, was apiRequest nutzt).
function fakeResponse({ ok, status, json }) {
  return {
    ok,
    status,
    json: async () => json,
  };
}

test("fetchTenantState gibt JSON bei 200 zurueck und ruft same-origin ohne Auth-Header", async () => {
  const payload = { agent: { number: "+49123", owner: "Alex" } };
  const f = stubFetch(() => fakeResponse({ ok: true, status: 200, json: payload }));
  try {
    const data = await fetchTenantState();
    assert.deepEqual(data, payload);
    assert.equal(f.calls.length, 1);
    const { path, options } = f.calls[0];
    assert.equal(path, "/api/self-service/state");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.method, "GET");
    // Fail-closed gegen Token-Leak: niemals ein Authorization-Header.
    assert.equal(options.headers.Authorization, undefined);
  } finally {
    f.restore();
  }
});

test("apiRequest wirft ApiError mit Status bei non-2xx", async () => {
  const f = stubFetch(() => fakeResponse({ ok: false, status: 500, json: {} }));
  try {
    await assert.rejects(fetchTenantState(), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 500);
      return true;
    });
  } finally {
    f.restore();
  }
});

test("logout schickt POST /auth/logout same-origin und liefert null bei 204", async () => {
  // 204 ohne Body: json() wuerde werfen -> der Stub liefert keinen Body, und
  // parseJson:false darf json() gar nicht erst aufrufen.
  const f = stubFetch(() =>
    fakeResponse({
      ok: true,
      status: 204,
      json: () => {
        throw new Error("204 hat keinen Body");
      },
    })
  );
  try {
    const result = await logout();
    assert.equal(result, null);
    const { path, options } = f.calls[0];
    assert.equal(path, "/auth/logout");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
  } finally {
    f.restore();
  }
});

test("loadAuthState -> AUTHENTICATED mit Daten bei 200", async () => {
  const payload = { agent: { number: "+49123", owner: "Alex" } };
  const f = stubFetch(() => fakeResponse({ ok: true, status: 200, json: payload }));
  try {
    const result = await loadAuthState();
    assert.equal(result.state, AUTH_STATE.AUTHENTICATED);
    assert.deepEqual(result.data, payload);
  } finally {
    f.restore();
  }
});

test("loadAuthState -> ANONYMOUS bei 401", async () => {
  const f = stubFetch(() => fakeResponse({ ok: false, status: 401, json: {} }));
  try {
    const result = await loadAuthState();
    assert.equal(result.state, AUTH_STATE.ANONYMOUS);
    assert.equal(result.data, null);
  } finally {
    f.restore();
  }
});

test("loadAuthState -> PENDING bei 403", async () => {
  const f = stubFetch(() => fakeResponse({ ok: false, status: 403, json: {} }));
  try {
    const result = await loadAuthState();
    assert.equal(result.state, AUTH_STATE.PENDING);
    assert.equal(result.data, null);
  } finally {
    f.restore();
  }
});

test("loadAuthState -> ERROR bei 5xx und bei Netzwerkfehler", async () => {
  const f1 = stubFetch(() => fakeResponse({ ok: false, status: 503, json: {} }));
  try {
    assert.equal((await loadAuthState()).state, AUTH_STATE.ERROR);
  } finally {
    f1.restore();
  }

  const f2 = stubFetch(() => {
    throw new TypeError("network down");
  });
  try {
    assert.equal((await loadAuthState()).state, AUTH_STATE.ERROR);
  } finally {
    f2.restore();
  }
});

// agentInfo ist die EINE Contract-Grenze zur API (data.agent). Grenzfaelle:
// fehlendes data/agent und leere Felder duerfen nie undefined durchlassen, sonst
// stuende "undefined" in der App-Shell. Voll befuellt: Werte unveraendert durch.
test("agentInfo liefert leere Strings bei fehlendem data oder agent", () => {
  assert.deepEqual(agentInfo(undefined), { number: "", owner: "" });
  assert.deepEqual(agentInfo(null), { number: "", owner: "" });
  assert.deepEqual(agentInfo({}), { number: "", owner: "" });
});

test("agentInfo faengt leere/null-Felder als leere Strings ab", () => {
  assert.deepEqual(agentInfo({ agent: { number: "", owner: null } }), {
    number: "",
    owner: "",
  });
});

test("agentInfo reicht befuellte Felder unveraendert durch", () => {
  assert.deepEqual(agentInfo({ agent: { number: "+49123", owner: "Alex" } }), {
    number: "+49123",
    owner: "Alex",
  });
});

// cardStatus ist die Contract-Grenze zur API fuer state.hasCard. Sichtbarkeits-
// Regel (W3): nur wenn hasCard ein Boolean ist (PAYMENT_ENABLED an), ist der
// Block sichtbar; sonst present=false -> versteckt (byte-identisch zum Bestand).
test("cardStatus: present=false, wenn hasCard fehlt (PAYMENT_ENABLED aus)", () => {
  assert.deepEqual(cardStatus(undefined), { present: false, hasCard: false });
  assert.deepEqual(cardStatus(null), { present: false, hasCard: false });
  assert.deepEqual(cardStatus({}), { present: false, hasCard: false });
  // hasCard nur als Boolean zaehlt -- Nicht-Boolean-Werte => versteckt.
  assert.deepEqual(cardStatus({ hasCard: "true" }), { present: false, hasCard: false });
  assert.deepEqual(cardStatus({ hasCard: 1 }), { present: false, hasCard: false });
  assert.deepEqual(cardStatus({ hasCard: null }), { present: false, hasCard: false });
});

test("cardStatus: present=true mit Boolean -> hasCard wird durchgereicht", () => {
  assert.deepEqual(cardStatus({ hasCard: false }), { present: true, hasCard: false });
  assert.deepEqual(cardStatus({ hasCard: true }), { present: true, hasCard: true });
});

// startBillingSetupCheckout: POST same-origin, gibt die Stripe-url zurueck
// (Backend antwortet mit JSON { url } -- verifiziert in self-service-routes.js).
test("startBillingSetupCheckout postet same-origin und liefert die Stripe-url", async () => {
  const f = stubFetch(() =>
    fakeResponse({ ok: true, status: 200, json: { url: "https://checkout.stripe.com/c/pay/cs_test" } })
  );
  try {
    const url = await startBillingSetupCheckout();
    assert.equal(url, "https://checkout.stripe.com/c/pay/cs_test");
    const { path, options } = f.calls[0];
    assert.equal(path, "/api/self-service/billing/setup-checkout");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    // Fail-closed gegen Token-Leak: niemals ein Authorization-Header.
    assert.equal(options.headers.Authorization, undefined);
  } finally {
    f.restore();
  }
});

test("startBillingSetupCheckout wirft ApiError bei non-2xx (z.B. 404 Payment aus)", async () => {
  const f = stubFetch(() => fakeResponse({ ok: false, status: 404, json: {} }));
  try {
    await assert.rejects(startBillingSetupCheckout(), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 404);
      return true;
    });
  } finally {
    f.restore();
  }
});

// Contract-Grenze (R5): ein 200 ohne url-Feld waere Drift -> fail-closed werfen,
// statt window.location.assign(undefined) an die Insel durchzureichen.
test("startBillingSetupCheckout wirft bei 200 ohne url-Feld", async () => {
  const f = stubFetch(() => fakeResponse({ ok: true, status: 200, json: {} }));
  try {
    await assert.rejects(startBillingSetupCheckout(), (err) => {
      assert.ok(err instanceof ApiError);
      return true;
    });
  } finally {
    f.restore();
  }
});
