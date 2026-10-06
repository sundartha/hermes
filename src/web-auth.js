import crypto from "crypto";
import { Router } from "express";
import { tenantIdForSubject, TENANT_STATUS } from "./store/defaults.js";
import { safeEqual, auditAuthFailed, AUTH_FAILED_GRUND } from "./util.js";
import { resolveOnboardCountry, tenantGeoForCountry } from "./geo/resolve.js";

const RANDOM_BYTES = 16;
const DEFAULT_LOGIN_COOKIE_TTL_SECONDS = 1800;
export const LOGIN_ROUTE = "/auth/login";
const RETRY_PARAM = "retry";
const STATE_RETRY_MARKER = "~retry";
const markRetryState = (token) => token + STATE_RETRY_MARKER;
const isRetryState = (state) => String(state ?? "").endsWith(STATE_RETRY_MARKER);
const SESSION_EXPIRED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Session expired</title></head><body>
<h1>Session expired</h1>
<p>Your sign-in session has expired, or your browser is blocking cookies. Please allow cookies for this site and sign in again.</p>
<p><a href="${LOGIN_ROUTE}">Sign in again</a></p>
</body></html>`;

const ERROR_CSRF_STATE_INVALID = "csrf_state_invalid";
const ERROR_LOGIN_FAILED = "login_failed";

const b64url = (buf) => buf.toString("base64url");

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

export function makePkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

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

function cookieAttrs(name, value, maxAge) {
  const encoded = encodeURIComponent(value ?? "");
  const age = value === null ? 0 : maxAge;
  return `${name}=${encoded}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}`;
}

function setCookies(res, entries) {
  for (const [name, value, maxAge] of entries) {
    res.append("Set-Cookie", cookieAttrs(name, value, maxAge));
  }
}

function clearCookies(res, names) {
  for (const name of names) {
    res.append("Set-Cookie", cookieAttrs(name, null, 0));
  }
}

export const SESSION_COOKIE_NAME = "__Host-session";

const LOGIN_FLOW_COOKIE_NAMES = ["pkce_verifier", "oauth_state", "oidc_nonce"];

export function readSignedCookie(req, name, secret) {
  const raw = readCookie(req, name);
  return raw ? verifyValue(raw, secret) : null;
}

function rejectCsrf(res) {
  return res.status(400).send(ERROR_CSRF_STATE_INVALID);
}

function recoverLogin(req, res) {
  if (isRetryState(req.query.state)) return res.status(200).send(SESSION_EXPIRED_PAGE);
  return res.redirect(302, `${LOGIN_ROUTE}?${RETRY_PARAM}=1`);
}

export function makeWebAuthRoutes(deps) {
  const { secret, redirectUri, ttlSeconds, oidc, accounts, sessions, audit } = deps;
  const postLoginPath = deps.postLoginPath || "/";
  const postLogoutUrl = deps.postLogoutUrl;
  const ensureTenant = deps.ensureTenant || (async () => {});
  const applyTenantIdentity = deps.applyTenantIdentity || (async () => {});
  const bindSub = deps.bindSub || (async () => {});
  const loginCookieTtlSeconds = deps.loginCookieTtlSeconds ?? DEFAULT_LOGIN_COOKIE_TTL_SECONDS;
  const router = Router();

  async function mintSession(res, { sub, email, firstName, lastName, workosSessionId }) {
    const { tenantId } = await accounts.upsertOnFirstLogin({ sub, email });
    await ensureTenant(tenantId);
    await bindSub(sub, tenantId);
    if (firstName || lastName) await applyTenantIdentity(tenantId, { firstName, lastName });
    const { id } = await sessions.create({ sub, tenantId, ttlSeconds, workosSessionId });
    res.append("Set-Cookie", cookieAttrs(SESSION_COOKIE_NAME, signValue(id, secret), ttlSeconds));
    return { tenantId, id };
  }

  router.get(LOGIN_ROUTE, async (req, res) => {
    const { verifier, challenge } = makePkce();
    const stateToken = crypto.randomBytes(RANDOM_BYTES).toString("base64url");
    const state = req.query[RETRY_PARAM] === "1" ? markRetryState(stateToken) : stateToken;
    const nonce = crypto.randomBytes(RANDOM_BYTES).toString("base64url");
    setCookies(res, [
      ["pkce_verifier", signValue(verifier, secret), loginCookieTtlSeconds],
      ["oauth_state", signValue(state, secret), loginCookieTtlSeconds],
      ["oidc_nonce", signValue(nonce, secret), loginCookieTtlSeconds],
    ]);
    try {
      const url = await oidc.authorizeUrl({ challenge, state, redirectUri });
      res.redirect(302, url);
    } catch {
      clearCookies(res, LOGIN_FLOW_COOKIE_NAMES);
      res.status(500).send(ERROR_LOGIN_FAILED);
    }
  });

  router.get("/auth/callback", async (req, res) => {
    const signedState = readCookie(req, "oauth_state");
    if (signedState === null) return recoverLogin(req, res);
    const stateFromCookie = verifyValue(signedState, secret);
    if (!stateFromCookie || stateFromCookie !== req.query.state) {
      return rejectCsrf(res);
    }

    const nonce = readSignedCookie(req, "oidc_nonce", secret);
    if (!nonce) {
      return rejectCsrf(res);
    }

    const verifier = readSignedCookie(req, "pkce_verifier", secret);

    if (!verifier || typeof req.query.code !== "string" || !req.query.code) {
      return rejectCsrf(res);
    }

    try {
      const { claims, workosSessionId } = await oidc.exchange({ code: req.query.code, verifier });
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
      clearCookies(res, LOGIN_FLOW_COOKIE_NAMES);
      res.status(401).send(ERROR_LOGIN_FAILED);
    }
  });

  router.post("/auth/logout", async (req, res) => {
    const sessionId = readSignedCookie(req, SESSION_COOKIE_NAME, secret);
    let workosSessionId = null;
    if (sessionId) {
      const row = await sessions.get(sessionId);
      workosSessionId = row ? row.workosSessionId : null;
      await sessions.invalidateById(sessionId);
    }
    clearCookies(res, [SESSION_COOKIE_NAME]);
    if (!workosSessionId) return res.status(204).end();
    res
      .status(200)
      .json({ logoutUrl: oidc.sessionLogoutUrl({ workosSessionId, returnTo: postLogoutUrl }) });
  });

  if (deps.devLoginEnabled) {
    router.post("/auth/dev-login", async (req, res) => {
      try {
        const body = req.body || {};
        const sub = typeof body.sub === "string" && body.sub ? body.sub : "dev-user";
        const email = typeof body.email === "string" && body.email ? body.email : "dev@local.test";
        await mintSession(res, { sub, email });
        res.redirect(302, postLoginPath);
      } catch {
        res.status(500).send("dev-login fehlgeschlagen");
      }
    });
  }

  return router;
}

export function claimsFromPayload(payload) {
  const email = payload.email_verified === true ? (payload.email ?? null) : null;
  const claims = { sub: payload.sub, email };
  if (typeof payload.firstName === "string" && payload.firstName)
    claims.firstName = payload.firstName;
  if (typeof payload.lastName === "string" && payload.lastName) claims.lastName = payload.lastName;
  return claims;
}

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

export function makeOidc(config, { _fetch = fetch } = {}) {
  const authorizeEndpoint = `${config.auth.workosApiBase}/user_management/authorize`;
  const authenticateEndpoint = `${config.auth.workosApiBase}/user_management/authenticate`;

  return {
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
      if (!r.ok) throw new Error(`authenticate HTTP ${r.status}`);
      const data = await r.json();
      const user = data && data.user;
      if (!user || typeof user !== "object")
        throw new Error("authenticate: user fehlt in der Antwort");
      if (typeof user.id !== "string" || !user.id)
        throw new Error("authenticate: user.id fehlt in der Antwort");
      return {
        claims: claimsFromPayload({
          sub: user.id,
          email: user.email,
          email_verified: user.email_verified,
          firstName: user.first_name,
          lastName: user.last_name,
        }),
        workosSessionId: sidFromAccessToken(data.access_token),
      };
    },

    sessionLogoutUrl({ workosSessionId, returnTo }) {
      const params = new URLSearchParams({ session_id: workosSessionId });
      if (returnTo) params.set("return_to", returnTo);
      return `${config.auth.workosApiBase}/user_management/sessions/logout?${params}`;
    },
  };
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : email;
}

async function resolveOrCreateTenant(c, { sub, email, geo }) {
  await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [email]);
  const existing = await c.query(
    `SELECT a.tenant_id FROM account a JOIN tenant t ON t.id = a.tenant_id
     WHERE a.email = $1 AND t.status <> $2 ORDER BY a.created_at ASC LIMIT 1`,
    [email, TENANT_STATUS.CLOSED],
  );
  if (existing.rows.length > 0) return existing.rows[0].tenant_id;
  const tenantId = tenantIdForSubject(sub);
  await c.query(
    `INSERT INTO tenant (id, status, idp_subject, country, default_language, timezone)
     VALUES ($1, '${TENANT_STATUS.SUSPENDED}', $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET idp_subject = EXCLUDED.idp_subject`,
    [tenantId, sub, geo.country, geo.defaultLanguage, geo.timezone],
  );
  return tenantId;
}

async function selectAccountAuth(c, sub) {
  const { rows } = await c.query(
    `SELECT a.sub, a.email, a.role, a.tenant_id AS "tenantId", t.status
     FROM account a JOIN tenant t ON t.id = a.tenant_id WHERE a.sub = $1`,
    [sub],
  );
  return rows[0] || null;
}

export function newestAccountIfUnanimousEmail(rows) {
  if (rows.length === 0) return null;
  const [newest] = rows;
  const email = normalizeEmail(newest.email);
  if (!rows.every((row) => normalizeEmail(row.email) === email)) return null;
  return { sub: newest.sub, email: newest.email };
}

export function makeAccounts(runner, { defaultCountry } = {}) {
  const signupGeo = tenantGeoForCountry(resolveOnboardCountry({ fallbackCountry: defaultCountry }));
  return {
    async upsertOnFirstLogin({ sub, email }) {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) {
        console.warn("[web-auth] Login abgelehnt: Email nicht verifiziert");
        throw new Error("login rejected: verified email required");
      }
      return runner.withClient(async (c) => {
        await c.query("BEGIN");
        try {
          const tenantId = await resolveOrCreateTenant(c, { sub, email: normalizedEmail, geo: signupGeo });
          await c.query(
            `INSERT INTO account (sub, tenant_id, email, role)
             VALUES ($1, $2, $3, 'member')
             ON CONFLICT (sub) DO UPDATE SET email = EXCLUDED.email`,
            [sub, tenantId, normalizedEmail],
          );
          const row = await selectAccountAuth(c, sub);
          await c.query("COMMIT");
          const result = row || { tenantId, role: "member", status: TENANT_STATUS.SUSPENDED };
          return { tenantId: result.tenantId, status: result.status, role: result.role };
        } catch (err) {
          await c.query("ROLLBACK");
          throw err;
        }
      });
    },

    async resolve(sub) {
      return runner.withClient((c) => selectAccountAuth(c, sub));
    },

    async accountByTenant(tenantId) {
      return runner.withClient(async (c) => {
        const { rows } = await c.query(
          `SELECT sub, email FROM account WHERE tenant_id = $1 ORDER BY created_at DESC, sub ASC`,
          [tenantId],
        );
        return newestAccountIfUnanimousEmail(rows);
      });
    },

    async accountsForOrphanReconcile() {
      return runner.withClient(async (client) => {
        const { rows } = await client.query(
          `SELECT t.id AS "tenantId", t.idp_subject AS "idpSubject",
                  a.sub, a.email, a.created_at AS "createdAt"
             FROM tenant t JOIN account a ON a.tenant_id = t.id
            WHERE t.id IN (SELECT tenant_id FROM account GROUP BY tenant_id HAVING count(*) > 1)
               OR (t.idp_subject IS NOT NULL
                   AND t.idp_subject NOT IN (SELECT sub FROM account WHERE tenant_id = t.id))
            ORDER BY t.id, a.created_at`,
        );
        return rows;
      });
    },

    async dropAccount(sub) {
      return runner.withClient(async (client) => {
        const { rows } = await client.query(`DELETE FROM account WHERE sub = $1 RETURNING sub`, [sub]);
        return rows.length > 0;
      });
    },

    async setIdpSubject(tenantId, sub) {
      return runner.withClient(async (client) => {
        const { rows } = await client.query(
          `UPDATE tenant SET idp_subject = $1 WHERE id = $2 RETURNING id`,
          [sub, tenantId],
        );
        return rows.length > 0;
      });
    },

    async setStatus(tenantId, status) {
      return runner.withClient(async (c) => {
        const { rows } = await c.query(`UPDATE tenant SET status = $1 WHERE id = $2 RETURNING id`, [
          status,
          tenantId,
        ]);
        return rows.length > 0;
      });
    },

    async listTenants() {
      return runner.withClient(async (c) => {
        const { rows } = await c.query(
          `SELECT id, status, created_at AS "createdAt" FROM tenant ORDER BY created_at`,
        );
        return rows;
      });
    },

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

async function resolveWebSession({ secret, sessions, accounts }, req) {
  const sessionId = readSignedCookie(req, SESSION_COOKIE_NAME, secret);
  if (!sessionId) return null;
  const row = await sessions.get(sessionId);
  if (!row || row.invalidated_at != null || new Date(row.expires_at) <= new Date()) return null;
  const acct = await accounts.resolve(row.sub);
  if (!acct) return null;
  return { acct, sub: row.sub };
}

const tenantContextOf = ({ acct, sub }) => ({
  tenantId: acct.tenantId,
  sub,
  role: acct.role,
  email: acct.email,
  status: acct.status,
});

const PENDING_ALLOWED_STATUS = Object.freeze(
  new Set([TENANT_STATUS.ACTIVE, TENANT_STATUS.SUSPENDED]),
);

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

export const webAuth = webAuthWithStatusGate((status) => status === TENANT_STATUS.ACTIVE);

export const webAuthAllowPending = webAuthWithStatusGate((status) =>
  PENDING_ALLOWED_STATUS.has(status),
);

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
