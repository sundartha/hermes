// E1 (PLAN-OPENAI.md Etappe 1, S5-A4 + F1-F4): Test des read-only
// Messwerkzeugs scripts/probe-as-faehigkeiten.mjs. Reine Funktionen laufen
// offline gegen eine Attrappe (Lehre "Messwerkzeug braucht Attrappe" -
// alle Blocker lagen im Fehlerfall); der IO-Teil per Kindprozess-Spawn
// (Muster test/anruf-unterbrechungen-script.test.js) und - fuer die
// Ende-zu-Ende-Faelle - gegen den echten Gateway (Muster test/oauth.test.js).
//
// Neues Verhalten braucht einen Test (P11): vor dieser Datei gibt es keine
// Zeile Code fuer diese Sonde.
//
// Fixture "vollstaendiges AuthKit-Dokument": die Feldliste stammt woertlich
// aus tasks/openai-fix/S5-authorization-server.md, Abschnitt "Kann der AS
// das?" (authorization_endpoint/token_endpoint/introspection_endpoint/
// registration_endpoint/issuer/code_challenge_methods_supported/
// grant_types_supported/scopes_supported/response_types_supported/
// response_modes_supported/token_endpoint_auth_methods_supported), ergaenzt
// um jwks_uri/userinfo_endpoint/client_id_metadata_document_supported/
// authorization_response_iss_parameter_supported (im selben Dokument als
// AS-Faehigkeiten diskutiert, nicht im Kurzbeispiel enthalten).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

import { ROOT, startServer, startIdp, MCP_AUDIENCE } from "./helpers.js";
import {
  bewerteFaehigkeiten,
  bewerteVorhanden,
  bewerteWahr,
  bewerteWahrOderUnbekannt,
  liesZiel,
  a3Vorhersage,
  messePrm,
  messeMcpModus,
  messeAsMetadata,
  exitCodeAus,
  sondiere,
  ohneEndSchraegstrich,
} from "../scripts/probe-as-faehigkeiten.mjs";

const SPAWN_TIMEOUT_MS = 8000;
const EXIT_OK = 0;
const EXIT_PFLICHT_VERLETZT = 1;
const EXIT_AUFRUFFEHLER = 2;
const FAEHIGKEITEN_ANZAHL = 8;
const HTTP_NOT_FOUND = 404;

const ISSUER = "https://idp.example";

function vollstaendigesAsDokument(overrides = {}) {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    introspection_endpoint: `${ISSUER}/introspect`,
    registration_endpoint: `${ISSUER}/register`,
    userinfo_endpoint: `${ISSUER}/oauth2/userinfo`,
    jwks_uri: `${ISSUER}/jwks`,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    scopes_supported: ["email", "offline_access", "openid", "profile"],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    ...overrides,
  };
}

// Konstanter Abruf-Spion: zaehlt Aufrufe, antwortet nach einer festen
// Tabelle {url -> {status, doc}}. Netzfrei, deterministisch.
function machAbrufAttrappe(tabelle) {
  const aufrufe = [];
  const abrufen = async (url) => {
    aufrufe.push(url);
    const eintrag = tabelle[url];
    if (!eintrag) throw new Error(`Attrappe kennt die URL nicht: ${url}`);
    return { status: eintrag.status, doc: eintrag.doc ?? null, fehler: eintrag.fehler ?? null, header: eintrag.header || (() => null) };
  };
  return { abrufen, aufrufe };
}

test("E1-1 vollstaendiges AS-Dokument: 8 Zeilen, S256 PASS, Reihenfolge stabil", async () => {
  const zeilen = await bewerteFaehigkeiten(vollstaendigesAsDokument(), ISSUER);
  assert.equal(zeilen.length, FAEHIGKEITEN_ANZAHL);
  zeilen.forEach((zeile, index) => {
    assert.match(zeile.name, new RegExp(`^${index + 1}/${FAEHIGKEITEN_ANZAHL} `));
  });
  const s256Zeile = zeilen.find((zeile) => zeile.name.includes("PKCE S256"));
  assert.equal(s256Zeile.status, "PASS");
  zeilen.forEach((zeile) => assert.notEqual(zeile.status, "UNKNOWN"));
});

test("E1-2 issuer-Gleichheit: Endschraegstrich egal, fremder Host FAIL", async () => {
  const mitSlash = await bewerteFaehigkeiten(vollstaendigesAsDokument({ issuer: `${ISSUER}/` }), ISSUER);
  assert.equal(mitSlash[0].status, "PASS");

  const fremderHost = await bewerteFaehigkeiten(vollstaendigesAsDokument({ issuer: "https://fremd.example" }), ISSUER);
  assert.equal(fremderHost[0].status, "FAIL");

  assert.equal(ohneEndSchraegstrich("https://x/"), "https://x");
  assert.equal(ohneEndSchraegstrich("https://x"), "https://x");
});

test("E1-3 jwks_uri cross-origin ergibt FAIL, aber nur BEFUND (Exit bleibt 0)", async () => {
  const zeilen = await bewerteFaehigkeiten(vollstaendigesAsDokument({ jwks_uri: "https://anderer-host.example/jwks" }), ISSUER);
  const jwksZeile = zeilen.find((zeile) => zeile.name.includes("jwks_uri"));
  assert.equal(jwksZeile.status, "FAIL");
  assert.equal(jwksZeile.gewicht, "BEFUND");
  assert.equal(exitCodeAus(zeilen), EXIT_OK);
});

test("E1-4 T-11 fehlendes Feld ergibt UNKNOWN, false ergibt FAIL", () => {
  assert.equal(bewerteWahrOderUnbekannt(undefined), "UNKNOWN");
  assert.equal(bewerteWahrOderUnbekannt(false), "FAIL");
  assert.equal(bewerteWahrOderUnbekannt(true), "PASS");
});

test("E1-5 CIMD fehlend ergibt FAIL (nicht UNKNOWN)", () => {
  assert.equal(bewerteWahr(undefined), "FAIL");
  assert.equal(bewerteWahr(false), "FAIL");
  assert.equal(bewerteWahr(true), "PASS");
  assert.equal(bewerteVorhanden(undefined), "FAIL");
  assert.equal(bewerteVorhanden(""), "FAIL");
  assert.equal(bewerteVorhanden("https://x/register"), "PASS");
});

test("E1-6 fehlendes AS-Dokument ergibt 8x UNKNOWN mit Grund", async () => {
  const zeilen = await bewerteFaehigkeiten(null, ISSUER);
  assert.equal(zeilen.length, FAEHIGKEITEN_ANZAHL);
  zeilen.forEach((zeile) => {
    assert.equal(zeile.status, "UNKNOWN");
    assert.match(zeile.detail, /nicht gemessen/);
  });
});

test("E1-7 A3-Vorhersage: NEIN / JA / UNBEKANNT", () => {
  const publicUrl = "https://agent.test";
  const nein = a3Vorhersage({ resource: `${publicUrl}/mcp`, publicUrl });
  assert.equal(nein.status, "NEIN");

  const ja = a3Vorhersage({ resource: "https://workos-resource.example/mcp", publicUrl });
  assert.equal(ja.status, "JA");

  const unbekannt = a3Vorhersage({ resource: null, publicUrl: null });
  assert.equal(unbekannt.status, "UNBEKANNT");
});

test("E1-8 ohne Argument: Exit 2 und KEINE Netzanfrage", async () => {
  const { abrufen, aufrufe } = machAbrufAttrappe({});
  const bericht = await sondiere([], { abrufen });
  assert.equal(bericht.exitCode, EXIT_AUFRUFFEHLER);
  assert.equal(bericht.aufrufFehler, true);
  assert.equal(aufrufe.length, 0);
});

test("E1-9 unbrauchbares Argument (file:, leer, zwei Argumente): Exit 2, kein Abruf", async () => {
  assert.equal(liesZiel(["file:///etc/passwd"]), null);
  assert.equal(liesZiel([""]), null);
  assert.equal(liesZiel(["https://a.test", "https://b.test"]), null);
  assert.equal(liesZiel(["nicht-eine-url"]), null);
  assert.equal(liesZiel(["https://a.test"]), "https://a.test");

  const { abrufen, aufrufe } = machAbrufAttrappe({});
  const bericht = await sondiere(["file:///etc/passwd"], { abrufen });
  assert.equal(bericht.exitCode, EXIT_AUFRUFFEHLER);
  assert.equal(aufrufe.length, 0);
});

test("E1-10 Attrappe mit vollstaendigem AS: alle PFLICHT PASS -> Exit 0", async () => {
  const basis = "https://gateway.example";
  const tabelle = {
    [`${basis}/.well-known/oauth-protected-resource`]: {
      status: 200,
      doc: { resource: `${basis}/mcp`, authorization_servers: [ISSUER] },
    },
    [`${basis}/mcp`]: {
      status: 401,
      header: (name) => (name === "www-authenticate" ? `Bearer resource_metadata="${basis}/.well-known/oauth-protected-resource"` : null),
    },
    [`${ISSUER}/.well-known/oauth-authorization-server`]: { status: 200, doc: vollstaendigesAsDokument() },
    [`${ISSUER}/.well-known/openid-configuration`]: { status: HTTP_NOT_FOUND },
  };
  const { abrufen } = machAbrufAttrappe(tabelle);
  const bericht = await sondiere([basis], { abrufen });
  assert.equal(bericht.exitCode, EXIT_OK);
  assert.equal(bericht.prm.zeile.status, "PASS");
  assert.equal(bericht.mcpModus.modus, "oauth");
  assert.equal(bericht.mcpModus.publicUrl, basis);
  assert.equal(bericht.vorhersage.status, "NEIN");
  assert.equal(bericht.asMeta.zeile.status, "PASS");
});

test("E1-11 PRM 404: benannte FAIL-Zeile + Exit 1", async () => {
  const basis = "https://gateway.example";
  const tabelle = {
    [`${basis}/.well-known/oauth-protected-resource`]: { status: HTTP_NOT_FOUND },
    [`${basis}/mcp`]: { status: HTTP_NOT_FOUND },
  };
  const { abrufen } = machAbrufAttrappe(tabelle);
  const bericht = await sondiere([basis], { abrufen });
  assert.equal(bericht.prm.zeile.status, "FAIL");
  assert.match(bericht.prm.zeile.detail, /PRM fehlt -> F1\/F2 nicht feststellbar, A3 NICHT deployen/);
  assert.equal(bericht.exitCode, EXIT_PFLICHT_VERLETZT);
  const faehigkeitenZeilen = bericht.asMeta.faehigkeiten;
  assert.equal(faehigkeitenZeilen.length, FAEHIGKEITEN_ANZAHL);
  faehigkeitenZeilen.forEach((zeile) => assert.equal(zeile.status, "UNKNOWN"));
});

test("E1-12 AS-Metadata 404 auf beiden Pfaden: Exit 1, 8x UNKNOWN", async () => {
  const basis = "https://gateway.example";
  const tabelle = {
    [`${basis}/.well-known/oauth-protected-resource`]: {
      status: 200,
      doc: { resource: `${basis}/mcp`, authorization_servers: [ISSUER] },
    },
    [`${basis}/mcp`]: { status: HTTP_NOT_FOUND },
    [`${ISSUER}/.well-known/oauth-authorization-server`]: { status: HTTP_NOT_FOUND },
    [`${ISSUER}/.well-known/openid-configuration`]: { status: HTTP_NOT_FOUND },
  };
  const { abrufen } = machAbrufAttrappe(tabelle);
  const bericht = await sondiere([basis], { abrufen });
  assert.equal(bericht.asMeta.zeile.status, "FAIL");
  assert.equal(bericht.exitCode, EXIT_PFLICHT_VERLETZT);
  bericht.asMeta.faehigkeiten.forEach((zeile) => assert.equal(zeile.status, "UNKNOWN"));
});

test("E1-12b messePrm/messeMcpModus/messeAsMetadata direkt gegen die Attrappe", async () => {
  const basis = "https://gateway.example";
  const tabelle = {
    [`${basis}/.well-known/oauth-protected-resource`]: {
      status: 200,
      doc: { resource: `${basis}/mcp`, authorization_servers: [ISSUER] },
    },
    [`${basis}/mcp`]: { status: HTTP_NOT_FOUND },
    [`${ISSUER}/.well-known/oauth-authorization-server`]: { status: 200, doc: vollstaendigesAsDokument() },
    [`${ISSUER}/.well-known/openid-configuration`]: { status: HTTP_NOT_FOUND },
  };
  const { abrufen } = machAbrufAttrappe(tabelle);
  const prm = await messePrm(basis, { abrufen });
  assert.equal(prm.issuer, ISSUER);
  assert.equal(prm.resource, `${basis}/mcp`);

  const mcpModus = await messeMcpModus(basis, { abrufen });
  assert.equal(mcpModus.modus, null);
  assert.equal(mcpModus.zeile.status, "FAIL");

  const asMeta = await messeAsMetadata(ISSUER, { abrufen });
  assert.equal(asMeta.zeile.status, "PASS");
  assert.equal(asMeta.faehigkeiten.length, FAEHIGKEITEN_ANZAHL);
});

function runSonde(argv, env) {
  const child = spawn(process.execPath, ["scripts/probe-as-faehigkeiten.mjs", ...argv], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`probe-as-faehigkeiten.mjs ist nicht rechtzeitig beendet. stdout: ${stdout} stderr: ${stderr}`));
    }, SPAWN_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test("E1-13 gegen den echten Gateway: F1/F2/F3 und publicUrl stimmen", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, OAUTH_AUDIENCE: MCP_AUDIENCE },
  });
  try {
    const bericht = await sondiere([srv.localUrl]);
    assert.equal(bericht.prm.issuer, idp.issuer);
    assert.equal(bericht.prm.resource, MCP_AUDIENCE);
    assert.equal(bericht.mcpModus.modus, "oauth");
    assert.equal(bericht.mcpModus.publicUrl, "https://agent.test");
    assert.equal(bericht.vorhersage.status, "NEIN");
    // Der lokale Mini-IdP bewirbt kein S256 -> PFLICHT-FAIL schlaegt auf den Exit durch.
    assert.equal(bericht.exitCode, EXIT_PFLICHT_VERLETZT);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("E1-14 Sonde gegen Host ohne PRM (Mini-IdP) -> Exit 1", async () => {
  const idp = await startIdp();
  try {
    const bericht = await sondiere([idp.issuer]);
    assert.equal(bericht.prm.zeile.status, "FAIL");
    assert.equal(bericht.exitCode, EXIT_PFLICHT_VERLETZT);
  } finally {
    await idp.close();
  }
});

test("E1-15 Quelltext-Gate: kein process.env, kein Authorization/Cookie, kein Schreibweg", async () => {
  const fs = await import("node:fs/promises");
  const quelltext = await fs.readFile(`${ROOT}/scripts/probe-as-faehigkeiten.mjs`, "utf8");
  const kommentarfrei = quelltext.replace(/\/\/.*$/gm, "");

  // "authorization" als Wortstueck ist im Quelltext ERWARTET (well-known-Pfade
  // wie oauth-authorization-server, Feldnamen wie authorization_servers/
  // authorization_endpoint/authorization_response_iss_parameter_supported) -
  // das Gate prueft deshalb gezielt das GESETZTE Header-Paar "Authorization:",
  // nicht das Wortstueck.
  assert.doesNotMatch(kommentarfrei, /process\.env/);
  assert.doesNotMatch(kommentarfrei, /["']?Authorization["']?\s*:/);
  assert.doesNotMatch(kommentarfrei, /cookie/i);
  assert.doesNotMatch(kommentarfrei, /from\s+["']node:fs["']/);
  assert.doesNotMatch(kommentarfrei, /writeFile|appendFile|createWriteStream/);
  assert.doesNotMatch(kommentarfrei, /method:\s*"(PUT|PATCH|DELETE)"/);

  // Positiv-Kontrolle (Lehre pruefkommando-ohne-positiv-kontrolle): dieselben
  // Regexe MUESSEN auf einen synthetischen Schnipsel treffen.
  const verdaechtigerSchnipsel =
    'const t = process.env.TOKEN;\nfetch(url, { headers: { Authorization: t, cookie: "x" }, method: "DELETE" });\nimport { writeFile } from "node:fs";\n';
  assert.match(verdaechtigerSchnipsel, /process\.env/);
  assert.match(verdaechtigerSchnipsel, /["']?Authorization["']?\s*:/);
  assert.match(verdaechtigerSchnipsel, /cookie/i);
  assert.match(verdaechtigerSchnipsel, /from\s+["']node:fs["']/);
  assert.match(verdaechtigerSchnipsel, /writeFile|appendFile|createWriteStream/);
  assert.match(verdaechtigerSchnipsel, /method:\s*"(PUT|PATCH|DELETE)"/);
});

test("E1-16 Spawn ohne Argument: Exit 2, USAGE auf stderr, stdout leer", async () => {
  const { code, stdout, stderr } = await runSonde([], { NODE_ENV: "test" });
  assert.equal(code, EXIT_AUFRUFFEHLER);
  assert.match(stderr, /Aufruf: node scripts\/probe-as-faehigkeiten\.mjs/);
  assert.equal(stdout, "");
});
