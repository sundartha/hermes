// Browser-Login: standard OIDC Authorization-Code + PKCE, in-house (kein Provider-
// SDK -> kein Lock-in, nur OIDC-Claims queren die Schicht). Cookie-Signatur und
// PKCE mit crypto (kein neuer Dep). Niemals Tokens/Secrets loggen.
import crypto from "crypto";
import { Router } from "express";
import { tenantIdForSubject, TENANT_STATUS } from "./store/defaults.js";
import { safeEqual, auditAuthFailed, AUTH_FAILED_GRUND } from "./util.js";
import { resolveOnboardCountry, tenantGeoForCountry } from "./geo/resolve.js";

// Laenge des CSRF-/nonce-Zufallswerts in Bytes (analog oauth_state).
const RANDOM_BYTES = 16;
// Default-Lebensdauer der Login-Flow-Cookies (pkce/state/nonce) in Sekunden, falls deps
// keinen Wert injiziert (Tests). Bewusster Test-Fallback; die Produktionsquelle ist
// config.auth.loginCookieTtlSeconds (Fallback 1800), durchgereicht via deps.loginCookieTtlSeconds.
// web-auth bleibt config-frei (DI-Naht) - kein config-Import hier.
const DEFAULT_LOGIN_COOKIE_TTL_SECONDS = 1800;
// Login-Route: eine Quelle (G5) fuer die Route-Registrierung, den Recovery-Redirect und
// den Link der terminalen Seite.
export const LOGIN_ROUTE = "/auth/login";
// Query-Param, mit dem die Recovery den Login als zweiten (markierten) Versuch anstoesst.
const RETRY_PARAM = "retry";
// Loop-Guard-Marker fuer den OAuth-state. Tilde ist URI-unreserved (RFC 3986) und nicht
// im base64url-Alphabet des Zufallstokens -> kollisionsfrei anhaengbar/erkennbar. Der
// Marker reist im state-Query-Param mit (vom IdP verbatim zurueckgespiegelt) und ueberlebt
// so den Round-Trip auch dann, wenn der Browser gar keine Cookies speichert.
const STATE_RETRY_MARKER = "~retry";
const markRetryState = (token) => token + STATE_RETRY_MARKER;
const isRetryState = (state) => String(state ?? "").endsWith(STATE_RETRY_MARKER);
// Terminale Recovery-Seite: erscheint NUR, wenn auch der zweite (markierte) Login-Versuch
// ohne Login-Cookie zurueckkommt (Browser blockiert Cookies) -> bricht den Loop statt
// Endlos-302. Mintet KEINE Session, setzt KEIN Cookie, leakt nichts.
// WEB-13: Englisch statt Deutsch. Die Seite erscheint, BEVOR eine Identitaet existiert
// (kein Cookie, keine Session, kein Tenant) - eine Tenant-Sprache gibt es hier strukturell
// nicht, also gilt der Weltdefault "en" (derselbe Massstab wie /app). Bewusst hart
// verdrahtet und NICHT ueber config: web-auth bleibt config-frei (DI-Naht, s.o.).
const SESSION_EXPIRED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Session expired</title></head><body>
<h1>Session expired</h1>
<p>Your sign-in session has expired, or your browser is blocking cookies. Please allow cookies for this site and sign in again.</p>
<p><a href="${LOGIN_ROUTE}">Sign in again</a></p>
</body></html>`;

// P9 (Fehler-Vertrag): die nutzersichtbaren Fehlerantworten der Auth-Pfade tragen stabile,
// sprachneutrale Codes statt deutschem Klartext - ein Browser mit beliebigem Accept-Language
// bekommt denselben, maschinenlesbaren Wert. Die Antworten bleiben bewusst detail-arm: EIN
// Code fuer ALLE CSRF-Ablehnungsgruende (kein Leak, welcher Check scheiterte, Regel 3).
const ERROR_CSRF_STATE_INVALID = "csrf_state_invalid";
const ERROR_LOGIN_FAILED = "login_failed";

const b64url = (buf) => buf.toString("base64url");

// HMAC-signierter Cookie-Wert "<value>.<sig>". Timing-sichere Pruefung.
export function signValue(value, secret) {
  const sig = crypto.createHmac("sha256", secret).update(value).digest("base64url");
  return `${value}.${sig}`;
}
export function verifyValue(signed, secret) {
  const i = String(signed).lastIndexOf(".");
  if (i < 1) return null;
  const value = signed.slice(0, i),
    sig = signed.slice(i + 1);
  const expected = crypto.createHmac("sha256", secret).update(value).digest("base64url");
  return safeEqual(sig, expected) ? value : null;
}

// PKCE S256.
export function makePkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// ---- Cookie-Hilfsfunktionen ----------------------------------------

// Liest einen einzelnen Cookie-Wert aus dem Request-Header (kein cookie-parser).
// Gibt den rohen Wert zurueck (URL-decodiert), oder null wenn nicht vorhanden.
function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split("; ")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    if (part.slice(0, i) === name) {
      try {
        return decodeURIComponent(part.slice(i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Baut den Set-Cookie-Header-String. value=null -> Cookie loeschen (Max-Age=0).
function cookieAttrs(name, value, maxAge) {
  const encoded = encodeURIComponent(value ?? "");
  const age = value === null ? 0 : maxAge;
  return `${name}=${encoded}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}`;
}

// Setzt mehrere Set-Cookie-Header per res.append (Express erlaubt Mehrfach-Append).
function setCookies(res, entries) {
  for (const [name, value, maxAge] of entries) {
    res.append("Set-Cookie", cookieAttrs(name, value, maxAge));
  }
}

// Loescht eine Liste von Cookies (Max-Age=0).
function clearCookies(res, names) {
  for (const name of names) {
    res.append("Set-Cookie", cookieAttrs(name, null, 0));
  }
}

// Login-Flow-Cookies (state/pkce/nonce) als EINE Namensliste (G5) fuer die drei Cleanup-Stellen.
const LOGIN_FLOW_COOKIE_NAMES = ["pkce_verifier", "oauth_state", "oidc_nonce"];

// Signierten Cookie lesen + HMAC verifizieren in EINEM Schritt (G5). Fehlt der Cookie ODER
// ist die Signatur ungueltig -> null (fail-closed). NICHT fuer oauth_state: dort MUSS
// "Cookie fehlt" (null-Recovery) von "ungueltig signiert" (400) unterschieden werden.
export function readSignedCookie(req, name, secret) {
  const raw = readCookie(req, name);
  return raw ? verifyValue(raw, secret) : null;
}

// EINE Quelle (G5) fuer die generische 400-CSRF-Antwort (bewusst detail-arm, kein Leak
// welcher Check scheiterte). Gibt die Antwort zurueck -> Aufrufer `return`t sie (Muster recoverLogin).
function rejectCsrf(res) {
  return res.status(400).send(ERROR_CSRF_STATE_INVALID);
}

// Recovery bei FEHLENDEM Login-Flow-Cookie (benign: Drop/Expiry/anderer Tab beim Mail-Link).
// Erster Versuch -> 302 zurueck auf den Login als markierter retry. Kommt der markierte
// Versuch erneut ohne Cookie zurueck (Browser blockiert Cookies), bricht der Loop-Guard ab
// und zeigt die terminale Seite statt eines Endlos-302. Mintet NIE eine Session.
function recoverLogin(req, res) {
  if (isRetryState(req.query.state)) return res.status(200).send(SESSION_EXPIRED_PAGE);
  return res.redirect(302, `${LOGIN_ROUTE}?${RETRY_PARAM}=1`);
}

// ---- makeWebAuthRoutes -----------------------------------------------
// Baut einen Express-Router mit GET /auth/login, GET /auth/callback, POST /auth/logout.
// Alle externen Abhaengigkeiten (oidc, accounts, sessions, audit) per Dependency-
// Injection -> testbar ohne echten IdP oder pg.
export function makeWebAuthRoutes(deps) {
  // postLoginPath: Ziel des Browser-Redirects nach erfolgreichem Callback. Default "/"
  // (byte-identisch zum Bestand). server.js reicht das Kunden-Portal durch, damit ein
  // frisch eingeloggter (noch suspendierter) Tenant NICHT auf dem Owner-Dashboard hinter
  // Basic-Auth landet (rohe 403-/Auth-Sackgasse), sondern auf der "Choose your plan"-Shell.
  const { secret, redirectUri, ttlSeconds, oidc, accounts, sessions, audit } = deps;
  const postLoginPath = deps.postLoginPath || "/";
  // Absolute Rueckkehr-URL fuer den WorkOS-Sign-out-Redirect (return_to). Muss absolut sein
  // (anders als postLoginPath) und im WorkOS-Dashboard als Sign-out-Redirect-URL registriert
  // sein (Phase 3, Jonas manuell). Optional: fehlt sie, laesst sessionLogoutUrl return_to weg
  // -> WorkOS beendet die Session trotzdem, nur ohne automatischen Rueck-Redirect.
  const postLogoutUrl = deps.postLogoutUrl;
  // Optionaler Signup-Spiegel-Nachzug (Default async No-Op -> Bestands-Auth-Tests
  // unveraendert): zieht den frisch per accounts.upsertOnFirstLogin angelegten Tenant in
  // den pg-Store-Spiegel, BEVOR die Session steht. Sonst faende jede WRITE-Store-Op auf dem
  // Self-Service-Subscribe-Pfad (setTenantStripe etc.) den Tenant nicht und wuerfe fail-closed.
  const ensureTenant = deps.ensureTenant || (async () => {});
  // P2b-Identitaets-Write (DI wie ensureTenant; Default async No-Op -> Bestands-Auth-Tests
  // ohne diesen Dep bleiben gruen). Schreibt Vor-/Nachname set-if-absent in den Gate-Store.
  const applyTenantIdentity = deps.applyTenantIdentity || (async () => {});
  // tenant-prolif-b: Spiegel-Bindung des (evtl. per Email-Merge gebundenen) sub in den
  // Resolver-Index (DI wie ensureTenant; Default No-Op -> Bestands-Auth-Tests unveraendert).
  const bindSub = deps.bindSub || (async () => {});
  // Login-Flow-Cookie-TTL (state/pkce/nonce) per DI (Muster ttlSeconds): Produktion reicht
  // config.auth.loginCookieTtlSeconds durch, Tests fallen auf den Default zurueck. `??` ehrt eine
  // explizite 0 (min:0 in config).
  const loginCookieTtlSeconds = deps.loginCookieTtlSeconds ?? DEFAULT_LOGIN_COOKIE_TTL_SECONDS;
  const router = Router();

  // EINE Quelle fuer das Session-Minting (G5 - kein paralleler Auth-Pfad): Account-Upsert
  // -> Session anlegen -> signiertes Session-Cookie setzen. Callback UND Dev-Login-Shim
  // teilen sich diese Mechanik, damit eine kuenftige Haertung (zusaetzliche Cookie-Flags,
  // Session-Rotation/-Binding) an EINER Stelle nachgezogen wird. Setzt NUR das Session-
  // Cookie; Login-Flow-Cookie-Cleanup, audit und redirect bleiben Sache des Aufrufers
  // (Callback auditiert + raeumt die pkce/state/nonce-Cookies, Dev-Login nicht).
  async function mintSession(res, { sub, email, firstName, lastName, workosSessionId }) {
    const { tenantId } = await accounts.upsertOnFirstLogin({ sub, email });
    // Spiegel-Nachzug NACH dem Account-/Tenant-Upsert (die DB-Zeile existiert jetzt), VOR
    // sessions.create. FAIL-OPEN bewusst: die Auth-Entscheidung (account+session) ist
    // bereits getroffen, der Spiegel ist nur ein Betriebs-Cache. Ein Nachzug-Schluckauf
    // oeffnet KEIN Gate (fehlt der Spiegel-Tenant, werfen die Setter weiter fail-CLOSED -
    // der alte 502, nie suspended-sieht-aktiv-aus). Deckt Callback UND Dev-Login (G5).
    await ensureTenant(tenantId);
    // tenant-prolif-b: den (evtl. per Email-Merge auf einen FREMDEN Tenant gebundenen) sub in
    // den MCP/REST-Resolver-Index spiegeln, damit resolveTenant den kanonischen Tenant OHNE
    // Neustart auffindet (schliesst die "idp_subject eingefroren"-Landmine). NACH ensureTenant
    // (Tenant ist jetzt im Spiegel); FAIL-OPEN wie ensureTenant (reiner Betriebs-Cache).
    await bindSub(sub, tenantId);
    // P2b: Vor-/Nachname (aus dem verifizierten IdP-Profil) set-if-absent in den Gate-Store
    // schreiben, sonst sperrt das Outbound-Identitaets-Gate den Web-Tenant fail-closed. NUR
    // wenn ein Name vorliegt (Dev-Login/namloses Profil -> kein unnoetiger Store-Lock, kein
    // Body-Spoofing). Deckt ausschliesslich den echten Callback (mintSession-Aufrufer reicht
    // Namen nur dort durch).
    if (firstName || lastName) await applyTenantIdentity(tenantId, { firstName, lastName });
    // workosSessionId (sid-Klaim, aus exchange()) wird mitgespeichert -> Grundlage fuer den
    // WorkOS-Sign-out-Redirect bei /auth/logout. Dev-Login reicht sie nie durch (undefined ->
    // sessions.create() defaultet auf null, kein Verhaltenswechsel fuer den Dev-Pfad).
    const { id } = await sessions.create({ sub, tenantId, ttlSeconds, workosSessionId });
    res.append("Set-Cookie", cookieAttrs("session", signValue(id, secret), ttlSeconds));
    return { tenantId, id };
  }

  // GET /auth/login
  // Erzeugt PKCE-Paar + State, signiert beides als Cookies, redirectet zum IdP.
  router.get(LOGIN_ROUTE, async (req, res) => {
    const { verifier, challenge } = makePkce();
    const stateToken = crypto.randomBytes(RANDOM_BYTES).toString("base64url");
    // Loop-Guard: ein Recovery-Neustart (?retry=1) markiert den state. Nur der state-Param
    // ueberlebt den IdP-Round-Trip (Cookies evtl. blockiert) -> der Callback erkennt am
    // Marker den zweiten vergeblichen Versuch und zeigt die terminale Seite statt Endlos-302.
    const state = req.query[RETRY_PARAM] === "1" ? markRetryState(stateToken) : stateToken;
    // oidc_nonce: zusaetzliche signierte Same-Session-Bindung. WorkOS User Management
    // kennt im authorize-Endpoint keinen nonce-Param und liefert kein id_token -> kein
    // IdP-Round-Trip; der Replay-Schutz liegt bei PKCE (code nur mit code_verifier
    // einloesbar). Der Callback erzwingt dieses Cookie (Vorhandensein + Signatur) vor
    // dem Token-Tausch.
    const nonce = crypto.randomBytes(RANDOM_BYTES).toString("base64url");
    setCookies(res, [
      ["pkce_verifier", signValue(verifier, secret), loginCookieTtlSeconds],
      ["oauth_state", signValue(state, secret), loginCookieTtlSeconds],
      ["oidc_nonce", signValue(nonce, secret), loginCookieTtlSeconds],
    ]);
    // authorizeUrl baut nur eine URL (kein I/O), bleibt aber awaited + fail-closed: ein
    // unerwarteter Fehler darf den Request nicht bis zum Socket-Timeout haengen lassen
    // (Express 4 reicht Route-Rejections NICHT automatisch an die Error-MW weiter).
    // Generische 5xx, Login-Cookies geloescht, kein Detail-Leak.
    try {
      const url = await oidc.authorizeUrl({ challenge, state, redirectUri });
      res.redirect(302, url);
    } catch {
      clearCookies(res, LOGIN_FLOW_COOKIE_NAMES);
      res.status(500).send(ERROR_LOGIN_FAILED);
    }
  });

  // GET /auth/callback
  // Validiert State (CSRF) + nonce + PKCE-Verifier + code, tauscht den Code bei WorkOS,
  // upsert Account, setzt Session-Cookie.
  router.get("/auth/callback", async (req, res) => {
    // CSRF + Recovery: ein FEHLENDES state-Cookie (signedState == null) ist benign -
    // Cookie-Drop/Expiry oder Mail-Link in anderem Tab/Geraet. Statt 400-Sackgasse starten
    // wir den Flow neu (re-mint pkce/state/nonce ueber /auth/login). Ein VORHANDENES, aber
    // ungueltig signiertes ODER abweichendes Cookie bleibt strikt 400 (echtes CSRF/Tampering);
    // der Recovery-Pfad mintet NIE eine Session -> die Sicherung wird nicht aufgeweicht.
    const signedState = readCookie(req, "oauth_state");
    if (signedState === null) return recoverLogin(req, res);
    const stateFromCookie = verifyValue(signedState, secret);
    if (!stateFromCookie || stateFromCookie !== req.query.state) {
      return rejectCsrf(res);
    }

    // nonce: signierter Cookie muss vorhanden und gueltig sein. Fehlt/ungueltig ->
    // 400 mit derselben generischen Meldung wie state (kein Detail-Leak, welcher
    // Check scheiterte). Bindet den Callback an die Login-Session dieses Browsers
    // (Same-Session). WorkOS User Management liefert kein id_token, an das ein nonce
    // gebunden werden koennte -> das Cookie selbst ist die Bindung; der Replay-Schutz
    // liegt bei PKCE.
    const nonce = readSignedCookie(req, "oidc_nonce", secret);
    if (!nonce) {
      return rejectCsrf(res);
    }

    // PKCE-Verifier aus Cookie
    const verifier = readSignedCookie(req, "pkce_verifier", secret);

    // Verifier + code muessen vorhanden sein, BEVOR wir WorkOS anrufen: ein fehlender
    // Verifier (Cookie weg/ungueltig) oder ein Callback ohne code (z.B. WorkOS-Fehler-
    // Redirect ?error=...) wuerde sonst als null/undefined an authenticate gehen. Fail-
    // fast lokal (400, gleiche generische Meldung wie state/nonce - kein Detail-Leak,
    // welcher Check scheiterte), statt einen garantiert ungueltigen Request abzusetzen.
    if (!verifier || typeof req.query.code !== "string" || !req.query.code) {
      return rejectCsrf(res);
    }

    try {
      const { claims, workosSessionId } = await oidc.exchange({ code: req.query.code, verifier });
      // Session ueber die gemeinsame Mint-Mechanik (setzt das Session-Cookie). Danach die
      // Login-Flow-Cookies loeschen.
      const { tenantId } = await mintSession(res, {
        sub: claims.sub,
        email: claims.email,
        firstName: claims.firstName,
        lastName: claims.lastName,
        workosSessionId,
      });
      clearCookies(res, LOGIN_FLOW_COOKIE_NAMES);

      await audit.record({ actorSub: claims.sub, tenantId, action: "login" });
      res.redirect(302, postLoginPath);
    } catch {
      // Generischer Fehler: kein internes Detail, keine Token-Leaks
      clearCookies(res, LOGIN_FLOW_COOKIE_NAMES);
      res.status(401).send(ERROR_LOGIN_FAILED);
    }
  });

  // POST /auth/logout
  // Invalidiert die lokale Session (wenn Cookie vorhanden), loescht das Cookie. Traegt die
  // Session eine WorkOS-Session-ID (sid-Klaim, seit dem Login mitgespeichert), liefert die
  // Antwort zusaetzlich { logoutUrl }: WorkOS' eigener Sign-out-Endpunkt, zu dem der Browser
  // TOP-LEVEL navigieren muss (Frontend), damit WorkOS die eigene AuthKit-SSO-Session beendet
  // -- sonst bleibt sie aktiv und der naechste Login-Redirect authentifiziert still durch (kein
  // Formular). Alt-Sessions/Dev-Login OHNE workos_session_id -> weiterhin 204 ohne Body
  // (rein lokal, byte-identisch zum Bestand).
  router.post("/auth/logout", async (req, res) => {
    const sessionId = readSignedCookie(req, "session", secret);
    let workosSessionId = null;
    if (sessionId) {
      const row = await sessions.get(sessionId);
      workosSessionId = row ? row.workosSessionId : null;
      await sessions.invalidateById(sessionId);
    }
    clearCookies(res, ["session"]);
    if (!workosSessionId) return res.status(204).end();
    res
      .status(200)
      .json({ logoutUrl: oidc.sessionLogoutUrl({ workosSessionId, returnTo: postLogoutUrl }) });
  });

  // POST /auth/dev-login (NUR lokal, hinter deps.devLoginEnabled - config ist doppelt
  // fail-closed: explizites Opt-in UND nie auf Render, plus Boot-Refusal dort). Login-
  // Shim fuer den lokalen Chrome-e2e-Loop OHNE WorkOS-Round-Trip: mintet die Session
  // ueber DIESELBE Quelle wie der echte Callback (accounts.upsertOnFirstLogin +
  // sessions.create, G5 - kein paralleler Auth-Pfad), setzt das signierte Session-Cookie
  // und redirectet auf postLoginPath. Aktiviert den Tenant NICHT (bleibt suspended) -
  // Aktivierung/Seed macht das Test-Harness. Liegt unter /auth/* (vor Basic-Auth, hinter
  // dem /auth-Rate-Limiter in server.js) -> keine zusaetzliche Auth-Ausnahme noetig.
  // Niemals Tokens/Secrets loggen. sub/email aus dem Body, sonst dev-Defaults.
  if (deps.devLoginEnabled) {
    router.post("/auth/dev-login", async (req, res) => {
      try {
        const body = req.body || {};
        const sub = typeof body.sub === "string" && body.sub ? body.sub : "dev-user";
        const email = typeof body.email === "string" && body.email ? body.email : "dev@local.test";
        // Dieselbe Mint-Quelle wie der echte Callback (mintSession) - kein paralleler Pfad.
        await mintSession(res, { sub, email });
        res.redirect(302, postLoginPath);
      } catch {
        res.status(500).send("dev-login fehlgeschlagen");
      }
    });
  }

  return router;
}

// ---- claimsFromPayload ----------------------------------------------
// Mappt einen Identitaets-Payload (sub/email/email_verified) auf die Session-Claims.
// Gespeist aus dem WorkOS-`user`-Objekt (exchange) bzw. direkt im Test. email wird NUR
// uebernommen, wenn email_verified === true ist (Strikt-Gleichheit, kein Truthy-Cast:
// "true"/1/Abwesenheit gelten als unverifiziert). Sonst email: null -> die Admin-
// Allowlist (adminOnly) ist damit nur ueber nachweislich verifizierte Adressen erreichbar.
export function claimsFromPayload(payload) {
  const email = payload.email_verified === true ? (payload.email ?? null) : null;
  const claims = { sub: payload.sub, email };
  // P2b: Vor-/Nachname additiv aus dem verifizierten IdP-Profil uebernehmen - NUR wenn
  // vorhanden (Bestands-Claims {sub,email} bleiben byte-identisch, kein leerer Muell).
  // KEIN email_verified-Gate: der Name ist kein Admin-Allowlist-Schluessel wie email;
  // die Trim-/Kompositions-Autoritaet bleibt applyOwnerIdentity (G5). Quelle = WorkOS-
  // user (server-zu-server), nicht der Body -> kein Spoofing.
  if (typeof payload.firstName === "string" && payload.firstName)
    claims.firstName = payload.firstName;
  if (typeof payload.lastName === "string" && payload.lastName) claims.lastName = payload.lastName;
  return claims;
}

// Extrahiert die "sid"-Klaim (WorkOS-Session-ID) aus dem JWT-Payload-Segment eines
// Access-Tokens, OHNE Signatur-Pruefung: die Antwort kommt server-zu-server ueber TLS
// (gleiche Vertrauensstufe wie das user-Objekt in exchange, kein JWKS-Verify noetig, kein
// neuer Dependency). Fehlt/ist das Token nicht dekodierbar -> null, fail-OPEN (der Login
// bleibt unberuehrt; /auth/logout faellt dann auf rein lokal zurueck). Niemals das Token
// selbst loggen/zurueckgeben - nur die extrahierte sid.
function sidFromAccessToken(accessToken) {
  if (typeof accessToken !== "string" || !accessToken) return null;
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.sid === "string" && payload.sid ? payload.sid : null;
  } catch {
    return null;
  }
}

// ---- makeOidc --------------------------------------------------------
// WorkOS-User-Management Auth-Code-Flow (PKCE). authorizeUrl baut die URL zum WorkOS-UM-
// authorize-Endpoint (provider=authkit = gehostete AuthKit-Login-Seite); exchange loest
// den Code beim UM-authenticate-Endpoint ein und uebernimmt die Identitaet aus dem
// zurueckgelieferten `user`-Objekt. WorkOS UM liefert KEIN id_token: die Antwort kommt
// server-zu-server (client_secret + TLS, single-use code + PKCE-verifier) und ist damit
// die Vertrauensquelle. CSRF = state-Cookie, Replay-Schutz = PKCE (beides im Router).
// Niemals Code/Secret/Token loggen.
export function makeOidc(config, { _fetch = fetch } = {}) {
  const authorizeEndpoint = `${config.auth.workosApiBase}/user_management/authorize`;
  const authenticateEndpoint = `${config.auth.workosApiBase}/user_management/authenticate`;

  return {
    // authorizeUrl bleibt async (Router awaitet + faengt fail-closed). provider=authkit
    // waehlt die gehostete AuthKit-Login-Seite; PKCE S256 + state queren als Query.
    // WorkOS UM kennt im authorize-Endpoint weder scope noch nonce.
    async authorizeUrl({ challenge, state, redirectUri }) {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.auth.oidcClientId,
        redirect_uri: redirectUri,
        provider: "authkit",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
      });
      return `${authorizeEndpoint}?${params}`;
    },

    // exchange loest den Auth-Code beim UM-authenticate-Endpoint ein. JSON-Body mit
    // client_secret = WorkOS-API-Key der Umgebung (Confidential-Client). Antwort:
    // {user, access_token, refresh_token, ...} OHNE id_token -> Identitaet aus `user`.
    async exchange({ code, verifier }) {
      const r = await _fetch(authenticateEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          client_id: config.auth.oidcClientId,
          client_secret: config.auth.oidcClientSecret,
        }),
      });
      // Fehlerstatus: NUR den Status nennen, NIE den Body (WorkOS-Fehlerkoerper kann
      // Detail tragen) -> kein Leak. Aufrufer faengt generisch (401).
      if (!r.ok) throw new Error(`authenticate HTTP ${r.status}`);
      // Body parsen. Ein non-JSON-Body (r.json() wirft) wird hier zu einem gefangenen
      // Fehler statt einer rohen Rejection.
      const data = await r.json();
      // user fehlt/kein Objekt wuerde sonst als undefined-Deref crashen -> klarer Fehler.
      const user = data && data.user;
      if (!user || typeof user !== "object")
        throw new Error("authenticate: user fehlt in der Antwort");
      // sub = user.id (== access_token-sub -> EINE Identitaetsquelle fuer Web-Login UND
      // MCP-Kanal ueber idp_subject). Fehlt die id, ist die Identitaet unbrauchbar.
      if (typeof user.id !== "string" || !user.id)
        throw new Error("authenticate: user.id fehlt in der Antwort");
      // email durchlaeuft das unveraenderte email_verified-Gate (claimsFromPayload).
      return {
        claims: claimsFromPayload({
          sub: user.id,
          email: user.email,
          email_verified: user.email_verified,
          // WorkOS User Management liefert first_name/last_name am verifizierten user-Objekt.
          firstName: user.first_name,
          lastName: user.last_name,
        }),
        // sid-Klaim aus dem Access-Token (fuer den spaeteren WorkOS-Sign-out-Redirect).
        workosSessionId: sidFromAccessToken(data.access_token),
      };
    },

    // sessionLogoutUrl baut die WorkOS-UM-Session-Logout-URL (reine URL-Konstruktion wie
    // authorizeUrl, kein I/O -> synchron, kein try/catch im Router noetig). session_id ist
    // Pflicht (API-Referenz), return_to optional -- WorkOS leitet den Browser danach dorthin
    // zurueck und beendet zugleich die eigene AuthKit-SSO-Session (workos.com/docs/authkit/
    // sessions, "Signing Out").
    sessionLogoutUrl({ workosSessionId, returnTo }) {
      const params = new URLSearchParams({ session_id: workosSessionId });
      if (returnTo) params.set("return_to", returnTo);
      return `${config.auth.workosApiBase}/user_management/sessions/logout?${params}`;
    },
  };
}

// Normalisiert eine Email fuer Speicherung UND Vergleich (Review-Blocker Runde 2, G26):
// trim+lowercase EINMAL an der Login-Grenze (upsertOnFirstLogin), BEVOR der normalisierte
// Wert an den Dedup-SELECT, den Advisory-Lock-Key (beide in resolveOrCreateTenant) und den
// account.email-Schreibpfad weitergereicht wird - Speicherform und Vergleichsform muessen
// uebereinstimmen. Ohne das matchen zwei Schreibweisen derselben Adresse (z.B. Autofill-
// Varianten wie "User@X" vs "user@x") den Dedup-SELECT nicht und legen weiterhin zwei
// Tenants an - exakt das Symptom, das diese Phase schliessen soll. Kein String (null/
// undefined) bleibt unveraendert; der Aufrufer prueft den Wahrheitswert danach.
function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : email;
}

// ---- resolveOrCreateTenant (Phase tenant-prolif-a: Email-Dedup) ------
// Dedup-Kern am Web-Login: gehoert die (verifizierte) Email schon einem Account MIT NICHT
// GESCHLOSSENEM Tenant, gewinnt dessen Tenant - aeltester zuerst (created_at ASC),
// deterministisch + transitiv -> KEIN neuer Tenant, KEIN spaeterer DID-Kauf. Der Aufrufer
// schreibt den neuen sub dann nur als zusaetzliche account-Zeile auf diese tenant_id
// (account.tenant_id ist nicht-unique). Kein Treffer -> heutiges Verhalten: neuer Tenant
// t_<sub> mit idp_subject=sub (idempotenter Upsert, ON CONFLICT aktualisiert NUR
// idp_subject, nie den evtl. schon aktivierten status). Laeuft auf dem uebergebenen
// Transaktions-Client c. Die 1-Tenant-pro-Email-Invariante garantiert DIESE Logik, nicht
// der (rein beschleunigende) account_email_idx. email kommt vom Aufrufer BEREITS
// normalisiert (normalizeEmail, s.o.) - diese Funktion normalisiert nicht selbst, sonst
// gaebe es zwei Normalisierungsstellen (G5).
//
// Closed-Tenants sind KEIN Merge-Ziel (Review-Blocker Runde 3, G3/S1): status=closed ist
// laut webAuthAllowPending "hart gesperrt, kein Reaktivieren". Wuerde der Dedup-SELECT einen
// closed-Alt-Account treffen, landet ein brandneuer sub dauerhaft auf einem toten Tenant und
// bekommt nach jedem Login 403 ohne Ausweg. Der JOIN+Status-Filter schliesst closed-Zeilen
// aus der Kandidatenmenge aus; bleiben fuer die Email NUR closed-Alt-Accounts uebrig, liefert
// die Query 0 Treffer und der Aufrufer faellt in den regulaeren Kein-Treffer-Pfad (neuer
// Tenant) statt in die Merge-Falle.
//
// Race-Schutz (Review-Blocker Runde 1, P16/G26): ohne Lock sehen zwei simultane Erst-Logins
// derselben brandneuen Email unter READ COMMITTED beide "kein Treffer" (keiner der beiden
// INSERTs des jeweils anderen ist zu diesem Zeitpunkt committet) und legen ZWEI Tenants an -
// exakt die Tenant-Vermehrung, die diese Phase beheben soll. pg_advisory_xact_lock serialisiert
// konkurrierende Logins DERSELBEN Email (haelt bis COMMIT/ROLLBACK der Transaktion c), ohne
// andere Emails zu blockieren. hashtext() ist reine Streuung fuer den Lock-Schluessel (kein
// Sicherheitsmerkmal) - eine seltene Kollision serialisiert hoechstens zwei UNTERSCHIEDLICHE
// Emails unnoetig mit, aendert aber nie das Ergebnis.
// geo = das Geo-Tripel eines Neuzugangs (P8/LANG-02, tenantGeoForCountry). Es wird
// AUSSCHLIESSLICH im INSERT-Zweig geschrieben, NIE im ON-CONFLICT-Zweig: ein
// Bestandstenant behaelt seine (evtl. leeren) Werte - kein Backfill durch die Hintertuer
// (O11), kein Ueberschreiben einer echten Kundenangabe durch einen Plattform-Default.
// Der Write sitzt bewusst in DIESER Transaktion und nicht in einem zweiten Schreibpfad:
// Tenant und seine Geo-Identitaet entstehen atomar oder gar nicht.
async function resolveOrCreateTenant(c, { sub, email, geo }) {
  await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [email]);
  const existing = await c.query(
    `SELECT a.tenant_id FROM account a JOIN tenant t ON t.id = a.tenant_id
     WHERE a.email = $1 AND t.status <> $2 ORDER BY a.created_at ASC LIMIT 1`,
    [email, TENANT_STATUS.CLOSED],
  );
  if (existing.rows.length > 0) return existing.rows[0].tenant_id;
  const tenantId = tenantIdForSubject(sub); // EINE Quelle (G5), identischer Wert
  await c.query(
    `INSERT INTO tenant (id, status, idp_subject, country, default_language, timezone)
     VALUES ($1, '${TENANT_STATUS.SUSPENDED}', $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET idp_subject = EXCLUDED.idp_subject`,
    [tenantId, sub, geo.country, geo.defaultLanguage, geo.timezone],
  );
  return tenantId;
}

// Gemeinsamer Lese-Baustein (Review-Blocker Runde 2, G5): EIN JOIN/WHERE fuer Account+
// Tenant-Status ueber sub. Zwei Aufrufer teilen sich das: resolve() (Autorisierungs-
// Lesepfad der Middleware) und der Post-Commit-Readback in upsertOnFirstLogin (liest die
// soeben geschriebene Zeile INNERHALB derselben Transaktion, VOR dem COMMIT - deshalb der
// durchgereichte Client c statt runner.withClient). Vorher fast identische Queries an zwei
// Stellen (eine Obermenge der anderen um a.sub/a.email) - ein kuenftiger Spalten-/Join-
// Wechsel musste an beiden nachgezogen werden. Liefert null, wenn kein Account existiert.
async function selectAccountAuth(c, sub) {
  const { rows } = await c.query(
    `SELECT a.sub, a.email, a.role, a.tenant_id AS "tenantId", t.status
     FROM account a JOIN tenant t ON t.id = a.tenant_id WHERE a.sub = $1`,
    [sub],
  );
  return rows[0] || null;
}

// ---- makeAccounts ----------------------------------------------------
// Tenant + Account upsert beim ersten Login; Lesepfade fuer Middleware.
//
// defaultCountry (P8/LANG-02): das Land, das ein per Web-Login entstehender Tenant
// bekommt. BEWUSST der Plattform-Default (config.provisioning.provisioningCountry) und
// KEIN IP-Geo: der Wert ist genau derselbe, den der bestehende Code-Fallback
// (tenantGeo().country || fallbackCountry) heute schon liefert - der Login wird dadurch
// verhaltensneutral explizit statt implizit. Eine IP-Herkunft saehe im Datensatz spaeter
// wie eine Kundenangabe aus (P8-Gegenmassnahme 1). Fehlt der Wert -> DEFAULT_COUNTRY.
// EINMAL bei der Konstruktion abgeleitet (konstant, kein Lazy-Init P15).
export function makeAccounts(runner, { defaultCountry } = {}) {
  const signupGeo = tenantGeoForCountry(resolveOnboardCountry({ fallbackCountry: defaultCountry }));
  return {
    // Erster Login: Tenant aufloesen (Email-Dedup) oder anlegen (suspended), Account
    // anlegen/aktualisieren. Gibt {tenantId, status, role} zurueck.
    async upsertOnFirstLogin({ sub, email }) {
      // Email einmal zentral normalisieren (normalizeEmail, s.o.) - VOR dem email_verified-
      // Reject-Gate, damit eine reine Whitespace-Email (nach Trim leer) denselben Reject
      // ausloest wie eine fehlende. Der normalisierte Wert reist danach unveraendert weiter
      // an resolveOrCreateTenant (Dedup-SELECT + Advisory-Lock-Key) UND den account.email-
      // Schreibpfad unten - EINE Normalisierungsstelle, Speicher- und Vergleichsform
      // stimmen damit garantiert ueberein.
      const normalizedEmail = normalizeEmail(email);
      // email_verified-Gate (claimsFromPayload) liefert bei unverifizierter Email null. Ohne
      // verifizierte Email KEIN Tenant/Account: definierter, geloggter Reject statt eines
      // unbeabsichtigten NOT-NULL-Crashs (account.email NOT NULL), der heute erst NACH dem
      // committeten Tenant-INSERT feuert und einen Orphan-Tenant hinterlaesst. PII-frei: nur
      // der Grund, nie Email/sub loggen. Nutzer-Verhalten unveraendert (unverifiziert kann
      // schon heute nicht einloggen), nur sauber + orphan-frei. Callback faengt -> 401.
      if (!normalizedEmail) {
        console.warn("[web-auth] Login abgelehnt: Email nicht verifiziert");
        throw new Error("login rejected: verified email required");
      }
      // Tenant-Aufloesung (Dedup) + Account-Anlage in EINER Transaktion (Atomaritaet, Muster
      // flush() in store/pg.js): schlaegt der Account-INSERT fehl, rollt der evtl. neue Tenant
      // mit zurueck -> kein halb-committeter Orphan-Tenant.
      return runner.withClient(async (c) => {
        await c.query("BEGIN");
        try {
          const tenantId = await resolveOrCreateTenant(c, { sub, email: normalizedEmail, geo: signupGeo });
          // Account anlegen/aktualisieren. tenant_id bleibt bei ON CONFLICT stabil (nur email
          // refresht) - ein Repeat-Login darf die (evtl. gemergte) Tenant-Bindung nicht kippen.
          await c.query(
            `INSERT INTO account (sub, tenant_id, email, role)
             VALUES ($1, $2, $3, 'member')
             ON CONFLICT (sub) DO UPDATE SET email = EXCLUDED.email`,
            [sub, tenantId, normalizedEmail],
          );
          const row = await selectAccountAuth(c, sub);
          await c.query("COMMIT");
          // Zurueckgegeben wird die TATSAECHLICH gespeicherte account.tenant_id (row.tenantId),
          // NICHT das lokal aufgeloeste Dedup-Ergebnis: bei einem bereits VORHANDENEN Account
          // mit abweichender tenant_id (Alt-Duplikat aus der Zeit vor diesem Fix) aendert der
          // ON-CONFLICT-UPDATE oben die Bindung NICHT. accounts.resolve() (= req.tenant, die
          // Autorisierungsquelle in webAuth) liest danach denselben Wert - sonst binden
          // mintSession/ensureTenant/applyTenantIdentity/session an einen ANDEREN Tenant als
          // die Autorisierung (Review-Blocker Runde 1: Rueckgabe-vs-Autorisierung-Divergenz).
          const result = row || { tenantId, role: "member", status: TENANT_STATUS.SUSPENDED };
          return { tenantId: result.tenantId, status: result.status, role: result.role };
        } catch (err) {
          await c.query("ROLLBACK");
          throw err;
        }
      });
    },

    // Liest Account + Tenant fuer die Session-Middleware.
    async resolve(sub) {
      return runner.withClient((c) => selectAccountAuth(c, sub));
    },

    // A2-Bruecke (Achsen-Bruch A9): die Aktivierung kennt nur tenantId, das Profil keyt
    // email. Reverse-Query zu upsertOnFirstLogin. Liefert {sub,email} fuer GENAU EINEN
    // Account des Tenants, sonst null: 0 (Webhook vor Account-Anlage) ODER >1 (mehrdeutig,
    // §5.6 B2C-1:1 - NICHT raten, fail-closed). account ist RLS-exempt (laeuft vor
    // app.current_tenant, Muster resolve/setStatus). LIMIT 2 trennt eindeutig/mehrdeutig,
    // ohne die ganze Liste zu laden.
    async accountByTenant(tenantId) {
      return runner.withClient(async (c) => {
        const { rows } = await c.query(
          `SELECT sub, email FROM account WHERE tenant_id = $1 LIMIT 2`,
          [tenantId],
        );
        return rows.length === 1 ? rows[0] : null;
      });
    },

    // Admin: Tenant-Status aendern (active/suspended). Gibt true zurueck, wenn ein
    // Tenant getroffen wurde - sonst false -> der Aufrufer antwortet 404 (kein
    // silent-noop, kein Audit-Eintrag fuer eine nicht-existente Tenant-ID).
    async setStatus(tenantId, status) {
      return runner.withClient(async (c) => {
        const { rows } = await c.query(`UPDATE tenant SET status = $1 WHERE id = $2 RETURNING id`, [
          status,
          tenantId,
        ]);
        return rows.length > 0;
      });
    },

    // Admin: alle Tenants listen (Cross-Tenant-Uebersicht fuers Admin-Panel). Read-only,
    // RLS-exempt wie setStatus (account/tenant laufen VOR app.current_tenant). Liefert nur
    // nicht-sensible Lebenszyklus-Felder (id/status/createdAt) - KEINE Transkripte/PII,
    // KEINE Settings/Nummern (Regel 4/5: kein Cross-Tenant-Daten-Leak ueber die Admin-Sicht).
    async listTenants() {
      return runner.withClient(async (c) => {
        const { rows } = await c.query(
          `SELECT id, status, created_at AS "createdAt" FROM tenant ORDER BY created_at`,
        );
        return rows;
      });
    },

    // Admin-Rolle setzen (grant-admin-Script). Idempotent: setzt role per E-Mail,
    // zweiter Lauf mit demselben Wert = derselbe Effekt. Gibt true zurueck, wenn ein
    // Account getroffen wurde - sonst false -> der Aufrufer meldet "nicht gefunden"
    // (kein silent-noop fuer eine nicht-existente E-Mail). account ist RLS-exempt,
    // daher kein app.current_tenant-GUC noetig (Muster wie setStatus).
    async setRole(email, role) {
      return runner.withClient(async (c) => {
        const { rows } = await c.query(
          `UPDATE account SET role = $1 WHERE email = $2 RETURNING sub`,
          [role, email],
        );
        return rows.length > 0;
      });
    },
  };
}

// ---- resolveWebSession (gemeinsame Auth-Mechanik, G5) ----------------
// Cookie -> Session -> Account. Liefert {acct, sub} bei gueltiger Session, sonst null
// (Aufrufer -> 401). KEIN Status-Gate hier - das ist die Politik der jeweiligen
// Middleware. EINE Quelle fuer Cookie/Session/Account-Pruefung, damit webAuth und
// webAuthAllowPending nicht auseinanderdriften. Fail-closed: kein Detail-Leak, kein
// Token-/Cookie-Logging (der Aufrufer faengt unerwartete Fehler generisch ab).
async function resolveWebSession({ secret, sessions, accounts }, req) {
  const sessionId = readSignedCookie(req, "session", secret);
  if (!sessionId) return null;
  const row = await sessions.get(sessionId);
  if (!row || row.invalidated_at != null || new Date(row.expires_at) <= new Date()) return null;
  const acct = await accounts.resolve(row.sub);
  if (!acct) return null;
  return { acct, sub: row.sub };
}

// Request-Tenant-Kontext aus der aufgeloesten Session (eine Quelle fuer die req.tenant-
// Form). status zusaetzlich exponiert (P5): die gefuehrte Aktivierung (billing/status)
// liest die Lebenszyklus-Stufe, ohne die active-only /state-View zu oeffnen.
const tenantContextOf = ({ acct, sub }) => ({
  tenantId: acct.tenantId,
  sub,
  role: acct.role,
  email: acct.email,
  status: acct.status,
});

// Status, die die suspended-erreichbaren Self-Aktivierungs-Routen passieren duerfen:
// active (normal) ODER suspended (frisch eingeloggt, darf sich selbst aktivieren). Alles
// andere - closed (hart gesperrt) oder unerwartet - fail-closed (403). Benannte Quelle (G25).
const PENDING_ALLOWED_STATUS = Object.freeze(
  new Set([TENANT_STATUS.ACTIVE, TENANT_STATUS.SUSPENDED]),
);

// ---- webAuthWithStatusGate (gemeinsames Middleware-Skelett, G5/G26) ----
// Higher-Order-Factory: baut aus einem Status-Praedikat eine Web-Session-Middleware.
// Die fail-closed-Mechanik ist in BEIDEN Varianten strukturell identisch - kein Cookie/
// keine gueltige Session -> 401; verbotener Status -> 403; req.tenant NUR im erlaubten
// Zweig gesetzt; unerwarteter Fehler -> generischer 401 (kein Detail-/Token-/Cookie-Leak).
// Die EINZIGE gewollte Divergenz ist statusAllowed(status): active-only (webAuth) vs.
// active|suspended (webAuthAllowPending). resolveWebSession/tenantContextOf bleiben die
// EINE Aufloesungsquelle - hier NICHT dupliziert, NICHT umgangen.
//
// AUTH-P5: beide Ablehnungszweige (401/403) schreiben zusaetzlich eine auth_failed-
// Zeile ueber auditAuthFailed (EINE Quelle, src/util.js) - der Ersatz fuer den
// einzigen heutigen Meldeweg, wenn das Basic-Auth-Gate faellt (P7). Der catch-Zweig
// (Infrastruktur-Fehler, z.B. DB weg) schreibt BEWUSST NICHT: er ist keine Auth-
// Entscheidung, und "expired"/"no_session" waere dort ein irrefuehrendes Forensik-
// Label (Befund F2, Plan Abschnitt 7 - eigener Punkt in PLAN-SECURITY.md).
function webAuthWithStatusGate(statusAllowed) {
  return function makeWebAuthMiddleware(deps) {
    return async function webAuthGateMiddleware(req, res, next) {
      try {
        const ctx = await resolveWebSession(deps, req);
        if (!ctx) {
          auditAuthFailed(req, AUTH_FAILED_GRUND.NO_SESSION);
          return res.status(401).json({ error: "Unauthorized" });
        }
        if (!statusAllowed(ctx.acct.status)) {
          auditAuthFailed(req, AUTH_FAILED_GRUND.NOT_ACTIVE);
          return res.status(403).json({ error: "Forbidden" });
        }
        req.tenant = tenantContextOf(ctx);
        next();
      } catch {
        res.status(401).json({ error: "Unauthorized" });
      }
    };
  };
}

// ---- webAuth ---------------------------------------------------------
// Active-only-Gate: nur active passiert, suspended/closed/unerwartet -> 403. Haengt an
// /state + Settings-Routen (Tenant-Daten). Die suspended-erreichbare Variante ist
// webAuthAllowPending. Fail-closed: kein Detail-/Token-/Cookie-Leak (siehe Skelett oben).
export const webAuth = webAuthWithStatusGate((status) => status === TENANT_STATUS.ACTIVE);

// ---- webAuthAllowPending (P5) ----------------------------------------
// Variante fuer die drei Self-Aktivierungs-Routen (setup-checkout/return/subscribe) +
// billing/status: laesst zusaetzlich suspended durch (frisch eingeloggt, darf sich selbst
// aktivieren - sonst 403-Deadlock), closed/unbekannt bleibt HART gesperrt (kein
// Reaktivieren). Oeffnet KEINE Tenant-Daten; nur active-only webAuth haengt an /state.
export const webAuthAllowPending = webAuthWithStatusGate((status) =>
  PENDING_ALLOWED_STATUS.has(status),
);

// ---- adminOnly -------------------------------------------------------
// Express-Middleware NACH webAuth (braucht req.tenant): erlaubt nur Admins -
// E-Mail in der Allowlist ODER role==='admin'. Fail-closed: ohne req.tenant
// oder kein Admin -> 403. Kein Detail-Leak. AUTH-P5: der 403-Zweig schreibt
// zusaetzlich eine auth_failed-Zeile (auditAuthFailed, grund=not_admin).
export function adminOnly(deps) {
  const allow = (deps.adminEmails || []).map((e) => e.toLowerCase());
  return function adminOnlyMiddleware(req, res, next) {
    const t = req.tenant;
    const isAdmin = t && (t.role === "admin" || (t.email && allow.includes(t.email.toLowerCase())));
    if (!isAdmin) {
      auditAuthFailed(req, AUTH_FAILED_GRUND.NOT_ADMIN);
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

// ---- makeAdminRoutes -------------------------------------------------
// Express-Router fuer die Admin-Tenant-Verwaltung (list/approve/suspend), hinter
// webAuthMw + adminMw. Als Factory exportiert, damit Produktion (server.js) UND
// Test denselben Handler nutzen (keine handkopierte Route-Replik, G5). suspend
// invalidiert sofort alle Sessions des Tenants (gesperrter Kunde kann nicht bis
// Cookie-Expiry weiterlesen). Jede Aktion auditiert; nicht-existenter Tenant ->
// 404 (kein silent-noop, kein Audit-Eintrag fuer eine Phantom-Tenant-ID). approve
// ist der DRITTE Reaktivierungspfad neben Webhook-Activate und Self-Service-
// Subscribe (billing/activation.js) - er laeuft NICHT durch activatePaidTenant
// (kein Zahlungsereignis, kein KYC/Provisioning), muss aber dieselbe Invariante 2
// wahren: ein Stripe-suspendierter Tenant, der manuell freigegeben wird, darf
// keinen stehenden suspended_at-Anchor behalten (sonst haelt ihn der spaetere
// DID-Release-Klassifizierer faelschlich fuer einen Kandidaten). Ruft dafuer
// denselben Store-Primitiv (store.clearSuspendedAt, G5) wie activatePaidTenant -
// KEIN Umweg ueber die Zahlungs-Komposition, die hier fachlich nicht passt.
export function makeAdminRoutes({ accounts, sessions, audit, webAuthMw, adminMw, store }) {
  const router = Router();
  router.get("/api/admin/tenants", webAuthMw, adminMw, async (req, res) => {
    try {
      res.json({ tenants: await accounts.listTenants() });
    } catch (e) {
      console.error("[admin] list", e.message);
      res.status(500).json({ error: "interner Fehler" });
    }
  });
  router.post("/api/admin/tenants/:id/approve", webAuthMw, adminMw, async (req, res) => {
    try {
      const ok = await accounts.setStatus(req.params.id, "active");
      if (!ok) return res.status(404).json({ error: "Tenant nicht gefunden" });
      // tenant-prolif-c (Invariante 2, G3-Fix): Grace-Anker loeschen, sonst bleibt ein
      // manuell reaktivierter, zahlender Tenant mit stale suspended_at aktiv (siehe
      // Kommentar oben). Idempotent (No-Op ohne gesetzten Anker).
      store.clearSuspendedAt(req.params.id);
      await audit.record({
        actorSub: req.tenant.sub,
        tenantId: req.params.id,
        action: "tenant_approve",
      });
      res.json({ tenantId: req.params.id, status: "active" });
    } catch (e) {
      console.error("[admin] approve", e.message);
      res.status(500).json({ error: "interner Fehler" });
    }
  });
  router.post("/api/admin/tenants/:id/suspend", webAuthMw, adminMw, async (req, res) => {
    try {
      const ok = await accounts.setStatus(req.params.id, TENANT_STATUS.SUSPENDED);
      if (!ok) return res.status(404).json({ error: "Tenant nicht gefunden" });
      await sessions.invalidateByTenant(req.params.id);
      // GAP-04: Symmetrie zu approve/clearSuspendedAt - eine manuelle Sperre nimmt auch die
      // Aktivierungs-Wartezustands-Erlaubnis zurueck, sonst duerfte ein gerade gesperrter
      // Tenant ueber den stehengebliebenen Marker weiterhin eine Nummer anfragen
      // (state-ops tenantMayRequestNumber). ensureTenant VOR dem Write (Muster mintSession/
      // triggerTenantProvisioning): setTenantSubscription wirft fail-closed bei fehlendem
      // Spiegel-Eintrag - ein Admin kann einen Tenant suspendieren, der noch NIE im Spiegel
      // stand (kein Web-Login/Onboarding-Schreibzugriff bisher). ensureTenant ist selbst
      // fail-soft (fangt DB-Fehler, wirft nie). Idempotent (No-Op ohne gesetzten Marker).
      await store.ensureTenant(req.params.id);
      store.setTenantSubscription(req.params.id, { activationPending: false });
      await audit.record({
        actorSub: req.tenant.sub,
        tenantId: req.params.id,
        action: "tenant_suspend",
      });
      res.json({ tenantId: req.params.id, status: TENANT_STATUS.SUSPENDED });
    } catch (e) {
      console.error("[admin] suspend", e.message);
      res.status(500).json({ error: "interner Fehler" });
    }
  });
  return router;
}

// ---- makeSessions ----------------------------------------------------
// Session-Lebenszyklus: anlegen, lesen, invalidieren (by id oder by tenant).
export function makeSessions(runner) {
  return {
    async create({ sub, tenantId, ttlSeconds, workosSessionId = null }) {
      const id = crypto.randomUUID();
      await runner.withClient((c) =>
        c.query(
          `INSERT INTO session (id, sub, tenant_id, expires_at, workos_session_id)
           VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval, $5)`,
          [id, sub, tenantId, String(ttlSeconds), workosSessionId],
        ),
      );
      return { id };
    },

    // Soft-Invalidierung via invalidated_at (Schema T6) - webAuth (T11) prueft
    // invalidated_at IS NULL AND expires_at>now(); Forensik bleibt erhalten.
    async get(id) {
      return runner.withClient(async (c) => {
        const { rows } = await c.query(
          `SELECT id, sub, tenant_id AS "tenantId", expires_at, invalidated_at,
                  workos_session_id AS "workosSessionId"
           FROM session WHERE id = $1`,
          [id],
        );
        return rows[0] || null;
      });
    },

    async invalidateById(id) {
      return runner.withClient((c) =>
        c.query(
          `UPDATE session SET invalidated_at = now() WHERE id = $1 AND invalidated_at IS NULL`,
          [id],
        ),
      );
    },

    async invalidateByTenant(tenantId) {
      return runner.withClient((c) =>
        c.query(
          `UPDATE session SET invalidated_at = now() WHERE tenant_id = $1 AND invalidated_at IS NULL`,
          [tenantId],
        ),
      );
    },
  };
}
