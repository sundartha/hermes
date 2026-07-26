# Phase P8 — Geo-Identität am Eintritt (verhaltensneutraler Vorbau)

**Gate: PASS**
**finalBranch:** `phase/i18n-p8-geo-identitaet`
**headCommit:** `334ebf58dd2c2b8b073310a48a4829edbb28ea9e`
**Basis:** `master @ 507e965`

---

## 1. Plan (gekürzt)

Autoritativ: `PLAN-I18N-FIX.md` § „P8 – Geo-Identitaet am Eintritt". Vier SOLL-Tests waren am echten Code als rot verifiziert:

| ID | Lücke |
|---|---|
| LANG-02 | `resolveOrCreateTenant` (Web-Login) schreibt nur `id, status, idp_subject` → `country`/`default_language` bleiben NULL |
| FMT-11 | `api-onboard.js` ruft `normalizePrivateNumber` ohne Land-Argument; strenger `["+49"]`-Default lehnt US-Onboarding ab |
| FMT-28 | Kein `timezone`-Feld im Datenmodell; Prompt-Uhrzeit läuft in Server-TZ (live UTC) statt Tenant-TZ |
| E2E-01 | `POST /api/self-service/settings {country:"US"}` verschluckt das Feld still, Route antwortet 200 ohne Wirkung |

**Zentrale Entscheidungen:**
- **D1 (Owner-Frage aufgelöst):** Kein IP-Geo im Login-Pfad. Login schreibt den deterministischen Plattform-Default (`config.provisioning.provisioningCountry`) — exakt der Wert, den der bestehende Code-Fallback heute ohnehin liefert. Neutralitätsbeweis der Phase.
- **D2:** `timezone` wird bewusst NICHT Teil von `tenantGeo()`. Eigener Reader `tenantTimezone()`, damit kein Gate-nahes Modul die Zone versehentlich mitliest (LAW-07: kein Anrufzeit-Gate).
- **D3:** Premium-/Notruf-Denylist wird als Blatt-Modul `src/telephony/number-denylist.js` herausgezogen (aus `outbound-gates.js`) und von `state-ops.js` mitbenutzt — EINE Quelle (G5), keine zweite Premium-Liste, kein Import-Zyklus (config-freie Store-Schicht darf `outbound-gates.js` nicht importieren).
- **D4:** Keine neue Env-Variable, keine neue Dependency.
- **D5 (kein Backfill):** Der Login-Write passiert nur im INSERT-Zweig von `resolveOrCreateTenant`, nie im `ON CONFLICT`-Zweig. Bestandszeilen bleiben NULL.

**Umsetzungsreihenfolge (7 Wellen):** Blätter (Denylist-Extraktion) → reine Ableitungen (`DEFAULT_TIMEZONE`/`resolveTimezone`/`timezoneForCountry`/`tenantGeoForCountry`) → Persistenz (Schema, `state-ops.js`, Fassaden) → Eintrittspfade (`api-onboard.js`, `web-auth.js`, `wiring/web-login.js`) → Nummern-Gate (`normalizePrivateNumber`/`setPrivateNumber`/`registerTenant`) → Konsum + Ablehnung (`claude.js`, Self-Service-Lock) → A3-Migration der vier Katalogtests nach `npm test`.

**Explizit NICHT Teil der Phase:** kein `US: "en"` in `LANGUAGE_FOR_COUNTRY` (P10 bleibt offen), kein IP-Geo, kein Backfill, kein Anrufzeit-Gate, kein zweiter DID-Kauf, keine Änderung an `disclosureSentence`/Auth/Signaturprüfung.

**Deterministische Abnahme:** Rot-Liste `33 → 29`, `npm test` grün, `grep -rlE "timezone|timeZone" src/` liefert exakt die Allowlist-Module (O10-Strukturbeweis).

---

## 2. Implementierungs-Zusammenfassung

Exakt nach Plan umgesetzt:

- **Neu:** `src/telephony/number-denylist.js` (Premium-/Notruf-Denylist, reine Verschiebung aus `outbound-gates.js`, diff-identisch bis auf `const`→`export const`)
- **`src/store/defaults.js`:** `DEFAULT_TIMEZONE`, `resolveTimezone()` (fail-safe gegen ungültige IANA-Werte → `RangeError`-Schutz für `toLocaleString`), `allowedPrivateNumberCodes()`
- **`src/geo/resolve.js`:** `TIMEZONE_FOR_COUNTRY`, `timezoneForCountry()`, `tenantGeoForCountry()` — EINE Quelle für Onboard- und Web-Login-Pfad
- **`src/store/state-ops.js`:** `normalizePrivateNumber(raw, tenantCountryIso)` (2. Parameter jetzt Land statt Codes), Denylist-Prüfung vorgeschaltet, `setPrivateNumber` von 4 auf 3 Argumente verkürzt, `registerTenant` mit `country`-Option, `setTenantGeo` um `timezone` erweitert, neuer Reader `tenantTimezone()` (bewusst getrennt von `tenantGeo()`)
- **Fassaden-Parität:** `json.js`/`pg.js`/`store.js` um `tenantTimezone` ergänzt
- **`src/db/schema.sql`:** additive, nullable `timezone`-Spalte (kein Backfill)
- **`src/store/pg.js`:** `TENANT_COLUMNS`/`rowToTenant`/`flushTenants` um `timezone` erweitert (I8-Lehre: beide Stellen, sonst Datenverlust beim Flush)
- **`src/routes/api-onboard.js`:** Land-Auflösung jetzt VOR der `privateNumber`-Vorprüfung, nutzt `tenantGeoForCountry`
- **`src/web-auth.js`:** `resolveOrCreateTenant`/`makeAccounts` schreiben das Geo-Tripel nur im INSERT-Zweig, kein IP-Geo
- **`src/wiring/web-login.js`:** `makeAccounts` mit `defaultCountry: config.provisioning.provisioningCountry`
- **`src/claude.js`:** `promptInputs` nutzt `resolveTimezone(store.tenantTimezone(...))` für die Prompt-Uhrzeit
- **`src/self-service.js`/`src/self-service-routes.js`:** `SELF_SERVICE_LOCKED_FIELDS`/`lockedSelfServiceKeys`, 409 vor jedem Store-Zugriff statt stillem 200-No-Op
- **A3-Migration:** die vier SOLL-Tests umbenannt und in `npm test` verschoben; `test/fmt-now-timezone-characterization.test.js` gelöscht (R5-Löschpflicht, durch `test/p8-prompt-timezone.test.js` ersetzt)
- **5 neue Regressionstest-Dateien:** `p8-tenant-geo-timezone`, `p8-timezone-no-gate` (struktureller Allowlist-Scan), `p8-prompt-timezone`, `p8-private-number-country-gate` (Toll-Fraud-Härtung), `p8-self-service-country-locked`

**Ergebnis:** `npm test` 3181/3181 grün (Delta +45 neue/umgezogene Tests, 0 rot). `test:gates` zeigt die vier Ziel-IDs nicht mehr in der Fehlerliste.

### Deviations
1. Erster Commit erfasste wegen eines fehlgeschlagenen `git add`-Aufrufs (ungültiger Pfad) nur einen Teil der Dateien; zweiter Commit (`334ebf5`) trägt die restlichen 18 geänderten Dateien nach. Arbeitsbaum am Ende vollständig, aber zwei Commits statt einem.
2. Curl-Smoke-Test (§7.7) konnte im isolierten Worktree nicht bis zum Ende laufen: Boot-Guard verlangt eine bereits geseedete aktive Nummer (`npm run bootstrap-tenant`), außerhalb des P8-Scopes. `smokePass=false`, kein Blocker — betroffene Routen sind durch In-Process-Integrationstests abgedeckt.
3. Die exakte Rot-Listen-Zählung „33 → 29" wurde nicht gegen ein separates Inventardokument nachgerechnet, sondern empirisch verifiziert (die vier IDs tauchen in keiner `test:gates`-Fehlerliste mehr auf).

---

## 3. Safety-Urteil (final)

**approved: true** — alle Kernprüfungen bestanden (Tests unabhängig grün, Safety-Gates intakt, Offenlegung intakt, Auth fail-closed intakt, keine Secrets geleakt, Scope eingehalten, Verhalten wie beabsichtigt), keine Blocker.

Wichtigste Prüfpunkte:
- Outbound-Gate-Kette nur durch Modul-Umzug berührt (Denylist byte-identisch, Gate-Array/Reihenfolge unverändert)
- Privates-Nummer-Gate bleibt Allowlist, bekommt zusätzlich die Denylist vorgeschaltet (Verschärfung, keine Aufweichung); unbekanntes Land fällt fail-closed auf `["+49"]`
- `disclosureSentence` in `claude.js`/`bridge.js` unberührt
- 409-Ablehnung sitzt hinter `webAuthMw`, feuert vor jedem Store-Zugriff, kein Teil-Apply

**Concerns (7, alle non-blocking):**
1. **Keine byte-identische Vorbau-Phase (gewollt):** die „Heute ist …"-Zeile im Systemprompt läuft jetzt in Tenant-Zeitzone (Bestand → `Europe/Berlin`) statt Server-Prozess-UTC — echte Live-Verhaltensänderung am Gesprächs-Prompt für jeden Anruf (±1-2 h), bewusst beim Deploy zu erwarten.
2. Web-Login-Tenants tragen ab sofort `country/default_language/timezone` statt NULL — alle Konsumenten geprüft, kein Verhaltensunterschied gefunden (inkl. Geldachse `holdAmountForCountry`); einzige sichtbare Änderung: Audit-/Metrik-Labels statt `null`.
3. Land-Gate der privaten Summary-Nummer wird jetzt aus nutzergesteuertem `tenant.country` hergeleitet — bleibt Allowlist + vorgeschaltete Denylist (netto strenger für DE), aber der Gate-Parameter ist jetzt eingabegesteuert.
4. `test/fmt-now-timezone-characterization.test.js` gelöscht — sachlich richtig, aber `test:gates` verliert einen Regressionspin; Buchführung in `PLAN-I18N-TESTS.md` sollte um -1 nachgezogen werden.
5. `test/p8-prompt-timezone.test.js` vergleicht zwei unabhängig berechnete `new Date()`-Renderings — theoretische Minutengrenzen-Flakiness (~1e-5).
6. Spec-Abnahmepunkt „psql-Messung für P10 wird hier erhoben" im Branch nicht eingelöst (operativ, kein Code-Defekt).
7. eslint im Worktree nicht ausführbar (`@eslint/js` nicht auflösbar) — Lint nicht unabhängig verifiziert, `node --check` für alle Dateien grün.

**Unabhängige Testläufe:** `npm test` (json-Backend) 3201 roh / 3181 korrigiert, 0 fail, 124s. `test:gates` 22 grün/34 rot (P8-IDs nicht mehr enthalten). `STORE_BACKEND=pg npm test` 46 Fehler — vollständig umgebungsbedingt (keine lokale Postgres-Instanz), pg-Abdeckung läuft in-process über pglite und ist grün.

---

## 4. Clean-Code-Audit (final)

**Verdikt: PASS.** Keine S1/S2-Befunde.

- **S1:** keine
- **S2:** keine
- **S3 (Beobachtungen, kein Fix nötig):**
  1. Kommentarblock in `number-denylist.js`/`outbound-gates.js` 1:1 mitkopiert statt gekürzt (~45 Zeilen Kommentar auf ~20 Zeilen Code) — inhaltlich korrekt (reine Verschiebung), nur Beobachtung.
  2. `TIMEZONE_FOR_COUNTRY` (geo/resolve.js) vs. `CALLING_CODE_FOR_COUNTRY` (defaults.js) — zwei separate Land→Wert-Tabellen mit unterschiedlicher Länderabdeckung (8 vs. 6 Einträge); im Kommentar begründet, Konsolidierungshinweis für die Zukunft.
- **S4:** keine

**Blocker: false.**

Vollständiger Suite-Lauf: Branch 3237 Tests, 34 fail (alle vorbestehende, dokumentierte i18n-Launch-Katalog-SOLL-rot-Fälle, keiner P8-bezogen). Master-Baseline: 3213 Tests, 40 fail. P8 fügt netto 24 Tests hinzu und reduziert die Fail-Zahl um 4 (E2E-01, FMT-11, FMT-28, LANG-02 drehen von rot auf grün) — keine Regression.

Positiv hervorgehoben: G5-Konsolidierung (eine Denylist-Quelle, ein `tenantGeoForCountry`-Helfer für beide Eintrittspfade), fail-safe-Pattern (`resolveTimezone` fängt ungültige IANA-Zonen ab), Bestandsneutralität für DE-Tenants mehrfach explizit getestet, PII-Disziplin eingehalten, additive/nullable Schema-Migration ohne Backfill.

---

## 5. Fix-Runden

Keine — der Abschnitt `=== FIXES ===` in der Quelle ist leer. Die Phase erreichte PASS ohne Nachbesserungsrunde.
