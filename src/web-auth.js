// Browser-Login: standard OIDC Authorization-Code + PKCE, in-house (kein Provider-
// SDK -> kein Lock-in, nur OIDC-Claims queren die Schicht). Cookie-Signatur und
// PKCE mit crypto (kein neuer Dep). Niemals Tokens/Secrets loggen.
import crypto from "crypto";
import { Router } from "express";
import { tenantIdForSubject, TENANT_STATUS } from "./store/defaults.js";

// Laenge des CSRF-/nonce-Zufallswerts in Bytes (analog oauth_state).
const RANDOM_BYTES = 16;
// Default-Lebensdauer der Login-Flow-Cookies (pkce/state/nonce) in Sekunden, falls deps
// keinen Wert injiziert (Tests). Produktion reicht config.loginCookieTtlSeconds durch.
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
const SESSION_EXPIRED_PAGE = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>Sitzung abgelaufen</title></head><body>
<h1>Sitzung abgelaufen</h1>
<p>Deine Anmeldesitzung ist abgelaufen oder dein Browser blockiert Cookies. Bitte erlaube Cookies fuer diese Seite und melde dich erneut an.</p>
<p><a href="${LOGIN_ROUTE}">Erneut anmelden</a></p>
</body></html>`;

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
  const a = Buffer.from(sig),
    b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? value : null;
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
  // Login-Flow-Cookie-TTL (state/pkce/nonce) per DI (Muster ttlSeconds): Produktion reicht
  // config.loginCookieTtlSeconds durch, Tests fallen auf den Default zurueck. `??` ehrt eine
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
      clearCookies(res, ["pkce_verifier", "oauth_state", "oidc_nonce"]);
      res.status(500).send("Anmeldung fehlgeschlagen");
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
      return res.status(400).send("Ungueltige oder fehlende CSRF-State-Pruefung");
    }

    // nonce: signierter Cookie muss vorhanden und gueltig sein. Fehlt/ungueltig ->
    // 400 mit derselben generischen Meldung wie state (kein Detail-Leak, welcher
    // Check scheiterte). Bindet den Callback an die Login-Session dieses Browsers
    // (Same-Session). WorkOS User Management liefert kein id_token, an das ein nonce
    // gebunden werden koennte -> das Cookie selbst ist die Bindung; der Replay-Schutz
    // liegt bei PKCE.
    const signedNonce = readCookie(req, "oidc_nonce");
    const nonce = signedNonce ? verifyValue(signedNonce, secret) : null;
    if (!nonce) {
      return res.status(400).send("Ungueltige oder fehlende CSRF-State-Pruefung");
    }

    // PKCE-Verifier aus Cookie
    const signedVerifier = readCookie(req, "pkce_verifier");
    const verifier = signedVerifier ? verifyValue(signedVerifier, secret) : null;

    // Verifier + code muessen vorhanden sein, BEVOR wir WorkOS anrufen: ein fehlender
    // Verifier (Cookie weg/ungueltig) oder ein Callback ohne code (z.B. WorkOS-Fehler-
    // Redirect ?error=...) wuerde sonst als null/undefined an authenticate gehen. Fail-
    // fast lokal (400, gleiche generische Meldung wie state/nonce - kein Detail-Leak,
    // welcher Check scheiterte), statt einen garantiert ungueltigen Request abzusetzen.
    if (!verifier || typeof req.query.code !== "string" || !req.query.code) {
      return res.status(400).send("Ungueltige oder fehlende CSRF-State-Pruefung");
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
      clearCookies(res, ["pkce_verifier", "oauth_state", "oidc_nonce"]);

      await audit.record({ actorSub: claims.sub, tenantId, action: "login" });
      res.redirect(302, postLoginPath);
    } catch {
      // Generischer Fehler: kein internes Detail, keine Token-Leaks
      clearCookies(res, ["pkce_verifier", "oauth_state", "oidc_nonce"]);
      res.status(401).send("Anmeldung fehlgeschlagen");
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
    const signedSession = readCookie(req, "session");
    const sessionId = signedSession ? verifyValue(signedSession, secret) : null;
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
  const authorizeEndpoint = `${config.workosApiBase}/user_management/authorize`;
  const authenticateEndpoint = `${config.workosApiBase}/user_management/authenticate`;

  return {
    // authorizeUrl bleibt async (Router awaitet + faengt fail-closed). provider=authkit
    // waehlt die gehostete AuthKit-Login-Seite; PKCE S256 + state queren als Query.
    // WorkOS UM kennt im authorize-Endpoint weder scope noch nonce.
    async authorizeUrl({ challenge, state, redirectUri }) {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.oidcClientId,
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
          client_id: config.oidcClientId,
          client_secret: config.oidcClientSecret,
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
      return `${config.workosApiBase}/user_management/sessions/logout?${params}`;
    },
  };
}

// ---- makeAccounts ----------------------------------------------------
// Tenant + Account upsert beim ersten Login; Lesepfade fuer Middleware.
export function makeAccounts(runner) {
  return {
    // Erster Login: Tenant anlegen (suspended), Account anlegen/aktualisieren.
    // Gibt {tenantId, status, role} zurueck.
    async upsertOnFirstLogin({ sub, email }) {
      return runner.withClient(async (c) => {
        const tenantId = tenantIdForSubject(sub); // EINE Quelle (G5), identischer Wert
        // Tenant anlegen falls nicht vorhanden (idempotent). idp_subject = sub macht
        // den Tenant ueber i9 resolveTenant (MCP/REST-Kanal) auffindbar -> EINE
        // Identitaetsquelle fuer beide Kanaele (Web-Login B + MCP i9). ON CONFLICT
        // aktualisiert NUR idp_subject, nie den (evtl. schon aktivierten) status.
        await c.query(
          `INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'suspended', $2)
           ON CONFLICT (id) DO UPDATE SET idp_subject = EXCLUDED.idp_subject`,
          [tenantId, sub],
        );
        // Account anlegen/aktualisieren
        await c.query(
          `INSERT INTO account (sub, tenant_id, email, role)
           VALUES ($1, $2, $3, 'member')
           ON CONFLICT (sub) DO UPDATE SET email = EXCLUDED.email`,
          [sub, tenantId, email],
        );
        const { rows } = await c.query(
          `SELECT a.role, t.status FROM account a JOIN tenant t ON t.id = a.tenant_id WHERE a.sub = $1`,
          [sub],
        );
        const row = rows[0] || { role: "member", status: "suspended" };
        return { tenantId, status: row.status, role: row.role };
      });
    },

    // Liest Account + Tenant fuer die Session-Middleware.
    async resolve(sub) {
      return runner.withClient(async (c) => {
        const { rows } = await c.query(
          `SELECT a.sub, a.email, a.role, a.tenant_id AS "tenantId", t.status
           FROM account a JOIN tenant t ON t.id = a.tenant_id WHERE a.sub = $1`,
          [sub],
        );
        return rows[0] || null;
      });
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
  const raw = readCookie(req, "session");
  const sessionId = raw ? verifyValue(raw, secret) : null;
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

// ---- webAuth ---------------------------------------------------------
// Express-Middleware: prueft Session-Cookie (signiert), laedt Session + Account,
// setzt req.tenant. Fail-closed: kein Detail-Leak in Fehlerkoerpern, kein Token-
// oder Cookie-Logging. Unerwartete Fehler -> 401. Status-Gate: nur active passiert
// (suspended/closed -> 403); die suspended-erreichbare Variante ist webAuthAllowPending.
export function webAuth(deps) {
  return async function webAuthMiddleware(req, res, next) {
    try {
      const ctx = await resolveWebSession(deps, req);
      if (!ctx) return res.status(401).json({ error: "Unauthorized" });
      if (ctx.acct.status !== TENANT_STATUS.ACTIVE)
        return res.status(403).json({ error: "Forbidden" });
      req.tenant = tenantContextOf(ctx);
      next();
    } catch {
      res.status(401).json({ error: "Unauthorized" });
    }
  };
}

// ---- webAuthAllowPending (P5) ----------------------------------------
// Variante fuer die drei Self-Aktivierungs-Routen (setup-checkout/return/subscribe) +
// billing/status: verlangt eine GUELTIGE Session (fail-closed: kein/abgelaufenes Cookie
// -> 401) und bindet jede Wirkung an den EIGENEN Tenant, laesst aber suspended durch -
// SONST koennte sich ein frisch eingeloggter Tenant nie selbst aktivieren (403-Deadlock).
// closed/unbekannt bleibt HART gesperrt (kein Reaktivieren). Oeffnet KEINE Tenant-Daten:
// nur active-only webAuth haengt an /state + Settings-Routen.
export function webAuthAllowPending(deps) {
  return async function webAuthAllowPendingMiddleware(req, res, next) {
    try {
      const ctx = await resolveWebSession(deps, req);
      if (!ctx) return res.status(401).json({ error: "Unauthorized" });
      if (!PENDING_ALLOWED_STATUS.has(ctx.acct.status))
        return res.status(403).json({ error: "Forbidden" });
      req.tenant = tenantContextOf(ctx);
      next();
    } catch {
      res.status(401).json({ error: "Unauthorized" });
    }
  };
}

// ---- adminOnly -------------------------------------------------------
// Express-Middleware NACH webAuth (braucht req.tenant): erlaubt nur Admins -
// E-Mail in der Allowlist ODER role==='admin'. Fail-closed: ohne req.tenant
// oder kein Admin -> 403. Kein Detail-Leak.
export function adminOnly(deps) {
  const allow = (deps.adminEmails || []).map((e) => e.toLowerCase());
  return function adminOnlyMiddleware(req, res, next) {
    const t = req.tenant;
    const isAdmin = t && (t.role === "admin" || (t.email && allow.includes(t.email.toLowerCase())));
    if (!isAdmin) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

// ---- makeAdminRoutes -------------------------------------------------
// Express-Router fuer die Admin-Tenant-Verwaltung (list/approve/suspend), hinter
// webAuthMw + adminMw. Als Factory exportiert, damit Produktion (server.js) UND
// Test denselben Handler nutzen (keine handkopierte Route-Replik, G5). suspend
// invalidiert sofort alle Sessions des Tenants (gesperrter Kunde kann nicht bis
// Cookie-Expiry weiterlesen). Jede Aktion auditiert; nicht-existenter Tenant ->
// 404 (kein silent-noop, kein Audit-Eintrag fuer eine Phantom-Tenant-ID).
export function makeAdminRoutes({ accounts, sessions, audit, webAuthMw, adminMw }) {
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
      const ok = await accounts.setStatus(req.params.id, "suspended");
      if (!ok) return res.status(404).json({ error: "Tenant nicht gefunden" });
      await sessions.invalidateByTenant(req.params.id);
      await audit.record({
        actorSub: req.tenant.sub,
        tenantId: req.params.id,
        action: "tenant_suspend",
      });
      res.json({ tenantId: req.params.id, status: "suspended" });
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
