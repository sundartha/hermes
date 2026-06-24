// Browser-Login: standard OIDC Authorization-Code + PKCE, in-house (kein Provider-
// SDK -> kein Lock-in, nur OIDC-Claims queren die Schicht). Cookie-Signatur und
// PKCE mit crypto (kein neuer Dep). Niemals Tokens/Secrets loggen.
import crypto from "crypto";
import { Router } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { safeEqual } from "./util.js";

// Laenge des CSRF-/nonce-Zufallswerts in Bytes (analog oauth_state).
const RANDOM_BYTES = 16;
// Lebensdauer der Login-Flow-Cookies (pkce/state/nonce) in Sekunden.
const LOGIN_COOKIE_MAX_AGE = 600;

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
  const router = Router();

  // GET /auth/login
  // Erzeugt PKCE-Paar + State, signiert beides als Cookies, redirectet zum IdP.
  router.get("/auth/login", async (req, res) => {
    const { verifier, challenge } = makePkce();
    const state = crypto.randomBytes(RANDOM_BYTES).toString("base64url");
    // nonce bindet das id_token an genau diese Login-Session (Replay/Substitution-
    // Schutz, den PKCE nicht abdeckt): signiert als Cookie, als Param zum IdP.
    const nonce = crypto.randomBytes(RANDOM_BYTES).toString("base64url");
    setCookies(res, [
      ["pkce_verifier", signValue(verifier, secret), LOGIN_COOKIE_MAX_AGE],
      ["oauth_state", signValue(state, secret), LOGIN_COOKIE_MAX_AGE],
      ["oidc_nonce", signValue(nonce, secret), LOGIN_COOKIE_MAX_AGE],
    ]);
    // authorizeUrl triggert intern discover() -> fetch. Ist der IdP unerreichbar
    // (oder die Discovery malformt), rejected der await. Express 4 reicht eine
    // Route-Rejection NICHT automatisch an eine Error-MW weiter -> der Request
    // haengt sonst bis zum Socket-Timeout. Fail-closed: sauberer 5xx, generische
    // Meldung (KEIN IdP-/Connection-Detail, kein Leak), Login-Cookies geloescht.
    try {
      const url = await oidc.authorizeUrl({ challenge, state, nonce, redirectUri });
      res.redirect(302, url);
    } catch {
      clearCookies(res, ["pkce_verifier", "oauth_state", "oidc_nonce"]);
      res.status(500).send("Anmeldung fehlgeschlagen");
    }
  });

  // GET /auth/callback
  // Validiert State (CSRF), tauscht Code gegen id_token, upsert Account, setzt Session-Cookie.
  router.get("/auth/callback", async (req, res) => {
    // CSRF: state-Cookie muss vorhanden und mit Query-Param uebereinstimmen
    const signedState = readCookie(req, "oauth_state");
    const stateFromCookie = signedState ? verifyValue(signedState, secret) : null;
    if (!stateFromCookie || stateFromCookie !== req.query.state) {
      return res.status(400).send("Ungueltige oder fehlende CSRF-State-Pruefung");
    }

    // nonce: signierter Cookie muss vorhanden und gueltig sein. Fehlt/ungueltig ->
    // 400 mit derselben generischen Meldung wie state (kein Detail-Leak, welcher
    // Check scheiterte). Der Klarwert wird an exchange zur id_token-Bindung gereicht.
    const signedNonce = readCookie(req, "oidc_nonce");
    const nonce = signedNonce ? verifyValue(signedNonce, secret) : null;
    if (!nonce) {
      return res.status(400).send("Ungueltige oder fehlende CSRF-State-Pruefung");
    }

    // PKCE-Verifier aus Cookie
    const signedVerifier = readCookie(req, "pkce_verifier");
    const verifier = signedVerifier ? verifyValue(signedVerifier, secret) : null;

    try {
      const { claims } = await oidc.exchange({
        code: req.query.code,
        verifier,
        nonce,
        redirectUri,
      });
      const { tenantId } = await accounts.upsertOnFirstLogin({
        sub: claims.sub,
        email: claims.email,
      });
      const { id } = await sessions.create({ sub: claims.sub, tenantId, ttlSeconds });

      // Session-Cookie setzen, Login-Flow-Cookies loeschen
      res.append("Set-Cookie", cookieAttrs("session", signValue(id, secret), ttlSeconds));
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
  // Invalidiert die Session (wenn Cookie vorhanden), loescht Cookie. Idempotent -> immer 204.
  router.post("/auth/logout", async (req, res) => {
    const signedSession = readCookie(req, "session");
    const sessionId = signedSession ? verifyValue(signedSession, secret) : null;
    if (sessionId) {
      await sessions.invalidateById(sessionId);
    }
    clearCookies(res, ["session"]);
    res.status(204).end();
  });

  return router;
}

// ---- claimsFromPayload ----------------------------------------------
// Mappt einen verifizierten id_token-Payload auf die Session-Claims. email
// wird NUR uebernommen, wenn der Provider email_verified === true setzt
// (Strikt-Gleichheit, kein Truthy-Cast: "true"/1/Abwesenheit gelten als
// unverifiziert). Sonst email: null -> die Admin-Allowlist (adminOnly) ist
// damit nur ueber nachweislich verifizierte Adressen erreichbar.
export function claimsFromPayload(payload) {
  const email = payload.email_verified === true ? (payload.email ?? null) : null;
  return { sub: payload.sub, email };
}

// Prueft, ob das id_token den nonce dieser Login-Session traegt. Timing-sicher.
// false bei fehlendem lokalem nonce, fehlendem Token-nonce oder Mismatch.
function nonceMatches(payloadNonce, expected) {
  if (!expected || payloadNonce == null) return false;
  return safeEqual(String(payloadNonce), expected);
}

// ---- makeOidc --------------------------------------------------------
// OIDC Auth-Code-Flow-Helfer (Authorization-Endpoint-URL bauen + Token-Exchange
// mit id_token-Verifikation). Cached Discovery-Dokument + JWKS. Niemals loggen.
// Default-TTL des Discovery-Dokuments in Millisekunden (1 h). Per optionalem
// Parameter _discoveryTtlMs nur fuer Tests uebersteuerbar (Default unveraendert).
const DISCOVERY_TTL_MS = 3600_000;

export function makeOidc(config, { _discoveryTtlMs = DISCOVERY_TTL_MS, _fetch = fetch } = {}) {
  let discoveryCache = null;
  let discoveryCachedAt = 0;
  let jwksCache = null;

  // TTL fuer das Discovery-Dokument. Beim Ablauf wird jwksCache ebenfalls
  // zurueckgesetzt, damit eine jwks_uri-Rotation beim IdP ohne Prozess-Neustart
  // aufgefangen wird (sonst brechen alle Logins bis zum Restart).
  async function discover() {
    if (discoveryCache && Date.now() - discoveryCachedAt < _discoveryTtlMs) return discoveryCache;
    const r = await _fetch(`${config.oauthIssuerUrl}/.well-known/openid-configuration`);
    if (!r.ok) throw new Error(`OIDC discovery HTTP ${r.status}`);
    discoveryCache = await r.json();
    discoveryCachedAt = Date.now();
    // Neuladen: jwksCache zuruecksetzen, damit getJwks() die (evtl. neue)
    // jwks_uri neu aufloest statt die alte RemoteJWKSet-Instanz zu behalten.
    jwksCache = null;
    return discoveryCache;
  }

  async function getJwks() {
    // Erst discover() (TTL-gated, billig): ein abgelaufener Cache wird hier neu
    // geladen und setzt jwksCache zurueck. Erst danach den Cache pruefen, sonst
    // wuerde eine jwks_uri-Rotation nie greifen (alte Instanz bliebe erhalten).
    const { jwks_uri } = await discover();
    if (jwksCache) return jwksCache;
    // Eine malformte Discovery-Antwort (kein jwks_uri) wuerde sonst als
    // `new URL(undefined)` -> roher TypeError: Invalid URL crashen (unhandled
    // rejection). Klarer, identifizierbarer Fehler statt blindem Deref.
    if (typeof jwks_uri !== "string" || !jwks_uri)
      throw new Error("OIDC discovery: jwks_uri fehlt oder ist ungueltig");
    jwksCache = createRemoteJWKSet(new URL(jwks_uri));
    return jwksCache;
  }

  return {
    // Test-Hook: macht getJwks fuer Unit-Tests beobachtbar (Cache-Verhalten).
    // Kein Produktions-Aufrufer; getJwks wird intern von exchange() genutzt.
    _getJwksForTest: getJwks,

    async authorizeUrl({ challenge, state, nonce, redirectUri }) {
      const { authorization_endpoint } = await discover();
      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.oidcClientId,
        redirect_uri: redirectUri,
        scope: "openid email",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        nonce,
      });
      return `${authorization_endpoint}?${params}`;
    },

    async exchange({ code, verifier, nonce, redirectUri }) {
      const { token_endpoint } = await discover();
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: config.oidcClientId,
        client_secret: config.oidcClientSecret,
        redirect_uri: redirectUri,
      });
      const r = await _fetch(token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!r.ok) throw new Error(`Token-Endpoint HTTP ${r.status}`);
      // Token-Body parsen. Ein non-JSON-Body (r.json() wirft) wird hier zu einem
      // gefangenen Fehler statt einer rohen Rejection. Ein leeres `{}` (kein
      // id_token) wuerde sonst als jwtVerify(undefined, ...) crashen - daher
      // explizit pruefen, BEVOR id_token an jwtVerify geht.
      const { id_token } = await r.json();
      if (typeof id_token !== "string" || !id_token)
        throw new Error("Token-Endpoint: id_token fehlt in der Token-Antwort");
      const jwks = await getJwks();
      const { payload } = await jwtVerify(id_token, jwks, {
        issuer: config.oauthIssuerUrl,
        audience: config.oidcClientId,
        clockTolerance: 30,
      });
      // nonce-Bindung manuell pruefen (nicht als jwtVerify-Option, da jose die
      // nonce-Option versionsabhaengig exponiert): id_token muss den nonce dieser
      // Login-Session tragen. Mismatch/fehlend -> wirft, Aufrufer faengt generisch
      // (401, kein Leak). Timing-sicherer Vergleich in nonceMatches.
      if (!nonceMatches(payload.nonce, nonce)) {
        throw new Error("nonce mismatch");
      }
      return { claims: claimsFromPayload(payload) };
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
        const tenantId = `t_${sub}`;
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

// ---- webAuth ---------------------------------------------------------
// Express-Middleware: prueft Session-Cookie (signiert), laedt Session + Account,
// setzt req.tenant. Fail-closed: kein Detail-Leak in Fehlerkoerpern, kein Token-
// oder Cookie-Logging. Unerwartete Fehler -> 401.
export function webAuth(deps) {
  const { secret, sessions, accounts } = deps;

  return async function webAuthMiddleware(req, res, next) {
    try {
      // 1. Cookie lesen und Signatur pruefen
      const raw = readCookie(req, "session");
      const sessionId = raw ? verifyValue(raw, secret) : null;
      if (!sessionId) return res.status(401).json({ error: "Unauthorized" });

      // 2. Session laden und Gueltigkeit pruefen
      const row = await sessions.get(sessionId);
      if (!row) return res.status(401).json({ error: "Unauthorized" });
      if (row.invalidated_at != null) return res.status(401).json({ error: "Unauthorized" });
      if (new Date(row.expires_at) <= new Date())
        return res.status(401).json({ error: "Unauthorized" });

      // 3. Account laden und Status pruefen
      const acct = await accounts.resolve(row.sub);
      if (!acct) return res.status(401).json({ error: "Unauthorized" });
      if (acct.status !== "active") return res.status(403).json({ error: "Forbidden" });

      // 4. Tenant-Kontext am Request setzen
      req.tenant = { tenantId: acct.tenantId, sub: row.sub, role: acct.role, email: acct.email };
      next();
    } catch {
      // Unerwarteter Fehler -> fail-closed, kein Detail-Leak
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
// Express-Router fuer die Admin-Tenant-Verwaltung (approve/suspend), hinter
// webAuthMw + adminMw. Als Factory exportiert, damit Produktion (server.js) UND
// Test denselben Handler nutzen (keine handkopierte Route-Replik, G5). suspend
// invalidiert sofort alle Sessions des Tenants (gesperrter Kunde kann nicht bis
// Cookie-Expiry weiterlesen). Jede Aktion auditiert; nicht-existenter Tenant ->
// 404 (kein silent-noop, kein Audit-Eintrag fuer eine Phantom-Tenant-ID).
export function makeAdminRoutes({ accounts, sessions, audit, webAuthMw, adminMw }) {
  const router = Router();
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
    async create({ sub, tenantId, ttlSeconds }) {
      const id = crypto.randomUUID();
      await runner.withClient((c) =>
        c.query(
          `INSERT INTO session (id, sub, tenant_id, expires_at)
           VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
          [id, sub, tenantId, String(ttlSeconds)],
        ),
      );
      return { id };
    },

    // Soft-Invalidierung via invalidated_at (Schema T6) - webAuth (T11) prueft
    // invalidated_at IS NULL AND expires_at>now(); Forensik bleibt erhalten.
    async get(id) {
      return runner.withClient(async (c) => {
        const { rows } = await c.query(
          `SELECT id, sub, tenant_id AS "tenantId", expires_at, invalidated_at
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
