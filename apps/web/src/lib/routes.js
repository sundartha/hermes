// Zentrale interne Routen-Ziele des Frontends. EINE Quelle, damit der Login-/
// Funnel-Einstieg an genau einer Stelle umschaltbar ist. Kein verstreutes
// /auth/login-Literal mehr (Clean-Code G5/S2). Bewusst abhaengigkeitsfrei (kein
// fetch/DOM), damit SSG-Frontmatter UND Browser-Inseln dieselbe Konstante teilen.

// Auth/Portal/Session leben auf dem separaten Gateway-Origin (nicht auf der
// Static Site). Diese Konstante wird ab jetzt vom Build-Env bestimmt:
// PUBLIC_GATEWAY_URL liefert den absoluten Auth-Origin, LOGIN_URL zeigt absolut
// auf <PUBLIC_GATEWAY_URL>/auth/login. Fehlt PUBLIC_GATEWAY_URL, schlaegt der
// Build absichtlich fehl (fail-closed) — ein relativer Default ("/auth/login")
// wuerde den Login-404 auf der Static Site sofort zuruckbringen.

// Astro/Vite befuellt import.meta.env zur Build-Zeit (PUBLIC_-Prefix). Im reinen
// Node-Test laeuft kein Vite -> import.meta.env ist undefined, dann greift
// process.env. Beide Pfade laufen serverseitig zur Build-/Test-Zeit (alle
// LOGIN_URL-Nutzungen sind Astro-Frontmatter, kein Client-Bundle).
const buildEnv = import.meta.env;
const GATEWAY_URL =
  (buildEnv && buildEnv.PUBLIC_GATEWAY_URL) || process.env.PUBLIC_GATEWAY_URL;
if (!GATEWAY_URL) {
  throw new Error(
    "PUBLIC_GATEWAY_URL fehlt — Build absichtlich abgebrochen (fail-closed). " +
      "Ein relativer Default wuerde den Login-404 sofort zuruckbringen.",
  );
}

// Login = Registrierung (Account entsteht beim ersten OIDC-Login). Get-started/
// Log-in/Sign-in-CTAs zeigen alle hierher — absolut auf den Gateway-Auth-Origin.
export const LOGIN_URL = `${GATEWAY_URL}/auth/login`;

// Einwilligungs-Protokoll des Gateways (Nachweis Art. 7 Abs. 1 DSGVO). consent.js
// schickt jede Cookie-Entscheidung per Beacon dorthin. Der Pfad spiegelt
// COOKIE_CONSENT_PATH aus src/cookie-consent-log.js (Wurzelprojekt, eigenes Paket -
// kein Import moeglich); test/cookie-consent-client.test.js haelt beide gleich.
export const COOKIE_CONSENT_URL = `${GATEWAY_URL}/api/cookie-consent`;

// Kuendigen (§ 312k BGB) NUR im Kundenbereich (Owner-Entscheidung 2026-10-01: ohne
// Anmeldung koennte jeder mit fremdem Namen + Email einen Vertrag kuendigen). Jeder
// Link "Verträge kündigen" / "Cancel contracts" zeigt hierher. Der Anker ist ein
// Auftrag an die App-Shell: sie fuehrt Nicht-Eingeloggte durch den Login und oeffnet
// danach direkt die Kuendigungs-Bestaetigung (lib/cancel-intent.js, BillingIsland).
export const CANCEL_URL = `${GATEWAY_URL}/app#kuendigen`;
