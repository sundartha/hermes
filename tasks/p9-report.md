# Phasenreport P9 — Web-Textoberflaechen und Fehler-Vertrag

**Status:** GATE = PASS
**finalBranch:** `phase/i18n-p9-web-textoberflaechen`
**headCommit:** `4e2c81c1ebfdd97f5fbc401afa567a476158384b`
**Basis:** `master` = `d4e61ba`
**Betroffene Katalog-IDs:** WEB-01, WEB-09, WEB-11, WEB-12

---

## 1. Plan (gekuerzt)

**Ausgangslage (gemessen, rot-vor-Fix):** 5 Testblaetter / 4 IDs rot.

| ID | Stelle | Ist vorher |
| --- | --- | --- |
| WEB-01 | `public/tenant.html` | `<html lang="de">` statisch, keine dynamische lang-Zuweisung |
| WEB-09 | `src/self-service-routes.js`, `POST /api/self-service/private-number` | `{ error: "privateNumber ungueltig (E.164 erwartet, erlaubtes Land)" }` |
| WEB-11 | `src/web-auth.js`, `rejectCsrf()` (eine Quelle, 4 Aufrufstellen) | `res.status(400).send("Ungueltige oder fehlende CSRF-State-Pruefung")` |
| WEB-12 | `src/web-auth.js`, catch in `GET /auth/login` (500) und `GET /auth/callback` (401) | beide `send("Anmeldung fehlgeschlagen")` |

**Konsumenten-Befund (entkraeftet Pre-Mortem 1):** Kein Frontend parst diese Texte — grep ueber `public/` und `apps/web/src/` liefert 0 Treffer fuer die deutschen Fehlerstrings; `apps/web/src/lib/api.js` liest nur `body.error` als Code (`ApiError.code`), nie die Message; `/auth/login` und `/auth/callback` liefern reinen Body ohne JS-Konsument. Fuer WEB-09/11/12 existiert daher kein Konsument — die Auflage "Konsument versteht neuen Code" wird stattdessen durch Antwort-Vertrags-Pins + diesen Grep-Beleg erfuellt. Fuer WEB-01 gibt es sehr wohl einen Konsumenten — dort wird der Vertrag beidseitig gepinnt (Server-Feld + Client-Lesen).

**Design-Entscheidungen:**
- **D1** — Codes statt Prosa: `invalid_private_number`, `csrf_state_invalid`, `login_failed` (snake_case, wie `no_card`/`already_subscribed` im Bestand).
- **D2** — Kein neues Modul fuer die drei Codes (keine Duplizierung ueber Dateigrenzen, drei verschiedene Domaenen); `login_failed` (2x in derselben Datei) wird eine Modulkonstante.
- **D3** — Konstanten nicht exportiert; Tests pinnen die String-Literale bewusst hart (Vertrag ist der String, nicht die Konstante).
- **D4** — WEB-01: Server loest die Sprache auf (`tenantLanguage`), Client schreibt nur das Attribut — keine zweite Praezedenz-Logik im Client (G5/S2).
- **D5** — `<html lang="de">` bleibt statischer Ausgangswert (Dashboard-Text ist zu 100% deutsch; kein Textumbau in dieser Phase).
- **D6** — Umfangsgrenze WEB-01 eingehalten: nur das Attribut, kein `data-i18n`-Mechanismus, kein Sprachumschalter.

**Edits (Kurzfassung):**
- `src/web-auth.js`: zwei Modulkonstanten `ERROR_CSRF_STATE_INVALID`/`ERROR_LOGIN_FAILED`; `rejectCsrf()` und beide catch-Zweige liefern die Codes statt deutschem Klartext.
- `src/self-service-routes.js`: `private-number`-Handler liefert `{error: "invalid_private_number"}`; `GET /api/self-service/state` loest die Sprache einmal auf (`tenantLanguage`) und liefert sie additiv als `language`-Feld, speist zugleich `greetingTemplates`.
- `public/tenant.html`: neue Funktion `setDocumentLanguage(language)` (fail-soft bei fehlendem/leerem Feld), aufgerufen in `refresh()` mit `s.language`.
- Tests: 2 Dateien per `git mv` umbenannt (A3, Katalog-Praefix raus aus dem Namen), 3 Tests in `web-auth.test.js` umbenannt+verschaerft, 1 neuer Test in `i9-self-service.test.js` ((w1), P10-immun durch explizite Sprachen en/fr statt Default).

**Explizit nicht Teil von P9:** `src/routes/api-onboard.js` (WEB-10, Operator-Flaeche, eigener gruener Pin), `SESSION_EXPIRED_PAGE` (WEB-13, P1, andere Phase), Dev-Login-Shim (kein Katalog-ID), uebrige deutsche Fehlerfelder ohne Katalog-ID, jede Textuebersetzung/`data-i18n`/Sprachumschalter, `DEFAULT_LANGUAGE`/Backfill (P10).

**Getragene Risiken (Owner-sichtbar):** (1) `lang != Textsprache` — EN-Tenant bekommt `lang="en"` auf deutschem Text (bewusste Zwischenstufe); (2) rohe Codes im Browser bei Auth-Fehlern statt deutschem Satz; (3) welches Dashboard live ist (WEB-02) bleibt offen und unabhaengig davon zu klaeren; (4) A6 Deploy-Wahrheit gilt unveraendert (Live erst nach `git push upstream master` + `/healthz`-Commit-Abgleich).

---

## 2. Impl-Zusammenfassung

- Umgesetzt exakt gemaess Plan auf `phase/i18n-p9-web-textoberflaechen` (Basis `master` `d4e61ba`).
- `src/web-auth.js`: `ERROR_CSRF_STATE_INVALID="csrf_state_invalid"` / `ERROR_LOGIN_FAILED="login_failed"`; `rejectCsrf()` sowie beide catch-Zweige (`GET /auth/login` 500, `GET /auth/callback` 401) liefern den Code statt deutschem Klartext; Dev-Login-Shim unangetastet.
- `src/self-service-routes.js`: `POST /api/self-service/private-number` liefert bei ungueltigem Wert `{error:"invalid_private_number"}`; `GET /api/self-service/state` loest die Tenant-Sprache einmal auf (`tenantLanguage`) und liefert sie additiv als `language`-Feld, speist zugleich `greetingTemplates`.
- `public/tenant.html`: `setDocumentLanguage(language)` neu, fail-soft, aufgerufen in `refresh()` mit `s.language`; `<html lang="de">` bleibt bewusst statischer Ausgangswert (D5).
- Tests: `test/web-01-tenant-html-lang-attribute.test.js` -> `test/tenant-html-lang-attribute.test.js`, `test/web-09-self-service-error-codes.test.js` -> `test/self-service-error-codes.test.js` (beide `git mv`, Testnamen ohne WEB-Praefix, A3); `test/web-auth.test.js`: WEB-11/12-Tests umbenannt+verschaerft, WEB-11-Test zusaetzlich mit zweitem Request gegen eine ANDERE `rejectCsrf`-Aufrufstelle (fehlender `oidc_nonce` statt State-Mismatch) -> byte-identischer Body gepinnt (Regel-3-Invariante); `test/i9-self-service.test.js`: neuer Test `(w1)` pinnt `language`-Feld + Kopplung an `greetingTemplates` fuer zwei explizite Sprachen (en/fr).

**Ergebnis-Verifikation:**
- Einzeldateien: 2+3+1 gruen wie im Plan erwartet.
- `npm test`: 3111/0 (korrigiert 3081/0), keine Regression.
- `npm run test:gates`: vorher (master) 82/26/56 -> nachher 77/26/51 (-5 Tests, pass unveraendert, -5 fail) — exakt die Plan-Invariante.
- Grep-Checks aus Plan Abschnitt 5: alle bestanden (0 Restvorkommen deutscher Klartext auf den 3 Pfaden, 1 dynamischer lang-Treffer, kein `WEB-0x`/`WEB-1x`-Testname mehr ausser dem unberuehrten WEB-14, nicht Teil der P9-ID-Menge).
- Prettier: `src/web-auth.js` und `src/self-service-routes.js` hatten bereits VOR den Aenderungen Formatierungsdrift (mit `git stash` gegen `d4e61ba` verifiziert) — nicht angefasst, um den Blast-Radius auf die Plan-Diffs zu begrenzen; `test/i9-self-service.test.js` ebenfalls vorbestehende Drift (gegen Original-Blob verifiziert) — nur der neue Testblock ist neu, Rest byte-identisch wiederhergestellt.

**testPassCount:** 3111 / **testFailCount:** 0 / **committed:** true

**filesEdited:** `src/web-auth.js`, `src/self-service-routes.js`, `public/tenant.html`, `test/i9-self-service.test.js`, `test/web-auth.test.js`
**filesCreated (via git mv):** `test/tenant-html-lang-attribute.test.js` (ex `test/web-01-tenant-html-lang-attribute.test.js`), `test/self-service-error-codes.test.js` (ex `test/web-09-self-service-error-codes.test.js`)

### Deviations

- Manueller End-to-End-Server-Smoke (curl gegen `/auth/callback` bzw. laufendes `tenant.html`) **nicht durchgefuehrt** — die Boot-Guard-Kette verlangt weitere, phasenfremde Env-Variablen (u.a. `COST_TRUING_REQUIRED_RECORD_TYPES`) bis der Prozess hochfaehrt. Laut Task-Vorgabe best-effort/kein Blocker. Ersatzbeleg: vollstaendige automatisierte Testabdeckung (Einzeldateien + `npm test` + `npm run test:gates` Vorher/Nachher-Delta), alle gruen.
- `smokePass: false` / `smokeNote`: Server-Boot lokal nicht bis `/healthz` erreicht (Boot-Guard verlangt zusaetzliche, mit P9 unverbundene Konfiguration); laut Task-Vorgabe best-effort/kein Blocker.

---

## 3. Safety-Urteil (final)

**approved: true** — alle Einzelkriterien true (`testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`).

**Unabhaengiger Testlauf:** frischer Worktree, Branch `review-p9` = `phase/i18n-p9-web-textoberflaechen` (`4e2c81c`), merge-base == `master` (`d4e61ba`), kein stale base.

- Branch P9: `npm test` exit 0 — roh 3111/3111/0, korrigiert 3081/3081/0 (30 Phantom-Wrapper abgezogen). GRUEN.
- Branch P9: `npm run test:gates` exit 1 — korrigiert 77 Tests / 26 pass / 51 fail (rot erlaubt).
- Master-Baseline (selbst erhoben, detached auf `d4e61ba`): `npm test` 3075/3075/0; `npm run test:gates` 82/26/56.
- Delta/Split-Invariante: Regression +6 (3075->3081) = 5 gewanderte Katalogtests + 1 neuer Test; Gates -5 Tests, Fails -5, pass unveraendert 26 -> kein vormals gruener Gate-Test gekippt. Gesamtbestand master 3157 = P9 3158 = +1 (genau der neue Test). Split verliert/dupliziert nichts.
- Beide Backends abgedeckt: json ueber `test/helpers.js` BASE_ENV fuer Spawn-Tests, pg in-process ueber pglite (`test/i9-self-service.test.js`, `test/web-auth-pg.test.js`) — beide gruen.
- `node --check` auf beiden Produktivdateien OK. eslint im Worktree nicht lauffaehig (Umgebungsartefakt, kein Code-Befund). Keine Umlaute in neuen Zeilen. Keine stale Referenzen auf umbenannte Testdateien.

**Absolute Regeln — einzeln geprueft, alle eingehalten:**
1. Safety-Gates: kein Gate angefasst (Telephony/numberGateError/Denylist/Land-Gate/Stundenlimit/Budget-Guard/Max-Dauer/Signaturpruefung unberuehrt).
2. Offenlegung: `claude.js`/`bridge.js` unveraendert, `disclosureSentence` fest verdrahtet.
3. Auth fail-closed: ausschliesslich String-Ersetzungen durch benannte Konstanten; Statuscodes, `clearCookies`, `recoverLogin`/Loop-Guard, `safeEqual`/`verifyValue`, Pruefreihenfolge unangetastet. Neuer Testfall belegt zusaetzlich Regel-3-Invariante (zwei verschiedene `rejectCsrf`-Aufrufstellen -> byte-identischer Body, kein Detail-Leak).
4. Secrets: nichts geleakt/geloggt; neues Feld `language` ist der eigene Sprachcode des angemeldeten Tenants; Fehlerantworten wurden detail-aermer, nicht reicher.

**Verhalten wie spezifiziert:** WEB-01 als reiner `document.documentElement.lang`-Write (Gegenmassnahme 2, kein `data-i18n`-Mechanismus), fail-soft bei fehlendem Feld/401/403. WEB-09/11/12 als stabile Codes. Eine Sprachaufloesung speist Vorlagen UND lang-Attribut (G5, testgepinnt). `(w1)`-Test mit expliziten Sprachen — P10-immun, kein Tautologie-Test.

**A3 erfuellt:** die 4 gefixten IDs verschwinden aus `test:gates` (56->51 Fails), leben als 5 Testfaelle im Regressionslauf weiter; Gates-pass-Zahl bleibt bei 26.

**Concerns (nicht blockierend):**
1. Merge-Reihenfolge: `PLAN-I18N-FIX.md` nennt fuer P9 die Vorbedingung "P8 live"; P8 ist auf diesem `master` NICHT enthalten (merge-base nach P3). Funktioniert technisch trotzdem, da `tenantLanguage`/`resolveCallLanguage` bereits vor P8 existieren. Lead sollte Wellen-Reihenfolge bewusst bestaetigen.
2. Nutzersichtbare UX-Verschlechterung (spec-konform, aber real): `/auth/login`/`/auth/callback` senden jetzt nackte Strings `login_failed`/`csrf_state_invalid` als HTML-Body statt eines Satzes — vom Katalog akzeptiert, Plan haelt echten Textmechanismus bewusst raus.
3. Additives API-Feld `language` in `GET /api/self-service/state` — formal mehr als das Testminimum von WEB-01, architektonisch aber richtig (keine zweite Praezedenz-Logik im Client); Konsumenten gegengeprueft, keine Kollision.
4. Pre-Mortem-1-Gegenmassnahme faktisch nicht gebraucht (kein Konsument der alten deutschen Strings), aber selbst belegt statt nur behauptet.
5. Bewusst nicht mitgefixte deutsche Fehlertexte in derselben Datei (`PUBLIC_URL fehlt` = WEB-10, `session_id ist Pflicht`, `Customer-Mismatch`, sowie identischer Text in `api-onboard.js`) — korrekte Scope-Disziplin, aber Inkonsistenz fuer Folgephase vormerken.

**Verdikt:** FREIGEGEBEN. Diff minimal und praezise auf P9 geschnitten: 3 Produktivdateien + 5 Testdateien, +121/-86. Keine neue Dependency, kein neuer Endpunkt.

---

## 4. Clean-Code-Audit (final)

**s1:** [] — keine Befunde
**s2:** [] — keine Befunde
**s3:** [] — keine Befunde
**s4:** [] — keine Befunde
**blocker: false**

**Verdikt:** PASS. Sauberer, eng geschnittener Diff (8 Dateien, +121/-86). Alle vier Kataloglücken exakt wie `tasks/i18n-tests/08-web-dashboard-onboarding.md` spezifiziert umgesetzt: dynamisches lang-Attribut in `tenant.html` gespeist aus neuem servergesteuertem `language`-Feld; stabile sprachneutrale Fehlercodes an drei Stellen (`invalid_private_number`, `csrf_state_invalid`, `login_failed`). Kein S1/S2-Befund verifiziert: `node --check` gruen, alle betroffenen Testdateien gruen nachvollzogen (77/77) in detachtem Checkout des Phasen-Commits. Neue Konstanten sauber benannt und dedupliziert; vormals doppelte `tenantLanguage(agentState, tenant)`-Berechnung in `self-service-routes.js` in eine lokale `language`-Variable gezogen (G5-Fix, keine neue Duplizierung). Fail-soft-Verhalten von `setDocumentLanguage` (typeof+truthy-Guard) korrekt und kommentiert.

**passNotes:** Scope haelt sich strikt an die vier benannten Katalog-IDs; bewusst nicht angefasst: WEB-10 (`PUBLIC_URL fehlt`, P2/Operator-only) sowie admin-only Fehlerpfade in `web-auth.js` ("interner Fehler", "Tenant nicht gefunden", "dev-login fehlgeschlagen") — laut Katalog nicht Teil dieser Phase. Testumbenennung verschiebt Tests korrekt aus `test:gates` in den `npm test`-Regressionslauf (Namenspraefix-Regel aus CLAUDE.md), Gesamtzahl ueber beide Laeufe erhalten. Kommentardichte hoch, aber inhaltlich korrekt (C2/C3 PASS).

**topTodos (optional, kein Blocker):**
1. `tasks/i18n-tests/00-kanonische-liste.md` bzw. die WEB-01/09/11/12-Eintraege in `08-web-dashboard-onboarding.md` als erledigt markieren.
2. Bei Gelegenheit: verbleibende deutsche Klartext-Fehler in `web-auth.js` Admin-Routen unter eine spaetere i18n-Phase ziehen, falls diese Flaechen je nutzersichtbar werden.

---

## 5. Fix-Runden

Keine. Der Plan wurde beim ersten Durchlauf umgesetzt; Safety- und Clean-Code-Review lieferten `approved: true` / `PASS` ohne Blocker, keine Fix-Runde noetig.
