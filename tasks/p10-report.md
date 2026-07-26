# Phase P10 — Schreibpfad-Korrektur und Weltdefault-Flip

- **Gate:** BLOCKED
- **finalBranch:** `phase/i18n-p10-weltdefault-flip-fix2`

## Plan (gekuerzt)

Basis: `master` = `a72a5e1`. Gemessene Ausgangslage: `npm test` auf master 3237 Tests, 37 rot (26 distinkte Katalog-IDs). Ein reiner Schreibpfad-Refactor (Schritt 1, ohne Flip) erzeugt 0 neue rote Tests; Schritt 1 + Flip ohne Testbehandlung kippt 17 vorher gruene Tests (Plan hatte 10 angenommen). Vollstaendiger Aenderungssatz: `npm test` 3187/3186 gruen (1 bekannter Last-Flake, isoliert gruen), `test:gates` 27 rot = 20 distinkte IDs (Rot-Liste 26 → 20; WORLD-01, WORLD-03, DID-01, DID-02, DID-03, E2E-05 fallen vollstaendig weg).

**Befund 1 (blockierend fuer Abnahme):** E2E-04 kann in P10 nicht vollstaendig gruen werden. Von drei Subtests ist nur Subtest 1 (`number.language` bei Geo-losem Tenant mit US-DID) in P10 loesbar; Subtest 2 (Inbound-Greeting bleibt deutsch) und Subtest 3 (Summary-SMS hart deutsch "Anruf") gehoeren zu PROMPT-03/WEB-04/WEB-14 und damit nach P11.

**Befund 2 (Entscheidung noetig):** Ein Env-Schalter fuer `DEFAULT_LANGUAGE` ist nicht trivial baubar, weil `src/config.js` aus `src/store/defaults.js` importiert (Ruecklauf waere ein ESM-Zyklus) und `src/i18n/locales.js` ueber `state-ops.js` bewusst config-frei bleiben muss. Empfehlung Option A: kein neuer Env-Schalter, Rollback ueber `settings.language`-Pin pro Tenant / `tenant.default_language` per SQL / `git revert`. Option B (falls Owner zwingt): eigenes Blatt-Modul `src/i18n/world-default.js` mit `process.env.WORLD_DEFAULT_LANGUAGE`, fail-safe `"en"`, als bewusste Ausnahme von der Env-Zentralisierung.

**Commit 1** (verhaltensneutral, vor dem Flip): `src/store/state-ops.js` — `seedBootstrapNumber`/`requestNumber` leiten `language` jetzt per Default-Parameter `languageForCountry(country)` her statt `DEFAULT_LANGUAGE`. `src/billing/provision-trigger.js` — Kauf-Land- und Sprach-Achse getrennt: `fallbackCountry` faerbt nur noch das Kauf-Land, die Sprache kommt ausschliesslich aus `tenantGeo`. Plus Testbehandlung: vier A2-Alarm-Assertions auf ihr eigenes Subjekt (`"de"`) umgehaengt statt geloescht, zwei neue Tests fuer die Achsentrennung.

**Commit 2** (der Flip): `src/store/defaults.js` `DEFAULT_LANGUAGE` `"de"` → `"en"`. `LANGUAGE_FOR_COUNTRY` unveraendert (DID-01 wird allein vom Flip gruen). Kommentar-/Doku-Wahrheit in fuenf weiteren Dateien nachgezogen. R5-Loeschpflichten (vier Alt-Pins auf den alten Weltdefault, echte Loeschung nicht Umschreibung). 13 Bestandstests subjekt-wahrend behandelt: wo das Subjekt nicht der Weltdefault ist, wird `language: "de"` explizit geseedet statt die Assertion aufzuweichen (u.a. `disclosure-regression.test.js`, `telnyx-elevenlabs-inbound.test.js`, `inbound-disclosure-mandatory.test.js`, `greeting-notice-migration.test.js`, `f1-p8-outbound-lang.test.js`, `p8-tenant-geo-timezone.test.js`, `i9-self-service.test.js`). A3-Migration (Katalog-Praefix raus, `(ex <ID>)` ans Ende) fuer WORLD-01/03, DID-01/02/03, E2E-05 (beide Subtests), E2E-04 nur Subtest 1.

**Risiken/Pre-Mortem-Delta:** Safety-Gates unberuehrt (keine der drei Produktionsdateien beruehrt Gate-/Auth-/Secret-Pfade). Neu identifiziert: Migrationen (`backfillGreetingNotices`) schreiben Sprache AT REST — Auflage, vor einem Deploy `SELECT count(*) FROM settings WHERE language IS NULL` gegen `hermes-db` zu erheben (FORCE-RLS beachten). Deploy-Wahrheit: unter Option A darf `master` erst nach P13-Abnahme deployt werden.

**Offene Entscheidungen vor Umsetzung:** (1) Env-Schalter Option A vs. B, (2) E2E-04-Abnahme mit Rot-Liste 26→20 statt →18 akzeptieren, oder P11-Arbeit in P10 ziehen (widerspricht Phasenzuschnitt).

## Impl-Zusammenfassung

Umsetzung exakt gemaess Plan in zwei Commits (Commit 1: `2381230`, Commit 2: `bed206e`, HEAD `bed206ea0f32aac21680f80ad75b313a8d5cb4ae`). Commit 1 verhaltensneutral gemessen (0 neue rote Tests ueber die volle Suite). Commit 2: Weltdefault-Flip `DEFAULT_LANGUAGE` `"de"`→`"en"` per Option A (kein Env-Schalter — das wurde in der ersten Impl-Runde so umgesetzt, in den Fix-Runden dann doch nachgeruestet, s.u.), `LANGUAGE_FOR_COUNTRY` unveraendert, Kommentar-Wahrheit in fuenf weiteren Dateien, vier R5-Loeschungen, neun Bestandstests mit explizitem `language:"de"`, sieben SOLL-Tests per A3 migriert.

Ergebnis: `npm test` 3191/3191 gruen (0 Fail), `npm run test:gates` 48/21/27 rot = 20 distinkte Katalog-IDs (WORLD-01/03, DID-01/02/03, E2E-05 fallen vollstaendig weg; E2E-04 bleibt mit den zwei P11-Blaettern Inbound-Greeting + Summary-SMS im Gate). Safety-Gates/Disclosure/Auth unberuehrt.

Nicht ausgefuehrt: die Owner-Auflage aus Plan-Risiko 4 (`SELECT count(*) WHERE language IS NULL` gegen die echte Prod-DB `hermes-db`) — liegt ausserhalb der Worktree-Implementierung, muss vom Lead/Owner vor einem Merge-zu-master-Deploy nachgeholt werden.

### Deviations

1. Vom Plan nicht vorhergesehene Regression gefunden und gefixt: `test/f1-i18n-locale.test.js` "Realtime-Bundle: localeFor-Fallback liefert DE-Sentinels" pinnte implizit den alten Weltdefault. Nach dem Flip zeigt der Fallback auf das EN-Bundle (`realtimeVoice="alloy"`, nicht `null`). Test auf `DEFAULT_LANGUAGE`-agnostische Assertion umgeschrieben (Mechanismus bleibt gepinnt, nicht der feste Wert) — dieselbe Methodik wie die im Plan spezifizierten Faelle.
2. A3-Migration in `f1-geo-port.test.js`: WORLD-01-Testfunktion behalten, DID-01 als separater Test mit eigenem `(ex DID-01)`-Suffix belassen statt zusammenzulegen — inhaltlich identisch zum Plan, nur Dokumentation der Abweichung.
3. Option A (kein neuer Env-Schalter) wie vom Plan empfohlen umgesetzt, ohne erneute Owner-Rueckfrage, da der Plan sie als Default vorgibt, falls keine Freigabe fuer Option B vorliegt.

## Safety-Urteil (final)

**BLOCKIERT.**

Handwerklich sauber: Scope eingehalten, Safety-Gates (Allowlist/Denylist/Land/Stundenlimit/Budget/Max-Dauer, Signaturpruefung) unberuehrt, keine neue Dependency, kein Lockfile, kein `eslint-disable`/`skip`/`only`. Eigene Laeufe (frischer Worktree, Branch `review-p10-r2`): `npm test` 3198/3198 gruen, zweimal reproduziert; `test:gates` 21/48 gruen, Diff gegen selbst erhobene master-Baseline (56 Tests, 22 gruen) zeigt exakt 7 vormals rote Katalogtests neu gruen, null neue Fehlschlaege.

**Blocker — Fail-Open Env-Default:** Das Aktivierungsfenster (Plan: "der Env-Schalter bleibt nach diesem Deploy AUS") war in Produktion nicht hergestellt. `src/config.js` setzte `boolEnv("WORLD_DEFAULT_LANGUAGE_ENABLED", ..., { fallback: true })` — der Code-Default schaltet den Flip scharf. Der einzige Schutz war der Blueprint-Wert `"false"` in `render.yaml`, der Live-Service ist aber dashboard-managed (render.yaml ist laut eigener Doku nur Referenz, nicht Wahrheit). Empirisch belegt: ohne gesetzte Variable liefert der Stack `en`/`en-GB`/`en-female-neural` und den englischen Offenlegungssatz — fuer Bestandsdatensaetze mit `NULL language` heisst das gekippte Gather-Locale, gekippte Stimme und gekippten Offenlegungssatz am Deploy-Tag. Fix: `fallback: false` (fail-closed).

**Concerns (nicht blockierend, aber im Report festzuhalten):**
- Wachtest gegen das Aktivierungsfenster assertete gegen `RENDER_ENV`, das laut `test/prod-env.js` selbst als nicht wahrheitstragend gilt — falsche Absicherung, sollte zusaetzlich den Code-Default pinnen.
- Rollback ueber den Env-Schalter ist nur teilweise: er gated nur den Wert von `DEFAULT_LANGUAGE`, nicht die Schreibpfad-Korrektur aus Schritt 1 (`provision-trigger.js` leitet Sprache jetzt aus `tenantCountry` ab, kein Ruckfall auf `fallbackCountry`). Bei `WORLD_DEFAULT_LANGUAGE_ENABLED=false` und `PROVISIONING_COUNTRY != DE` wuerde sich das Verhalten gegenueber Vor-P10 unterscheiden (aktuell folgenlos, da `PROVISIONING_COUNTRY="DE"`).
- E2E-04 nicht buchstaeblich als "nicht mehr in der Rot-Liste" erfuellt — 2 von 3 Subtests bleiben planmaessig rot (P11-Wurzeln PROMPT-03/WEB-14), scope-treu, aber im Bericht festzuhalten statt still zu bleiben.
- Irrefuehrender Kommentar in `test/e2e-05-us-launch-full-chain.test.js:12` ("Weiterhin offen" fuer einen bereits gruenen Test).
- `src/store/defaults.js` macht `DEFAULT_LANGUAGE` zu einem mutable Modul-Global (`export let`) — funktioniert korrekt (alle Konsumenten lesen call-time), aber ein Footgun fuer kuenftige Erweiterungen ohne Test-Guard.

## Clean-Code-Audit

- **S1:** keine Funde.
- **S2:** keine Funde.
- **S3:** `src/store/defaults.js:341-364` — `DEFAULT_LANGUAGE` als mutable `let`-Modul-Export, ausschliesslich von `config.js` einmalig beim Boot via `setWorldDefaultLanguageEnabled()` gedrueckt (Wiring als Kompositions-Root, um den Zirkel `defaults.js`↔`config.js` zu vermeiden). Sauber dokumentiert, eigener Mechanismus-Test, kein aktueller Verstoss — nur als Footgun fuer kuenftige Erweiterungen vermerkt (ein kuenftiger Top-Level-Read waere an die Boot-Reihenfolge gekoppelt, ohne dass die Signatur das erzwingt).
- **S4:** keine Funde.
- **Blocker:** false (Clean-Code-Audit selbst PASS; der Merge-Block kam aus dem Safety-Urteil, nicht aus Clean-Code).

**Verdict Clean-Code:** PASS. Diff (4 Commits, 26 Dateien) fuehrt den Flip sauber hinter einem Env-Schalter ein (nach den Fix-Runden), mit Zwei-Schichten-Absicherung (render.yaml-Kommentar + eigener Aktivierungsfenster-Test), Kauf-Land/Sprach-Achsentrennung korrekt umgesetzt, `npm test` auf dem Phasen-Commit 3216/3216 gruen (nach Abzug reiner Datei-Wrapper 3198/3198), Byte-Identitaet fuer unveraenderten Bestand konsequent durchgehalten (`BASE_ENV` explizit gesetzt, Lehre `test-base-env-drift` befolgt), keine Safety-Gate-/Auth-/Secret-Beruehrung.

## Fix-Runden

- **r1:** Alle drei Review-Blocker behoben, minimal und ohne Scope-Drift. Kernaenderung: `DEFAULT_LANGUAGE` in `src/store/defaults.js` von harter Konstante auf mutable `let` mit Setter (`setWorldDefaultLanguageEnabled`) umgestellt; `config.js` liest den neuen Env-Schalter `WORLD_DEFAULT_LANGUAGE_ENABLED`.
- **r2:** Alle drei gemeldeten Blocker behoben: `render.yaml` setzt `WORLD_DEFAULT_LANGUAGE_ENABLED` jetzt auf `"false"` (statt `"true"`), womit das Aktivierungsfenster P10-P13 tatsaechlich geschlossen bleibt und der Weltdefault-Flip beim naechsten Deploy nicht fail-open scharf geschaltet wird.
