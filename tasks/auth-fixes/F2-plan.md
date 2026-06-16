# F2 — nonce im OIDC Auth-Code-Flow

**Prioritaet:** HIGH  
**Branch:** feat/auth-tenant-foundation  
**Dateien:** `src/web-auth.js`, `test/web-auth.test.js`

---

## Problem

`GET /auth/login` erzeugt kein nonce. `authorizeUrl()` sendet keinen `nonce`-Parameter
an den IdP. `exchange()` / `jwtVerify()` pruefen `payload.nonce` nicht.

Folge: Ein id_token, der fuer eine andere Login-Session ausgestellt wurde (Replay) oder
per Token-Substitution eingeschleust wird, besteht die Verifikation. PKCE schuetzt den
Code-Exchange-Kanal, ersetzt aber nicht die nonce-Bindung des id_token an genau
diese Browser-Session.

---

## Soll-Verhalten (vollstaendig und binaer pruefbar)

### GET /auth/login

1. Erzeugt `nonce` via `crypto.randomBytes(16).toString("base64url")`.
2. Signiert `nonce` mit `signValue(nonce, secret)` analog zu `oauth_state`.
3. Setzt Cookie `oidc_nonce` mit denselben Attributen wie `pkce_verifier`/`oauth_state`
   (HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=600).
4. Uebergibt `nonce` als Parameter `nonce` an `oidc.authorizeUrl(...)` — der IdP
   bettet ihn in den id_token ein.

### makeOidc.authorizeUrl

5. Nimmt `nonce` als neuen Parameter entgegen und fuegt ihn in den URLSearchParams-
   Block ein (neben `state`, `code_challenge`, ...).

### makeOidc.exchange

6. Nimmt `nonce` als neuen Parameter entgegen.
7. Reicht `nonce` nach erfolgreicher `jwtVerify` als zusaetzliche Option an eine
   manuelle Pruefung durch — NICHT als `jwtVerify`-Option, weil `jose` die
   nonce-Option nur unter bestimmten Versionen/Aufrufformen exponiert.
   Stattdessen: nach `jwtVerify` explizit pruefen:
   ```js
   if (!nonce || !payload.nonce ||
       !timingSafeStringEqual(String(payload.nonce), nonce)) {
     throw new Error("nonce mismatch");
   }
   ```
   wobei `timingSafeStringEqual` timing-sicher via `crypto.timingSafeEqual` auf
   Buffer-Ebene arbeitet (identisch zum bestehenden Muster in `verifyValue`).

### GET /auth/callback

8. Liest `oidc_nonce`-Cookie, verifiziert Signatur mit `verifyValue`.
9. Bei fehlendem oder ungueltigem `oidc_nonce`-Cookie: sofortiger Abbruch mit
   HTTP 400, generische Meldung ("Ungueltige oder fehlende CSRF-State-Pruefung" —
   gleich wie state-Pruefung, kein Detail-Leak welcher Check scheiterte).
10. Reicht `nonce` an `oidc.exchange(...)` weiter.
11. Bei nonce-Mismatch im exchange-Ergebnis: wird vom bestehenden `catch`-Block
    gefangen -> HTTP 401 "Anmeldung fehlgeschlagen" (kein Leak).
12. Loescht `oidc_nonce`-Cookie zusammen mit `pkce_verifier` und `oauth_state` in
    `clearCookies(res, ["pkce_verifier", "oauth_state", "oidc_nonce"])`.

---

## Akzeptanzkriterien

| # | Kriterium | Pruefbar durch |
|---|---|---|
| AC1 | `GET /auth/login` setzt Cookie `oidc_nonce` (signiert, HttpOnly, SameSite=Lax, Max-Age=600) | Test T1 |
| AC2 | `authorizeUrl` erhaelt Parameter `nonce` und gibt ihn in der URL aus | Test T1 |
| AC3 | `GET /auth/callback` mit fehlendem `oidc_nonce`-Cookie -> 400, keine Session | Test T2 |
| AC4 | `GET /auth/callback` mit ungueltigem (manipuliertem) `oidc_nonce`-Cookie -> 400, keine Session | Test T3 |
| AC5 | `GET /auth/callback` mit nonce-Mismatch im id_token (exchange wirft) -> 401, keine Session | Test T4 |
| AC6 | `GET /auth/callback` Happy-Path: oidc_nonce wird an exchange uebergeben, nonce-Cookie wird geloescht | Test T5 |
| AC7 | nonce-Vergleich in exchange ist timing-sicher (kein String-Direktvergleich) | Code-Review |
| AC8 | Kein internes Detail (nonce-Wert, Token-Inhalt) in Fehler-Response-Body | Tests T2-T4 |
| AC9 | Alle bestehenden 7 Tests in web-auth.test.js weiterhin gruen | `npm test` |

---

## Test-Cases (node:test, test/web-auth.test.js)

Alle Tests verwenden das bestehende `fakeDeps()`/`mountRouter()`/`rawGet()`-Muster.
Die Fake-`oidc`-Implementierung wird gezielt pro Test ueberschrieben.

### T1 — GET /auth/login setzt nonce-Cookie und gibt nonce an authorizeUrl

**Given:** Server laeuft mit `fakeDeps()`; `oidc.authorizeUrl` speichert den
erhaltenen `nonce`-Wert in einem `calls`-Objekt und gibt ihn in der URL aus
(z.B. `?nonce=<wert>`).

**When:** `rawGet(/auth/login)`

**Then:**
- `res.status === 302`
- `res.setCookie` enthaelt `oidc_nonce=...` mit HttpOnly, SameSite=Lax
- `cookieValue(res.setCookie, "oidc_nonce")` ist nicht null und verifizierbar
  signiert (`verifyValue(..., SECRET) !== null`)
- `res.headers.location` enthaelt `nonce=` Parameter
- Der nonce-Wert in der URL stimmt mit dem Cookie-Inhalt (nach verifyValue) ueberein

### T2 — GET /auth/callback ohne oidc_nonce-Cookie -> 400

**Given:** Server mit `fakeDeps()`. Nur `oauth_state` und `pkce_verifier` als
Cookies gesetzt, kein `oidc_nonce`.

**When:** `rawGet(/auth/callback?code=authcode&state=<valid-state>, { Cookie: ... })`

**Then:**
- `res.status === 400`
- `cookieValue(res.setCookie, "session") === null`
- `calls.upsert.length === 0`
- `calls.create.length === 0`

### T3 — GET /auth/callback mit manipuliertem oidc_nonce-Cookie -> 400

**Given:** `oidc_nonce`-Cookie wird mit falscher Signatur gesetzt (z.B.
`signValue("nonce-val", "wrong-secret")`).

**When:** `rawGet(/auth/callback?code=authcode&state=<valid-state>, { Cookie: ... })`
mit validem `oauth_state`-Cookie und manipuliertem `oidc_nonce`.

**Then:**
- `res.status === 400`
- `cookieValue(res.setCookie, "session") === null`
- Kein Leak des nonce-Werts in `res.body`

### T4 — GET /auth/callback mit nonce-Mismatch im id_token -> 401

**Given:** `oidc.exchange` ist so gefaked, dass er einen nonce-Mismatch simuliert
(wirft `new Error("nonce mismatch")`). Alle drei Cookies (state, verifier, nonce)
korrekt gesetzt.

**When:** `rawGet(/auth/callback?code=authcode&state=<valid-state>, { Cookie: ... })`

**Then:**
- `res.status === 401`
- `cookieValue(res.setCookie, "session") === null`
- `res.body` enthaelt weder "nonce" noch Fehler-Details

### T5 — GET /auth/callback Happy-Path: nonce-Cookie wird an exchange uebergeben und danach geloescht

**Given:** `fakeDeps()`. `oidc.exchange` speichert den erhaltenen `nonce`-Parameter
in `calls.exchangeNonce`. Alle drei Cookies korrekt gesetzt mit passendem `nonce`.

**When:** `rawGet(/auth/callback?code=authcode&state=<valid-state>, { Cookie: ... })`

**Then:**
- `res.status === 302`
- `calls.exchangeNonce` ist der korrekte nonce-Klarwert (nach verifyValue des Cookies)
- `res.setCookie` loescht `oidc_nonce` (Max-Age=0)
- Session-Cookie wird gesetzt (unveraenderter Happy-Path)

---

## Implementierungsreihenfolge

1. Tests T1-T5 in `test/web-auth.test.js` schreiben (RED).
2. `src/web-auth.js` aendern:
   a. `makeWebAuthRoutes` -> `GET /auth/login`: nonce erzeugen, Cookie setzen,
      an `authorizeUrl` uebergeben.
   b. `makeOidc.authorizeUrl`: `nonce`-Parameter in URLSearchParams aufnehmen.
   c. `makeOidc.exchange`: `nonce`-Parameter aufnehmen, nach `jwtVerify`
      timing-sichere Pruefung gegen `payload.nonce`.
   d. `makeWebAuthRoutes` -> `GET /auth/callback`: `oidc_nonce`-Cookie lesen,
      verifizieren (400 bei Fehler), an `exchange` weitergeben, beim Cleanup
      mitloeschen.
3. `npm test` (alle Tests gruen).
4. Syntax-Check: `node --check src/web-auth.js`.

---

## Risiken

- **jose jwtVerify nonce-Option:** Nicht verwendet (Versionsabhaengig). Manuelle
  timing-sichere Pruefung ist robuster und expliziter. Kein Risiko.
- **Fake-exchange in bestehenden Tests:** Der bestehende `exchange`-Fake in
  `fakeDeps()` gibt `nonce` nicht zurueck. T5-Update muss den Fake erweitern,
  ohne die bestehenden Tests zu brechen. Loesung: neue Fake-Variante in T5,
  `fakeDeps()` unveraendert.
- **Bestehender Callback-Test (T_callback_happy):** Erwartet bislang keinen
  `oidc_nonce`-Cookie. Muss um diesen Cookie ergaenzt werden, sonst schlaegt er
  nach der Aenderung mit 400 fehl. Explizit in Schritt 2d zu beachten.
- **Keine neue Abhaengigkeit:** Nur `crypto` (bereits importiert). Kein neuer Dep.
