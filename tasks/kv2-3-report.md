# Phase KV2-3 — Das Kosten-Buch

**Gate:** PASS
**finalBranch:** phase/kv2-3-impl-fix1

## Plan (gekuerzt)

Eine tenant-isolierte Tabelle `call_cost_evidence` (eine Zeile je `(call_id, traeger)`), ihr Regelwerk (Reife-Ordnung, Geld-/Form-Waechter, `detail`-Allowlist, Summenregel) und zwei Store-Operationen. Kein Schreiber ausserhalb der Tests, kein Leser, keine Buchung, kein Cent bewegt sich. Keine Route, kein Gate, kein Offenlegungssatz, kein `callee_is_owner`, keine neue Env-Variable, keine neue npm-Dependency.

Owner-Entscheidung 16 laeuft auf Default (a): `beleg_ausgeblieben` entfaellt, der Wertebereich hat vier Auspraegungen (im Bericht als Default vermerkt, nicht als getroffene Entscheidung).

**Zwei vorab benannte Abweichungen von der Spec-Dateiliste:**
1. Neue Datei `src/store/cost-evidence.js` — reines Regelwerk (Validatoren, Zeilen-Fabrik, Reife-Praedikat, `detail`-Projektion, Summe), weil `state-ops.js` 4854 Zeilen hat und einen eigenen Altlast-Pin traegt.
2. Ergaenzung in `src/store/defaults.js` — Reife-Vokabular (`REIFE`, `REIFE_FORTSCHRITT`, `REIFE_TERMINAL`, `REIFE_SUMMIERBAR`) plus `isProviderMicroCents`, da `defaults.js` die etablierte Vokabular-Heimat des Stores ist.

**Datenmodell-Festlegungen:** NOT NULL nur auf `id/tenant_id/call_id/traeger/reife/versuche`; `call_id` ohne FK (Parity zu `usage_event`, Erase/Prune darf Kostennachweis nicht mitnehmen); `gemessen_at` als TEXT/ISO; `betrag_mikro_cents` BIGINT NULL, im Zustand `erwartet` immer NULL (nie 0); `tenant_id` wird aus dem Anruf abgeleitet, nie vom Aufrufer entgegengenommen; „letzter Schreiber gewinnt" bei Wertfeldern; erneutes Setzen desselben terminalen Zustands ist echtes No-Op (`changed=false`, keine Wertfelder geschrieben).

Benannte Rueckfrage an den Owner (nicht eigenmaechtig entschieden): Spannung zwischen Kriterium (e)/4.5 (Summenregel zaehlt nur `vorlaeufig|belegt`) und Matrix 4.6 bei `belegt -> beleg_strukturell_unbeschaffbar` — eine so markierte Zeile verliert ihren Summenbeitrag, was 4.6 wortgleich gegenteilig liest. Wortgetreu nach (e) implementiert, Spannung fuer Owner/KV2-4 offen gelassen.

**Neue Datei `src/store/cost-evidence.js`:** rein, IO-frei, importiert nur `defaults.js` und `billing/kostenarten.js`. Enthaelt `isKnownTraeger`, `isKnownMaturity`, `isTerminalMaturity`, `canSetEvidenceMaturity` (Fortschritt/Gleichstand erlaubt, Rueckschritt nie, terminal erreichbar aus jedem Vorzustand, aus terminal heraus nie), die `detail`-Allowlist `BELEG_DETAIL_PFADE` (Suffix-Pfade, nicht flache Schluessel, z.B. `analysis.price` statt ganzes `analysis`-Objekt), `belegDetailAusRohdaten` (Projektion mit Tiefendeckel `DETAIL_MAX_TIEFE=6` und Laengendeckel `DETAIL_TEXT_MAX=64`), `assertCostEvidenceInput` (fuenf Einzelwaechter: Traeger-Katalog, Reife-Wertebereich, Geld-ohne-erwartet-Regel, Etiketten-Formmuster, Zaehler-Ganzzahl), `buildCostEvidenceRow`, `applyCostEvidenceValues` und `costEvidenceSumMicroCents` (zaehlt ausschliesslich `vorlaeufig|belegt`, kein `?? 0`).

**Edits an Bestandsdateien:**
- `src/db/schema.sql`: neue Tabelle `call_cost_evidence` (ohne FK auf `call_id`, mit FK+RLS auf `tenant_id`, Unique-Index auf `(call_id, traeger)`, kein CHECK-Constraint — Gueltigkeit lebt fail-closed im Mutator), `ENABLE`+`FORCE ROW LEVEL SECURITY`, `tenant_isolation`-Policy mit explizitem `WITH CHECK`.
- `src/store/defaults.js`: `REIFE`/`REIFE_FORTSCHRITT`/`REIFE_TERMINAL`/`REIFE_SUMMIERBAR`, `isProviderMicroCents`.
- `src/store/state-ops.js`: Import des Regelwerks, `callCostEvidence: []` in `makeDefaultState()`, reiner Refactor in `recordCallCostTruingResult` (Inline-Praedikat -> `isProviderMicroCents`, verhaltens-identisch), neuer Abschnitt mit `findCostEvidence` (privat), `recordCallCostEvidence` (wirft fail-closed, tenantId aus dem Anruf) und `callCostEvidence` (Query, sortiert nach `traeger`).
- `src/store/json.js` / `src/store/pg.js` / `src/store.js`: Wrapper-Paritaet (Muster `recordCostProfile`/`recordUsageEvent`), Hydrierung/Flush in `pg.js` (`hydrateCallCostEvidence`, `flushCallCostEvidence` via `flushOwnScoped`, id-PK-Upsert).
- Pins nachgezogen: `test/rls-with-check.test.js` (`TENANT_ISOLATION_POLICY_COUNT` 12->13), `eslint-legacy-exceptions.json` (`makePgStore`, `hydrateTenantInto`), `test/check-staged-suppressions.test.js` (`LEGACY_FINGERPRINT` + Changelog).

**Tests (Plan):** neue Datei `test/kv2-3-kosten-buch.test.js` deckt Kriterien (a) Idempotenz, (b)/(b)(i)-(iv) Reife-Uebergaenge inkl. terminal/No-Op, (e) Summenregel inkl. „erwartet traegt nichts bei", (f) `detail`-Allowlist gegen einen echten ElevenLabs-Antwortkoerper (Fixture `CONVERSATION_DONE_MIT_KOSTEN`) inkl. Gegenprobe auf gleichnamigen `price`-Leaf unter fremdem Elternpfad, sowie Eingabe-Waechter. `test/store-pg-rls.test.js` (Kriterium c, mit Positivkontrolle), `test/store-pg-json-parity.test.js` (Kriterium d, echter Reopen-Roundtrip beider Backends).

Sieben benannte Gegenproben (jede muss beim Kaputtmachen des jeweiligen Mechanismus rot werden), Pre-Mortem gegen Transkript-Leck, stille 0-als-Vollbeleg, stilles Zu-wenig-Buchen, Cross-Tenant-Sicht und Erase-Pflicht-Verletzung — alle mit konkreter Gegenmassnahme im Code benannt.

## Implementierungs-Zusammenfassung

- **headCommit:** 9e60430ff41bbc8ed56811adf4273e061d207928
- **node --check:** PASS
- **npm test:** PASS, 5473/5473, 0 fail
- **committed:** ja, Branch `phase/kv2-3-impl`

**Neue Dateien:** `src/store/cost-evidence.js`, `test/kv2-3-kosten-buch.test.js`

**Editierte Dateien:** `src/store/defaults.js`, `src/store/state-ops.js`, `src/store/json.js`, `src/store/pg.js`, `src/store.js`, `src/db/schema.sql`, `test/rls-with-check.test.js`, `test/check-staged-suppressions.test.js`, `test/store-pg-json-parity.test.js`, `test/store-pg-rls.test.js`, `test/fixtures/elevenlabs-conversations.js`, `eslint-legacy-exceptions.json`, `eslint-suppressions.json`

**Tests hinzugefuegt/geaendert:**
- `test/kv2-3-kosten-buch.test.js` — 20 neue Faelle (Kriterien a/b/e/f + Waechter)
- `test/store-pg-json-parity.test.js` — 4 neue Faelle (pg/json-Rundlauf + Shape-Paritaet)
- `test/store-pg-rls.test.js` — 1 neuer Fall (RLS-Isolation inkl. Positivkontrolle, GRANT-Listen zweier Rollen erweitert)
- `test/rls-with-check.test.js` — `TENANT_ISOLATION_POLICY_COUNT` 12->13
- `test/fixtures/elevenlabs-conversations.js` — neue Fixture `CONVERSATION_DONE_MIT_KOSTEN`
- `test/check-staged-suppressions.test.js` — `LEGACY_FINGERPRINT`-Spiegel + Changelog-Eintrag

### Deviations
1. (vorab im Plan benannt, ueberstimmbar) Neue Datei `src/store/cost-evidence.js` statt Regelwerk in `state-ops.js` — Begruendung: Zeilenzahl + Altlast-Pin von `state-ops.js`.
2. (vorab im Plan benannt) Erweiterung von `src/store/defaults.js` um Reife-Vokabular + `isProviderMicroCents` statt zweitem Vokabular-Ort.
3. Waehrend der Umsetzung intern umbenannt: `applyCostEvidenceValues` (mutierend, wie skizziert) wurde als reine `costEvidenceValuePatch` gebaut (liefert neues Patch-Objekt statt Parameter zu mutieren) — reiner Clean-Code-Fix (no-param-reassign), keine Verhaltens-/Testaenderung; die Mutation der bestehenden Zeile passiert weiterhin in `state-ops.js` auf einer lokalen Variable.
4. Owner-Entscheidung 16 wie gefordert als DEFAULT (nicht als getroffene Entscheidung) im Code-Kommentar vermerkt: vier statt fuenf Auspraegungen, kein `beleg_ausgeblieben`.
5. Die im Plan benannte Rueckfrage an den Owner (Spannung Kriterium (e)/4.5 vs. Matrix 4.6) ist NICHT eigenmaechtig entschieden: (e) wortgetreu implementiert und mit eigenem Test gepinnt; Spannung bleibt fuer Owner/KV2-4 offen.
6. Zusaetzlich, nicht im Plan vorgesehen, aber durch den Pre-Commit-Hook erzwungen: `eslint-suppressions.json` fuer `state-ops.js` (id-length 241->244) nachgezogen, da der Commit-Hook zusaetzlich das native ESLint-Suppression-Format prueft. In `test/kv2-3-kosten-buch.test.js` wurden alle Magic Numbers durch benannte Konstanten bzw. direkten Vergleich gegen die Fixture-Quelle ersetzt (vom Clean-Code-Gate verlangt, kein Plan-Detail).

**Smoke-Test:** PASS — Server mit json-Backend gestartet, `GET /healthz` -> 200. Persistierter `store.json` enthaelt `callCostEvidence:[]` (Backfill fuer Bestands-Stores greift). Keine Route/kein Gate beruehrt.

## Safety-Urteil

**verdict:** PASS. approved=true, testsPassIndependently=true, safetyGatesIntact=true, disclosureIntact=true, authFailClosedIntact=true, noSecretsLeaked=true, scopeRespected=true, behaviorAsIntended=true.

Unabhaengiger Testlauf in frischem Worktree (Branch `review-kv2-3-r1` aus `phase/kv2-3-impl-fix1`, merge-base == master): `npm test` 5493/5493 pass (nach Abzug der Datei-Wrapper korrigiert 5474/5474), 0 fail. Beide Backends (pg via pglite, json via Disk) laufen in dieser Bank. Eigene Gegenproben gegen die `detail`-Allowlist (Tiefendeckel, Laengendeckel, Zyklus-Terminierung, kein Prototype-Pollution-Durchgriff, `canSetEvidenceMaturity` fail-closed bei unbekanntem Ist-Zustand) — alle bestanden.

`git diff master HEAD --name-status` ueber alle Safety-Gate-Dateien (`src/claude.js`, `src/bridge.js`, `src/outbound-gates.js`, `src/routes/`, `src/route-policy.js`, `src/config.js`, `src/auth.js`, `src/web-auth.js`, `src/callee-is-owner.js`, `src/middleware.js`, `src/telephony/`, `src/mcp-tools.js`, `src/billing/`, `.env.example`, `render.yaml`) liefert LEER. `disclosureSentence` unveraendert. Kein neuer Endpunkt, keine neue Env-Variable, keine neue npm-Dependency. Kein Aufrufer des Kosten-Buchs ausserhalb der Tests (per grep verifiziert).

**Concerns (keine Blocker, Vorwaerts-Hinweise fuer KV2-4/KV2-5):**
1. `detail`-Allowlist matcht per Schluessel-SUFFIX in jeder Tiefe <=6, nicht wertbewusst — heute folgenlos (kein Aufrufer), aber kuenftige Phasen duerfen nicht annehmen, der Riegel pruefe Werte (z.B. `rate`/`tier` koennten theoretisch eine Rufnummer tragen).
2. `recordCallCostEvidence` leitet `tenantId` aus `getCall(s, callId)` ab, und `getCall` ist nicht tenant-scoped (globaler Spiegel) — heute korrekt/getestet, aber ein kuenftiger Einsammler darf keine von aussen gelieferte `callId` ohne Tenant-Pruefung durchreichen.
3. Unique-Index `(call_id, traeger)` wird vom Flush nicht bedient (`ON CONFLICT (id)`) — ueber die Store-API nicht erreichbar, deshalb kein Blocker.
4. eslint-Legacy-Pins angehoben (`state-ops.js` id-length 180->183, `pg.js` `hydrateTenantInto` 102->103, `makePgStore` 568->576) — einzeln begruendet, keine neue Verstosskategorie.
5. Kleine Spec-Ueberschreitung: `isProviderMicroCents`-Extraktion hat zusaetzlich eine Zeile in `recordCallCostTruingResult` umgeschrieben (textuell identisches Praedikat, Dedup) — Datei stand nicht in der Spec-Dateiliste.
6. Owner-Entscheidung 16 als Default korrekt im Code gekennzeichnet — Lead soll pruefen, dass der Phasenbericht die ausdrueckliche Rueckfrage traegt (nicht nur der Code-Kommentar).
7. Betriebs-Nebenwirkung (spec-konform, wie `usage_event`): leerer Spiegel kostet pro Tenant/Boot eine zusaetzliche Hydrierungs-Query und pro Save einen DELETE+Insert-Loop, obwohl in dieser Phase niemand schreibt.

## Clean-Code-Audit

**blocker:** false — **verdict:** PASS

- **s1 (Blocker):** keine
- **s2 (Blocker):** keine
- **s3:** G16/Kommentar (nicht blockierend) — `src/store/cost-evidence.js:60-65`: Kommentar begruendet Rekursionstiefen-Bremse mit einem „theoretisch zyklischen Anbieter-Objekt", obwohl `detail` nur aus geparstem JSON kommt (nie zyklisch) — Kommentar sollte praezisiert werden (Terminierung bei tiefer Verschachtelung, nicht bei Zyklen).
- **s4:** (1) G3/T5 klein — kein Test treibt `DETAIL_MAX_TIEFE=6` an einem tatsaechlich >6 Ebenen tiefen Anbieter-Body an (Konstante ungetestet, nicht falsch); optional ergaenzen. (2) S4/Bestandsmuster, kein neuer Befund — `pg.js` (`makePgStore`/`hydrateTenantInto`) setzt die seit 2026-08-15 dokumentierte, akzeptierte Wachstumskurve fort, sauber per eslint-Pin gemeldet.

**passNotes:** Regelwerk ist sauberes Blatt-Modul (reine Funktionen, keine Mutation, benannte Konstanten statt Magic Numbers, klare Trennung Waechter/Zeilen-Bau/Summenregel). `state-ops.js` haelt sich strikt an „nur Zustand". `json.js`/`pg.js` folgen 1:1 dem Bestandsmuster. `schema.sql` dokumentiert bewusste Abweichungen (kein FK, kein CHECK) mit Begruendung. Tests nutzen Build/Operate/Check, ein Konzept pro Test, breite Grenzfall-Abdeckung.

## Fix-Runden

**r1** — Alle 3 gemeldeten Review-Blocker behoben, minimal, ohne Scope-Drift:
- Fix (PII-Riegel + Kriterium f): in `src/store/cost-evidence.js` projiziert `costEvidenceValuePatch()` das mitgelieferte `detail`-Feld jetzt zwingend durch `belegDetailAusRohdaten()`, bevor es ins Patch-Objekt aufgenommen wird — der Aufrufer kann den Allowlist-Riegel nicht mehr durch direkte Uebergabe eines rohen Anbieter-Body umgehen.

Ergebnis nach r1: finaler Branch `phase/kv2-3-impl-fix1`, Safety-Review und Clean-Code-Audit beide PASS ohne S1/S2-Blocker.
