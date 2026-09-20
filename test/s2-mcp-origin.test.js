// E5/S2-A1..A8: die Herkunftswache auf /mcp (MCP-Spec T-06) - Einheits-Faelle des
// Praedikats, HTTP-Faelle am Spawn-Server, Boot-Faelle des angekuendigten Origins.
//
// DIESE DATEI IST DER EINZIGE REGRESSIONSANKER DER WACHE. collectRoutes in
// test/route-auth-inventory.test.js sammelt ausschliesslich layer.route-Schichten; die
// Wache ist eine router.use-Schicht und erscheint in KEINEM handlerNames und in KEINEM
// ROUTE_FINGERPRINT. Faellt der Mount weg, bleibt das Inventar-Gate gruen. Deshalb:
// nicht loeschen, nicht skippen (T4/G4), und KEINE Katalog-ID am Namensanfang - ein
// Praefix aus package.json config.i18nCatalogPattern (DID|E2E|FMT|GAP|LANG|LAW|MCP|
// ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD)-<Ziffer> wuerde die Faelle in test:gates
// verschieben, wo npm test sie nicht mehr festhaelt. Praefix hier: "E5-".
import test from "node:test";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  startServerExpectExit,
  startIdp,
  mcpPost as post,
  MCP_AUDIENCE,
  waitForLog,
} from "./helpers.js";
import { normalisierterOrigin, mcpErlaubteOrigins, mcpOriginErlaubt, originLogWert } from "../src/middleware.js";
import { angekuendigterOriginFindings, kanonischeAudience } from "../src/boot-guard.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_METHOD_NOT_ALLOWED = 405;

// mcpPost (helpers.js) kann keinen Origin setzen - bewusst nicht erweitert: 47
// Testdateien haengen an seiner heutigen Header-Menge, und "kein Origin" ist die
// Baseline, die byte-identisch bleiben MUSS. Hier steht der eine Sender MIT Origin.
function mcpPostMitOrigin(url, { origin, token, body } = {}) {
  const originHeader = origin === undefined ? {} : { Origin: origin };
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json, text/event-stream",
      ...originHeader,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || { jsonrpc: "2.0", id: 1, method: "initialize" }),
  });
}

// ==================================================================================
// Einheits-Faelle (kein Server)
// ==================================================================================

test("E5-U01: normalisierterOrigin normalisiert Schema-Case, Trailing-Slash", () => {
  assert.equal(normalisierterOrigin("https://agent.test"), "https://agent.test");
  assert.equal(normalisierterOrigin("https://agent.test/"), "https://agent.test");
  assert.equal(normalisierterOrigin("HTTPS://Agent.Test"), "https://agent.test");
});

test("E5-U02: normalisierterOrigin -> null bei Muell/leer/undefined/zwei Headern", () => {
  assert.equal(normalisierterOrigin("null"), null);
  assert.equal(normalisierterOrigin(""), null);
  assert.equal(normalisierterOrigin(undefined), null);
  assert.equal(normalisierterOrigin("agent.test"), null);
  assert.equal(normalisierterOrigin("https://a, https://b"), null);
});

test("E5-U03: normalisierterOrigin(foo://Bar) -> null (fail-open-Riegel gegen den opaken 'null'-Origin)", () => {
  assert.equal(normalisierterOrigin("foo://Bar"), null);
});

test("E5-U04: mcpErlaubteOrigins normalisiert publicUrl + additive Liste, verwirft Muell, dedupliziert", () => {
  const liste = mcpErlaubteOrigins({
    publicUrl: "https://agent.test",
    zusaetzlicheOrigins: ["https://chatgpt.com", "https://CHATGPT.com/", "nicht-parsbar"],
  });
  assert.deepEqual(liste, ["https://agent.test", "https://chatgpt.com"]);
});

test("E5-U05: mcpErlaubteOrigins({ publicUrl: '' }) -> [] (definiertes Verhalten statt [''])", () => {
  assert.deepEqual(mcpErlaubteOrigins({ publicUrl: "" }), []);
});

test("E5-U06: mcpOriginErlaubt ohne Origin-Header -> true", () => {
  assert.equal(mcpOriginErlaubt(undefined, []), true);
  assert.equal(mcpOriginErlaubt("", ["https://agent.test"]), true);
});

test("E5-U07: mcpOriginErlaubt mit vorhandenem Origin gegen leere Liste -> false (deny-all)", () => {
  assert.equal(mcpOriginErlaubt("https://x.test", []), false);
});

test("E5-U08: mcpOriginErlaubt Treffer/Nicht-Treffer/Case-Toleranz", () => {
  const erlaubt = ["https://agent.test"];
  assert.equal(mcpOriginErlaubt("https://agent.test", erlaubt), true);
  assert.equal(mcpOriginErlaubt("https://agent.test:8443", erlaubt), false);
  assert.equal(mcpOriginErlaubt("HTTPS://AGENT.TEST", erlaubt), true);
});

test("E5-U09: originLogWert liefert Host oder 'unlesbar', nie den Rohwert", () => {
  assert.equal(originLogWert("https://evil.example"), "evil.example");
  assert.equal(originLogWert("null"), "unlesbar");
  assert.equal(originLogWert("<script>"), "unlesbar");
  assert.equal(originLogWert(""), "unlesbar");
});

test("E5-U10: angekuendigterOriginFindings Happy Path -> []", () => {
  assert.deepEqual(
    angekuendigterOriginFindings({ publicUrl: "https://agent.test", oauthAudience: "" }),
    [],
  );
});

test("E5-U11: angekuendigterOriginFindings mit divergenter Audience -> genau ein fataler Befund", () => {
  const findings = angekuendigterOriginFindings({
    publicUrl: "https://agent.test",
    oauthAudience: "https://andere.test/mcp",
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "angekuendigte_audience_divergent");
  assert.equal(findings[0].fatal, true);
});

test("E5-U12: angekuendigterOriginFindings toleriert Schraegstrich-Differenz (PM-8)", () => {
  assert.deepEqual(
    angekuendigterOriginFindings({
      publicUrl: "https://agent.test",
      oauthAudience: "https://agent.test/mcp/",
    }),
    [],
  );
});

// E8: der GESETZTE, exakt kanonische Wert ist der zweite erlaubte Betriebszustand neben
// "leer" (E5-U10) - live nicht unterscheidbar (RUNBOOK-LIVE-WERTE, F-b), deshalb darf
// KEINER der beiden einen Befund ergeben. Ohne diese Zeile haengt die Zusage nur am
// Spawn-Fall in test/oauth.test.js, der sie als Nebenwirkung mitbelegt statt sie zu pruefen.
test("E8-U01: gesetzte, exakt kanonische OAUTH_AUDIENCE -> kein Befund", () => {
  assert.deepEqual(
    angekuendigterOriginFindings({
      publicUrl: "https://agent.test",
      oauthAudience: kanonischeAudience("https://agent.test"),
    }),
    [],
  );
});

test("E5-U13: angekuendigterOriginFindings mit Pfad in PUBLIC_URL -> fatal public_url_mit_pfad", () => {
  const findings = angekuendigterOriginFindings({ publicUrl: "https://agent.test/gateway" });
  assert.ok(findings.some((finding) => finding.code === "public_url_mit_pfad" && finding.fatal));
});

test("E5-U14: angekuendigterOriginFindings unparsbare PUBLIC_URL -> fatal; leer -> []", () => {
  const unparsbar = angekuendigterOriginFindings({ publicUrl: "nicht-parsbar" });
  assert.ok(unparsbar.some((finding) => finding.code === "public_url_unparsbar" && finding.fatal));
  assert.deepEqual(angekuendigterOriginFindings({ publicUrl: "" }), []);
});

test("E5-U15: angekuendigterOriginFindings http+isProduction -> fatal; ohne isProduction -> []", () => {
  const prod = angekuendigterOriginFindings({ publicUrl: "http://agent.test", isProduction: true });
  assert.ok(prod.some((finding) => finding.code === "public_url_unsicher" && finding.fatal));
  assert.deepEqual(angekuendigterOriginFindings({ publicUrl: "http://agent.test" }), []);
});

test("E5-U16: angekuendigterOriginFindings mit Muell in allowedOrigins -> fatal, Meldung ohne den Wert", () => {
  const findings = angekuendigterOriginFindings({
    publicUrl: "https://agent.test",
    allowedOrigins: ["https://ok.test", "agent-ohne-schema.test"],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "mcp_allowlist_unparsbar");
  assert.equal(findings[0].fatal, true);
  assert.match(findings[0].message, /Eintrag 2/);
  assert.doesNotMatch(findings[0].message, /agent-ohne-schema\.test/);
});

// ==================================================================================
// HTTP-Faelle (Spawn-Server, MCP_AUTH=oauth + lokaler IdP)
// ==================================================================================

describe("E5-H: Herkunftswache am laufenden Server", () => {
  let idp;
  let srv;
  let gueltigesToken;

  before(async () => {
    idp = await startIdp();
    srv = await startServer({
      env: {
        MCP_AUTH: "oauth",
        OAUTH_ISSUER_URL: idp.issuer,
        OAUTH_AUDIENCE: MCP_AUDIENCE,
        // E4: gueltigesToken traegt den Default-sub "user-1" (idp.sign ohne explizites
        // sub) - ohne Bindung wuerde jeder Origin-/Auth-positive Fall am /mcp-Torschluss
        // (TENANT_REJECT -> 403) scheitern, bevor er die Herkunftswache selbst pruefen
        // kann. Die Negativ-Faelle (fremder Origin) bleiben unberuehrt: die Herkunftswache
        // sitzt VOR mcpAuth und dem Torschluss und blockt dort bereits.
        OWNER_IDP_SUBJECT: "user-1",
      },
    });
    gueltigesToken = await idp.sign({ email: "e5@team.test" });
  });

  after(async () => {
    await srv.stop();
    await idp.close();
  });

  it("H01: fremder Origin + gueltiges Token -> 403, kein JSON-RPC", async () => {
    const res = await mcpPostMitOrigin(`${srv.localUrl}/mcp`, {
      origin: "https://evil.example",
      token: gueltigesToken,
    });
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.deepEqual(await res.json(), { error: "cross_origin_blocked" });
  });

  it("H02: fremder Origin ohne Token -> 403, NICHT 401, kein WWW-Authenticate", async () => {
    const res = await mcpPostMitOrigin(`${srv.localUrl}/mcp`, { origin: "https://evil.example" });
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.equal(res.headers.get("www-authenticate"), null);
  });

  it("H03: ohne Origin, ohne Token -> 401 mit WWW-Authenticate (Baseline unveraendert)", async () => {
    const res = await post(`${srv.localUrl}/mcp`, null);
    assert.equal(res.status, HTTP_UNAUTHORIZED);
    const wa = res.headers.get("www-authenticate") || "";
    assert.match(wa, /resource_metadata="https:\/\/agent\.test\/\.well-known\/oauth-protected-resource"/);
  });

  it("H04: ohne Origin, gueltiges Token, tools/list -> 200", async () => {
    const res = await post(`${srv.localUrl}/mcp`, gueltigesToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    assert.equal(res.status, HTTP_OK);
  });

  it("H05: eigener Origin -> nicht 403 (ohne Token 401, mit Token nicht 401)", async () => {
    const ohneToken = await mcpPostMitOrigin(`${srv.localUrl}/mcp`, { origin: "https://agent.test" });
    assert.equal(ohneToken.status, HTTP_UNAUTHORIZED);
    const mitToken = await mcpPostMitOrigin(`${srv.localUrl}/mcp`, {
      origin: "https://agent.test",
      token: gueltigesToken,
    });
    assert.notEqual(mitToken.status, HTTP_FORBIDDEN);
  });

  it("H06: Origin-Normalisierung (Case, Trailing-Slash) -> nicht 403", async () => {
    const gross = await mcpPostMitOrigin(`${srv.localUrl}/mcp`, {
      origin: "HTTPS://Agent.Test",
      token: gueltigesToken,
    });
    assert.notEqual(gross.status, HTTP_FORBIDDEN);
    const slash = await mcpPostMitOrigin(`${srv.localUrl}/mcp`, {
      origin: "https://agent.test/",
      token: gueltigesToken,
    });
    assert.notEqual(slash.status, HTTP_FORBIDDEN);
  });

  it("H07a: Origin=null -> 403", async () => {
    const res = await mcpPostMitOrigin(`${srv.localUrl}/mcp`, { origin: "null", token: gueltigesToken });
    assert.equal(res.status, HTTP_FORBIDDEN);
  });

  it("H07b: fremder Port (Origin != erlaubter Origin) -> 403", async () => {
    const res = await mcpPostMitOrigin(`${srv.localUrl}/mcp`, {
      origin: "https://agent.test:8443",
      token: gueltigesToken,
    });
    assert.equal(res.status, HTTP_FORBIDDEN);
  });

  it("H07c: zwei zusammengefasste Origin-Header ('a, b') -> 403", async () => {
    const res = await fetch(`${srv.localUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Accept: "application/json, text/event-stream",
        Origin: "https://agent.test, https://evil.example",
        Authorization: `Bearer ${gueltigesToken}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    assert.equal(res.status, HTTP_FORBIDDEN);
  });
});

// Zweiter describe-Block (G30/max-lines-per-function): dieselbe Wache, derselbe Server-
// Aufbau wie oben - nur in ein eigenes before/after gespiegelt, damit keine einzelne
// Funktion die Laenge aller H-Faelle traegt. Kein fachlicher Unterschied zu "E5-H" oben.
describe("E5-H (Methoden, Pfad, Forensik, Formel-Pin)", () => {
  let idp;
  let srv;
  let gueltigesToken;

  before(async () => {
    idp = await startIdp();
    srv = await startServer({
      env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, OAUTH_AUDIENCE: MCP_AUDIENCE },
    });
    gueltigesToken = await idp.sign({ email: "e5b@team.test" });
  });

  after(async () => {
    await srv.stop();
    await idp.close();
  });

  it("H08: GET/DELETE fremder Origin -> 403 (nicht 405); GET ohne Origin -> weiter 405", async () => {
    const getFremd = await fetch(`${srv.localUrl}/mcp`, {
      method: "GET",
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(getFremd.status, HTTP_FORBIDDEN);
    const getOhne = await fetch(`${srv.localUrl}/mcp`, { method: "GET" });
    assert.equal(getOhne.status, HTTP_METHOD_NOT_ALLOWED);
    const deleteFremd = await fetch(`${srv.localUrl}/mcp`, {
      method: "DELETE",
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(deleteFremd.status, HTTP_FORBIDDEN);
  });

  it("H09: OPTIONS fremder Origin -> 403 (Vertragsaenderung); ohne Origin -> 200", async () => {
    const optFremd = await fetch(`${srv.localUrl}/mcp`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(optFremd.status, HTTP_FORBIDDEN);
    const optOhne = await fetch(`${srv.localUrl}/mcp`, { method: "OPTIONS" });
    assert.equal(optOhne.status, HTTP_OK);
  });

  it("H10: POST /mcp/foo fremder Origin -> 403 (nicht 404)", async () => {
    const res = await fetch(`${srv.localUrl}/mcp/foo`, {
      method: "POST",
      headers: { Origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, HTTP_FORBIDDEN);
  });

  it("H11: Forensik - genau eine Zeile je Ablehnung, unlesbarer Origin wird als solcher geloggt", async () => {
    const vorher = srv.stdout.length;
    const res = await mcpPostMitOrigin(`${srv.localUrl}/mcp`, {
      origin: "https://evil.example",
      token: gueltigesToken,
    });
    assert.equal(res.status, HTTP_FORBIDDEN);
    await waitForLog(srv, /grund=mcp_cross_origin origin=evil\.example/);
    const neu = srv.stdout.slice(vorher);
    const treffer = neu.match(/grund=mcp_cross_origin origin=evil\.example/g) || [];
    assert.equal(treffer.length, 1);

    const nullRes = await mcpPostMitOrigin(`${srv.localUrl}/mcp`, {
      origin: "null",
      token: gueltigesToken,
    });
    assert.equal(nullRes.status, HTTP_FORBIDDEN);
    await waitForLog(srv, /grund=mcp_cross_origin origin=unlesbar/);
  });

  // H12 (PM-7, Positiv-Kontrolle): die Wache ist an "/mcp" GEMOUNTET, nicht global.
  // /api/self-service/* ist im Default-Testumfeld ungemountet (SELF_SERVICE_ENABLED +
  // MULTI_TENANT + STORE_BACKEND=pg noetig, s. test/self-service-flag-gate.test.js) -
  // die dortige Herkunftspruefung (createSameOriginGuard) ist bereits eigenstaendig in
  // test/sec-p3-eingabegrenzen-csrf.test.js belegt (G5: keine zweite pg-Kompositions-
  // Umgebung nur fuer diese eine Zeile). Positiv-Kontrolle hier: /healthz (immer gemountet,
  // ausserhalb "/mcp") UND /api/plans (oeffentliche Route, ausserhalb "/mcp") bleiben mit
  // fremdem Origin unberuehrt - der Mount deckt GENAU "/mcp", nicht das Gateway.
  it("H12: Pfadbindung - Routen ausserhalb /mcp bleiben mit fremdem Origin unberuehrt", async () => {
    const health = await fetch(`${srv.localUrl}/healthz`, { headers: { Origin: "https://evil.example" } });
    assert.equal(health.status, HTTP_OK);

    const plans = await fetch(`${srv.localUrl}/api/plans`, { headers: { Origin: "https://evil.example" } });
    assert.equal(plans.status, HTTP_OK);
  });

  it("H13: Formel-Pin - PRM.resource === kanonische Audience", async () => {
    const res = await fetch(`${srv.localUrl}/.well-known/oauth-protected-resource`);
    const doc = await res.json();
    assert.equal(doc.resource, kanonischeAudience("https://agent.test"));
    assert.equal(doc.resource, MCP_AUDIENCE);
  });
});

describe("E5-H14: MCP_ALLOWED_ORIGINS ist additiv, nicht ersetzend", () => {
  let idp;
  let srv;
  let token;

  before(async () => {
    idp = await startIdp();
    srv = await startServer({
      env: {
        MCP_AUTH: "oauth",
        OAUTH_ISSUER_URL: idp.issuer,
        OAUTH_AUDIENCE: MCP_AUDIENCE,
        MCP_ALLOWED_ORIGINS: "https://chatgpt.com",
        // E4: s. Kommentar im "E5-H"-Block oben - der Default-sub "user-1" braucht eine
        // Tenant-Bindung, sonst greift der /mcp-Torschluss VOR der Herkunftswaage-Aussage.
        OWNER_IDP_SUBJECT: "user-1",
      },
    });
    token = await idp.sign({ email: "e5h14@team.test" });
  });

  after(async () => {
    await srv.stop();
    await idp.close();
  });

  it("chatgpt.com nicht 403", async () => {
    const res = await mcpPostMitOrigin(`${srv.localUrl}/mcp`, { origin: "https://chatgpt.com", token });
    assert.notEqual(res.status, HTTP_FORBIDDEN);
  });

  it("agent.test (PUBLIC_URL) weiter nicht 403", async () => {
    const res = await mcpPostMitOrigin(`${srv.localUrl}/mcp`, { origin: "https://agent.test", token });
    assert.notEqual(res.status, HTTP_FORBIDDEN);
  });

  it("evil.example weiter 403", async () => {
    const res = await mcpPostMitOrigin(`${srv.localUrl}/mcp`, { origin: "https://evil.example", token });
    assert.equal(res.status, HTTP_FORBIDDEN);
  });
});

test("E5-H15: Notventil MCP_ORIGIN_ENFORCE=false loest die Wache, schreibt keine Zeile", async () => {
  // MCP_AUTH=token OHNE Token erzwingt 401 unabhaengig vom Legacy-Localhost-Bypass
  // (der Default-Modus wuerde hier lokal 200 liefern und den Beweis verdecken).
  const srv = await startServer({ env: { MCP_ORIGIN_ENFORCE: "false", MCP_AUTH: "token" } });
  try {
    const vorher = srv.stdout.length;
    const res = await mcpPostMitOrigin(`${srv.localUrl}/mcp`, { origin: "https://evil.example" });
    assert.equal(res.status, HTTP_UNAUTHORIZED, "nicht 403 - die Wache ist geloest, mcpAuth greift wie sonst");
    assert.doesNotMatch(srv.stdout.slice(vorher), /grund=mcp_cross_origin/);
  } finally {
    await srv.stop();
  }
});

// ==================================================================================
// Boot-Faelle (startServerExpectExit)
// ==================================================================================

test("E5-B01: divergente OAUTH_AUDIENCE -> Boot-Refusal, nennt OAUTH_AUDIENCE", async () => {
  const { code, output } = await startServerExpectExit({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: "https://idp.test", OAUTH_AUDIENCE: "https://andere.test/mcp" },
  });
  assert.equal(code, 1);
  assert.match(output, /\[boot\] Start abgebrochen/);
  assert.match(output, /OAUTH_AUDIENCE/);
  assert.doesNotMatch(output, /Gateway laeuft/);
});

test("E5-B02: PUBLIC_URL mit Pfad -> Boot-Refusal, nennt PUBLIC_URL", async () => {
  const { code, output } = await startServerExpectExit({
    env: { PUBLIC_URL: "https://agent.test/gateway" },
  });
  assert.equal(code, 1);
  assert.match(output, /PUBLIC_URL/);
});

test("E5-B03: MCP_ALLOWED_ORIGINS ohne Schema -> Boot-Refusal, Wert nicht im Output", async () => {
  const { code, output } = await startServerExpectExit({
    env: { MCP_ALLOWED_ORIGINS: "agent.test" },
  });
  assert.equal(code, 1);
  assert.match(output, /MCP_ALLOWED_ORIGINS/);
  assert.doesNotMatch(output, /agent\.test/);
});

test("E5-B04: Hosting (RENDER_EXTERNAL_URL) + PUBLIC_URL=http -> Boot-Refusal", async () => {
  const { code } = await startServerExpectExit({
    env: {
      RENDER_EXTERNAL_URL: "https://hermes.onrender.com",
      PUBLIC_URL: "http://agent.test",
      DASHBOARD_PASSWORD: "geheim",
    },
  });
  assert.equal(code, 1);
});

test("E5-B05: Happy-Path-Schraegstrich - PUBLIC_URL/OAUTH_AUDIENCE mit/ohne Slash startet", async () => {
  const srv = await startServer({
    env: { PUBLIC_URL: "https://agent.test/", OAUTH_AUDIENCE: "" },
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, HTTP_OK);
  } finally {
    await srv.stop();
  }
});
