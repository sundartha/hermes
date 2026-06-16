// Browser-Login: standard OIDC Authorization-Code + PKCE, in-house (kein Provider-
// SDK -> kein Lock-in, nur OIDC-Claims queren die Schicht). Cookie-Signatur und
// PKCE mit crypto (kein neuer Dep). Niemals Tokens/Secrets loggen.
import crypto from "crypto";
import { Router } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

const b64url = (buf) => buf.toString("base64url");

// HMAC-signierter Cookie-Wert "<value>.<sig>". Timing-sichere Pruefung.
export function signValue(value, secret) {
  const sig = crypto.createHmac("sha256", secret).update(value).digest("base64url");
  return `${value}.${sig}`;
}
export function verifyValue(signed, secret) {
  const i = String(signed).lastIndexOf(".");
  if (i < 1) return null;
  const value = signed.slice(0, i), sig = signed.slice(i + 1);
  const expected = crypto.createHmac("sha256", secret).update(value).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
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
      try { return decodeURIComponent(part.slice(i + 1)); } catch { return null; }
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
  const { secret, redirectUri, ttlSeconds, oidc, accounts, sessions, audit } = deps;
  const router = Router();

  // GET /auth/login
  // Erzeugt PKCE-Paar + State, signiert beides als Cookies, redirectet zum IdP.
  router.get("/auth/login", async (req, res) => {
    const { verifier, challenge } = makePkce();
    const state = crypto.randomBytes(16).toString("base64url");
    setCookies(res, [
      ["pkce_verifier", signValue(verifier, secret), 600],
      ["oauth_state",   signValue(state,    secret), 600],
    ]);
    const url = await oidc.authorizeUrl({ challenge, state, redirectUri });
    res.redirect(302, url);
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

    // PKCE-Verifier aus Cookie
    const signedVerifier = readCookie(req, "pkce_verifier");
    const verifier = signedVerifier ? verifyValue(signedVerifier, secret) : null;

    try {
      const { claims } = await oidc.exchange({ code: req.query.code, verifier, redirectUri });
      const { tenantId } = await accounts.upsertOnFirstLogin({ sub: claims.sub, email: claims.email });
      const { id } = await sessions.create({ sub: claims.sub, tenantId, ttlSeconds });

      // Session-Cookie setzen, PKCE/State-Cookies loeschen
      res.append("Set-Cookie", cookieAttrs("session", signValue(id, secret), ttlSeconds));
      clearCookies(res, ["pkce_verifier", "oauth_state"]);

      await audit.record({ actorSub: claims.sub, tenantId, action: "login" });
      res.redirect(302, "/");
    } catch {
      // Generischer Fehler: kein internes Detail, keine Token-Leaks
      clearCookies(res, ["pkce_verifier", "oauth_state"]);
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

// ---- makeOidc --------------------------------------------------------
// OIDC Auth-Code-Flow-Helfer (Authorization-Endpoint-URL bauen + Token-Exchange
// mit id_token-Verifikation). Cached Discovery-Dokument + JWKS. Niemals loggen.
export function makeOidc(config) {
  let discoveryCache = null;

  async function discover() {
    if (discoveryCache) return discoveryCache;
    const r = await fetch(`${config.oauthIssuerUrl}/.well-known/openid-configuration`);
    if (!r.ok) throw new Error(`OIDC discovery HTTP ${r.status}`);
    discoveryCache = await r.json();
    return discoveryCache;
  }

  let jwksCache = null;
  async function getJwks() {
    if (jwksCache) return jwksCache;
    const { jwks_uri } = await discover();
    jwksCache = createRemoteJWKSet(new URL(jwks_uri));
    return jwksCache;
  }

  return {
    async authorizeUrl({ challenge, state, redirectUri }) {
      const { authorization_endpoint } = await discover();
      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.oidcClientId,
        redirect_uri: redirectUri,
        scope: "openid email",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
      });
      return `${authorization_endpoint}?${params}`;
    },

    async exchange({ code, verifier, redirectUri }) {
      const { token_endpoint } = await discover();
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: config.oidcClientId,
        client_secret: config.oidcClientSecret,
        redirect_uri: redirectUri,
      });
      const r = await fetch(token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!r.ok) throw new Error(`Token-Endpoint HTTP ${r.status}`);
      const { id_token } = await r.json();
      const jwks = await getJwks();
      const { payload } = await jwtVerify(id_token, jwks, {
        issuer: config.oauthIssuerUrl,
        audience: config.oidcClientId,
        clockTolerance: 30,
      });
      return { claims: { sub: payload.sub, email: payload.email || null } };
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
        // Tenant anlegen falls nicht vorhanden (idempotent)
        await c.query(
          `INSERT INTO tenant (id, status) VALUES ($1, 'suspended') ON CONFLICT DO NOTHING`,
          [tenantId]
        );
        // Account anlegen/aktualisieren
        await c.query(
          `INSERT INTO account (sub, tenant_id, email, role)
           VALUES ($1, $2, $3, 'member')
           ON CONFLICT (sub) DO UPDATE SET email = EXCLUDED.email`,
          [sub, tenantId, email]
        );
        const { rows } = await c.query(
          `SELECT a.role, t.status FROM account a JOIN tenant t ON t.id = a.tenant_id WHERE a.sub = $1`,
          [sub]
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
          [sub]
        );
        return rows[0] || null;
      });
    },

    // Admin: Tenant-Status aendern (active/suspended).
    async setStatus(tenantId, status) {
      return runner.withClient((c) =>
        c.query(`UPDATE tenant SET status = $1 WHERE id = $2`, [status, tenantId])
      );
    },
  };
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
          [id, sub, tenantId, String(ttlSeconds)]
        )
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
          [id]
        );
        return rows[0] || null;
      });
    },

    async invalidateById(id) {
      return runner.withClient((c) =>
        c.query(
          `UPDATE session SET invalidated_at = now() WHERE id = $1 AND invalidated_at IS NULL`,
          [id]
        )
      );
    },

    async invalidateByTenant(tenantId) {
      return runner.withClient((c) =>
        c.query(
          `UPDATE session SET invalidated_at = now() WHERE tenant_id = $1 AND invalidated_at IS NULL`,
          [tenantId]
        )
      );
    },
  };
}
