# F1 — email_verified vor Admin-Allowlist erzwingen

## Problem

`makeOidc.exchange()` gibt `email: payload.email || null` zurueck **ohne** `payload.email_verified`
zu pruefen (web-auth.js:201). `adminOnly()` prueft `allow.includes(t.email.toLowerCase())` gegen
die ADMIN_EMAILS-Allowlist. Ergebnis: Wer einen OIDC-Account mit einer unverifzierten
E-Mail-Adresse (oder einer providersetig aenderbaren) bekommt, die in ADMIN_EMAILS steht,
erhaelt Admin-Rechte ohne Kontrolle ueber die tatsaechliche Mailbox. Privilege-Escalation.

Der `sub`-basierte role=admin-Pfad (`t.role === 'admin'`) wird **nicht** angefasst — er basiert
nicht auf email.

---

## Soll-Zustand (Akzeptanzkriterien)

AC1. `exchange()` gibt `email: null` zurueck, wenn `payload.email_verified` NICHT exakt `true`
     ist (undefined, false, "false", 0, abwesend — alle gelten als unverifiziert).

AC2. `exchange()` gibt `email: payload.email` zurueck, wenn `payload.email_verified === true`
     (boolesches true, kein Truthy-Cast).

AC3. `adminOnly()` bleibt unveraendert — das Fix sitzt ausschliesslich in `exchange()`. Die
     Allowlist-Logik ist korrekt, solange email=null unverifiziert signalisiert.

AC4. Bestehende Tests in web-auth.test.js, web-auth-middleware.test.js, web-auth-pg.test.js
     laufen weiterhin gruen (`npm test` ohne Fehler).

AC5. Neues Verhalten ist durch automatisierte node:test-Cases abgedeckt (s.u.) — kein
     manueller Smoke-Test erforderlich, da kein HTTP-Endpunkt, kein Twilio-Pfad betroffen.

---

## Lokalisierung

**Einzige Source-Aenderung:**
- `/src/web-auth.js` Zeile 201:
  ```js
  // Vorher
  return { claims: { sub: payload.sub, email: payload.email || null } };
  // Nachher
  return { claims: { sub: payload.sub, email: payload.email_verified === true ? (payload.email ?? null) : null } };
  ```

**Einzige Test-Aenderung:**
- `/test/web-auth.test.js` — neue Tests am Ende der Datei (kein neues File noetig; Muster aus
  bestehenden fakeDeps-Tests wiederverwenden).

---

## Test-Cases (Given / When / Then)

Alle Tests laufen in `test/web-auth.test.js` als Unit-Tests gegen `makeOidc` (injizierter
`fetch`-Fake + injizierter `jwtVerify`-Fake via Dependency-Injection-Muster). Da `makeOidc`
intern `fetch` und `jose` aufruft, wird der `exchange()`-Codepfad direkt ueber die
exportierte Funktion getestet — kein HTTP-Server noetig.

**Hinweis zur Teststruktur:** `makeOidc` verwendet `fetch` und `createRemoteJWKSet`/`jwtVerify`
aus `jose` global. Um diese ohne Dependency-Injection stubbar zu machen, wird eine kleine
Hilfsfunktion `makeOidcWithDeps(config, { fetchFn, jwtVerifyFn })` als zweite Signatur
exportiert (oder die Tests mocken `globalThis.fetch`). Einfachste Loesung: `makeOidc` bekommt
einen optionalen zweiten Parameter `_internals = {}` — in Tests werden `fetchFn` und
`jwtVerifyFn` dort uebergeben; in Produktion bleiben globale Defaults.

**Alternative (noch einfacher, kein Interface-Eingriff):** Die exchange()-Tests werden als
direkte Unit-Tests der Claim-Auswertungslogik geschrieben, indem der payload-zu-claims-
Mapping-Code in eine pure Helper-Funktion `claimsFromPayload(payload)` ausgelagert wird,
die separat getestet werden kann. Dieses Muster vermeidet Aenderungen an der oeffentlichen
Signatur von `makeOidc`.

**Empfohlene Umsetzung (einfachste, kein neues Interface, kein globalThis-Mock):**

1. Extrahiere `claimsFromPayload(payload)` als exportierte pure Funktion in web-auth.js.
2. `exchange()` ruft intern `claimsFromPayload(payload)` auf.
3. Tests importieren und testen `claimsFromPayload` direkt — kein Netz, kein Fake-JWKS.

---

### T-F1-01: email_verified true -> email durchgereicht

**Given:** OIDC-Payload mit `email_verified: true`, `email: "admin@vodafone.de"`, `sub: "u1"`

**When:** `claimsFromPayload(payload)` aufgerufen

**Then:** Rueckgabe `{ sub: "u1", email: "admin@vodafone.de" }`

---

### T-F1-02: email_verified false -> email: null

**Given:** OIDC-Payload mit `email_verified: false`, `email: "attacker@vodafone.de"`, `sub: "u2"`

**When:** `claimsFromPayload(payload)` aufgerufen

**Then:** Rueckgabe `{ sub: "u2", email: null }`

---

### T-F1-03: email_verified fehlt (undefined) -> email: null

**Given:** OIDC-Payload **ohne** `email_verified`-Feld, `email: "x@y.de"`, `sub: "u3"`

**When:** `claimsFromPayload(payload)` aufgerufen

**Then:** Rueckgabe `{ sub: "u3", email: null }`

---

### T-F1-04: email_verified true, email fehlt -> email: null (nicht crash)

**Given:** OIDC-Payload mit `email_verified: true`, **kein** `email`-Feld, `sub: "u4"`

**When:** `claimsFromPayload(payload)` aufgerufen

**Then:** Rueckgabe `{ sub: "u4", email: null }` — kein Throw

---

### T-F1-05: email_verified truthy (String "true") -> email: null (kein Truthy-Cast)

**Given:** OIDC-Payload mit `email_verified: "true"` (String), `email: "x@y.de"`, `sub: "u5"`

**When:** `claimsFromPayload(payload)` aufgerufen

**Then:** Rueckgabe `{ sub: "u5", email: null }` — Strikt-Gleichheit `=== true` erzwungen

---

### T-F1-06: adminOnly mit unverifizierter Email (null) -> 403 trotz ADMIN_EMAILS-Treffer

**Given:** `adminOnly({ adminEmails: ["admin@vodafone.de"] })` und `req.tenant = { email: null,
            role: "member", tenantId: "t_u1", sub: "u1" }`

**When:** Middleware aufgerufen

**Then:** Response 403 — email=null schlaegt ADMIN_EMAILS-Check fehl, role-Pfad greift nicht

*(Dieser Test verwendet das bestehende express-Mount-Muster aus web-auth-middleware.test.js.)*

---

### T-F1-07: adminOnly mit verifizierter Email in Allowlist -> 200

**Given:** `adminOnly({ adminEmails: ["admin@vodafone.de"] })` und `req.tenant = { email:
            "admin@vodafone.de", role: "member", tenantId: "t_u1", sub: "u1" }`

**When:** Middleware aufgerufen

**Then:** Response 200 — verifizierte Email in Allowlist erlaubt Zugang

*(Smoke-Test fuer Regression: bestehende adminOnly-Logik nach Fix unveraendert.)*

---

## Betroffene Dateien

| Datei | Typ | Aenderung |
|---|---|---|
| `src/web-auth.js` | Source | (1) `claimsFromPayload(payload)` als exportierte pure Funktion hinzufuegen; (2) `exchange()` delegiert dorthin |
| `test/web-auth.test.js` | Test | T-F1-01 bis T-F1-07 am Ende der Datei anfuegen |

Keine weiteren Dateien. `adminOnly` bleibt unveraendert. `web-auth-middleware.test.js` und
`web-auth-pg.test.js` werden nicht angefasst; sie laufen unveraendert gruen.

---

## Verifikation

```
node --check src/web-auth.js   # Syntax-Check
npm test                        # alle Tests gruen
```

Erwartetes Ergebnis: 0 Failures, T-F1-01 bis T-F1-07 bestehen, bestehende Tests unveraendert gruen.

---

## Risiken

- **Kein Risiko fuer sub-basierten Admin-Pfad:** `t.role === 'admin'` prueft die DB-Spalte,
  nicht email — unveraendert.
- **OIDC-Provider ohne email_verified:** Legitime Provider (Google, Microsoft, GitHub) setzen
  `email_verified: true` bei verifizierten Adressen. Ein Provider, der den Claim weglasst,
  wuerde nach diesem Fix keine email liefern — das ist bewusstes fail-closed-Verhalten.
  Wenn Jonas einen Provider ohne `email_verified` unterstuetzen will, ist das eine separate
  Entscheidung (Config-Flag oder Account-Aktivierungsflow aendern).
- **upsertOnFirstLogin erhaelt email: null:** Der Account wird mit `email = NULL` angelegt,
  wenn der Claim fehlt. Das ist korrekt — Admin-Zugang via Allowlist braucht danach manuellen
  DB-Update oder Provider-seitiges email_verified. Keine Daten-Integritaets-Verletzung
  (email-Spalte ist nullable laut Schema).
