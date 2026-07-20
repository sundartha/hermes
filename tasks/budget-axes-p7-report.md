# Phase P7 — Der Flip: Gates lesen die Spend-Monat-Achse (Default AUS)

**Status:** Gate = PASS. Final-Branch: `phase/ba-p7-flip-fix1`. Nicht deployed, nicht gemergt auf `master` im Rahmen dieses Berichts (Merge-Freigabe liegt vor, s. Safety-Urteil).

**Basis:** `master @ 2a375c6`
**Head-Commit (Impl):** `2e78bc4beeb62f30e7ac4a9d5477a9b21bc11258`
**Tests:** 2637/2637 grün (Impl-Lauf), unabhängig reproduziert mit 2638/2638 grün (Review-Lauf, +1 durch einen zusätzlichen Titel-Fix)

---

## 1. Auftrag dieser Phase

**Tut:** Zwei benannte Verbrauchs-Auflösungen einziehen (`gateUsageCents` für die Tenant-Achse, `gatePlatformUsageCents` für die Plattform-Achse), die vier Gate-Prädikate (`budgetExceeded`, `reserveExceedsBudget`, `globalBudgetExceeded`, `globalReserveExceedsBudget`) darauf umstellen, hinter **einem** Flag `BUDGET_MONTH_ENABLED` mit Default AUS.

**Tut NICHT:** kein Flag-Flip, keine Cap-Neudimensionierung, kein abgeleiteter Plattform-Cap (das ist eine spätere Phase P7b), keine Entwidmung von `costCents` (spätere Phase P8a), keine Änderung an `planMinutesExceeded`, keine neue Dependency, keine Signaturänderung an der Store-Fassade.

Hintergrund: Der Gate-Verbrauch lief bisher als Lebenszeit-Akkumulator (`costCents`), wodurch ein einmal erreichter Budget-Deckel dauerhaft geschlossen bleibt (Totband-Effekt, siehe frühere Phase zu Budget-Achsen/Totband). Diese Phase legt die Verdrahtung, um stattdessen wahlweise im laufenden UTC-Kalendermonat zu messen — ohne den Schalter selbst umzulegen.

---

## 2. Plan (gekürzt)

### 2.1 Die zwei Auflösungsfunktionen

Beide neu in `src/store/state-ops.js`, beide `export` (Test-Pinning), beide reine Query-Funktionen ohne Seiteneffekt:

```js
export function gateUsageCents(s, tenantId, cfg, nowIso)          // -> Ganzzahl Cents
export function gatePlatformUsageCents(s, cfg, nowIso)            // -> Ganzzahl Cents
```

Rumpf (Plan-Vorgabe):

```js
export function gateUsageCents(s, tenantId, cfg, nowIso) {
  const bucket = usageFor(s, tenantId);
  return cfg.budgetMonthEnabled ? spendMonthUsageCents(bucket, nowIso) : bucket.costCents;
}

export function gatePlatformUsageCents(s, cfg, nowIso) {
  return cfg.budgetMonthEnabled ? platformSpendMonthCents(s, nowIso) : globalUsageTotals(s).costCents;
}
```

Die Plattform-Monatssumme braucht keine Mikro-Cent-Brücke (anders als die Lebenszeit-Summe), weil der Sub-Cent-Rest beim Buchen ausschließlich lebenszeit-skaliert verbucht wird — auf der Monats-Achse existiert dieser Rest nicht, die Ganzzahl-Summe ist exakt.

### 2.2 Zeit-Injektion statt Systemuhr im Ops-Layer

`nowIso` wird an der IO-Grenze (`json.js`/`pg.js`, dieselbe Stelle wie das Bestandsmuster bei `trackUsage`) erzeugt und als **letzter** Parameter durchgereicht. Die Fassaden-Signaturen bleiben byte-identisch — dadurch ändert sich keine einzige Call-Site in `outbound-gates.js`, `routes/voice.js`, `telnyx-llm-shim.js` oder `server.js`. Wichtiger Grund: `tryReserveOutboundBudget` erzeugt **einen** Zeitpunkt für beide Achsen — würde jedes Prädikat selbst die Uhr lesen, könnten Tenant- und Plattform-Achse an der Monatsgrenze in verschiedenen Monaten messen.

Bewusste F1-Ausnahme: einzelne Funktionen erreichen 5 Parameter (Präzedenz: bestehendes `trackUsage(s, tenantId, tokens, cfg, nowIso)`). `s`/`cfg`/`nowIso` sind Modul-Plumbing, kein Fachargument; ein Objekt-Argument würde gepinnte Namen und Bestandsaufrufer brechen.

### 2.3 Gemeinsamer Rumpf für den D7-Riegel (G5-Dedup)

`tenantSpendOrDeny` und `globalSpendOrDeny` teilen sich künftig einen gemeinsamen `spendOrDeny`-Rumpf, der **zwei** Zahlen prüft: die Gate-Größe (nach dem Flip die Monatszahl) UND einen unabhängigen Lebenszeit-Wert derselben Quelle. Begründung: nur die Gate-Größe zu prüfen würde die Sicherung verkleinern (ein Bucket mit vergiftetem Lebenszeit-Zähler und gesunder Monatszahl rutschte durch); nur den Lebenszeit-Wert zu prüfen wäre nach dem Flip fail-open (`NaN >= cap` ist `false`). Bei Flag AUS sind beide Zahlen identisch.

Akzeptierter Zielkonflikt: der Quercheck kostet einen zusätzlichen O(Tenants)-Durchlauf auf der Plattform-Achse; bei heutiger Tenant-Zahl vernachlässigbar, für spätere Skala als eigene (optionale) Adressierung vorgemerkt.

### 2.4 Dateien im Plan

- `src/store/state-ops.js` — neuer Block mit den zwei Auflösungsfunktionen, `spendOrDeny`-Extraktion, `nowIso`-Threading durch die vier Prädikate + `tryReserveOutboundBudget`, Anpassung von `platformSpendObservedCents`/`claimPlatformSpendWarning` (P6-Frühwarnung folgt der Gate-Achse, sonst Dauer-Fehlalarm nach einem künftigen Flip).
- `src/store/json.js` / `src/store/pg.js` — Wrapper-Parität, erzeugen `new Date().toISOString()` an der IO-Grenze.
- `src/config.js` — neuer Flag-Eintrag `budgetMonthEnabled` (`BUDGET_MONTH_ENABLED`, Default `false`) samt Pflicht-Eintrag in `CONFIG_NAMESPACES.billing` (höchstes Ausfallrisiko: ein vergessener Namespace-Eintrag wirft `TypeError` im laufenden Gespräch, nicht beim Boot).
- `.env.example`, `render.yaml` — Dokumentation des neuen Flags, Default AUS.
- `test/helpers.js` (`BASE_ENV`) — `BUDGET_MONTH_ENABLED: "false"` (Lehre aus früherer Env-Drift-Erfahrung: sonst leakt eine lokale `.env` in Spawn-Tests).
- `PLAN-SECURITY.md` — neuer Abschnitt zur akzeptierten Divergenz Kalendermonat vs. Abrechnungsperiode.
- `test/budget-month-flip.test.js` (neu) — 17 Testfälle (s. u.).

### 2.5 Pre-Mortem-Risiken aus dem Plan (vor der Umsetzung benannt)

1. Der Monats-Anker überlebt einen Neustart nicht → Cap wirkungslos bei jedem Boot-Zyklus. Entschärfung: Flip erst nach separatem Live-Beleg, dass der Schlüssel einen Neustart übersteht — diese Phase flippt nicht.
2. `CONFIG_NAMESPACES` vergessen → `TypeError` im ersten Anruf statt beim Boot. Entschärfung: dedizierter Test + Runtime-Smoke.
3. Ablehnungstexte/Anzeige zeigen nach einem künftigen Flip weiter Lebenszeit-Zahlen neben einer Monats-Entscheidung — bewusst ausgeklammert als eigene Folgephase (keine Sicherheitslücke, da keine Gate-Entscheidung daran hängt).
4. Warnkanal leer (kein SMS-Alert-Ziel konfiguriert) → Frühwarnung landet nur im Audit-Log, das niemand abonniert hat. Betreiber-Auflage vor dem Flip.
5. Cap-Höhen sind nach dem Flip Monats-Werte statt Lebenszeit-Werte — Neudimensionierung ist eine separate Betreiber-/Phasenentscheidung, nicht Teil dieses Diffs.

Offene Frage an den Owner (blockiert den *Flip*, nicht den *Merge*): ob die Achsen-Kohärenz in Anzeige/Ablehnung vor dem Flip stehen soll oder eine irreführende Zahl für einen Übergangsmonat akzeptabel ist.

---

## 3. Implementierungs-Zusammenfassung

- **Head-Commit:** `2e78bc4beeb62f30e7ac4a9d5477a9b21bc11258`, Branch `phase/ba-p7-flip` (finaler Merge-Branch nach Fix-Runde: `phase/ba-p7-flip-fix1`).
- `node --check` auf allen vier geänderten Kern-Dateien sauber, `npm test`: 2637/2637 grün im Impl-Lauf.
- **Committed:** ja.

### 3.1 Umgesetzte Kernänderung

Zwei neue exportierte Auflösungsfunktionen in `state-ops.js` bündeln Tenant- bzw. Plattform-Verbrauchsquelle hinter genau einem Flag. Alle vier Gate-Prädikate sowie `tryReserveOutboundBudget` nutzen diese Auflösung statt direkt die Lebenszeit-Felder zu lesen; `nowIso` reist als letzter Parameter durch, die Fassaden-Signaturen in `json.js`/`pg.js` bleiben unverändert (sie erzeugen die Zeit an der IO-Grenze, Muster wie beim bestehenden `trackUsage`).

`tenantSpendOrDeny`/`globalSpendOrDeny` teilen sich jetzt den gemeinsamen `spendOrDeny`-Rumpf (G5-Dedup), der sowohl die Gate-Größe als auch den unabhängigen Lebenszeit-Wert prüft, damit das Flag den D7-Riegel nie schrumpfen lässt (fail-closed bei einem vergifteten Wert auf jeder der beiden Seiten). Die P6-Frühwarnung liest jetzt dieselbe Achse wie das Gate, damit sie nach einem künftigen Flip nicht dauerhaft auf der Lebenszeit-Achse fehlalarmiert.

Das Flag ist **nicht geflippt**: `budgetMonthEnabled=false` ist Default in `.env.example`, `render.yaml` und `test/helpers.js` `BASE_ENV`, eingetragen in `CONFIG_NAMESPACES.billing` (17 → 18 Keys).

### 3.2 Tests

17 neue Ops-Tests in `test/budget-month-flip.test.js`, decken ab:
- das ursprüngliche Symptom (ein abgelaufener Monatsschlüssel gibt bei Flag AN Kontingent frei, bei Flag AUS nicht),
- beide Gegentests (laufender Monat bleibt scharf; Flag AUS bleibt Bestandsverhalten),
- den Folgemonats-Übergang (Gate startet bei 0, Lebenszeitsumme bleibt erhalten),
- das gemeinsame Schalten aller vier Prädikate,
- drei D7-Reichweiten-Fälle (vergifteter Tenant-Wert, vergifteter Plattform-Wert, vergiftete Monats-Achse — jeweils fail-closed),
- die Achsen-Zuordnung (Tenant- vs. Plattform-Prädikate lesen unterschiedliche Auflösungen),
- eine Instrumentierungs-/Zählerprobe der Auflösungsaufrufe (zählender Getter auf das Flag),
- eine Quelltext-Invariante, dass das Flag in `state-ops.js` genau zweimal vorkommt,
- eine Quelltext-Invariante, dass keines der vier Prädikate die rohe Lebenszeit-Zahl direkt liest,
- eine TOCTOU-Invariante (kein `await`/`async` im Rumpf von `tryReserveOutboundBudget`),
- die Config-Oberfläche (Flag über den echten Proxy lesbar, kein `TypeError`),
- den Code-Default (`fallback: false`),
- Doku-Parität (`.env.example`/`render.yaml`),
- P6-Kohärenz (Frühwarnung feuert nicht dauerhaft nach dem Flip).

Zusätzlich angepasst: `test/config-namespaces.test.js` (drei gepinnte Zählwerte: `billing` 17→18, `EXPECTED_TOTAL_KEYS` 105→106, geprüfte Schlüssel 98→99, plus ein veralteter Testtitel nachgezogen) und `test/helpers.js` (`BASE_ENV` um das neue Flag ergänzt).

### 3.3 Abweichungen vom Plan (deviations)

1. **Diff-Größe in `state-ops.js` größer als geschätzt** (Plan-Schätzung ~+45/-20, tatsächlich +115/-66). Grund: vollständige Docstring-Überarbeitung an allen fünf betroffenen Funktionen (Pflicht laut Clean-Code-Regeln, Kommentare mussten den neuen Rumpf/die neue Auflösung erklären) plus die im Plan selbst geforderte G5-Extraktion, bei der die vorherige Zeile-für-Zeile-Duplizierung vollständig einem gemeinsamen Rumpf wich. Funktional deckungsgleich mit dem Plan, nur textuell umfangreicher.
2. **Ein Testfall wurde gegenüber dem Plan-Vorschlag verschärft:** die ursprünglich vorgeschlagene Konstruktion für den Achsen-Zuordnungstest (zwei Tenants mit jeweils identischer Lebenszeit- und Monatszahl) hätte den Rot-vor-Fix-Beweis nicht bestanden, weil beide Zahlen zufällig gleich liefen. Auf gegenläufige Werte umgestellt, damit ein Regress zur rohen Lebenszeit-Lesung den Test wirklich rot färbt.
3. **Ein veralteter Test-Titel** in `test/config-namespaces.test.js` (nannte noch die alte Gesamt-Key-Zahl) wurde zusätzlich nachgezogen — reiner Kommentar-/Titel-Fix ohne Verhaltensänderung, war im Plan nicht explizit benannt, aber direkte Folge der Zähler-Änderung.

---

## 4. Rot-vor-Fix-Beleg

Zweifach belegt:

1. **Import-Ebene (vor jeder Implementierung):** Testdatei zuerst geschrieben, Befehl `NODE_ENV=test node --test test/budget-month-flip.test.js` → `SyntaxError: The requested module '../src/store/state-ops.js' does not provide an export named 'gateUsageCents'`, Exit 1 (1 failing, 0 passing). Trivial rot wie erwartet.

2. **Verhaltens-Ebene (nach der Implementierung, gemäß Plan-Protokoll):** Monats-Zweig in `gateUsageCents`/`gatePlatformUsageCents` temporär auf die reine Lebenszeit-Lesung verkürzt (Flag effektiv wirkungslos gemacht). Ergebnis: die Prod-Symptom-, Folgemonats-, Gemeinsam-Schalten-, Achsen-Zuordnungs-, Instrumentierungs-, Zähler-Fundament- und P6-Kohärenz-Tests fielen rot; beide Gegentests sowie die D7-Reichweiten- und übrigen strukturellen Tests blieben grün. Das trennt „Flip wirkt" von „Gegentests wirken". Danach zurückgenommen (Diff gegen Backup = leer), wieder alle 17 grün.

**Unabhängige Zusatz-Verifikation im Review (zweiter, verhaltensbasierter Beleg auf echtem `master`, detached HEAD):**
- Eigenes Probe-Skript mit dem Prod-Symptom (Lebenszeit-Kosten über Cap, abgelaufener Monatsschlüssel, aktueller Monat unter Cap, Flag AN im cfg) → `tryReserveOutboundBudget` liefert auf `master` `FALSE` (Flag wird komplett ignoriert). Auf dem Phasen-Branch: `TRUE`. Der Verhaltensunterschied ist real, nicht bloß ein fehlender Export.

**Zusätzlicher Spawn-Beleg für die Config-Oberfläche (Merge-Gate-Pflicht):**
`node -e "import('./src/config.js').then(m => console.log(m.config.billing.budgetMonthEnabled))"` — mit fehlendem `CONFIG_NAMESPACES`-Eintrag: Exit 1, `TypeError`. Mit dem Eintrag: Exit 0, `false`.

**Echter HTTP-Runtime-Smoke** (Kindprozess über `test/helpers.js`): `/healthz` → 200; ein Inbound-Anruf-Webhook (routet auf `budgetExceeded`/`globalBudgetExceeded`) → 200, kein Fehler im Server-Log. Mit temporär entferntem Namespace-Eintrag zeigte derselbe Pfad den vorhergesagten Absturz (Server-Log meldet fehlenden Config-Key, Antwort fällt auf den generischen Fehler-Fallback zurück) — bestätigt Pre-Mortem-Risiko 2 aus dem Plan eins zu eins.

---

## 5. Safety-Urteil (final)

**Verdikt: APPROVED.** Alle sechs geforderten Phasen-Invarianten halten der adversarialen Prüfung stand, kein Blocker.

Geprüfte Invarianten:
1. **Flag AUS = byte-identisch** (härtester Punkt) — erfüllt. Voll-Suite grün mit Default AUS, kein einziger Bestands-Gate-Test musste angepasst werden; der Test-Diff besteht nur aus der neuen Testdatei, einer strukturell unvermeidlichen Zählwert-Anpassung und einer Env-Hygiene-Ergänzung.
2. **Beide Achsen schalten gemeinsam** — erfüllt, strukturell statt konventionell erzwungen (das Flag kommt im Modul genau zweimal vor, je einmal pro Auflösungsfunktion).
3. **Kein Prädikat liest die Lebenszeit-Zahl direkt / diese Zahl existiert weiter** — beides erfüllt; die verbliebene Lesung im D7-Riegel ist eine zusätzliche, nur verschärfende Gegenprobe, keine Gate-Größe.
4. **`tryReserveOutboundBudget` bleibt rein synchron** — erfüllt, kein Suspendierungspunkt zwischen Prüfung und Inkrement.
5. **Monotonie hält auch im Gate** — erfüllt; eigenständig mit acht Uhr-Anomalien geprüft (Zukunfts-Schlüssel, zurückgedrehte Uhr, unlesbare/undefinierte/leere/Null-Werte, Kombinationen) — in keinem Fall fiel der gemessene Verbrauch auf 0, der Cap blieb über eine Uhr-Anomalie nicht abschaltbar (einzige Ausnahme: echter Vorwärts-Skew, s. Concern C3 unten).
6. **Kein abgeleiteter Plattform-Cap, keine geänderten Cap-Zahlen** — erfüllt.

### Concerns (nicht blockierend)

- **C1 (diagnostisch):** Das Log-Format der Korruptions-Meldung ändert sich auch bei Flag AUS leicht (benennt jetzt das tatsächlich geprüfte Feld statt hart `costCents=` zu behaupten). Kein Konsument parst diesen Wert; das maschinenlesbare Grund-Token bleibt unverändert. Behebt eine reale Ungenauigkeit im Runtime-Output.
- **C2 (Betriebs-Auflage vor einem künftigen Flip, nicht vor dem Merge):** Der Flip selbst wäre eine einmalige Voll-Amnestie — im Moment des Umschaltens fällt der gesamte aufgelaufene Lebenszeit-Verbrauch aller Tenants auf die aktuelle Monatszahl zurück (bestätigt durch Gegenprobe mit einem Bucket ohne Monatsschlüssel). Muss ins Flip-Runbook, damit der Betreiber es nicht als schleichenden Übergang missversteht.
- **C3 (inhärentes Restrisiko):** Eine vorwärts verstellte Uhr setzt den gemessenen Verbrauch auf 0 zurück — von einem echten Monatswechsel prinzipiell nicht unterscheidbar, inhärent für jede Kalender-Achse. Entschärft durch den bestehenden Monotonie-Riegel: nach dem ersten Schreibzugriff mit dem Zukunftswert schließt sich das Gate wieder, also höchstens ein einmaliges Fenster.
- **C4 (Performance, heute irrelevant, für Millionen-Skala vorgemerkt):** Der Plattform-D7-Riegel durchläuft die Nutzungsdaten jetzt zweimal pro Aufruf (Monatssumme + Lebenszeit-Gegenprobe); bei heutiger Tenant-Zahl belanglos, bei angestrebter Skala eine Kante für ein künftiges inkrementelles Aggregat.
- **C5 (bewusst vertagt, muss vor einem Live-Flip geschlossen sein):** Die Snapshot-Funktion für Anzeige-/Ablehnungstexte liest weiterhin die Lebenszeit-Zahl. Nach einem künftigen Flip zeigen API-Zustand und Ablehnungstexte Lebenszeit-Zahlen neben einer Monats-Entscheidung — inkonsistent zur (in dieser Phase bewusst mitgezogenen) Frühwarnung. Kein Sicherheitsdefekt, da keine Gate-Entscheidung daran hängt; in `PLAN-SECURITY.md` bereits als ausgeklammerte Folgephase benannt.

### Unabhängige Verifikation (Review-Session)

- Volle Suite (json-Backend, Default): 2638/2638 grün, kein Flake.
- pglite-in-process (alle Testdateien mit pglite-Bezug): 1012/1012 grün.
- Gezielte Geld-/Nebenläufigkeits-Achse (Outbound-Budget-Concurrency, Reserve-Gate, Tenant-Cap, NaN-Fail-Closed, Spend-Monat-Achse, Plattform-Warnung, neue Flip-Tests): 81/81 grün, kein bestehender Gate-Test musste angepasst werden.
- `node --check` auf allen vier geänderten Quelldateien sauber, keine neue Dependency (package.json/package-lock unverändert).
- Rot-vor-Fix zusätzlich auf echtem `master` (detached HEAD) reproduziert, sowohl auf Import- als auch auf Verhaltensebene.
- Acht adversariale Uhr-Anomalie-Gegenproben (s. o.) sowie eine empirische Achsen-Trennungsprobe (Lebenszeit-Wert über Cap, Monatswert 0 → Gate offen) und ein Boot-/Log-Scan ohne Secret-Treffer.

---

## 6. Clean-Code-Audit

**Verdikt:** PASS — keine S1/S2-Befunde (Blocker). Kernauftrag (genau eine Monats-Auflösung je Achse) sauber erfüllt und strukturell per Test erzwungen.

### S3 (mittel)

- **Zu viele Argumente:** Die vier Gate-Prädikate plus die Hilfsfunktion für den Tenant-Riegel wachsen durch das neue Zeit-Threading auf 4–5 Parameter — über dem Richtwert von 3 aus dem Katalog. Kein neuer Architekturfehler (dient Testbarkeit/Reinheit, folgt dem etablierten Präzedenzmuster, die Parameter sind semantisch nicht sinnvoll bündelbar ohne Klarheitsverlust), aber die Zahl wächst mit jeder Phase weiter. Vorgeschlagener (optionaler) Fix für eine künftige Phase: Konfiguration und Zeitstempel als ein gemeinsames Kontext-Objekt bündeln.

### S4 (niedrig)

- **Doppelter Zeit-Aufruf:** Die beiden Gate-Aufrufe für Tenant- und Plattform-Prüfung erzeugen an ihren jeweiligen Aufrufstellen unabhängig voneinander den aktuellen Zeitstempel — bei aktiviertem Flag theoretisch zwei mikrosekunden-versetzte „Jetzt"-Werte für dieselbe Gate-Entscheidung an einer Monatsgrenze. Praktisch vernachlässigbar (Flag aktuell AUS, Fenster im Nanosekundenbereich), als Kante für einen späteren strengeren Determinismus-Anspruch festgehalten.

### Bestätigte Punkte (passNotes, Auszug)

- Der Kernauftrag — genau eine Auflösung je Achse — ist per Quelltext-Grep bestätigt (das Flag kommt exakt zweimal in `state-ops.js` vor). Alle vier Prädikate lesen ausschließlich über diese zwei Funktionen.
- Der D7-Riegel prüft nach der Erweiterung korrekt beide Werte und sperrt fail-closed bei jedem vergifteten Wert; ein aus einer früheren Review-Runde stammender Blocker (irreführendes Log-Label) ist behoben und durch einen Test gepinnt.
- Namenskonsistenz folgt konsequent dem bereits etablierten Modul-Schema (Tenant- vs. Plattform-Varianten bestehender Helferfunktionen) — keine neue Inkonsistenz.
- Die Fassaden-Grenze ist per Grep über den gesamten `src/`-Baum bestätigt: jeder Aufrufer geht ausschließlich über die Store-Fassade, kein direkter Import umgeht die Zeit-Injektion.
- Doku-Parität (`.env.example`/`render.yaml`/`config.js`/`PLAN-SECURITY.md`/Namespace-Liste) durchgängig konsistent, Default AUS überall, durch Tests gepinnt.
- Unabhängig verifiziert: volle Suite nach Checkout des Branches — 2638/2638 grün, `node --check` auf allen vier geänderten Quelldateien sauber.

### Top-Todos (nicht blockierend)

1. Parameterzahl der Gate-Funktionen im Auge behalten — bei der nächsten Erweiterung ein gemeinsames Kontext-Objekt erwägen.
2. Vor dem eigentlichen Flag-Flip (bewusst nicht Teil dieser Phase): den geforderten Live-Beleg einholen, dass der Monatsschlüssel einen Neustart auf dem Free-Tier-Host übersteht.
3. Die dokumentierte Folgephase (Anzeige-/Ablehnungstexte zeigen nach einem Flip weiter Lebenszeit-Zahlen) im Blick behalten.

---

## 7. Fix-Runden

**Runde 1 (r1):** Ein Blocker aus der Review-Runde wurde behoben: Die Korruptions-Log-Funktion bekam einen dritten Parameter, der das tatsächlich geprüft-vergiftete Feld benennt (Gate-Größe oder Lebenszeit-Wert), statt den Log-Text hart auf die alte Lebenszeit-Bezeichnung zu pinnen. Der gemeinsame D7-Rumpf (`spendOrDeny`) übergibt seither das jeweils betroffene Feld statt eines pauschalen Labels. Ergebnis: die im Safety-Urteil unter „Clean-Code" bestätigte Behebung, per zusätzlichem Testfall gepinnt.

Nach Runde 1 lag sowohl das Safety- als auch das Clean-Code-Urteil final bei PASS/APPROVED ohne verbleibende Blocker.

---

## 8. Offene Deploy-/Flip-Vorbedingungen (aus Plan, Safety-Urteil und Clean-Code-Audit)

Diese Phase ändert nur die Verdrahtung; das Flag bleibt AUS. Vor einem späteren tatsächlichen Umschalten auf die Monats-Achse sind folgende Punkte zu erledigen — sie sind **keine** Bedingung für den Merge dieser Phase:

1. **Live-Beleg für Neustart-Festigkeit:** Nachweis aus der Produktions-Datenbank, dass der Monatsschlüssel einen Boot-Zyklus des Free-Tier-Hosts übersteht (Pre-Mortem-Risiko 1 des Plans). Ohne diesen Beleg wäre der Cap nach jedem Neustart wirkungslos.
2. **Voll-Amnestie ins Flip-Runbook aufnehmen (C2):** Der Flip-Moment setzt den gesamten aufgelaufenen Lebenszeit-Verbrauch aller Tenants auf die aktuelle Monatszahl zurück — das muss dem Betreiber vorab bewusst sein, nicht erst danach auffallen.
3. **Warnkanal besetzen (Pre-Mortem-Risiko 4):** Vor dem Flip sollte ein echtes Alarmierungsziel für die Frühwarnung konfiguriert sein, statt dass die Warnung nur im Audit-Log landet.
4. **Cap-Neudimensionierung als bewusste Betreiber-Entscheidung (Pre-Mortem-Risiko 5):** Die bestehenden Cap-Werte werden nach dem Flip zu Monats-Werten statt Lebenszeit-Werten — das ist eine separate Env-Entscheidung, nicht Teil dieses Diffs. Ein abgeleiteter Plattform-Cap ist eine eigene spätere Phase.
5. **Achsen-Kohärenz in Anzeige/Ablehnung (C5, Pre-Mortem-Risiko 3):** Anzeige- und Ablehnungstexte lesen weiterhin die Lebenszeit-Zahl und würden nach einem Flip neben einer Monats-Entscheidung eine andere Zahl zeigen. Kein Sicherheitsdefekt, aber vor einem produktiven Flip nachzuziehen (dokumentiert als eigene Folgephase in `PLAN-SECURITY.md`).
6. **Offene Owner-Frage:** ob Punkt 5 vor dem Flip stehen muss oder eine irreführende Zahl für einen Übergangsmonat akzeptiert wird — blockiert den Flip, nicht den Merge.
7. **Performance-Kante bei Skala (C4):** Der doppelte Durchlauf über die Nutzungsdaten im Plattform-D7-Riegel ist bei heutiger Tenant-Zahl irrelevant, sollte aber vor deutlich höherer Skala durch ein inkrementelles Aggregat ersetzt werden.

---

## 9. Diff-Übersicht (laut Plan/Review bestätigt)

Geänderte Dateien: `src/store/state-ops.js`, `src/store/json.js`, `src/store/pg.js`, `src/config.js`, `.env.example`, `render.yaml`, `test/helpers.js`, `test/config-namespaces.test.js`, `PLAN-SECURITY.md`. Neu: `test/budget-month-flip.test.js`.

**Unverändert (per `git diff --stat` bestätigt):** `server.js`, `outbound-gates.js`, `routes/voice.js`, `telnyx-llm-shim.js`, `store.js`, `defaults.js`, `schema.sql` sowie alle drei bestehenden Geld-/Gate-Testdateien (Outbound-Budget-Concurrency, Reserve-Gate, Tenant-Cap) — kein einziger Bestands-Gate-Test musste für diese Phase angepasst werden.

---

*Bericht erstellt am 2026-07-20. Enthält keine echten Kunden-/Tenant-Identifikatoren, keine Secrets und keine Telefonnummern — vor dem Schreiben gegen die Quelle geprüft (PII-Scan).*
