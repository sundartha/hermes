import test from "node:test";
import assert from "node:assert/strict";
import { startServer, startIdp, seedState, externalIp, waitForLog } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY = 429;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const FENSTER_LIMIT = 3;
const UEBER_LIMIT = FENSTER_LIMIT + 1;
const RATE_LIMIT_PER_MIN_TEST = String(FENSTER_LIMIT);
const FLUT_UEBERSCHUSS = 10;
const GROSSER_BODY_BYTES = 150_000;

const TENANT_A = "t_a",
  TENANT_B = "t_b";
const SUB_A = "sub-a",
  SUB_B = "sub-b";

function seedTwoTenants() {
  return seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      { id: TENANT_A, status: "active", idpSubject: SUB_A },
      { id: TENANT_B, status: "active", idpSubject: SUB_B },
    ],
  });
}

function mcpPostFrom(url, { token, body, forwardedFor } = {}) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
    },
    body: JSON.stringify(body),
  });
}

function mcpPostMitOriginFrom(url, { origin, token, forwardedFor } = {}) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(origin ? { Origin: origin } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
    },
    body: JSON.stringify(initBody),
  });
}
const ERLAUBTER_ORIGIN = "https://agent.test";

const initBody = { jsonrpc: "2.0", id: 1, method: "initialize" };
const oauthEnv = (idp, overrides = {}) => ({
  MCP_AUTH: "oauth",
  OAUTH_ISSUER_URL: idp.issuer,
  RATE_LIMIT_PER_MIN: RATE_LIMIT_PER_MIN_TEST,
  ...overrides,
});

test("MRL-a: Mandant A dreimal 200, 4. 429 mit Retry-After; Mandant B teilt die IP, nicht den Zaehler", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const ip = "203.0.113.11";
    const tokenA = await idp.sign({ sub: SUB_A });
    for (let i = 0; i < FENSTER_LIMIT; i++) {
      const res = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: tokenA, body: initBody, forwardedFor: ip });
      assert.equal(res.status, HTTP_OK, `Versuch ${i + 1} sollte 200 sein`);
    }
    const blocked = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: tokenA, body: initBody, forwardedFor: ip });
    assert.equal(blocked.status, HTTP_TOO_MANY);
    assert.ok(blocked.headers.get("retry-after"), "429 traegt Retry-After");

    const tokenB = await idp.sign({ sub: SUB_B });
    const resB = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: tokenB, body: initBody, forwardedFor: ip });
    assert.equal(resB.status, HTTP_OK, "Mandant B hat einen eigenen Zaehler");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MRL-b: 3 falsch signierte Tokens 401, 4. 429; gueltiges Token derselben IP danach 200", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const ip = "203.0.113.12";
    for (let i = 0; i < FENSTER_LIMIT; i++) {
      const wrong = await idp.sign({ sub: SUB_A }, { key: idp.wrongKey });
      const res = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: wrong, body: initBody, forwardedFor: ip });
      assert.equal(res.status, HTTP_UNAUTHORIZED, `Versuch ${i + 1}`);
      assert.ok(res.headers.get("www-authenticate"));
    }
    const wrong4 = await idp.sign({ sub: SUB_A }, { key: idp.wrongKey });
    const blocked = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: wrong4, body: initBody, forwardedFor: ip });
    assert.equal(blocked.status, HTTP_TOO_MANY);

    const validToken = await idp.sign({ sub: SUB_A });
    const ok = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: validToken, body: initBody, forwardedFor: ip });
    assert.equal(ok.status, HTTP_OK, "ein gueltiges Token wird vom Ablehnungs-Zaehler nie gedrosselt");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MRL-c: 4 abgelaufene Tokens mit 4 verschiedenen subs, gleiche IP -> je 401, kein 429", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const ip = "203.0.113.13";
    for (let i = 0; i < UEBER_LIMIT; i++) {
      const expired = await idp.sign({ sub: `sub-abgelaufen-${i}` }, { exp: "-2m" });
      const res = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: expired, body: initBody, forwardedFor: ip });
      assert.equal(res.status, HTTP_UNAUTHORIZED, `Versuch ${i + 1}`);
      assert.ok(res.headers.get("www-authenticate"));
    }
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MRL-d: 4 abgelaufene Tokens derselben sub -> 3x 401, 4. 429", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const ip = "203.0.113.14";
    for (let i = 0; i < FENSTER_LIMIT; i++) {
      const expired = await idp.sign({ sub: SUB_A }, { exp: "-2m" });
      const res = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: expired, body: initBody, forwardedFor: ip });
      assert.equal(res.status, HTTP_UNAUTHORIZED, `Versuch ${i + 1}`);
    }
    const expired4 = await idp.sign({ sub: SUB_A }, { exp: "-2m" });
    const blocked = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: expired4, body: initBody, forwardedFor: ip });
    assert.equal(blocked.status, HTTP_TOO_MANY);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MRL-e: Muell-Tokens mit 4 verschiedenen unverifizierten subs -> zaehlen ueber die IP, 4. 429", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const ip = "203.0.113.15";
    for (let i = 0; i < FENSTER_LIMIT; i++) {
      const muell = await idp.sign({ sub: `angreifer-sub-${i}` }, { key: idp.wrongKey });
      const res = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: muell, body: initBody, forwardedFor: ip });
      assert.equal(res.status, HTTP_UNAUTHORIZED, `Versuch ${i + 1}`);
    }
    const muell4 = await idp.sign({ sub: `angreifer-sub-${FENSTER_LIMIT}` }, { key: idp.wrongKey });
    const blocked = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: muell4, body: initBody, forwardedFor: ip });
    assert.equal(blocked.status, HTTP_TOO_MANY, "vier verschiedene subs teilen SICH EINEN Eimer (die IP)");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MRL-f: kein Token 3x 401, 4. 429", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const ip = "203.0.113.16";
    for (let i = 0; i < FENSTER_LIMIT; i++) {
      const res = await mcpPostFrom(`${srv.localUrl}/mcp`, { body: initBody, forwardedFor: ip });
      assert.equal(res.status, HTTP_UNAUTHORIZED, `Versuch ${i + 1}`);
    }
    const blocked = await mcpPostFrom(`${srv.localUrl}/mcp`, { body: initBody, forwardedFor: ip });
    assert.equal(blocked.status, HTTP_TOO_MANY);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MRL-g: Body-Parser laufen HINTER mcpAuth auf POST /mcp", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const ip = "203.0.113.17";
    const grosserBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { fuellstoff: "x".repeat(GROSSER_BODY_BYTES) },
    };

    const mitMuellToken = await mcpPostFrom(`${srv.localUrl}/mcp`, {
      token: "muell-token-ohne-gueltige-signatur",
      body: grosserBody,
      forwardedFor: ip,
    });
    assert.equal(mitMuellToken.status, HTTP_UNAUTHORIZED, "Muell-Token -> 401, nicht 413 (Parser lief nie)");

    const gueltigesToken = await idp.sign({ sub: SUB_A });
    const mitGueltigemToken = await mcpPostFrom(`${srv.localUrl}/mcp`, {
      token: gueltigesToken,
      body: grosserBody,
      forwardedFor: ip,
    });
    assert.equal(mitGueltigemToken.status, HTTP_PAYLOAD_TOO_LARGE, "hinter mcpAuth gilt derselbe BODY_LIMIT");

    const kaputtesJson = await fetch(`${srv.localUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Forwarded-For": ip },
      body: "{kaputt",
    });
    assert.equal(kaputtesJson.status, HTTP_UNAUTHORIZED, "kaputtes JSON ohne Token -> 401, nicht 400");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MRL-h: /healthz bleibt vom /mcp-Zaehler unberuehrt; der globale IP-Limiter fuer andere Routen bleibt", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const ipX = "203.0.113.18";
    const tokenA = await idp.sign({ sub: SUB_A });
    for (let i = 0; i < FENSTER_LIMIT; i++) {
      await mcpPostFrom(`${srv.localUrl}/mcp`, { token: tokenA, body: initBody, forwardedFor: ipX });
    }
    const healthzX = await fetch(`${srv.localUrl}/healthz`, { headers: { "X-Forwarded-For": ipX } });
    assert.equal(healthzX.status, HTTP_OK, "/mcp-POSTs derselben IP zaehlen NICHT im globalen Limiter");

    const ipY = "203.0.113.19";
    for (let i = 0; i < FENSTER_LIMIT; i++) {
      const res = await fetch(`${srv.localUrl}/healthz`, { headers: { "X-Forwarded-For": ipY } });
      assert.equal(res.status, HTTP_OK, `/healthz Versuch ${i + 1}`);
    }
    const blocked = await fetch(`${srv.localUrl}/healthz`, { headers: { "X-Forwarded-For": ipY } });
    assert.equal(blocked.status, HTTP_TOO_MANY, "der globale IP-Limiter fuer andere Routen ist unveraendert");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MRL-i: Token-Modus zaehlt je IP (kein Mandant), Ablehnung und Erfolg getrennt gedrosselt", async () => {
  const tokenEnv = { MCP_AUTH: "token", MCP_AUTH_TOKEN: "t0p-secret", RATE_LIMIT_PER_MIN: RATE_LIMIT_PER_MIN_TEST };
  const srv = await startServer({ env: tokenEnv, seed: seedTwoTenants() });
  try {
    const ipGueltig = "203.0.113.20";
    for (let i = 0; i < FENSTER_LIMIT; i++) {
      const res = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: "t0p-secret", body: initBody, forwardedFor: ipGueltig });
      assert.notEqual(res.status, HTTP_TOO_MANY, `Versuch ${i + 1} nicht 429`);
    }
    const blocked = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: "t0p-secret", body: initBody, forwardedFor: ipGueltig });
    assert.equal(blocked.status, HTTP_TOO_MANY, "der Mandanten-Zaehler (hier: je IP) hat ein Budget");

    const ipFalsch = "203.0.113.21";
    for (let i = 0; i < FENSTER_LIMIT; i++) {
      const res = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: "falsches-token", body: initBody, forwardedFor: ipFalsch });
      assert.equal(res.status, HTTP_UNAUTHORIZED, `Versuch ${i + 1}`);
    }
    const blockedFalsch = await mcpPostFrom(`${srv.localUrl}/mcp`, {
      token: "falsches-token",
      body: initBody,
      forwardedFor: ipFalsch,
    });
    assert.equal(blockedFalsch.status, HTTP_TOO_MANY);
  } finally {
    await srv.stop();
  }
});

test("MRL-j: Interface-IP-Gegenprobe (ohne XFF) - Mandant A/B getrennt gezaehlt", { skip: !externalIp() }, async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const tokenA = await idp.sign({ sub: SUB_A });
    for (let i = 0; i < FENSTER_LIMIT; i++) {
      const res = await mcpPostFrom(`${srv.externalUrl}/mcp`, { token: tokenA, body: initBody });
      assert.equal(res.status, HTTP_OK, `Versuch ${i + 1}`);
    }
    const blocked = await mcpPostFrom(`${srv.externalUrl}/mcp`, { token: tokenA, body: initBody });
    assert.equal(blocked.status, HTTP_TOO_MANY);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MRL-k: OAuth ohne Mandant zaehlt je sub, nicht je IP - zwei unbekannte subs, gleiche IP, je 3x kein 429", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const ip = "203.0.113.22";
    const tokenGhost1 = await idp.sign({ sub: "sub-unbekannt-1" });
    const tokenGhost2 = await idp.sign({ sub: "sub-unbekannt-2" });
    for (let i = 0; i < FENSTER_LIMIT; i++) {
      const res1 = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: tokenGhost1, body: initBody, forwardedFor: ip });
      assert.notEqual(res1.status, HTTP_TOO_MANY, `ghost1 Versuch ${i + 1}`);
      const res2 = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: tokenGhost2, body: initBody, forwardedFor: ip });
      assert.notEqual(res2.status, HTTP_TOO_MANY, `ghost2 Versuch ${i + 1}`);
    }
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MRL-l: fremder Origin zaehlt jetzt ueber den Ablehnungs-Zaehler - 3x 403, 4. 429; gueltiges Token danach weiter 200", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const ip = "203.0.113.23";
    for (let i = 0; i < FENSTER_LIMIT; i++) {
      const res = await mcpPostMitOriginFrom(`${srv.localUrl}/mcp`, { origin: "https://evil.example", forwardedFor: ip });
      assert.equal(res.status, HTTP_FORBIDDEN, `Versuch ${i + 1}`);
    }
    const blocked = await mcpPostMitOriginFrom(`${srv.localUrl}/mcp`, { origin: "https://evil.example", forwardedFor: ip });
    assert.equal(blocked.status, HTTP_TOO_MANY, "die Wache zaehlt jetzt mit");
    assert.ok(blocked.headers.get("retry-after"));

    const tokenA = await idp.sign({ sub: SUB_A });
    const ohneOrigin = await mcpPostMitOriginFrom(`${srv.localUrl}/mcp`, { token: tokenA, forwardedFor: ip });
    assert.equal(ohneOrigin.status, HTTP_OK, "gueltiges Token ohne Origin bleibt trotz ausgeschoepftem Eimer 200");

    const tokenB = await idp.sign({ sub: SUB_B });
    const mitErlaubtemOrigin = await mcpPostMitOriginFrom(`${srv.localUrl}/mcp`, {
      origin: ERLAUBTER_ORIGIN,
      token: tokenB,
      forwardedFor: ip,
    });
    assert.equal(mitErlaubtemOrigin.status, HTTP_OK, "gueltiges Token mit erlaubtem Origin bleibt ebenso 200");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MRL-m: insufficient_scope zaehlt je sub, nicht je IP - zwei subs ohne Scope, gleiche IP, je 3x kein 429", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const ip = "203.0.113.24";
    const tokenOhneScope1 = await idp.sign({ sub: "sub-ohne-scope-1", scope: null });
    const tokenOhneScope2 = await idp.sign({ sub: "sub-ohne-scope-2", scope: null });
    for (let i = 0; i < FENSTER_LIMIT; i++) {
      const res1 = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: tokenOhneScope1, body: initBody, forwardedFor: ip });
      assert.notEqual(res1.status, HTTP_TOO_MANY, `sub1 Versuch ${i + 1}`);
      assert.equal(res1.status, HTTP_FORBIDDEN, `sub1 Versuch ${i + 1} ist insufficient_scope`);
      const res2 = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: tokenOhneScope2, body: initBody, forwardedFor: ip });
      assert.notEqual(res2.status, HTTP_TOO_MANY, `sub2 Versuch ${i + 1}`);
    }
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("MRL-n: auth_failed-Zeilen bleiben unter einer Flut auf FENSTER_LIMIT begrenzt", async () => {
  const idp = await startIdp();
  const srv = await startServer({ env: oauthEnv(idp), seed: seedTwoTenants() });
  try {
    const ip = "203.0.113.25";
    const FLUT_VERSUCHE = FENSTER_LIMIT + FLUT_UEBERSCHUSS;
    for (let i = 0; i < FLUT_VERSUCHE; i++) {
      const res = await mcpPostFrom(`${srv.localUrl}/mcp`, { body: initBody, forwardedFor: ip });
      const erwartet = i < FENSTER_LIMIT ? HTTP_UNAUTHORIZED : HTTP_TOO_MANY;
      assert.equal(res.status, erwartet, `Versuch ${i + 1}`);
    }
    const tokenA = await idp.sign({ sub: SUB_A });
    const markerRes = await mcpPostFrom(`${srv.localUrl}/mcp`, { token: tokenA, body: initBody, forwardedFor: ip });
    assert.equal(markerRes.status, HTTP_OK, "der Mandanten-Zaehler ist vom Ablehnungs-Zaehler getrennt (MRL-b)");
    await waitForLog(srv, /\[mcp\]/);

    const zeilen = srv.stdout.match(/grund=kein_token/g) || [];
    assert.equal(zeilen.length, FENSTER_LIMIT, "hoechstens eine Audit-Zeile je erlaubtem Versuch, keine je 429");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

const STATISCHES_TOKEN = "t0p-secret";
async function belegeIpSperreVorVergleich(env) {
  const srv = await startServer({ env: { ...env, RATE_LIMIT_PER_MIN: RATE_LIMIT_PER_MIN_TEST }, seed: seedTwoTenants() });
  try {
    const url = `${srv.localUrl}/mcp`;
    const angreiferIp = "203.0.113.30";
    const sende = (token, forwardedFor = angreiferIp) => mcpPostFrom(url, { token, body: initBody, forwardedFor });

    for (let i = 0; i < FENSTER_LIMIT; i++) {
      assert.equal((await sende("falsch")).status, HTTP_UNAUTHORIZED, `Fehlversuch ${i + 1}`);
      if (i < FENSTER_LIMIT - 1) {
        const gueltig = await sende(STATISCHES_TOKEN);
        assert.notEqual(gueltig.status, HTTP_TOO_MANY, "gueltig unter dem Fehlversuch-Budget: nicht gedrosselt");
      }
    }
    const richtigGeraten = await sende(STATISCHES_TOKEN);
    assert.equal(richtigGeraten.status, HTTP_TOO_MANY, "ab dem Fenster kein Vergleich mehr - kein Orakel");
    assert.ok(richtigGeraten.headers.get("retry-after"), "Retry-After gesetzt");
    for (let i = 0; i < FLUT_UEBERSCHUSS; i++) {
      assert.equal((await sende(`rate-${i}`)).status, HTTP_TOO_MANY, `Flut-Versuch ${i + 1}`);
    }
    const andereIp = await sende(STATISCHES_TOKEN, "203.0.113.31");
    assert.notEqual(andereIp.status, HTTP_TOO_MANY, "andere IP teilt den Fehlversuch-Eimer nicht");
    assert.notEqual(andereIp.status, HTTP_UNAUTHORIZED, "andere IP mit gueltigem Token authentifiziert");
  } finally {
    await srv.stop();
  }
}

test("MRL-o: Token-Modus - IP-Sperre VOR dem Token-Vergleich nach FENSTER_LIMIT Fehlversuchen", async () => {
  await belegeIpSperreVorVergleich({ MCP_AUTH: "token", MCP_AUTH_TOKEN: STATISCHES_TOKEN });
});

test("MRL-p: Legacy-Modus (MCP_AUTH leer, Token gesetzt) - dieselbe IP-Sperre VOR dem Vergleich", async () => {
  await belegeIpSperreVorVergleich({ MCP_AUTH: "", MCP_AUTH_TOKEN: STATISCHES_TOKEN });
});
