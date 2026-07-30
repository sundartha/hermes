# Phase KS-P3a — Plan-Decken gegen die Worst-Case-Reserve absichern

**Gate: PASS**
**finalBranch:** `phase/ks-p3a-plan-decken`
**headCommit:** `454cc26` (Basis `master` = `9309310`)

---

## 0. Scope-Klärung

`PLAN-KOSTEN-STEUERUNG.md` Abschnitt `### KS-P3a` nennt zwei Teile:

| Teil | Inhalt | Stand |
|---|---|---|
| 1. Boot-Guard gegen `MIN(planCapCents)` | offen | **diese Phase liefert das** |
| 2. Kalibrierung Buchungssatz ↔ `voiceCapRateCentsPerMin` (E5) | bereits umgesetzt | durch KS-P5a (`00d480c`): `voiceCapRateCentsPerMin`/`VOICE_CAP_RATE_CENTS_PER_MIN` existiert repo-weit nicht mehr, `src/billing/plan-caps.js` rechnet mit `cfg.voiceTariffDefaultCents` — EIN Satz |

Teil 2 wurde deshalb **nicht erneut gebaut**, sondern nur mit Fundstelle festgestellt (keine Doppel-Implementierung). Diese Phase liefert ausschließlich den Boot-Guard.

### Tragende Rechnung

Nach KS-P5a gilt mit Satz `T`:

```
planCapCents(starter)  = 30 · T · 5/3 = 50T
planCapCents(business) = 120 · T · 5/4 = 150T
Worst-Case-Reserve     = T · ceil(MAX_CALL_DURATION_CAP_S / 60)   (Cap = 300 s -> 5T)
```

`T` kürzt sich raus. Die einzige lebende Variable ist `ceil(MAX_CALL_DURATION_CAP_S/60)` gegen `includedMinutes · num/den`. Der Guard feuert ab `MAX_CALL_DURATION_CAP_S > 3000 s` — genau die Größe, die **KS-P3** anhebt. KS-P3a steht damit als Vorbedingung davor.

Gemessen grün bei T=0 (Testsuite), T=30 (live), T=300:

```
0   [[starter,0],[business,0]]       reserve 0
30  [[starter,1500],[business,4500]] reserve 150
300 [[starter,15000],[business,45000]] reserve 1500
```

---

## 1. Plan (gekürzt)

- **Neue Datei** `test/ks-p3a-plan-cap-reserve-guard.test.js` — reine Wahrheitstabelle, 5 Tests (a–e): echter Katalog bei T∈{0,30,300} → `[]`; feuernder Fall → genau ein FATAL mit Slug+Zahlen; Grenze `>` vs. `>=`; werfender `capForSlug` wird übersprungen statt zu werfen; leere/komplett unableitbare Slug-Menge → `[]`.
- **`src/boot-guard.js`**:
  - Edit A: gemeinsame Reserve-Rechnung als `worstCaseReserveCents({maxTariffCents, maxCallDurationS})` extrahiert (statt zweiter Kopie in `spendCapCoherence`).
  - Edit B: Wurf-Fang von `capForSlug` in EINE Stelle `derivePlanCaps({slugs, capForSlug})` gezogen — beide Plan-Decken-Guards werfen dadurch strukturell nie (sonst: Wurf → `assertBootGates` → uncaughtException-Netz → lautloser `exit(0)`).
  - Edit C: neuer Befund-Code `PLAN_CAP_WORST_CASE_UNAFFORDABLE` in `PLAN_CAP_FINDING`.
  - Edit D: neue Export-Funktion `planCapReserveFindings({slugs, capForSlug, maxTariffCents, maxCallDurationS})` — hält Reserve gegen `MIN(planCapCents(slug))`, höchstens ein Befund, FATAL.
- **`src/boot.js`**: Import + Verdrahtung in `assertSpendCapCoherence` (Reserve-Eingaben einmal als `worstCase` benannt, an beide Guards gespreizt), Doc-Kommentar ergänzt.
- **`test/boot-failclosed.test.js`**: ein zusätzlicher Spawn-Test mit `VOICE_TARIFF_DEFAULT_CENTS=30` (Live-Satz) — beweist grüne Verdrahtung; der feuernde Zweig ist über Env strukturell nicht erreichbar (Code-Konstante), daher kein Refusal-Spawn wie `T-P3-12`.
- **`PLAN-SECURITY.md`**: neuer Abschnitt `## KS-P3a — ...` nach dem KS-P1b-Abschnitt, inkl. Restrisiko.
- **Nicht angefasst**: `.env.example`, `render.yaml`, `src/config.js`, `src/plans.js`, `src/billing/plan-caps.js`, `src/store/state-ops.js`, `src/telephony/outbound-gates.js`, `MAX_CALL_DURATION_CAP_S` (= KS-P3), `MAX_BUDGET_EUR`, `tasks/ks-deploy-checkliste.md`, `STATUS.md`.

---

## 2. Impl-Zusammenfassung

Umgesetzt wie geplant. `planCapReserveFindings` in `src/boot-guard.js`, verdrahtet in `assertSpendCapCoherence` (`src/boot.js`). Zwei verhaltensgleiche Extraktionen (`worstCaseReserveCents`, `derivePlanCaps`) statt Duplizierung (G5). `planCapUnderivableFindings` bleibt in Signatur, Rückgabe und Meldung unverändert.

**Mutationsprobe (P11):** Testdatei zuerst angelegt → rot (Export existiert auf master nicht), dann Code → grün. Refactor-Nachbarschaft (`spend-cap-coherence`, `plan-cap-unclamped`, `env-docs-spend-cap-coherence`, `ks-p5a-plan-cap-carries-sold-minutes`) blieb dabei **ohne jede Testanpassung** grün — Beleg, dass Edit A/B reines Refactoring war.

**Verifikation:**
1. Testdatei allein → rot (statt der geplanten `TypeError` ein `SyntaxError`, s. Deviations).
2. `node --check` auf beiden Quelldateien → Exit 0.
3. Neue Datei allein → 5/5 grün.
4. Regressions-Nachbarschaft → grün, unverändert.
5. `boot-failclosed.test.js` → grün, inkl. neuem Spawn.
6. `npm test` → 3585/3585 grün (Delta zur Baseline 9309310 exakt +6 Tests).
7. `npm run test:gates` → 126/129 grün, 3 rot — identisch zur master-Baseline.
8. Rechenbeleg für die Kürzungs-Rechnung ausgeführt und im Bericht dokumentiert (s. oben).

### Deviations

1. **Teil 2 der Spec nicht gebaut** — bereits durch KS-P5a (`00d480c`) erledigt (`voiceCapRateCentsPerMin` existiert repo-weit nicht mehr); mit Fundstelle festgestellt statt dupliziert.
2. **Mutationsprobe Schritt 1 anderer Fehlertyp** — Plan erwartete `TypeError` (5/5 fail), tatsächlich `SyntaxError: does not provide an export named 'planCapReserveFindings'` (statischer ESM-Import scheitert schon beim Modul-Laden, # pass 0 / # fail 1). Gleich definitiv, andere Fehlerform.
3. **node_modules-Symlink-Anweisung fehlerhaft** — `ln -s "./node_modules" node_modules` erzeugt ELOOP (Selbstreferenz); durch Symlink auf den absoluten Pfad des Haupt-Repos ersetzt, nicht committet (gitignored).
4. **`test:gates` mit 3 roten Tests gelaufen** — entspricht exakt der dokumentierten master-Baseline ("Gates 36→3 rot"), unverändert; KS-P3a-Testnamen tragen bewusst kein i18n-Katalog-Präfix und landen im Regressionslauf.
5. **Kein Spawn-Refusal-Test wie `T-P3-12` möglich** — der feuernde Zweig ist über Env strukturell unerreichbar (Satz kürzt sich raus, `MAX_CALL_DURATION_CAP_S` ist Code-Konstante); im Plan begründet, im Bericht als Restrisiko geführt.

---

## 3. Safety-Urteil (final)

**APPROVED**, mit 5 nicht-blockierenden Concerns. Alle absoluten Regeln gehalten: Safety-Gates unverändert (kein Laufzeitpfad angefasst), Offenlegungssatz in `claude.js`/`bridge.js` byte-identisch, Auth fail-closed unberührt (kein neuer Endpunkt), keine Secrets im Diff, kein Audio über MCP betroffen, Scope eingehalten (6 Dateien, keine neue Dependency).

Eigene Läufe (frischer Worktree, Branch `review-ks-p3a`): Regression 3585/3585 grün gegen selbst gemessene master-Baseline 3579/3579 (Delta exakt +6), Gates 126/129/3 unverändert, pg-Pfad (pglite) 112/112 grün. Mutationsproben bestätigen: Grenzbedingung `>` gepinnt, Guard neutralisiert → 3/5 Tests rot (wirksam), Verdrahtungszeile entfernt → alles bleibt grün (Lücke, s. Concerns).

**Concerns:**
1. **Verdrahtung nicht test-gepinnt** — Löschen der Aufrufzeile in `src/boot.js` lässt die gesamte relevante Testmenge (31/31) grün. Nur der Guard selbst ist gepinnt, seine Aktivierung nicht.
2. **Feuernder Zweig über Env strukturell unerreichbar** — der Guard schützt heute gegen keine Operator-Fehlkonfiguration, nur gegen eine künftige Code-Änderung (`MAX_CALL_DURATION_CAP_S > 3000 s`). Erklärte Absicht (Vorbedingung von KS-P3), operativer Nutzen vor KS-P3 ist null.
3. **Neuer FATAL-Boot-Refusal-Pfad = neue Verfügbarkeitsfläche** — ein künftiger Plan mit kleinem `includedMinutes` könnte den Boot komplett verweigern (inbound eingeschlossen). Heutiger Katalog gemessen grün bei T=0/30/300; Meldung ist actionable. Präzedenz existiert (`spendCapCoherence` Klausel B ist seit P7 ebenfalls FATAL).
4. **Prettier-Drift** auf allen vier berührten Dateien — gegengeprüft: bereits auf Basis-Commit `9309310` vorhanden, also vorbestehend, nicht eingeschleppt. `format:check` ist kein Gate in `npm test`.
5. **Teil 2 der Spec bewusst nicht gebaut** — Begründung verifiziert (`VOICE_CAP_RATE_CENTS_PER_MIN` existiert nur noch als Historien-Kommentar); der von der Spec geforderte Rechentest existiert bereits als `test/ks-p5a-plan-cap-carries-sold-minutes.test.js` (grün gemessen). Abweichung vom wörtlichen Spec-Text, aber korrekt und belegt.

---

## 4. Clean-Code-Audit

**Verdict: PASS** (kein Blocker).

- **s1:** []
- **s2:** []
- **s3:** [`planCapReserveFindings` und `spendCapCoherence` Klausel B haben strukturell dieselbe Form (Reserve berechnen, gegen Decke prüfen, Message bauen) — beabsichtigte Parallelität gegen zwei verschiedene Decken (Tenant-Default vs. Plan-Minimum); gemeinsame Berechnung bereits als `worstCaseReserveCents` extrahiert. Kein Fix nötig, nur als Beobachtung notiert.]
- **s4:** []

Begründung: additiver, verhaltenserhaltender Diff. Eine dritte fatale Boot-Sicherung kommt hinzu, keine bestehende wird geschwächt (kein `fatal:true→false`, kein Guard umgehängt). G5 sauber gelöst (`worstCaseReserveCents`, `derivePlanCaps` statt Duplizierung). Fehlerpfade per Wahrheitstabelle getestet plus Spawn-Test mit Live-Satz. `node --check` fehlerfrei. Keine Berührung von Auth/Secrets/Offenlegungssatz. `PLAN-SECURITY.md` konsistent nachgeführt, Restrisiko explizit benannt.

**Top-TODOs:** Kein Blocker. Optional später: falls eine dritte Decken-Art dazukommt, `spendCapCoherence`-Klausel-B und `planCapReserveFindings` auf eine gemeinsame parametrisierte Guard-Funktion zusammenführen — aktuell kein Handlungsbedarf.

---

## 5. Fix-Runden

Keine — Impl lief bei erstem Durchlauf grün, Safety- und Clean-Code-Review liefen ohne Blocker durch (nur nicht-blockierende Concerns/Beobachtungen).

---

## 6. Restrisiko (getragen, in `PLAN-SECURITY.md` festgehalten)

Der Guard prüft die aus dem Plan **abgeleitete** Decke, nicht eine per Hand gesetzte `tenant_budget`-Zeile — eine manuell zu niedrig geschriebene Decke fängt er nicht. Außerdem greift er beim Boot, nicht beim Schreiben: eine Konfiguration, die erst nach dem Start inkohärent würde, meldet er erst beim nächsten Neustart. Zusätzlich (aus dem Safety-Review): die Verdrahtung selbst ist nicht test-gepinnt, und der Guard hat vor KS-P3 keinen operativen Wirkbereich — er ist reine Vorbedingung für die kommende Phase.

## 7. Übergabe an KS-P3

Auslöseschwelle des Guards: `MAX_CALL_DURATION_CAP_S > 3000 s`. KS-P3 muss diese Grenze beim Anheben der maximalen Gesprächsdauer berücksichtigen — der Boot verweigert sonst mit einer Meldung, die Slug, Reserve-Betrag und beide Abhilfe-Hebel (Dauer senken / inkludierte Minuten bzw. Kopffreiheit anheben) nennt.
