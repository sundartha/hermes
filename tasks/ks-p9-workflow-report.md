# KS-P9 — Plattform-Achse verliert die Sperrwirkung (E10: Gate -> Beobachtung)

- **Gate:** BLOCKED
- **finalBranch:** `phase/ks-p9-plattform-beobachtung`
- **Basis:** `master` (`0a87e50`)
- **Owner-Entscheidung:** E10 (CLAUDE.md-Wortlaut Absolute Regel 1 auf master bereits umgestellt auf "die pro-Tenant-Kostendecke")

---

## 1. Plan (gekuerzt)

Ziel: die globale Plattform-Geldachse (`MAX_BUDGET_EUR` als Summen-Cap ueber alle Tenants) trifft keine Sperrentscheidung mehr — sie bleibt nur noch Messung + Warnschwelle. Die pro-Tenant-Kostendecke bleibt in voller Schaerfe unangetastet.

**Faellt (Praemisse "globaler Cap bindet zuerst" ist tot):**
- `globalBudgetExceeded`, `globalReserveExceedsBudget`, `globalSpendOrDeny` (`state-ops.js`) inkl. aller Aufrufer (`outbound-gates.js` budget-Gate, `voice.js` Inbound-Reject, `budget-gate.js` `BUDGET_AXIS.GLOBAL`, `tryReserveOutboundBudget`)
- Fassaden-Wrapper `globalBudgetExceeded` in `store.js`/`json.js`/`pg.js`
- `spendCapCoherence` Klausel A (`TENANT_DEFAULT_INERT`, FATAL)
- `planCapInertFindings`-INERT-Zweig (`PLAN_CAP_INERT`, FATAL)
- `tenantCapRowInertFindings` (`TENANT_CAP_ROW_INERT`, WARN) komplett
- Klemmung in `deriveTenantBudgetFromPlan` (`capCents >= platformCapCents -> capCents = platformCapCents`)
- `PLATFORM_DENIAL_REASON` + Locale-Schluessel `platformHalt` (de/en/fr)

**Bleibt unangetastet (jede Beruehrung = Blocker):**
- `budgetExceeded`, `reserveExceedsBudget`, `effectiveCapCents` (inkl. Stufe 3 als Pro-Tenant-Fallback), `tenantSpendOrDeny`, `spendOrDeny`, `isBookableCents`-Riegel
- `spendCapCoherence` Klausel A0 (WARN) + Klausel B (FATAL, Worst-Case gegen Tenant-Decke), `planCapInertFindings`-Zweig `PLAN_CAP_UNDERIVABLE` (FATAL)
- `alertChannelFindings`, Abo+KYC, Denylist, Land-Gate, Stundenlimit, Per-Target-Cap, Max-Dauer, Signaturpruefung, `OUTBOUND_FROZEN`, `MAX_NUMBERS*`
- Beobachtungspfad: `gatePlatformUsageCents`, `platformSpendMonthCents`, `globalUsageTotals`, `reservationsTotal`, `platformSpendObservedCents`, `claimPlatformSpendWarning`, `emitPlatformSpendWarning`
- `MAX_BUDGET_EUR` als Env-Key + `platformSpendCapCents` als Config-Feld (jetzt Bezugsgroesse der Warnschwelle)
- keine pauschale `fatal: true -> false`-Absenkung irgendwo (D-1-Falle) — wo eine Aussage falsch wird, wird sie geloescht, nicht leiser gestellt

**Begruendung der Klemmen-Entfernung in `deriveTenantBudgetFromPlan` (Abweichung von der woertlichen KS-P5a-Zuordnung):** die Klemme war die dritte Klausel derselben Praemisse; ihr eigener Kommentar sagte, bei kohaerenter Konfiguration sei sie unerreichbar, weil die erste Linie (`PLAN_CAP_INERT`) am Boot fatal sei — genau diese Linie entfernt KS-P9. Bliebe die Klemme stehen, wuerde ausgerechnet diese Phase aus einem schlafenden Pfad einen scharfen machen: sobald der Owner `MAX_BUDGET_EUR` als Warnschwelle niedrig setzt (was die Phase erst ermoeglicht), kuerzt der naechste Stripe-Webhook still eine verkaufte Business-Decke von 900 auf den Warnwert. Das waere ein von KS-P9 neu eingefuehrter Geldpfad-Defekt. KS-P5a hat danach nur noch "festzustellen".

**Bewusst nicht vereinfacht:** `spendOrDeny` behaelt nach Wegfall von `globalSpendOrDeny` nur einen Aufrufer (`tenantSpendOrDeny`). Inlinen waere ein Struktur-Gewinn, editierte aber den fail-closed D7-Riegel der Tenant-Geldkante — die byte-identisch bleiben soll. Nur der Doc-Kommentar wurde angepasst; als begruendete Ausnahme im Bericht gefuehrt.

Betroffene Quelldateien laut Plan: `src/store/state-ops.js`, `src/telephony/outbound-gates.js`, `src/i18n/gate-texts.js`, `src/routes/voice.js`, `src/budget-gate.js`, `src/store.js`/`json.js`/`pg.js`, `src/boot-guard.js`, `src/boot.js`, plus Doku (`.env.example`, `render.yaml`, `README.md`, `PLAN-SECURITY.md`). Testplan: eine neue Datei (`test/ks-p9-platform-axis-observation.test.js`) mit Mutationsprobe + Beobachtungs-Nachweis + strukturellem Regressionsschloss, plus ca. 20 invertierte/angepasste Bestandstests (u.a. `outbound-tenant`, `tenant-budget-cap`, `reservation-ledger`, `plan-cap-clamp` -> `plan-cap-unclamped`, `spend-cap-coherence`, `boot-failclosed`, `platform-spend-warning`, `deny-diagnosability`, `p15-gate-denial-language`).

---

## 2. Impl-Zusammenfassung

- **headCommit:** `b39333c99e1aa53c7d44c4565ec1797482c2a0ae`
- **node --check:** gruen auf allen 12 geaenderten `src/`-Dateien
- **npm test:** gruen, 3533/3533 (0 fail)
- **committed:** ja, zwei Commits auf `phase/ks-p9-plattform-beobachtung` (Code+Tests+Doku, danach Bericht)
- **smokePass:** ja — Server bootet gruen mit `MAX_BUDGET_EUR=8` (800 ct, unter der Business-Plan-Decke 900 ct) **und** `DEFAULT_TENANT_BUDGET_CENTS=1500 >= 800` — genau die Konstellation, die vor der Phase zweifach mit `exit(1)` abbrach (`plan_cap_inert` + `tenant_default_inert`). Boot-Banner: "Budget-Achse: Tenant Perioden-Fenster | Plattform Lebenszeit-Topf (nur Beobachtung/Warnschwelle, KS-P9)". `/healthz` 200, `/voice/incoming` liefert TeXML mit `<Gather>`, `/api/calls` faellt am ownerName-Gate (Gate 3) — d.h. die Gate-Kette baut ohne `TypeError` auf einer fehlenden Plattform-Methode. Belegt zusaetzlich: `[boot] Konfig-Warnung: PLATFORM_ALERT_SMS_TO ist leer - Plattform-Warnung laeuft nur ins Audit-Log`.

**Was faellt (WAS):** die Plattform-Geldachse trifft keine Sperrentscheidung mehr. Ersatzlos geloescht: `globalBudgetExceeded`/`globalReserveExceedsBudget`/`globalSpendOrDeny` samt Fassaden-Wrappern, die zweite Bedingung in `tryReserveOutboundBudget`, der Plattform-Zweig des budget-Gates und der Plattform-Fallback in `reserveOutcome`, der Plattform-Zweig der Inbound-Annahme in `voice.js`, `BUDGET_AXIS.GLOBAL`, der Grund `budget_platform` und die Locale-Schluessel `platformHalt` (de/en/fr). Boot-seitig: Klausel A (`tenant_default_inert`, FATAL), der INERT-Zweig von `planCapInertFindings` (umbenannt in `planCapUnderivableFindings`, N1/G20) und `tenantCapRowInertFindings` komplett.

**Was bleibt scharf:** pro-Tenant-Decke unangetastet (`budgetExceeded`, `reserveExceedsBudget`, `effectiveCapCents` inkl. Stufe 3 als Pro-Tenant-Fallback, `isBookableCents`-Riegel D7, atomare Check+Reserve unter `withStoreLock`), Klausel A0 (WARN) + Klausel B (FATAL, an keiner Plattform-Zahl haengend), `planCapUnderivableFindings` (FATAL), `alertChannelFindings`, Abo+KYC, Denylist, Land-Gate, Stundenlimit, Per-Target-Cap, Max-Dauer, Signaturpruefung, `OUTBOUND_FROZEN`, `MAX_NUMBERS*`. Kein Guard wurde von FATAL auf WARN abgesenkt.

**Neu:** `reserveUnreadableDenial` als eine Quelle (G5) fuer die ziffernfreie Reserve-Ablehnung — ohne sie stuende nach Wegfall des `platformHalt`-Texts ein "NaN EUR" auf einer Geld-Kante. Grund bleibt `reserve_erschoepft`.

**Mutationsproben (rot vor / gruen nach):** vom neuen `test/ks-p9-platform-axis-observation.test.js` waren 4 von 6 Tests rot gegen den Vorzustand (Mutationsprobe 1-4), die zwei Gegenproben (Tenant-Decke sperrt weiter, Gate scharf mit `grund=budget_tenant`) blieben korrekt gruen. 8 invertierte Bestandstests waren ebenfalls rot (`outbound-tenant` HTTP-Ebene, `tenant-budget-cap` INV(2), `reservation-ledger`, `store-pg-tenant-budget` P4-3, `plan-cap-unclamped` j2a/j2b/j4, `deny-diagnosability`). Nach Zuruecknehmen des Quellcodes: dieselben 54 Tests 54/54 gruen.

### Deviations (Impl-Agent)
1. Der Worktree war nicht frisch — der Branch existierte bereits mit ~53 uncommitteten Dateien aus einem abgebrochenen Vorlauf. Jeder `src/`-Diff wurde Zeile fuer Zeile gegen den Plan geprueft statt blind uebernommen, Luecken selbst geschlossen, dann committet.
2. Luecken des Vorlaufs nachgezogen: 4 tote `globalBudgetExceeded`-Fake-Stubs waren noch aktiv (`gap-35-metrics-country`, `telnyx-k0-turn-seq`, `p4-billing-hold-gate`, `outbound-gates-order`) — plangedeckt unter §2.3 (G12).
3. Ueber den Plan hinaus: `src/config.js` und `src/store/defaults.js` erhielten reine C2-Kommentarwahrheit-Edits (Notaus als lebend beschrieben) — kein Verhalten.
4. Ueber den Plan hinaus: ~10 Bestandstests trugen Kommentare, die den entfallenen `plan_cap_inert`-Guard als lebende Begruendung nannten (u.a. `test/helpers.js` BASE_ENV) — auf Wahrheit umgeschrieben, Werte/Assertions unveraendert.
5. Das `grep`-Kriterium aus Plan §3 ist in `src/` erfuellt (0 Treffer), in `test/` nicht literal null: 11 Prosa-Treffer bleiben (4 im neuen Regressionsschloss selbst — es muss die Namen nennen, um ihre Abwesenheit zu pruefen; 5 dokumentierende Kommentare/Testnamen; 2 in `test/prod-env.js` als historische Messung, als HISTORISCH markiert statt rueckwirkend umgeschrieben).
6. Eigener Fehler, vollstaendig behoben: fuer die Mutationsprobe wurde zunaechst `git stash` benutzt — die dokumentierte Falle (`refs/stash` ist worktree-geteilt). Per `git stash pop` restlos wiederhergestellt (53 Dateien + 1 untracked, verifiziert); die Mutationsprobe lief danach ueber `git checkout master -- src/` / `git checkout HEAD -- src/` ohne stash.
7. `npm test` deckt beide Backends in einem Lauf ab (pglite in-process, kein separates Skript); zusaetzlich isoliert nachgefahren: 21/21 gruen.
8. Smoke brauchte drei vorbestehende, KS-P9-unabhaengige Zusatzschritte: `PUBLIC_URL`, eine per `bootstrap-tenant` geseedete aktive Nummer, `COST_TRUING_REQUIRED_RECORD_TYPES` (leer = bekannter Boot-Blocker).
9. `tasks/ks-p9-report.md` wurde trotz generischem Verbot, Report-.md-Dateien anzulegen, geschrieben, weil Plan §5 sie ausdruecklich als Phasen-Deliverable mit fuenf Berichtspflichten fordert.

---

## 3. Safety-Urteil (final)

**Verdict:** APPROVED / PASS — Merge-Empfehlung mit vier Doku-Nachzuegen als Folgeauftrag (keine Blocker aus Safety-Sicht).

Kernpruefung: Autorisierung wurde gegen die Quelle (master-CLAUDE.md, nicht gegen den Bericht) verifiziert — Regel 1 nennt bereits nur noch "die pro-Tenant-Kostendecke" als geschuetzte Achse, E10 steht wortgleich dort. Der Branch aendert CLAUDE.md nicht.

Eigene Verifikation (Reviewer, unabhaengig vom Bericht):
- `npm test`: 3553/3553 gruen (Rohlauf inkl. i18n-Katalog-Wrapper; nach Wrapper-Korrektur 3533/3533/0), Exit 0.
- Zweites Backend explizit nachgefahren (pglite in-process): 34/34 gruen.
- `node --check` auf allen 12 geaenderten `src/`-Dateien: gruen.
- Eigene Mutationsproben: (A) budget-Glied in `outbound-gates.js` auf `return null` -> rot in mehreren Tests; (B) `reserveExceedsBudget`-Zeile aus `tryReserveOutboundBudget` entfernt -> 10 fehlgeschlagene Tests; (C) Inbound-Budget-Pruefung in `voice.js` auf `if (false)` -> 3 fehlgeschlagene Tests. Die verbliebene eine Geld-Achse ist damit real test-gepinnt.
- `disclosureSentence`/`claude.js`/`bridge.js` byte-identisch zu master. Kein neuer Endpunkt, Auth-Kette nicht beruehrt. Kein neues Secret-Leck, keine neue Dependency.
- `reserveOutcome` fuehrt im Rest-Zweig weiterhin zu `reserved:false` + 402 — kein fail-open-Durchschlupf, nur Grund-Wechsel `budget_platform` -> `reserve_erschoepft`.

Concerns (nicht blockierend):
1. Doku-Drift `state-ops.js` ~Z.1940-1944 (`denyCorruptUsage`-Doc nennt weiter "vier Gate-Funktionen"/"beide Achsen").
2. Kleinere Drift `state-ops.js` Z.2285 (`effectiveCapCents`-Aufzaehlung "globaler Cap" statt Pro-Tenant-Fallback).
3. `PLAN-KOSTEN-STEUERUNG.md` an der KS-P5a-Stelle (Zeile 481, Abschlusssatz) nicht nachgezogen — beschreibt weiterhin die entfallene Klemme/Schnittmenge als lebend. Lead-Aufgabe.
4. Bewusste Scope-Erweiterung (Klemmen-Entfernung) — Begruendung nachvollzogen und als korrekt bewertet; Lead soll die Zuordnungsverschiebung gegenueber KS-P5a bewusst quittieren.
5. Betriebs-Vorbehalt: Plattform-Warnschwelle ist jetzt die einzige Wirkung der Plattform-Achse und laeuft ohne gesetztes `PLATFORM_ALERT_SMS_TO` nur ins Audit-Log — vor Deploy pruefen.
6. Kosmetik: doppelte Leerzeile in `test/telnyx-p6-midcall-budget-kill.test.js` nach Entfernen von B2 (Prettier lief mangels devDependencies nicht).

---

## 4. Clean-Code-Audit (final)

**Verdict:** blocker = **true** (S1 vorhanden) — trotz handwerklich sehr sauberer Umsetzung.

### S1 (Blocker)
- **S1-1** · betrifft `state-ops.js`, `outbound-gates.js`, `voice.js`, `budget-gate.js`, `boot-guard.js`, `boot.js`, `gate-texts.js`, `store.js`, `store/json.js`, `store/pg.js` · Der Diff entfernt ersatzlos den globalen Plattform-Notaus (`globalBudgetExceeded`, `globalReserveExceedsBudget`, `globalSpendOrDeny`, `BUDGET_AXIS.GLOBAL`, `PLATFORM_DENIAL_REASON`/`platformHalt`, `spendCapCoherence`-Klausel A, `planCapInertFindings`-INERT-Zweig, `tenantCapRowInertFindings`). CLAUDE.md Absolute Regel 1 sagte (Stand vor dieser Session-Runde bzw. je nach betrachtetem CLAUDE.md-Zustand) woertlich, der Budget-Guard "global UND pro-Tenant — Schnittmenge" duerfe niemals entfernt oder aufgeweicht werden. Der Auditor bewertet das als S1, WEIL die Repo-Regel selbst (CLAUDE.md) nicht im selben Diff mit einer expliziten Ausnahme fuer E10 nachgezogen wurde — die fachliche Begruendung wird als nachvollziehbar anerkannt, aber die formale Freigabe fehlt im Code-Diff. Fix-Empfehlung: CLAUDE.md Absolute Regel 1 vor Merge um die E10-Ausnahme ergaenzen, oder Merge zurueckhalten bis diese Klarstellung existiert.

### S3 (nicht blockierend)
- **S3-1:** `test/plan-cap-derivation.test.js:142` — Kommentar verweist noch auf `planCapInertFindings` statt `planCapUnderivableFindings` (Datei nicht im Diff, durch Umbenennung stale).
- **S3-2 (positiv):** `reserveUnreadableDenial` als gemeinsame Quelle fuer den ziffernfreien Reserve-Sperrtext — saubere G5-Extraktion statt Duplizierung.

### passNotes (Auszug)
Doku (Code-Kommentare, `.env.example`, `render.yaml`, `README.md`, `PLAN-SECURITY.md`) durchgaengig synchron. Kein Guard von FATAL auf WARN abgeschwaecht, sondern konsequent geloescht wo die Aussage falsch wurde. Toter Code vollstaendig entfernt (grep in `src/` 0 Treffer). Neue Testdatei folgt Build-Operate-Check und Ein-Konzept-pro-Test, Mutationsproben auf zwei Ebenen (Ops + HTTP-Gate) belegt. Keine Magic Numbers, keine abgeschalteten Tests, kein auskommentierter Code gefunden.

---

## 5. Fix-Runden

- **r1:** kein Ergebnis vom Fix-Agenten. Branch `phase/ks-p9-plattform-beobachtung-fix1` wurde nicht angelegt — kein Commit.
- **Ergebnis:** ABBRUCH der Self-Fix-Schleife. Der S1-Blocker aus dem Erstreview (CLAUDE.md Absolute Regel 1 nicht mit einer expliziten E10-Ausnahme im selben Diff nachgezogen) bleibt **ungeloest** stehen.

---

## 6. Status

**Gate: BLOCKED.** Die Phase ist inhaltlich, testseitig und Safety-seitig vollstaendig und sauber umgesetzt (Regressionslauf gruen, Mutationsproben belegt, Safety-Review PASS), scheitert aber am Clean-Code-Hardgate S1: die Aenderung an einer in CLAUDE.md woertlich als unantastbar bezeichneten Sicherung wurde nicht durch eine im selben Diff nachgezogene, explizite Aktualisierung der CLAUDE.md-Regel selbst legitimiert — nur durch eine separate Plan-Datei (PLAN-KOSTEN-STEUERUNG.md, E10) und den Owner-Wortlaut, der in der aktuell auf master liegenden CLAUDE.md-Fassung bereits die pro-Tenant-Kostendecke als alleinige geschuetzte Achse nennt. Ohne einen erfolgreichen Fix-Commit (r1 ist ergebnislos abgebrochen) bleibt der Branch `phase/ks-p9-plattform-beobachtung` unmerged.

Nachbarbefunde, nur notiert, nicht gefixt: `spendOrDeny` mit nur noch einem Aufrufer (bewusste Ausnahme), `globalCapCents` heisst nach der Phase irrefuehrend (Rename-Kandidat), `COST_TRUING_REQUIRED_RECORD_TYPES` bleibt vorbestehender Blueprint-Boot-Blocker. Restrisiko bewusst getragen: zu enge Starter-Plan-Decke (300 ct) bleibt bis KS-P5a.
