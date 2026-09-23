// T-14 (T2-05): OAuth-Login OHNE verknuepften Hermes-Mandanten. Statt der Route
// pauschal mit HTTP 403 zu antworten (frueherer Stand, s. Kommentar routes/mcp.js),
// bekommt der Client eine normale Werkzeugliste (initialize/tools/list unveraendert)
// und JEDER tools/call liefert einen Tool-Fehler mit einer Re-Auth-Challenge in
// _meta["mcp/www_authenticate"] (plugins/build/auth: "runtime errors that carry
// mcp/www_authenticate" - nur so zeigt ChatGPT die Konto-Verknuepfung an).
//
// SICHERHEITS-INVARIANTE (Pre-Mortem 1, PLAN-OPENAI-TECHNIK-2.md T2-05): dieser Pfad
// ruft NIEMALS api() und liest NIEMALS aus dem Store. Ein echter Tool-Handler darf
// hier unter keinen Umstaenden laufen, weil ein X-Internal-Tenant-loser Aufruf im
// REST-Hop sonst auf operatorChannelTenant (BOOTSTRAP = Owner) zurueckfiele. Deshalb:
// - die Fassade unten hat GENAU zwei Methoden (registerTool, registerResource); jede
//   andere Server-Methode, die ein kuenftiger zweiter Registrierweg in registerTools
//   aufriefe, wirft TypeError -> 500 im catch der Route (fail-closed);
// - registerTool() VERWIRFT den uebergebenen Original-Handler und ruft immer denselben
//   synchron-trivialen Stub auf (kein fetch, kein api(), kein Store);
// - scopedTenant wird hart auf TENANT_REJECT gezwungen (nie null), damit selbst ein
//   versehentlich durchgereichter echter Handler nie in einen Legacy-/Operator-
//   Rueckfall liefe.
import { registerTools } from "./mcp-tools.js";
import { oauthBearerChallenge } from "./auth.js";
import { MCP_ERROR_CODE } from "./i18n/mcp-texts.js";
import { localeFor } from "./i18n/locales.js";
import { TENANT_REJECT } from "./request-tenant.js";

// RFC-7235-Challenge-Parameter fuer diesen Fall: das Token ist gueltig (sonst waere
// mcpAuth schon mit 401 abgebrochen), es fehlt nur die Mandanten-Zuordnung - das ist
// begrifflich RFC 6750 "requires higher privileges" (insufficient_scope), nicht ein
// ungueltiges Token. ASCII, ohne doppelte Anfuehrungszeichen (landet als Wert IN einem
// bereits doppelt gequoteten Header-Parameter).
const NO_TENANT_ERROR = "insufficient_scope";
const NO_TENANT_DESCRIPTION = "No Hermes account is linked to this login";

// Einzige Stelle mit diesem Metadaten-Schluessel (Beweis S1: grep in src/ liefert nur
// diese Datei).
const MCP_WWW_AUTHENTICATE_META = "mcp/www_authenticate";

// Baut das Tool-Fehlerergebnis fuer die uebergebene Sprache. Eigene, exportierte
// Funktion (statt inline in registerNoTenantStubs) - der Unit-Test in
// test/openai-t2-05-reauth-challenge.test.js prueft Form und Inhalt direkt, ohne einen
// Fake-Server zu bauen.
export function buildNoTenantResult(language) {
  const text = localeFor(language).mcp.errors[MCP_ERROR_CODE.NO_TENANT_LINKED];
  return Object.freeze({
    content: Object.freeze([Object.freeze({ type: "text", text })]),
    isError: true,
    _meta: Object.freeze({
      [MCP_WWW_AUTHENTICATE_META]: Object.freeze([oauthBearerChallenge(NO_TENANT_ERROR, NO_TENANT_DESCRIPTION)]),
    }),
  });
}

// Fassade fuer registerTools: GENAU zwei Methoden, plain object (keine Proxy-Magie),
// damit jede fehlende Server-Methode sichtbar mit TypeError bricht statt still zu
// verpuffen (Pre-Mortem 1).
function noTenantFacade(server, stubHandler) {
  return {
    registerTool: (name, config) => server.registerTool(name, config, stubHandler),
    registerResource: (...args) => server.registerResource(...args),
  };
}

// Registriert dieselbe Werkzeugmenge wie registerTools (Namen, Beschreibungen, Schemas,
// annotations, _meta, Widget-Verweise bleiben byte-gleich), aber JEDER Handler ist der
// synchron-triviale Stub oben - unabhaengig davon, welchen Handler das jeweilige Tool
// im Bestand definiert. toolContext.scopedTenant wird ignoriert und hart auf
// TENANT_REJECT gesetzt (W4/Pre-Mortem 1: nie null, kein registerTools-Default).
export function registerNoTenantStubs(server, toolContext) {
  const result = buildNoTenantResult(toolContext.language);
  const stubHandler = async () => result;
  registerTools(noTenantFacade(server, stubHandler), { ...toolContext, scopedTenant: TENANT_REJECT });
}
