# Arbeits-Todo (Scratch)

Dieses File ist der Arbeits-Scratch fuer die jeweils laufende Phase (siehe
`.claude/refs/workflow.md`) und wird pro Aufgabe neu befuellt.

- Dauerhafter Ueberblick ueber offene Punkte: **`STATUS.md`**
- Lehren aus abgeschlossenen Aufgaben: **`tasks/lessons.md`**
- Rebrand-Task im Detail: **`tasks/rebrand-sundartha.md`**

---

# Bug A — Web-Login: WorkOS UM statt generischem /oauth2/* (fix/web-login-workos-um)

## Problem (verifiziert, read-only)
`authorizeUrl()` nimmt `authorization_endpoint` aus der OIDC-Discovery =
`.../oauth2/authorize` (WorkOS OAuth-2.1/Connect-Server). Der kennt User-Management-
Apps NICHT -> `application_not_found`.

Beweis (curl, gleicher client_id):
- `.../oauth2/authorize?...` -> 302 `/oauth2/error?error=application_not_found` ✓
- `api.workos.com/user_management/authorize?...&provider=authkit` -> 302 AuthKit-Login (`/bootstrap?...`) ✓

## Doku-Entscheidung: (b)
WorkOS `POST /user_management/authenticate` liefert `{ user, access_token, refresh_token, ... }`,
**KEIN `id_token`**. Das `access_token`-JWT traegt `sub,sid,iss,org_id,role,permissions,exp,iat`
— **kein `email`, kein `aud`, kein `nonce`**. => Option (a) (jwtVerify mit issuer/audience/nonce)
nicht anwendbar. => **(b)**: Identitaet aus der verifizierten Back-Channel-Antwort (`user`-Objekt:
`id`,`email`,`email_verified`). Verifikation = der authenticate-POST selbst (server-zu-server,
client_secret + TLS, single-use code + PKCE). `user.id` == access_token-`sub` -> Web- und
MCP-Kanal loesen denselben Tenant auf (idp_subject).

## Security-Bindungen (bleiben)
- **state** = CSRF (signierter Cookie, match gegen Query) — unveraendert.
- **PKCE S256** = Replay-Bindung (code nur mit code_verifier aus httpOnly-Cookie einloesbar).
- **oidc_nonce-Cookie** bleibt als signierte Same-Session-Bindung erzwungen (kein IdP-Round-Trip
  mehr moeglich; Kommentare korrigiert, kein toter Code).

## Plan / Tasks
1. [ ] RED: `test/web-auth.test.js` auf Zielbild (neue exchange-/authorizeUrl-Tests, F2 angepasst, T-P4 angepasst)
2. [ ] GREEN: `src/web-auth.js` (`makeOidc` UM-authorize+authenticate, Identitaet aus `user`, Discovery/JWKS/jose/nonceMatches raus; login/callback nonce-Cookie behalten, kein Round-Trip)
3. [ ] `src/config.js`: `workosApiBase` (Default `https://api.workos.com`) + Kommentar Zeile 301
4. [ ] `test/web-auth-oidc.test.js` loeschen
5. [ ] `render.yaml` + `PLAN-SECURITY.md` (.env.example ist read-guard-blockiert -> Report)
6. [ ] Verifikation: `node --check`, `npm test` gruen, authorizeUrl->curl->AuthKit-Login
7. [ ] Commit auf `fix/web-login-workos-um` (kein push, kein Deploy)

## Erwartetes Ergebnis (deterministisch / Feedback-Loop)
- `npm test` exit 0.
- `oidc.authorizeUrl(...)` -> URL beginnt `https://api.workos.com/user_management/authorize` + `provider=authkit`;
  `curl -sI` -> `location:` = AuthKit-`/bootstrap`, NICHT `/oauth2/error?error=application_not_found`.
- `exchange()` parst `{user}` -> `{claims:{sub:user.id, email:(email_verified===true?email:null)}}`.
