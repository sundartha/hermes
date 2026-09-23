// T2-07 (T-28): Rate-Limit fuer POST /mcp je MANDANT statt je IP, am echten HTTP-Draht
// (gespawnter Server). FENSTER_LIMIT haelt jeden Fall kurz. Jeder Fall nutzt eine FRISCHE
// X-Forwarded-For-IP bzw. einen frischen Server, damit sich Fenster nicht gegenseitig
// beeinflussen (Fixed-Window, RATE_WINDOW_MS=60s, middleware.js).
// mcpPost (helpers.js) nimmt keinen Header-Parameter - mcpPostFrom hier ist die
// XFF-faehige Variante (Muster httpResourceReadFromIp, openai-t2-01-widget-resource-
// meta.test.js), als EIN Optionsobjekt statt eines vierten Positionsarguments (F1: max
// 3 Argumente). X-Forwarded-For macht den Request NICHT vertrauenswuerdig-lokal
// (isTrustedLocalCaller verlangt zusaetzlich KEIN X-Forwarded-For) - erst dadurch zaehlen
// die Drosseln ueberhaupt.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, startIdp, seedState, externalIp } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY = 429;
const HTTP_PAYLOAD_TOO_LARGE = 413;
// Fenster-Limit fuer ALLE Faelle dieser Datei (RATE_LIMIT_PER_MIN=FENSTER_LIMIT) - haelt
// jeden Fall kurz. UEBER_LIMIT ist der eine Versuch mehr als das Fenster traegt.
const FENSTER_LIMIT = 3;
const UEBER_LIMIT = FENSTER_LIMIT + 1;
const RATE_LIMIT_PER_MIN_TEST = String(FENSTER_LIMIT);
// (g): Body groesser als BODY_LIMIT ("100kb", src/app.js) - provoziert 413 hinter mcpAuth.
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

const initBody = { jsonrpc: "2.0", id: 1, method: "initialize" };
const oauthEnv = (idp, overrides = {}) => ({
  MCP_AUTH: "oauth",
  OAUTH_ISSUER_URL: idp.issuer,
  RATE_LIMIT_PER_MIN: RATE_LIMIT_PER_MIN_TEST,
  ...overrides,
});

// (a) Mandant A FENSTER_LIMIT-mal 200, danach 429 mit Retry-After; Mandant B (dieselbe
// IP) -> 200.
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

// (b) FENSTER_LIMIT falsch signierte Tokens -> je 401 mit WWW-Authenticate; danach 429;
// ein GUELTIGES Token derselben IP -> 200 (der Ablehnungs-Zaehler ist vom Mandanten-
// Zaehler getrennt).
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

// (c) UEBER_LIMIT abgelaufene, gueltig signierte Tokens mit ebenso vielen VERSCHIEDENEN
// subs, dieselbe IP -> je 401 mit WWW-Authenticate, KEIN 429 (Egress-Schutz - ein
// abgelaufenes Token ist der normale Refresh-Anlass legitimer Clients hinter geteilten
// Egress-IPs).
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

// (d) UEBER_LIMIT abgelaufene Tokens DERSELBEN sub -> FENSTER_LIMIT-mal 401, danach 429
// (das Budget je verifizierter sub ist begrenzt, s. (c)).
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

// (e) UEBER_LIMIT Muell-Tokens (falsche Signatur) mit ebenso vielen verschiedenen
// UNVERIFIZIERTEN sub-Claims -> FENSTER_LIMIT-mal 401, danach 429 (der Schluessel ist die
// IP, NIE eine unverifizierte sub - sonst koennte ein Angreifer die Zaehler-Map mit
// beliebig vielen subs fuellen).
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

// (f) Kein Token FENSTER_LIMIT-mal 401, danach 429.
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

// (g) Parser hinter Auth: ein grosser JSON-Body mit Muell-Token -> 401 (nicht 413/400 vom
// Parser - der Parser sieht den Body nie, weil mcpAuth vorher ablehnt); mit gueltigem
// Token -> 413 (der Parser laeuft jetzt, derselbe BODY_LIMIT wie global); kaputtes JSON
// OHNE Token -> 401 (nicht 400 - wieder: der Parser sieht es nie).
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

// (h) Nicht-/mcp-Route bleibt vom neuen /mcp-Zaehler unberuehrt: nach FENSTER_LIMIT
// /mcp-POSTs von IP X antwortet /healthz derselben IP weiterhin 200 (POST /mcp wird nicht
// mehr im globalen IP-Eimer gezaehlt); von einer FRISCHEN IP Y laeuft der letzte Versuch
// in den GLOBALEN Limiter (unveraendert).
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

// (i) Token-Modus (MCP_AUTH=token): gleiche XFF, FENSTER_LIMIT Anfragen mit gueltigem
// Token -> nicht 429 (Status wie heute: 403, kein Mandant im Token-Modus), danach 429;
// falsches Token FENSTER_LIMIT-mal 401, danach 429 (der Mandanten-Zaehler faellt im
// Token-/Legacy-Modus auf die IP zurueck, s. mandantSchluessel).
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

// (j) Interface-IP-Gegenprobe: Fall (a) ueber die echte Netzwerkschnittstelle statt XFF -
// belegt, dass der Mandanten-Zaehler nicht an der Kunst-IP aus X-Forwarded-For haengt.
// Uebersprungen ohne ermittelbare externe Interface-IP (CI/Sandbox ohne Netzwerk).
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

// (k) OAuth-Token ohne Mandant (Stub-Fassade, T2-05): zaehlt je verifizierter sub - zwei
// unbekannte subs, dieselbe IP, je FENSTER_LIMIT-mal -> kein 429 (getrennte Eimer je sub).
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
