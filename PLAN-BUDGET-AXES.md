# PLAN-BUDGET-AXES — Budget-Achsen entwirren (Perioden-Achse, Tenant-Limit, Plattform-Notaus)

Stand: 2026-07-19. Betrifft `src/store/state-ops.js`, `src/config.js`,
`src/telephony/outbound-gates.js`, `src/billing/metering.js`, `src/routes/api-read.js`,
`src/boot-guard.js`, `src/db/schema.sql`, `src/store/pg.js`.

Dieses Dokument ist die vollstaendige Arbeitsgrundlage. Es setzt keinen Gespraechskontext
voraus. Alle Zeilennummern beziehen sich auf den Stand `master` @ `6522b60`.

Text bewusst OHNE Umlaute (Repo-Konvention, `.claude/refs/clean-code.md` + CLAUDE.md).

---

## 1. Lage

Seit dem 2026-07-19 wird **jeder** Outbound-Call in Produktion mit HTTP 402
"Voraussichtliche Anrufkosten ueberschreiten das verfuegbare Budget." abgelehnt
(Audit-Detail `grund=reserve`). Ursache ist nicht ein Defekt in der Reservierung, sondern
eine fehlende Zeitachse: der globale Verbrauchszaehler `usage.costCents` hat **null
Reset-Stellen** und ist damit faktisch ein LEBENSZEIT-Akku, der gegen ein als Monatsbudget
gemeintes Limit (`MAX_BUDGET_EUR=8` -> 800 Cent) geprueft wird. Der Zaehler steht bei
**779 von 800 Cent**; die Worst-Case-Reserve fuer ein einziges Inlandsgespraech betraegt
60 Cent (20 ct/min * ceil(180 s / 60)). 779 + 60 = 839 > 800 -> das Reserve-Gate blockt.
Der Zustand ist **selbstverriegelnd**: weil kein Call mehr zustande kommt, waechst der
Zaehler nie auf 800, das einfachere `budget`-Gate schweigt dauerhaft, und der Nutzer sieht
nie die verstaendlichere Meldung. Verschaerfend: der 800-Cent-Topf ist ein GETEILTER Topf
ueber alle 28 Tenants. Der Owner kann aktuell nicht telefonieren, weil andere Konten den
gemeinsamen Topf gefuellt haben.

**Praezisierung der Schwere (Korrektur):** Eine fruehere Fassung nannte das ein Problem
"fremder Tenants". Das ist die falsche Rahmung — in einem Multi-Tenant-Produkt sind andere
Tenants KUNDEN, kein Fremdkoerper. Der Defekt ist nicht, WER den Topf haelt, sondern DASS
es einen gemeinsamen Topf gibt. Bei 6 Tenants heisst das, dass einer die anderen blockiert.
Bei der angestrebten Skala heisst dasselbe: **ein einzelner beliebiger Nutzer schaltet den
Dienst fuer alle ab** — dauerhaft, weil der Zaehler nie zurueckgesetzt wird. In diesem
Punkt war die Mehrmandantenfaehigkeit bisher nur behauptet, nicht vorhanden.

---

## 2. Messung (Beweis, nicht neu herleiten)

### 2.1 Verteilung des globalen Topfes (28 Tenants, 6 mit Verbrauch)

| Tenant | Verbrauch | Calls |
| --- | --- | --- |
| Owner-Nutzer (der blockierte Tenant) | 3.50 EUR | 19 |
| Tenant B | 1.62 EUR | 11 |
| Tenant C | 1.42 EUR | 9 |
| Tenant D | 0.81 EUR | 4 |
| Tenant E | 0.41 EUR | 4 |
| `owner` (Bootstrap) | 0.03 EUR | 14 |
| **Summe** | **7.79 EUR** | **61** |

Die Tenant-IDs sind hier bewusst pseudonymisiert (Kunden-Identifikatoren gehoeren
nicht in die Git-Historie). Reproduzierbar mit den echten IDs ueber die Messung in
`~/.config/hermes/budget-messung.sql`.

**Entscheidend ist die Struktur, nicht die Identitaet: 4.29 EUR — 55 % des Deckels —
entfallen auf Konten, die den blockierten Tenant nichts angehen.** Die Zahl belegt keinen
Missbrauch, sondern eine fehlende Achse: der Verbrauch JEDES Kontos zaehlt gegen den
Deckel JEDES anderen. Dass es hier 55 % sind, ist ein Zufall der Tenant-Zahl — bei
hinreichend vielen Konten genuegt ein einziges, um alle zu sperren.

Cap: `MAX_BUDGET_EUR=8` -> 800 Cent. **Kopffreiheit: 21 Cent.**
`tenant_budget`-Zeilen in der Live-DB: **0** (bei 28 Tenants).

### 2.2 Totband-Repro (mit echtem Server verifiziert)

Bucket-Werte 700 / 740 / 741 / 799 / 800 gegen Cap 800, Ziel `+49`, Reserve 60 Cent:

| Bucket | `budgetExceeded` (`>=`, state-ops.js:1450) | `reserveExceedsBudget` (`>`, :1465) | Ergebnis |
| --- | --- | --- | --- |
| 700 | false | 700+60=760 > 800? nein | Call geht durch |
| 740 | false | 800 > 800? nein | Call geht durch |
| **741** | false | 801 > 800? **ja** | **402 `grund=reserve`** |
| **779** | false | 839 > 800? **ja** | **402 `grund=reserve`** (Prod-Zustand) |
| **799** | false | 859 > 800? **ja** | **402 `grund=reserve`** |
| 800 | **true** | true | 402 `grund=budget` |

Zwischen 741 und 799 liegt ein **Totband**: das Reserve-Gate blockt, das Budget-Gate
schweigt, und weil geblockt wird, erreicht der Zaehler die 800 nie. Der Zustand friert
permanent ein.

### 2.3 Widerlegte Hypothesen (nicht wieder aufwaermen)

- **P7a-Modellpreis-Falle als Ursache**: widerlegt. Gebucht wird die konfigurierte
  Alias-ID, nie `resp.model` (`src/llm.js` / `llm-usage.js:48-53`).
- **Reserve-Leak**: widerlegt. Der Reserve-Ledger ist ephemer, es gibt 4 Freigabepfade,
  und beide untersuchten Calls erreichten Settlement.

---

## 3. Befunde D1-D9

| ID | Kurzbeschreibung | Schwere | Behoben in |
| --- | --- | --- | --- |
| **D1** | `usage.costCents` hat NULL Reset-Stellen (`state-ops.js:1419` und `:1431` sind die einzigen Mutationen, beide `+=`). `MAX_BUDGET_EUR` ist faktisch ein Lebenszeit-Cap: bei 20 ct/min sind das ~40 Gespraechsminuten. JEMALS. | **kritisch** (Wurzel) | P4, P7, P8a |
| **D2** | Totband `>=` vs. `>` zwischen `budget` und `reserve_budget` -> selbstverriegelnd, und der Nutzer bekommt nie die verstaendlichere Meldung. | hoch | P5a |
| **D3** | Globaler Cap ist ein GETEILTER Topf ueber alle Tenants (`globalUsageTotals`, `state-ops.js:1340`). Tenant-Achse inert: 0 `tenant_budget`-Zeilen, und `DEFAULT_TENANT_BUDGET_CENTS`(Code-Fallback 1000) > `maxBudgetCents`(800) koennte ohnehin nie binden. | **kritisch** | P2a, P3, P6 |
| **D4** | Anzeige mischt Achsen: `api-read.js:32` `costEur` = TENANT-Verbrauch, `:33` `maxBudgetEur` = GLOBALER Cap. "3,50 von 8,00" sieht gesund aus, waehrend global 7,79 blockieren. | hoch | P5a, P5b |
| **D5** | Auslandsziele: 300 ct/min * 3 min = 900 Cent Reserve > 800 Cap -> JEDER Outbound ausserhalb +49/+33/+44 ist strukturell unmoeglich, unabhaengig vom Verbrauch. | hoch | P3 (WARN), P5a (Diagnose) |
| **D6** | Kein Boot-Guard fuer `CLAUDE_MODEL`/`PRECALL_BRIEFING_MODEL` gegen `modelPricesUsd` (`boot-guard.js` kennt nur `fakeOriginateBootBlocked` + `meterMappingGaps`). Eine datierte Snapshot-ID bucht still zur teuersten Rate. | mittel | P3 (WARN) |
| **D7** | Kein `Number.isFinite`-Guard auf `costCents`. `metering.js:45` `if (minutes <= 0) return` laesst NaN durch (`NaN <= 0 === false`). Auf pg ueberlebt NaN (NUMERIC 'NaN') und macht BEIDE Geld-Gates fail-OPEN (`NaN >= 800 === false`). Budget-Guard waere still blind. | **kritisch** (latent) | P1 |
| **D8** | `globalUsageTotals` iteriert bei JEDEM `place_call` synchron unter `store.withStoreLock` ueber ALLE Tenant-Buckets. O(Tenants) pro Anrufversuch. | niedrig | P8b (optional) |
| **D9** | 28 Tenants, 22 davon ohne einen einzigen Call (Nummern-/Tenant-Vermehrung). | mittel | **NICHT in diesem Plan** (s. Abschnitt 10) |

---

## 4. Begriffsmodell

Heute sind vier Achsen zu zwei verschmolzen. Nach dem Umbau heissen sie getrennt und
binden getrennt.

### 4.1 SPEND-MONAT (heute nicht existent — die Wurzel)

Kalendermonat in UTC, tenant-unabhaengig, immer definiert. Materialisiert als
`spendMonthKey` (`'YYYY-MM'`) + `spendMonthCostCents` (GANZZAHL Cents, G26) **neben** dem
unveraenderten `costCents`.

**Namenswahl (bindend):** der Begriff "Periode" ist im Repo bereits vergeben —
`src/billing/period.js` besitzt ihn als **Stripe-Abrechnungsperiode**
(`periodStartFromEnd`, `resolvePeriodStartIso`, Spalte `stripe_current_period_start`,
Aufruf `outbound-gates.js:221`). Die neue Kalendermonat-Achse heisst deshalb durchgaengig
`spendMonth*` / `spend_month_*` und das Flag `BUDGET_MONTH_ENABLED`. Der Modul-Kommentar
in `state-ops.js` grenzt sie ausdruecklich gegen `billing/period.js` ab.

**Bewusst NICHT der Stripe-Anker:** `planMinutesExceeded` (`state-ops.js:1556ff`) ist ohne
Anker fail-closed. 1:1 kopiert wuerde das den Owner (kein Abo) und jeden pre-Payment-Tenant
dauerhaft sperren — das exakte Gegenteil des P0-Ziels.

**Der Rollover ist eine REINE Leseprojektion** `spendMonthUsageCents(bucket, nowIso)` —
keine Mutation, kein Cron, kein preDeploy (Render Free Tier hat weder Shell noch Jobs).
Grund am Code: `usageFor` (`state-ops.js:1321-1323`) legt den Bucket schon beim LESEN per
`||=` an; ein Rollover an der Lesekante waere ein ungespeicherter Schreibeffekt mitten im
Gate-Pfad, der bei jedem `/api/state`-Poll feuert.

### 4.2 TENANT-MONATSDECKE (heute inert)

Was EIN Nutzer pro Spend-Monat verbrauchen darf. Quelle ist `effectiveCapCents`
(`state-ops.js:1439-1442`). Heute faellt sie ohne `tenant_budget`-Zeile auf den globalen
Cap zurueck — genau das macht den Plattform-Cap zum geteilten Topf und die Tenant-Achse
fuer alle 28 Tenants wirkungslos. Kuenftig faellt sie auf
`config.billing.defaultTenantBudgetCents`, **sofern dieser > 0 ist** (s. P2a, 0-Sentinel).
Leser: `budgetExceeded`, `reserveExceedsBudget`.

### 4.3 PLATTFORM-NOTAUS (heute doppelt belegt)

Betreiber-Risikogrenze, NIE ein Nutzer-Kontingent. Quelle `globalCapCents` aus
`maxBudgetCents` (`config.js:133`, gelesen ueber `defaults.js:153-161`). Leser:
`globalBudgetExceeded` (`state-ops.js:1591`), `globalReserveExceedsBudget` (`:1617`).
Bleibt fail-closed und Schnittmenge mit 4.2 — wird nie entfernt, nur neu dimensioniert und
periodisiert. Der interne Config-Key wird zu `platformSpendCapCents` umbenannt (P2b); der
**ENV-Name `MAX_BUDGET_EUR` bleibt unangetastet** (der Live-Dienst ist Dashboard-managed,
`render.yaml:236` ist nur Doku — eine Env-Umbenennung waere eine Live-Config-Migration
ohne Shell).

### 4.4 MINUTEN-ACHSE (unberuehrt)

Stripe-Abrechnungsperiode, `planMinutesExceeded`, eigenes Gate `minutes` in
`outbound-gates.js`. Kundenversprechen, nicht Kostenschutz. Wird in dieser Kette **nicht**
angefasst.

### 4.5 Quer dazu (unveraendert)

- **RESERVE-LEDGER** (`s.reservations`, strukturell ephemer, nie persistiert) haelt
  In-Flight-Worst-Case-Kosten und wird von `reserveExceedsBudget` /
  `globalReserveExceedsBudget` mitgerechnet.
- **`usage_event`** bleibt der append-only Abrechnungsnachweis und wird **NICHT**
  Gate-Quelle (rundet pro Event, ist nur bei `PAYMENT_ENABLED` vollstaendig, und ein
  wachsendes `SUM()` synchron unter `withStoreLock` verschaerft D8).

### 4.6 In einem Satz

Pro Anrufversuch gilt die **Schnittmenge aus Tenant-Monatsdecke und Plattform-Notaus**,
beide gemessen im Spend-Monat-Fenster, beide reserve-bewusst nur im letzten Gate
`reserve_budget`. `budgetExceeded` bleibt **settled-only** — es wird mitten im Gespraech
gelesen (`telnyx-llm-shim.js:406` legt bei `true` real auf) und auf dem kostenfreien
Inbound-Pfad (`voice.js:242`); reserve-bewusst gemacht wuerde ein Call sich an seiner
EIGENEN Reserve selbst beenden und Inbound wegen fremder Outbound-Reserven abgewiesen.

---

## 5. P0 — Sofortmassnahme (rein ENV, kein Code, kein Deploy)

### Handgriff

Im **Render-Dashboard des Live-Dienstes** `MAX_BUDGET_EUR` von `8` auf `12` setzen.
`render.yaml:236` ist nur Doku (Live-Service ist Dashboard-managed) und wird im ersten
Phasen-Commit (P1) zusammen mit `.env.example:6` nachgezogen.

### Rechnung

Global settled 779 Cent + Reserve fuer ein +49-Ziel (20 ct/min * ceil(180/60) = 60) = 839
< 1200 -> `globalReserveExceedsBudget` schweigt, der Owner waehlt sofort wieder.
Geteilte Kopffreiheit bis zur naechsten Verriegelung: **421 Cent**, also rund 10
Inlandsgespraeche (die Reserve wird bei Settlement freigegeben, der Ist-Abzug liegt
darunter).

Bewusst **nicht** 50 oder 60 EUR: bis P2a bindet die Tenant-Achse nicht
(`effectiveCapCents`, `state-ops.js:1439-1442`, faellt ohne `tenant_budget`-Zeile weiter
auf den globalen Cap). Ein groesserer Cap waere in diesem Fenster ein groesserer geteilter
Topf ohne zweite Achse und ohne Fruehwarnung.

### Regel-1-Begruendung

Kein Gate wird entfernt, aufgeweicht oder per Default umgangen. `budgetExceeded`,
`reserveExceedsBudget`, `globalBudgetExceeded`, `globalReserveExceedsBudget` und
`tryReserveOutboundBudget` bleiben unveraendert fail-closed und bleiben Schnittmenge. Es
aendert sich ausschliesslich die DIMENSION einer Konstante, die wegen D1 nie ein
Monatsbudget war, sondern ein Lebenszeit-Deckel von rund 40 Gespraechsminuten — die
Korrektur einer Fehl-Dimensionierung, keine Aufhebung einer Sicherung.

### Ehrliche Bilanz (korrigiert)

> **Korrektur gegenueber der ersten Planfassung:** Dort stand, mit 1200 >
> `DEFAULT_TENANT_BUDGET_CENTS`=1000 bekomme "jeder ab jetzt onboardende Tenant erstmals
> eine bindende eigene Decke". **Das ist falsch.** `seedTenantDefaultBudget`
> (`state-ops.js:731-733`) legt bei Default 0 keine Zeile an, und dass ueber 28 Tenants
> keine einzige `tenant_budget`-Zeile entstanden ist, ist ein starkes Indiz, dass der
> Live-Wert von `DEFAULT_TENANT_BUDGET_CENTS` **0** ist (`api-onboard.js:166` reicht ihn
> bei JEDEM Onboarding an `registerTenant`; bei unsetzter Env haette der `numEnv`-Fallback
> 1000 gegriffen und es gaebe Zeilen). Ausserdem wuerde eine Zeile mit
> `hardCapCents=1000` unter einem Plattform-Cap von 1200 den Topf nicht aufteilen, sondern
> nur eine zweite Obergrenze knapp darunter setzen.

**P0 ist damit eine unkompensierte Lockerung um 400 Cent geteilte Exposition**, ohne zweite
Achse und ohne Fruehwarnung, befristet bis P2a/P6. Genau so — datiert und befristet — in
`PLAN-SECURITY.md` eintragen. Wer eine echte Kompensation will, nimmt den Owner-Handgriff
aus Abschnitt 8 (Frage 2, Option 4): `tenant_budget`-Zeilen fuer die 6 aktiven Tenants von
Hand, **ueber `setTenantBudget` im Prozess, nie ueber SQL**.

### Betriebs-Auflagen

- **In einem CALL-FREIEN Moment ausloesen**: die Env-Aenderung startet den Web-Prozess neu
  (`config.js:133` liest beim Modul-Import), laufende Gespraeche brechen ab.
- **AUSDRUECKLICH VERBOTEN als Abkuerzung**: ein `UPDATE usage SET cost_eur=...` gegen die
  externe `DATABASE_URL`. Der laufende Prozess haelt den In-Memory-Spiegel und ueberschreibt
  den Effekt beim naechsten Flush lautlos — `flushUsage` (`src/store/pg.js:1055-1065`)
  schreibt `cost_eur` autoritativ aus `usage.costCents`. Der Operator glaubt, es sei
  erledigt, und es ist es nicht.
- **Dasselbe gilt fuer JEDEN externen Schreiber auf `tenant_budget`**: unter
  `FORCE ROW LEVEL SECURITY` ohne gesetzte `app.current_tenant`-GUC trifft er still 0
  Zeilen UND meldet keinen Fehler.
- **P0 ist ein gekaufter Aufschub von Wochen, kein Fix**: der Zaehler waechst weiter
  monoton und verriegelt bei 1200 erneut.

---

## 6. Phasen

Notation: `datei:zeile` bezieht sich auf `master` @ `6522b60`.
Jede Phase braucht einen Test, der **vor** dem Fix rot ist (Repo-Regel).

---

### P1 — NaN-Riegel: Geld-Schreib-, Lese- und Hydrierungskante fail-closed

**Behebt:** D7. **Aufwand:** S. **Abhaengig:** —

#### Ziel

Ein nicht-endlicher oder negativer Geldwert darf weder in einen Bucket gelangen noch ein
Gate blind machen.

#### Kern

`voiceMinutesOf` (`metering.js:17-20`) liefert bei kaputtem `answeredAt`/`endedAt` NaN
(`new Date('kaputt')` -> NaN, `Math.ceil(NaN)` -> NaN). Beide Aufrufer
(`recordVoiceMinuteMeter` `:28`, `reconcileOutboundVoiceBudget` `:46`) lassen es durch,
weil `minutes <= 0` bei NaN `false` ist, und `addVoiceUsageCostCents`
(`state-ops.js:1429-1433`) schreibt es ungeprueft in den Bucket. Auf pg ueberlebt es
(NUMERIC `'NaN'` -> `rowToUsage` `pg.js:889-890` `Math.round(Number(r.cost_eur)*100)` ->
NaN) und macht BEIDE Geld-Gates fail-OPEN (`NaN >= cap` ist `false`).

Vier Kanten, **eine** benannte Invariante:

1. **Wurzel in `voiceMinutesOf`** (`metering.js:17-20`): ein nicht-endliches Ergebnis wird
   dort auf `0` normalisiert. Damit bleiben **beide** bestehenden `minutes <= 0`-Pruefungen
   byte-identisch und es entsteht keine zweite Kopie derselben Pruefung.
2. **Schreibkante**: `addVoiceUsageCostCents` (`state-ops.js:1429-1433`) und `trackUsage`
   (`:1411-1422`) verwerfen nicht-buchbare Betraege und loggen laut (secret-frei).
3. **Lesekante**: `budgetExceeded` (`:1450`) und `globalBudgetExceeded` (`:1591`)
   behandeln einen nicht-endlichen Verbrauch als `exceeded = true`.
4. **Hydrierungskante**: `rowToUsage` (`pg.js:889-890`) normalisiert einen nicht-endlichen
   Wert auf `0` **mit lautem Log**. Ohne diese Kante ist ein bereits vergifteter Bestand
   bei JEDEM Boot wieder da — sie ist die einzige, die heilt.

**EINE Quelle fuer die Invariante (G5, verbindlich):** es gibt heute keine benannte
Quelle — `Number.isFinite` steht ad hoc an rund zehn Stellen (u.a.
`state-ops.js:1562`, `outbound-gates.js:121`, `sms-summary.js:46`) und `!(x >= 0)` genau
einmal in `tryReserveOutboundBudget` (`state-ops.js:1631`). Fuenf weitere Inline-Kopien
waeren exakt die Invariante-per-Konvention-Klasse, an der die naechste vergessene
Schreibstelle fail-open geht — also dieselbe D7-Klasse, die diese Phase behebt. Deshalb:
eine exportierte reine Funktion `isBookableCents(x)` in `src/store/defaults.js` (neben
`CENTS_PER_EUR` / `MICRO_CENTS_PER_CENT`) als EINZIGE Quelle; **auch** das bestehende
`!(x >= 0)` in `tryReserveOutboundBudget` wird darauf umgestellt.

**Der Guard prueft AUSSCHLIESSLICH auf Nicht-Endlichkeit/Negativitaet, nie auf Kleinheit.**
`costMicroCentsRem` und der Sub-Cent-Uebertrag bleiben unangetastet (P1-Safety-BLOCKER:
Per-Inkrement-Runden wuerde Sub-Cent-Turns auf 0 fallen lassen und das Gate blind machen).

**Eigener Ablehnungsgrund (korrigiert):** die Lesekanten-Verschaerfung macht den Dienst bei
NaN vollstaendig stumm, ohne unterscheidbares Signal — `budgetExceeded` hat drei
Nicht-Gate-Leser (`telnyx-llm-shim.js:406` legt mid-call auf, `voice.js:242` weist
kostenlosen Inbound ab, `outbound-gates.js:485`). Fail-closed ist dort richtig, aber
ununterscheidbar von "Budget wirklich erschoepft" — der Operator wiederholt sonst exakt die
Fehldiagnose dieses Vorfalls. Die Lesekante bekommt deshalb einen **eigenen
Audit-/Log-Grund `grund=usage_korrupt`**, nicht nur einen Kommentar.

**Scope-Praezisierung `trackUsage` (korrigiert):** `trackUsage` inkrementiert
`inputTokens`/`outputTokens` (`state-ops.js:1412-1414`) VOR der Kostenrechnung. Der Guard
sitzt **am Funktionseingang** und deckt `tokens.inputTokens`, `tokens.outputTokens` UND
den Mikro-Cent-Inkrement ab. Rueckgabewert bleibt der Bucket.

**Env-Doku (Projektregel):** in dieser Phase werden `.env.example:6` und `render.yaml:236`
auf den P0-Wert `12` nachgezogen (Env zentral in `config.js` UND `.env.example` UND
`render.yaml`).

#### Betroffene Dateien

`src/billing/metering.js`, `src/store/state-ops.js`, `src/store/defaults.js`,
`src/store/pg.js`, `.env.example`, `render.yaml`,
`test/budget-nan-fail-closed.test.js` (neu), bestehende Mikro-Cent-Akkumulations-Testdatei.

#### Akzeptanzkriterium

- Ein Call mit unbrauchbarem `answeredAt`/`endedAt` laesst `usage.costCents` bit-identisch.
- Ein per Hand auf NaN gesetzter Bucket laesst `budgetExceeded` UND `globalBudgetExceeded`
  `true` liefern und erzeugt einen Log-/Audit-Eintrag mit `grund=usage_korrupt`.
- Ein NaN/Infinity/negativer Betrag an `addVoiceUsageCostCents` oder `trackUsage` laesst
  `inputTokens`, `outputTokens`, `costCents` und `costMicroCentsRem` bit-identisch;
  Rueckgabe bleibt der Bucket.
- Eine pg-Zeile mit `cost_eur = 'NaN'` hydriert zu `costCents = 0` mit Log.
- `isBookableCents` ist die einzige Geld-Gueltigkeitsquelle: **kein zweites
  `!(x>=0)`/`isFinite`-Idiom auf einer Geld-Kante** (Test auf die geteilte Quelle).
- Die Sub-Cent-Akkumulation (Haiku-Turn << 0,5 Cent) buchtet unveraendert in
  `costMicroCentsRem`.
- `.env.example` und `render.yaml` nennen `MAX_BUDGET_EUR=12`.
- Bestandssuite vollstaendig gruen.

#### Rot-vor-Fix-Test

Neu `test/budget-nan-fail-closed.test.js`, alle heute rot:

- (a) `reconcileOutboundVoiceBudget` mit `endedAt='kaputt'` -> `costCents` unveraendert
  (heute wandert NaN in den Bucket). **Hinweis fuer die Umsetzung:**
  `reconcileOutboundVoiceBudget` ist Closure-privat in `makeMetering` (`metering.js:13`)
  und nur ueber das Rueckgabeobjekt (`:67-72`) erreichbar — der Test muss
  `makeMetering({ store, config })` mit einem Fake-Store instanziieren.
- (b) Bucket `costCents=NaN` -> `budgetExceeded === true` (heute `false`).
- (c) Bucket `costCents=790`, Cap 800, dann `addVoiceUsageCostCents(NaN)` -> Bucket steht
  auf 790 und das Gate greift weiter bei 800 (heute Bucket NaN, Gate blind).
- (d) pg-Zeile `cost_eur='NaN'` -> `rowToUsage` liefert `costCents === 0`.

Die Mikro-Cent-Regression (200 Sub-Cent-Turns -> exakt 1 Cent) gehoert in die **bestehende**
Akkumulations-Testdatei, nicht in die neue — sie prueft ein anderes Konzept (P14).

#### Risiko

Ein zu breiter Guard (z.B. `> 0` statt Endlichkeitspruefung) verwirft legitime 0-Betraege
oder Sub-Cent-Turns und loest den P1-Safety-BLOCKER in der Gegenrichtung aus: der
KI-Kostenanteil faellt aus dem Gate. Zweitens: fail-closed an der Lesekante heisst im
Extremfall, dass ein laufender Call beendet wird — bei NaN-Verbrauch korrekt, aber es muss
im Kommentar UND im Audit-Grund stehen.

---

### P2a — Tenant-Achse bindet: Fallback auf den Tenant-Default statt auf den geteilten Topf

**Behebt:** D3. **Aufwand:** M. **Abhaengig:** P1

#### Ziel

`effectiveCapCents` faellt ohne `tenant_budget`-Zeile nicht mehr auf den geteilten
Plattform-Topf, sondern auf die Tenant-Default-Decke — **ohne** die dokumentierte
0-Semantik zu brechen.

#### Kern

`effectiveCapCents` (`state-ops.js:1439-1442`) faellt heute ohne `tenant_budget`-Zeile auf
`globalCapCents(cfg)`. Neue Regel, exakt so zu implementieren:

```
defaultTenantBudgetCents > 0 ? defaultTenantBudgetCents : globalCapCents(cfg)
```

> **BLOCKER-KORREKTUR (kritisch, drei unabhaengige Reviews):** `config.js:373-378`
> definiert ausdruecklich **"0 = kein Default-Seed (Tenant faellt auf den globalen Cap)"**
> (`numEnv` mit `min: 0` laesst 0 zu), und `seedTenantDefaultBudget`
> (`state-ops.js:731-733`) ueberspringt bei 0. Ein bedingungsloser Fallback auf
> `defaultTenantBudgetCents` wuerde bei Live-Wert 0 einen Cap von **0** liefern:
> `budgetExceeded` (`>=`) wird fuer JEDEN Tenant ohne Zeile `true`, jeder Outbound blockt,
> `voice.js:242` weist JEDEN kostenlosen INBOUND ab, und `telnyx-llm-shim.js:406` legt bei
> jedem laufenden Call auf. Das haette den Owner exakt eine Phase nach P0 erneut und
> haerter gesperrt. Zweitbeleg: `test/helpers.js:233` pinnt `DEFAULT_TENANT_BUDGET_CENTS`
> auf `"0"` — die gesamte Spawn-Suite liefe gegen einen 0-Cap.

`globalCapCents` bleibt **PARALLEL** als Schnittmenge (Regel 1) — `min(tenant, global)` ist
in keiner Konstellation schwaecher als heute.

#### Harte Vorbedingungen vor dem Deploy

1. **Live-Dashboard-Wert von `DEFAULT_TENANT_BUDGET_CENTS` lesen** (nicht `render.yaml:243`,
   nicht den Code-Fallback) und auf einen positiven Zielwert setzen. Solange er 0 ist,
   greift P2a in Prod nicht — der Fix waere ein No-Op.
2. **Abstandspruefung gegen die Live-Zahlen**: jeder Bestands-Tenant, dessen
   LEBENSZEIT-Verbrauch ueber dem Zielwert liegt, wird beim Deploy sofort geblockt. Heute
   ist der hoechste Wert 350 Cent — gegen einen Zielwert von 1000 ist der Abstand gross
   genug, das MUSS aber gegen die dann aktuellen Zahlen erneut geprueft werden.
3. **`test/helpers.js` BASE_ENV** (`:233`) von `"0"` auf den Zielwert ziehen (Lehre
   `test-base-env-drift`) — und bewusst entscheiden, dass damit die Baseline aller
   Gate-Spawn-Tests verschoben wird.

Ein `tenant_budget`-Backfill ist **NICHT** Teil dieser Phase: unter `FORCE RLS` ohne
gesetzte `app.current_tenant`-GUC trifft er still 0 Zeilen und meldet keinen Fehler —
Heilung, deren Ausbleiben man nicht bemerkt.

#### Betroffene Dateien

`src/store/state-ops.js`, `test/helpers.js`, `test/effective-cap-fallback.test.js` (neu),
`test/tenant-budget-cap.test.js`, `test/outbound-tenant-default-budget.test.js`,
`test/outbound-tenant.test.js`.

#### Akzeptanzkriterium

- `defaultTenantBudgetCents = 0` -> `effectiveCapCents === globalCapCents(cfg)` und
  `budgetExceeded === false` fuer einen unverbrauchten Tenant (**Bestandsverhalten
  erhalten**).
- `defaultTenantBudgetCents > 0` und keine `tenant_budget`-Zeile -> Tenant wird bei diesem
  Wert geblockt, nicht erst am Plattform-Cap.
- Ein Tenant MIT Zeile behaelt exakt seinen `hardCapCents` (Praezedenz unveraendert).
- Der Verbrauch eines Tenants kann keinen anderen mehr unter dessen eigener Decke
  blockieren, solange die Summe unter dem Plattform-Cap bleibt.
- Bestandssuite gruen (nach BASE_ENV-Nachzug).

#### Rot-vor-Fix-Test

Neu `test/effective-cap-fallback.test.js`:

- **0-Sentinel (muss gruen bleiben, Regressionsschutz):** `defaultTenantBudgetCents=0`,
  `platformSpendCap=1200` -> `effectiveCapCents === 1200`, `budgetExceeded === false`.
- **Fallback (heute rot):** kein `tenantBudgets`-Eintrag, `platformSpendCap=1200`,
  `defaultTenantBudgetCents=1000` -> `effectiveCapCents === 1000` (heute 1200).
- **Cross-Tenant (der eigentliche Prod-Defekt, heute rot):** Tenant A bei 900, Tenant B bei
  0, Plattform-Summe 900 -> `budgetExceeded(B) === false` und
  `reserveExceedsBudget(B, 60) === false` (heute zieht B am geteilten Topf mit).

#### Risiko

Deploy-Moment: siehe Vorbedingung 2. Zweitens verschiebt der BASE_ENV-Nachzug die Baseline
aller Gate-Spawn-Tests — das ist beabsichtigt, muss aber im Commit begruendet stehen.

---

### P2b — Rename `maxBudgetCents` -> `platformSpendCapCents` (rein mechanisch)

**Behebt:** D3 (Benennung). **Aufwand:** M. **Abhaengig:** P2a

#### Ziel

Ein Wert hoert auf, gleichzeitig Nutzer-Kontingent und Betreiber-Notaus zu bedeuten.

> **BLOCKER-KORREKTUR:** Der Rename war urspruenglich in P2 gebuendelt. Ein Diff, der eine
> Gate-Semantik aendert UND einen repo-weiten Rename traegt, ist weder reviewbar noch
> bisect-bar. Ausserdem war die Dateiliste massiv unter-skaliert: **18 Dateien** enthalten
> `maxBudgetCents`, davon 13 Testdateien.

#### Kern

`maxBudgetCents` (`config.js:133`) -> `platformSpendCapCents`, inklusive
`CONFIG_NAMESPACES.billing` (`config.js:863`) und der Leseschicht `globalCapEur` /
`globalCapCents` (`defaults.js:149-161` — der einzige Zugriffspfad). `MONEY_CONFIG_KEYS`
in `test/config-money-manifest.test.js:19` wird im selben Commit umgetragen; der
Manifest-Guard ("kein gelistetes Feld wurde stillschweigend entfernt") ist der beabsichtigte
Reibungspunkt, kein Hindernis.

**Der ENV-Name `MAX_BUDGET_EUR` bleibt unveraendert** — die Doppeldeutigkeit sitzt in der
Fallback-Zeile, nicht im Env-Namen, und eine Env-Umbenennung auf einem Dashboard-managed
Dienst ohne Shell erzeugt zwei Quellen fuer einen Cap.

#### Betroffene Dateien (vollstaendig, 18)

`src/config.js`, `src/store/defaults.js`, `src/store/state-ops.js`, `src/db/schema.sql`
(Kommentar `:347-351`), `test/config-money-manifest.test.js`, `test/config-namespaces.test.js`,
`test/config-shape.test.js`, `test/config-failclosed.test.js`, `test/_prices.js`,
`test/api-read-parity.test.js`, `test/outbound-budget-concurrency.test.js`,
`test/outbound-gates-order.test.js`, `test/outbound-tenant.test.js`,
`test/outbound-tenant-default-budget.test.js`, `test/reservation-ledger.test.js`,
`test/reservation-json-ephemeral.test.js`, `test/outbound-reserve-reconcile.test.js`,
`test/tenant-budget-cap.test.js`.
Zusaetzlich Kommentar-Vorkommen in `state-ops.js:1436`, `:1444`, `config.js:131-133`,
`defaults.js:158`.

#### Akzeptanzkriterium

- `grep -rn 'maxBudgetCents' src test` liefert **0 Treffer** (inkl. Kommentare und
  `schema.sql`).
- `MONEY_CONFIG_KEYS` nennt `platformSpendCapCents`.
- Kein Verhaltensunterschied: alle Gate-Entscheidungen byte-identisch.

#### Rot-vor-Fix-Test

Kein neuer Test — das Money-Manifest (`test/config-money-manifest.test.js`) und
`test/config-namespaces.test.js` sind der Gate: sie werden beim Rename rot und muessen im
selben Commit mitgezogen werden.

#### Risiko

Der Rename beruehrt den `guardedConfig`-Proxy: eine Property ohne Eintrag in
`CONFIG_NAMESPACES` **wirft bei JEDEM Zugriff** (`config.js:836-840`), potenziell im Boot
selbst. Der Namespace-Eintrag muss im selben Commit stehen.

---

### P3 — Boot-Guards fuer Konfig-Kohaerenz und Modellpreise (exit nur bei Schutzverlust)

**Behebt:** D5, D6 (und praeventiv D3). **Aufwand:** M. **Abhaengig:** **P0** (s.u.)

#### Ziel

Eine Konfiguration, die den Kostenschutz **schwaecht**, darf nicht booten. Eine, die nur
**ueber-blockt** oder **ueber-bepreist**, bootet und warnt laut.

#### Entscheidungsregel (bindend)

> `exit(1)` **nur**, wenn die Verletzung den Kostenschutz SCHWAECHT.
> Lautes WARN + Audit, wenn sie nur ueber-blockt oder ueber-bepreist.

Ein Boot-Refusal auf Render Free Tier ist nur ueber Dashboard-Env + Redeploy heilbar,
waehrend die Telefonie steht. Kein neues Gate darf den Dienst wegen eines Ueber-Blockers
stumm schalten.

#### Kern

Zwei **reine, arg-injizierte** Funktionen in `src/boot-guard.js` nach dem exakten Muster
von `fakeOriginateBootBlocked` (`:30`) / `meterMappingGaps` (`:39`) — config-frei, ohne
Seiteneffekt, testbar ohne Prozess-Crash — verdrahtet in `assertBootGates`
(`src/boot.js:31-79`), zwingend **VOR** `rearmActiveCallTimers` (INV-5,
F10-ORD-Zombie-Call-Fenster).

**(1) `spendCapCoherence({ tenantDefaultCents, platformCapCents, maxTariffCents, maxCallDurationS })`**

| Klausel | Bedingung | Verdikt | Begruendung |
| --- | --- | --- | --- |
| **A** | `tenantDefaultCents > 0 && tenantDefaultCents >= platformCapCents` | **FATAL, exit(1)** | Tenant-Achse ist inert -> geteilter Topf -> **weniger Schutz**. Exakt die Konstellation 1000 >= 800, die den Vorfall ermoeglichte. |
| **A0** | `tenantDefaultCents === 0` | **WARN** | Dokumentierter Sentinel "kein Default-Seed". Tenant-Achse ist damit ebenfalls inert — aber es ist das Bestandsverhalten, und ein Boot-Refusal wuerde die heutige Suite (`helpers.js:233`) und potenziell den Live-Dienst bricken. |
| **B** | `maxTariffCents * ceil(maxCallDurationS / 60) > tenantDefaultCents` (nur wenn Default > 0) | **WARN + Audit** | D5: blockt nur zu viel. Nennt die bei dieser Decke noch bezahlbare `max_duration_s`. |

> **BLOCKER-KORREKTUREN:**
> - Die Phase trug urspruenglich `abhaengig: []`. Klausel A haette gegen die **heutige**
>   Live-Konfiguration gefeuert (`DEFAULT_TENANT_BUDGET_CENTS`=1000 gegen
>   `MAX_BUDGET_EUR`=8 -> 800): `process.exit(1)` in `assertBootGates`, kein `app.listen`,
>   kein `/voice`, kein `/mcp`, kein `/healthz`. **P3 haengt deshalb an P0** und darf erst
>   nach verifiziertem Dashboard-Wert deployen.
> - Klausel A prueft `>=`, nicht `>`: der echte Schutzverlust ist "Tenant-Achse inert",
>   und bei Gleichstand bindet sie ebenfalls nie.
> - **Bewusste Abweichung von einer Review-Empfehlung:** eine Review wollte `Default 0`
>   ebenfalls **fatal** machen ("das ist genau der Fall, der den Vorfall ermoeglichte").
>   Dem folge ich **nicht**. 0 ist die dokumentierte, seit Bestand gueltige Semantik
>   (`config.js:373-375`) und ist im BASE_ENV der gesamten Suite gepinnt; ein Boot-Refusal
>   darauf tauscht ein Kostenproblem gegen einen Totalausfall der Telefonie auf einem Host
>   ohne Shell — genau das, was die Entscheidungsregel verbietet. Der Fall wird laut
>   gewarnt (Klausel A0) und ist ueber die P2a-Vorbedingung ohnehin ein bewusster
>   Owner-Handgriff.

**(2) `unpricedModels(modelIds, modelPricesUsd)`** gegen `config.llm.modelPricesUsd`
(`config.js:790-793`) -> **WARN**, weil `priceForModel` fail-closed zur teuersten Rate
bucht: die Folge ist bis zu 3x Ueber-Bepreisung, nie Ueber-Ausgabe. Geprueft werden
`CLAUDE_MODEL` und `PRECALL_BRIEFING_MODEL`.

**Pflicht-Details fuer die Umsetzung:**

- `unpricedModels` darf `modelPricesUsd` **ausschliesslich ueber `Object.hasOwn`** befragen.
  Ein Roh-Index wirft an der `guardedConfig`-get-Trap (`config.js:836-840`) — ausgerechnet
  der Boot-Guard wuerde den Boot killen. Das Muster samt Begruendung steht bereits in
  `state-ops.js:1382-1387`.
- `modelPricesUsd` bleibt **UNGEFREEZED** (guardedConfig-Proxy-Invariante).
- Quellen fuer die Argumente **namentlich gepinnt**: `maxTariffCents` =
  `config.billing.voiceTariffDefaultCents` (`config.js:367`, Fallback 300);
  `maxCallDurationS` = `MAX_CALL_DURATION_CAP_S` (die harte Obergrenze aus
  `resolveMaxDurationS`, `outbound-gates.js:119-125`), **nicht** die Default-Dauer — der
  Guard rechnet den Worst Case.
- `audit` hat die Signatur `(action, req, details)` (`util.js:48`) und faellt ohne `req`
  auf `ip=system` zurueck; `boot.js` importiert `util.js` heute nicht. Aufrufform ist
  **`audit(event, null, detail)`**.
- **Keine neuen Env-Variablen.**

#### Betroffene Dateien

`src/boot-guard.js`, `src/boot.js`, `test/spend-cap-coherence.test.js` (neu),
`test/boot-guard.test.js`, `test/boot-failclosed.test.js`.

#### Akzeptanzkriterium

- Start mit `DEFAULT_TENANT_BUDGET_CENTS` >= `MAX_BUDGET_EUR`*100 (und Default > 0) endet
  mit `console.error` + `exit(1)` und nennt **beide** Zahlen.
- Start mit `DEFAULT_TENANT_BUDGET_CENTS=0` startet DURCH und warnt.
- Start mit Worst-Case-Reserve > Tenant-Default startet DURCH, schreibt genau eine
  WARN-Zeile plus einen Audit-Eintrag, der die noch bezahlbare `max_duration_s` nennt.
- Start mit einer datierten Modell-Snapshot-ID startet durch und warnt.
- **Start mit den HEUTIGEN Live-Werten laeuft durch** (Spawn-Test, vor dem Merge).
- Start mit den in `test/helpers.js` gepinnten Werten (`MAX_BUDGET_EUR="8"` `:41`,
  `DEFAULT_TENANT_BUDGET_CENTS="0"` `:233`, Tarife `"0"`) ist log-identisch zu heute bis
  auf die A0-WARN-Zeile; der WARN-Fall aus Klausel B braucht einen kuenstlichen Env-Fall im
  Test.
- Beide Guard-Funktionen importieren `config` **nicht**.

#### Rot-vor-Fix-Test

Neu `test/spend-cap-coherence.test.js` (die Funktionen existieren nicht, der Import wirft):

- `spendCapCoherence({ tenantDefaultCents: 1000, platformCapCents: 800, ... })` -> genau
  ein FATALER Befund.
- `spendCapCoherence({ tenantDefaultCents: 0, platformCapCents: 800, ... })` -> **kein**
  fataler Befund, ein WARN.
- `spendCapCoherence({ tenantDefaultCents: 800, platformCapCents: 1200, maxTariffCents: 300, maxCallDurationS: 180 })`
  -> genau ein WARN, kein fataler.
- `unpricedModels(['claude-haiku-4-5', 'claude-opus-4-5-20260101'], prices)` -> exakt die
  datierte ID.
- Spawn-Test: die inkohaerente Konstellation liefert Exit-Code != 0 (heute bootet sie
  gruen); die Live-Konstellation liefert Exit-Code 0.

#### Risiko

Ein Boot-Refusal ist auf Free Tier nur ueber Dashboard-Env + Redeploy heilbar. Deshalb ist
genau EINE Klausel fatal, und ihre Verletzung ist nach P0 nicht gegeben (1000 < 1200).
Zweitrangig: WARN-Zeilen sind wertlos, wenn sie niemand liest — der Kanal ist eine
Owner-Entscheidung (Abschnitt 8, Frage 5), keine des Implementierers.

---

### P4 — Spend-Monat-Achse additiv einfuehren (inert, kein Gate liest sie)

**Behebt:** D1 (Fundament). **Aufwand:** L. **Abhaengig:** P1
**HARTE VORBEDINGUNG: die hermes-db-Frage muss geloest sein** (s.u.)

#### Ziel

Eine zweite, periodische Verbrauchsachse existiert und wird persistiert — **ohne** dass
sich irgendein Gate-Verhalten aendert.

#### Harte Vorbedingung

`hermes-db` (Render Free Tier) laeuft am **2026-07-24** ab. P4 fuehrt eine
Schema-Migration und neue Persistenz-Felder ein. **P0-P3 sind schema-frei und koennen
sofort laufen; P4 erst nach Abloesung/Verlaengerung der DB.** Positiv verifiziert:
`migrate()` laeuft bei Connect (`pg.js:57`), also kein preDeploy und keine Shell noetig —
Free-Tier-tauglich.

#### Kern

`emptyUsage` (`src/store/defaults.js:310-312`) bekommt:

- `spendMonthKey` — `'YYYY-MM'`, UTC
- `spendMonthCostCents` — **GANZZAHL Cents** (G26), bewusst NICHT die Alt-Konvention
  `cost_eur NUMERIC`

Beide Schreibstellen (`trackUsage` `state-ops.js:1411-1422` und `addVoiceUsageCostCents`
`:1429-1433`) inkrementieren `spendMonthCostCents` **PARALLEL** zum unveraenderten
`costCents` und stempeln den Schluessel. Liegt der gespeicherte Schluessel in einem
aelteren Monat, startet `spendMonthCostCents` bei diesem Schreibvorgang bei 0.

Dazu die **reine Leseprojektion** `spendMonthUsageCents(bucket, nowIso)`, die 0 liefert,
wenn der Schluessel aelter als der laufende Monat ist. Kein Reset-Job, keine Mutation im
Lesepfad.

**MONOTONIE-RIEGEL (verbindlich):** der Schluessel wird nie rueckwaerts gesetzt, und ein
Schluessel in der **ZUKUNFT** (Clock-Skew, falsche Container-Uhr) liest NICHT als frischer
Monat und faellt nicht auf 0. Ohne diesen Riegel ist jedes Perioden-Modell ueber eine
Uhr-Anomalie beliebig oft ruecksetzbar — also der Cap abschaltbar. Die
Schluessel-Vergleichsregel lebt als **EIN Praedikat mit zwei Aufrufern** (Projektion +
Schreiber), nie dupliziert. `nowIso` kommt vom Aufrufer (`state-ops.js` bleibt zeit-frei,
Muster `voiceMinutesUsedSince`).

**Mikro-Cent-Regel (BLOCKER-KORREKTUR, verbindlich):** `costMicroCentsRem`
(`state-ops.js:1411-1422`) bleibt **LEBENSZEIT-skaliert und wird beim Monatswechsel NIE
zurueckgesetzt**. Nur der Cent-Zaehler ist periodisch. Wuerde der Sub-Cent-Rest mit
zurueckgesetzt, faellt bei jedem Monatswechsel der angesparte Betrag auf 0 — nach P7
(Gates lesen nur noch die Monatsachse) waere das der wiederkehrende, strukturelle Verlust
des KI-Kostenanteils, den der P1-Safety-BLOCKER ausdruecklich verbietet.

**Persistenz-Entscheidung (BLOCKER-KORREKTUR):** `costMicroCentsRem` wird heute bewusst
NICHT persistiert (`pg.js:889`, Kommentar "ephemer, Boot startet bei 0").
`spendMonthCostCents` **wird** persistiert. Damit driftet die Monats-Achse ueber Neustarts
minimal anders als `costCents` — die Drift ist **< 1 Cent pro Neustart** und wird bewusst
akzeptiert; sie steht im Schema-Kommentar. Der Grund: ein Anker nur im Spiegel wuerde bei
jedem Boot neu gestempelt und der Cap nach P7 faktisch wirkungslos.

**Migration** (additiv, idempotent) in `src/db/schema.sql:243-249`:

```
ALTER TABLE usage ADD COLUMN IF NOT EXISTS spend_month_key TEXT;
ALTER TABLE usage ADD COLUMN IF NOT EXISTS spend_month_cost_cents BIGINT NOT NULL DEFAULT 0;
```

Rundlauf in `rowToUsage` / `flushUsage` (`pg.js:885`, `:1055`) und im json-Serializer.
**Schema-Kommentar Pflicht:** `spend_month_cost_cents BIGINT` neben `cost_eur NUMERIC`
bedeutet zwei Geldkodierungen in EINER Tabelle. Die Wahl ist richtig (G26), muss aber
kommentiert sein, sonst leitet der naechste Leser die Einheit aus der Nachbarspalte ab.

**KEIN Gate liest die neuen Felder** — der Deploy ist verhaltens-identisch.

#### Betroffene Dateien

`src/store/defaults.js`, `src/store/state-ops.js`, `src/db/schema.sql`, `src/store/pg.js`,
`src/store/json.js`, `test/usage-spend-month-axis.test.js` (neu),
`test/store-pg-tenant-budget.test.js`.

#### Akzeptanzkriterium

- Alle Bestands-Gate- und Store-Tests unveraendert gruen (Gate-Entscheidungen
  byte-identisch).
- `costCents` waechst weiter exakt wie heute (Lebenszeit-Forensik erhalten).
- Rundlauf ueber **beide** Backends traegt `spendMonthKey` / `spendMonthCostCents`
  verlustfrei.
- Bestandszeilen ohne Wert hydrieren zu `null` / `0` ohne Fehler.
- Ein zweiter `migrate()`-Lauf aendert nichts.
- `costMicroCentsRem` ueberlebt einen Monatswechsel unveraendert.

#### Rot-vor-Fix-Test

Neu `test/usage-spend-month-axis.test.js`, alle heute rot (Felder/Funktion existieren
nicht):

- (a) Bucket `spendMonthKey='2026-06'`, `spendMonthCostCents=500`, jetzt Juli ->
  `trackUsage` mit 60 Cent ergibt `spendMonthCostCents === 60` UND `costCents === alt+60`.
- (b) `spendMonthUsageCents` liefert bei altem Schluessel 0, bei aktuellem den vollen Wert.
- (c) **Monotonie:** `nowIso` zurueck auf Juni -> `spendMonthUsageCents` liefert weiter den
  Juli-Wert, der Schluessel bleibt `'2026-07'`.
- (d) **Zukunft:** Schluessel `'2026-09'` -> liest NICHT als 0.
- (e) **Mikro-Cent ueber die Monatsgrenze:** 200 Sub-Cent-Turns, verteilt ueber einen
  Monatswechsel -> kein Cent geht verloren, `costMicroCentsRem` wird nie zurueckgesetzt.

#### Risiko

Eine dritte, kuenftige Schreibstelle, die `spendMonthCostCents` vergisst, laesst den Tenant
nach dem Flip dauerhaft als 0 lesen — **fail-open durch Vergessen**, dieselbe Klasse wie
D7. Genau dagegen bleibt `costCents` als unabhaengige Gegenprobe stehen (der Grund, warum
die Achse additiv und nicht ersetzend ist). Zweitens: der Anker ist eine
Kalender-/Zeitzonenfrage — lokal statt UTC gerechnet driftet der Rollover zwischen json-
und pg-Backend; die Ableitung darf nur an EINER Stelle leben.

---

### P5a — Achsen in Anzeige und Ablehnung trennen

**Behebt:** D2, D4, D5 (Diagnose). **Aufwand:** M. **Abhaengig:** P2a, P2b

#### Ziel

Aus `/api/state` und aus jeder 402 ist ohne Server-Log ablesbar, **welche Achse** blockt.

#### Kern

**(1) Anzeige.** `usageView` (`src/routes/api-read.js:29-34`) stellt heute TENANT-Verbrauch
(`costEur`, `:32`) neben den GLOBALEN Cap (`maxBudgetEur = globalCapEur(config.billing)`,
`:33`). "3,50 von 8,00" sieht gesund aus, waehrend global 7,79 blockieren.

> **BLOCKER-KORREKTUR:** Die erste Planfassung wollte den Schluessel `maxBudgetEur`
> **behalten und seine Bedeutung wechseln** (kuenftig Tenant-Cap), mit der Begruendung,
> untypisierte Konsumenten wuerden bei fehlendem Schluessel still `undefined` rendern. Die
> Begruendung traegt nicht: alle Konsumenten liegen im Repo und sind greppbar. Ein Geldfeld,
> dessen Achse sich lautlos aendert, ist exakt die unehrliche Benennung, die dieser Plan
> an anderer Stelle bekaempft.

Deshalb **harte Migration im selben Commit**: neuer Schluessel `tenantCapEur` (effektiver
Tenant-Cap aus `effectiveCapCents`), `maxBudgetEur` **entfaellt**. Alle vier Konsumenten
werden mitgezogen:

- `src/mcp-tools.js:214` (Projektion), `:228` (Zod `z.number()`), `:690` (Textrender
  "... EUR von max. X EUR")
- `src/ui/widgets/agent-status.html:51` (Label "Max budget (EUR)")
- `test/api-read-parity.test.js:140` (assertiert hart `body.usage.maxBudgetEur === 8`)
- `test/mcp-ui.test.js:645/664/679` (Widget-Allowlist + Zod-Schema)

Der **Plattform-Notaus verlaesst die Tenant-Projektion nicht** (Cross-Tenant-Leck).

**(2) Ablehnungstexte.** Das `budget`-Gate (`outbound-gates.js:481-494`) feuert bei
`budgetExceeded(tenant) ODER globalBudgetExceeded()` und meldet heute konstant
`Budget-Limit von ${globalCapEur(...)} EUR erreicht.` mit `grund=budget`.

> **BLOCKER-KORREKTUR:** Die erste Planfassung wollte nur die Zahl austauschen
> (globaler Cap -> Tenant-Decke). Feuert dann die GLOBALE Achse, liest der Nutzer
> "Budget-Limit von 10,00 EUR erreicht", waehrend sein eigener Verbrauch bei 3,50 liegt —
> das ist D4 in neuer Form, jetzt im Fehlertext.

Neu, **nach Achse getrennt**:

| Ausloeser | Text | Audit |
| --- | --- | --- |
| Tenant-Achse | eigene Decke **und** eigener Verbrauch (beides tenant-eigen, kein Leck) | `grund=budget_tenant` |
| Plattform-Achse | benannt, aber **ZAHLENFREI**: "Plattform-Notaus aktiv, bitte Betreiber kontaktieren." | `grund=budget_platform` |

Analog im `reserve_budget`-Gate (`:538-562`): `grund=reserve_ueber_rest` (Restbudget
vorhanden, dieser Call passt nicht) vs. `grund=reserve_erschoepft`, mit **Fehlbetrag** und
**Monatsende** im Text.

**(3) Was NICHT ausgegeben wird — BLOCKER-KORREKTUR.** Die erste Planfassung wollte in der
Ablehnung die "noch bezahlbare `max_duration_s`" nennen. **Das wird gestrichen.**
Begruendung: `resolveMaxDurationS` (`outbound-gates.js:119-125`) akzeptiert einen
unvalidierten Body-Override **ohne Untergrenze** (nur `> 0`, Cap nach oben), und
`compute_reserve` (`:528-529`) leitet die Reserve daraus ab
(`reserve = tariff * ceil(maxDur/60)`). Der Aufrufer ist ein LLM (`mcp-tools.js place_call`),
das auf eine strukturierte Fehlermeldung deterministisch mit dem genannten Wert retryt.
Aus einer harten 402 wuerde ein Tropf: jeder Retry reserviert nur noch eine Minute Tarif,
und `armReserveReleaseTimer` (`call-lifecycle.js:91-94`) gibt die Reserve ohnehin frei. Der
Rueckdruck, den die heutige konstante Ablehnung erzeugt, war das einzige Signal, das den
Vorfall sichtbar gemacht hat. **Fehlbetrag + Monatsende erfuellen das Diagnose-Ziel
vollstaendig.** Das entsprechende Akzeptanzkriterium ("ein Retry mit exakt dieser
`max_duration_s` wird nicht mehr abgelehnt") ist damit ebenfalls gestrichen — es war eine
Zusicherung auf die Umgehbarkeit.

**(4) Totband (D2) diagnostisch schliessen, nicht umsemantisieren.** Die
Vergleichsoperatoren `>=` in `budgetExceeded` (`:1450`) und `>` in `reserveExceedsBudget`
(`:1465`) bleiben **unangetastet** — sie beantworten verschiedene Fragen. Nach P5a ist das
Totband kein stummer Zustand mehr, sondern eine bezifferte Auskunft. **Keine
Praedikat-Aenderung in dieser Phase.**

#### Betroffene Dateien

`src/routes/api-read.js`, `src/telephony/outbound-gates.js`, `src/mcp-tools.js`,
`src/ui/widgets/agent-status.html`, `public/index.html`, `public/tenant.html`,
`test/api-read-parity.test.js`, `test/mcp-ui.test.js`, `test/outbound-gates-order.test.js`,
`test/deny-diagnosability.test.js` (neu), `test/api-state-usage-axis.test.js` (neu).

#### Akzeptanzkriterium

- `/api/state` liefert `tenantCapEur` (effektiver Tenant-Cap); `maxBudgetEur` existiert
  nicht mehr; `grep -rn 'maxBudgetEur' src public test` liefert 0 Treffer.
- Widget-Allowlist und Zod-Schema nennen die neue Achse.
- Eine 402 nennt **welche Achse** ausgeloest hat; Plattform-Meldungen sind zahlenfrei.
- Eine `reserve`-Ablehnung nennt Fehlbetrag und Monatsende — und **keine** ausfuehrbare
  Dauer.
- Kein Endpunkt und kein MCP-Tool gibt Plattform-Zahlen oder Werte anderer Tenants an einen
  Nicht-Admin.
- Die Gate-Reihenfolge (`test/outbound-gates-order.test.js`) bleibt in Namen und Reihenfolge
  unveraendert; `reserve_budget` bleibt LETZTES Glied.
- Explizite Entscheidung dokumentiert, ob das Widget-Label (i18n en/de/fr) mitgeaendert wird
  oder bewusst gleich bleibt.

#### Rot-vor-Fix-Test

- Neu `test/api-state-usage-axis.test.js`: Tenant-Cap 1000, Tenant-Verbrauch 350,
  Plattform-Verbrauch 779 -> `usage.tenantCapEur === 10.00` und `usage.maxBudgetEur ===
  undefined` (heute liefert `usageView` hart `globalCapEur` -> rot).
- Neu `test/deny-diagnosability.test.js`: Tenant-Achse feuert -> Text nennt eigene Decke +
  eigenen Verbrauch, Audit `grund=budget_tenant` (heute konstanter String, `grund=budget`
  -> rot). Plattform-Achse feuert -> Text ist zahlenfrei, Audit `grund=budget_platform`.
  Rest 21 Cent, Reserve 60 Cent -> Text nennt Fehlbetrag und Monatsende, Audit
  `grund=reserve_ueber_rest` (heute `grund=reserve` -> rot).

#### Risiko

Fehlertexte sind byte-genau gepinnt (`test/outbound-gates-order.test.js`) — jede
Formulierungsaenderung muss dort mitgepflegt werden, sonst rote Suite aus dem falschen
Grund. Gefaehrlicher ist die Gegenrichtung: Restbetraege in Nutzer-Antworten sind eine neue
Informationskante und duerfen ausschliesslich aus der EIGENEN Tenant-Achse gespeist werden.

---

### P5b — Monats-Felder in die Projektion

**Behebt:** D4 (Fenster). **Aufwand:** S. **Abhaengig:** P4, P5a

> **BLOCKER-KORREKTUR:** In der ersten Planfassung trug P5 `abhaengig: ["P2"]`, verlangte
> aber im Kern und in den Tests P4-Artefakte ("den Perioden-Verbrauch, das
> Perioden-Fenster"). Bei paralleler Abarbeitung waere P5 legal vor P4 gelaufen und dann
> nicht umsetzbar gewesen. Der Perioden-Teil ist deshalb als P5b abgetrennt.

#### Ziel

Das angezeigte Verbrauchsfenster ist dasselbe, das die Gates lesen werden.

#### Kern

`usageView` (`api-read.js:29-34`) liefert zusaetzlich den Monatsverbrauch
(`spendMonthUsageCents`), den Monatsschluessel und die eigene In-Flight-Reserve
(`reservationFor`). Alles tenant-eigen; der Plattform-Notaus bleibt draussen.

#### Betroffene Dateien

`src/routes/api-read.js`, `src/mcp-tools.js`, `src/ui/widgets/agent-status.html`,
`public/index.html`, `public/tenant.html`, `test/api-state-usage-axis.test.js`,
`test/mcp-ui.test.js`, `test/api-read-parity.test.js`.

#### Akzeptanzkriterium

Aus `/api/state` ist ablesbar, welche Achse den naechsten Call blockieren wuerde;
angezeigtes Fenster == (kuenftiges) Gate-Fenster — kein "Rest X, trotzdem geblockt".

#### Rot-vor-Fix-Test

`test/api-state-usage-axis.test.js` erweitert: Bucket mit Schluessel aus dem Vormonat ->
`usage.spendMonthCostEur === 0`, waehrend `usage.costEur` den Lebenszeitwert zeigt (heute
existiert das Feld nicht -> rot).

#### Risiko

Zwei sichtbare Verbrauchszahlen (Lebenszeit + Monat) sind erklaerungsbeduerftig; die
Labels muessen die Achse benennen, sonst ersetzt man D4 durch eine neue Verwechslung.

---

### P6 — Fruehwarnung: der Plattform-Notaus wird sichtbar, BEVOR er blockt

**Behebt:** D3 (Beobachtbarkeit). **Aufwand:** S. **Abhaengig:** P4, P5a

#### Ziel

Ein Mensch erfaehrt von einer Kosten-Anomalie **nicht** erst durch eine 402.

Dies ist **Vorbedingung fuer jede Cap-Anhebung** (P7), deshalb davor und nicht als
Nachtrag.

#### Kern

Ein Audit-Ereignis feuert, wenn die Plattform-Summe (settled + In-Flight) einen benannten
Anteil von `platformSpendCapCents` **erstmals in einem Spend-Monat** ueberschreitet — genau
EIN Ereignis pro Monat und Schwelle, **kein Ereignis pro Anrufversuch** (sonst flutet es
das Audit-Log und macht es unbrauchbar).

**Neue Env-Variable (Name und Default hier festgelegt, damit sie nicht erfunden wird):**

| Name | Config-Pfad | Default | Semantik |
| --- | --- | --- | --- |
| `PLATFORM_SPEND_WARN_PERCENT` | `config.billing.platformSpendWarnPercent` | `80` | Ganzzahl 0-100. `0` = Warnung aus. |

Einzutragen in: `src/config.js`, `CONFIG_NAMESPACES.billing` (`config.js:863`),
`.env.example`, `render.yaml` **und** `test/helpers.js` BASE_ENV (Lehre
`test-base-env-drift`).

**Emissionsort (BLOCKER-KORREKTUR).** Die erste Planfassung liess offen, wo das Ereignis
entsteht. `globalBudgetExceeded` / `globalReserveExceedsBudget` sind ausdruecklich als
"Reine Query, kein IO" dokumentiert (`state-ops.js:1607-1621`); ein Audit-Schreibeffekt
dort bricht Command-Query-Trennung (N7). Zugleich kann die Warnung nicht in `deny()`
haengen, denn sie muss auch feuern, wenn der Call **erlaubt** wird. Deshalb:

> Emission im `run` des `reserve_budget`-Gates (`outbound-gates.js:538-562`), **nach
> erfolgreicher Reservierung** — dort liegt bereits der `withStoreLock`-Kontext. Die
> Praedikate bleiben unveraendert nebeneffektfrei.

**Entprellung (BLOCKER-KORREKTUR).** Die erste Planfassung haengte den Marker an den
Perioden-Schluessel aus P4 — der lebt aber **pro Tenant-Bucket**, waehrend die Schwelle
eine **Plattform**-Groesse ist; es gibt keinen Plattform-Bucket, der einen Schluessel
tragen koennte. Der Marker ist deshalb ein **eigenes, prozess-lokales, ephemeres Feld**
neben `s.reservations` (nie persistiert). Bei Prozess-Neustart ist er hoechstens einmal
zusaetzlich laut — **nie stumm**.

Kein neues Gate, keine Ablehnungsentscheidung aendert sich. `globalUsageTotals`
(`state-ops.js:1340-1358`) bleibt in dieser Phase die exakte Summe.

#### Betroffene Dateien

`src/store/state-ops.js`, `src/telephony/outbound-gates.js`, `src/config.js`,
`.env.example`, `render.yaml`, `test/helpers.js`,
`test/platform-spend-warning.test.js` (neu).

#### Akzeptanzkriterium

- Beim erstmaligen Ueberschreiten der Schwelle innerhalb eines Spend-Monats entsteht genau
  ein Audit-Eintrag; zehn weitere Anrufversuche oberhalb der Schwelle erzeugen keinen
  weiteren.
- Nach einem Monatswechsel kann sie erneut genau einmal feuern.
- Keine Ablehnung und kein Fehlertext aendert sich (Gate-Entscheidungen byte-identisch).
- `globalBudgetExceeded` und `globalReserveExceedsBudget` bleiben **nebeneffektfrei**.
- Das Audit-Detail enthaelt **ausschliesslich Summen-Cents und den Monatsschluessel, keine
  `tenantId`**.
- `PLATFORM_SPEND_WARN_PERCENT=0` -> kein Ereignis, byte-identisch zum Bestand.

#### Rot-vor-Fix-Test

Neu `test/platform-spend-warning.test.js`, heute rot (es existiert kein Ereignis):

- Zwei aufeinanderfolgende Ueberschreitungen -> genau ein Audit-Eintrag.
- Verbrauch knapp unter der Schwelle -> kein Eintrag.
- Monatswechsel -> genau ein weiterer Eintrag.
- Audit-Detail enthaelt keine `tenantId`.

#### Risiko

Ein Ereignis, das pro Anrufversuch feuert, ist schlimmer als keines. Zweitens: eine
Schwelle ohne verdrahteten Kanal erfuellt die Auflage formal, aber nicht praktisch (s.
Abschnitt 8, Frage 5).

---

### P7 — Der Flip: Gates lesen die Spend-Monat-Achse (Default AUS)

**Behebt:** D1, D2, D3. **Aufwand:** M. **Abhaengig:** P2a, P2b, P3, P4, P6

#### Ziel

Die **einzige bewusste Lockerung** der Kette: der Lebenszeit-Akku hoert auf, Gate-Quelle zu
sein.

#### Kern

`budgetExceeded` (`:1450`), `reserveExceedsBudget` (`:1465`), `globalBudgetExceeded`
(`:1591`) und `globalReserveExceedsBudget` (`:1617`) loesen den Verbrauch kuenftig ueber
die Monatsachse auf statt direkt ueber `usageFor(...).costCents`.

> **BLOCKER-KORREKTUR:** Die erste Planfassung sagte "an GENAU EINER Stelle". Am Code ist
> das falsch: es gibt **ZWEI** Verbrauchs-Aufloesungen. Die Tenant-Achse loest ueber
> `usageFor(...).costCents` auf (`:1450`, `:1465`), die Plattform-Achse ueber die separate
> Funktion `globalUsageTotals` (`:1340-1358`) mit eigener Mikro-Cent-Summierung.

Deshalb **zwei benannte Aufloesungsstellen**, beide exportiert und beide per Test gepinnt:

- `gateUsageCents(s, tenantId, cfg, nowIso)` — Tenant-Achse, genutzt von `budgetExceeded`
  und `reserveExceedsBudget`.
- `gatePlatformUsageCents(s, cfg, nowIso)` — Plattform-Achse, genutzt von
  `globalBudgetExceeded` und `globalReserveExceedsBudget`.

**Es darf keinen Zustand geben, in dem ein Praedikat periodisch und ein anderes lebenslang
rechnet** — das waere eine neue, subtilere Variante des Totbands.

**Flag:** `BUDGET_MONTH_ENABLED`, Default **AUS** = byte-identisch zum Bestand. Der Rollback
ist damit ein Env-Flip **ohne Deploy** — auf einem Free-Tier-Host ohne Shell und mit
langsamem Redeploy operativ mehr wert als Modellsauberkeit. Einzutragen in `config.js`,
`CONFIG_NAMESPACES.billing`, `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV.

**Geflippt wird erst nach einem Live-Beleg, dass `spendMonthKey` einen Neustart
ueberlebt.** Mit demselben Flip wird die Cap-Neudimensionierung wirksam (Tenant-Monatsdecke
und Plattform-Notaus als MONATS-Werte — die Hoehe entscheidet der Owner, Abschnitt 8,
Frage 1). Der Kohaerenz-Guard aus P3 erzwingt dabei `tenantDefault < platformCap`.

`tryReserveOutboundBudget` bleibt **REIN SYNCHRON** (kein `await` zwischen Check und
Increment, TOCTOU).

#### Betroffene Dateien

`src/store/state-ops.js`, `src/config.js`, `.env.example`, `render.yaml`,
`test/helpers.js`, `test/budget-month-flip.test.js` (neu),
`test/outbound-reserve-gate.test.js`, `test/tenant-budget-cap.test.js`,
`test/outbound-budget-concurrency.test.js`.

#### Akzeptanzkriterium

- **Flag AUS:** vollstaendige Bestandssuite gruen, Gate-Entscheidungen byte-identisch, kein
  Verhaltensunterschied messbar.
- **Flag AN:** ein Tenant mit Schluessel aus dem Vormonat und 779 Cent Lebenszeit erhaelt
  bei Decke 800 und Reserve 60 ein `reserved === true`.
- Im Folgemonat startet die Zaehlung nachweisbar bei 0, waehrend `costCents` die
  Lebenszeitsumme behaelt.
- Beide Achsen (Tenant und Plattform) schalten **gemeinsam**.
- `tryReserveOutboundBudget` bleibt rein synchron; die Nebenlaeufigkeitstests bleiben gruen.

#### Rot-vor-Fix-Test

Neu `test/budget-month-flip.test.js`:

- **Prod-Symptom (heute rot):** `costCents=779`, `spendMonthCostCents=779`,
  `spendMonthKey='2026-06'`, Cap 800, Flag AN -> `tryReserveOutboundBudget(t, 60) === true`
  (heute `false`).
- **Gegentest 1:** Schluessel im laufenden Monat -> weiterhin `false` (Gate bleibt scharf).
- **Gegentest 2:** Flag AUS -> `false` (Bestandsverhalten).
- **Gegentest 3 (BLOCKER-KORREKTUR, ausfuehrbar formuliert).** Die erste Planfassung
  verlangte "muss strukturell unmoeglich sein" — das kann ein `node:test` nicht pruefen.
  Stattdessen zwei konkrete Zusicherungen:
  - **3a:** `gateUsageCents` und `gatePlatformUsageCents` werden instrumentiert; jedes der
    vier Praedikate ruft **genau eine** von beiden **genau einmal** auf.
  - **3b:** Quelltext-Lesen von `state-ops.js` (Muster wie die bestehenden
    Manifest-Tests): `costCents` kommt in **keinem** der vier Praedikat-Rumpfe mehr vor.

#### Risiko

Dies ist die Phase, in der der Kostenschutz nominal lockerer wird. Greift der Anker falsch
(z.B. jeder Boot stempelt neu), ist der Cap faktisch wirkungslos und die Plattform zahlt
bis zum Plattform-Cap — **jeden Monat, unbegrenzt oft**. Der Lebenszeit-Akku war ein Bug,
aber auch ein absoluter Deckel; nach P7 ist er weg. Deshalb: Flip nur nach P6
(Sichtbarkeit) und nach Live-Beleg der Anker-Stabilitaet ueber einen Neustart, und
`costCents` bleibt als unabhaengige Gegenprobe stehen.

**Pflicht-Eintrag in `PLAN-SECURITY.md`:** Kalendermonat vs. Stripe-Periode divergieren —
ein Tenant kann innerhalb EINER Rechnungsperiode zwei Gate-Monate ausschoepfen, also bis zu
2x seine Decke. Bewusst akzeptiert, aber als Entscheidung dokumentiert, sonst wird es in
einem Jahr als Bug entdeckt.

---

### P8a — Entkopplung: Flag entfernen, `costCents` entwidmen

**Behebt:** D1 (Abschluss). **Aufwand:** M. **Abhaengig:** P7 (+ ein voller Monatszyklus mit Flag AN)

> **BLOCKER-KORREKTUR:** Die erste Planfassung buendelte diese Aufraeumung mit einem
> gepflegten Plattform-Aggregat (D8) in EINER Phase — zwei voellig verschiedene
> Risikoklassen, und die Aggregat-Haelfte trug im eigenen Risiko-Absatz bereits eine
> Abbruchklausel. Eine Phase mit eingebauter Abbruchklausel ist zwei Phasen. Der Split ist
> P8a (hier) und P8b (optional, s.u.).

#### Ziel

Die befristete Doppel-Wahrheit wird terminiert statt dauerhaft gepflegt.

#### Kern

Nach einem vollen Monatszyklus mit Flag AN faellt `BUDGET_MONTH_ENABLED` **ersatzlos** weg
(kein permanenter Selektor-Fork, in dem jedes Gate zwei Verhalten hat und jede Zusicherung
in zwei Welten laufen muss). `costCents` wird explizit **entwidmet**: es bleibt als
Lebenszeit-/Forensik-Wert, verliert aber Namen und Kommentar der Gate-Quelle (N2/N7) und
wird von keinem Praedikat mehr gelesen.

#### Betroffene Dateien

`src/store/state-ops.js`, `src/config.js`, `.env.example`, `render.yaml`,
`test/helpers.js`, alle Gate-Testdateien mit Flag-Verzweigung.

#### Akzeptanzkriterium

- `grep -rn 'BUDGET_MONTH_ENABLED' src test` liefert 0 Treffer; alle Gate-Tests laufen in
  genau EINER Welt.
- Kein Praedikat liest `costCents` (Quelltext-Test wie P7/3b).
- Vollstaendige Suite gruen.

#### Rot-vor-Fix-Test

Der Quelltext-Test aus P7/3b wird auf "kein Flag-Selektor mehr vorhanden" erweitert (heute
rot, solange das Flag existiert).

#### Risiko

Gering. Nach der Entfernung ist der Rollback kein Env-Flip mehr, sondern ein Revert — das
ist der bewusste Preis fuer die Termination der Doppel-Wahrheit und der Grund, warum ein
voller Monatszyklus als Vorbedingung steht.

---

### P8b — OPTIONAL: O(Tenants) aus dem Gate-Pfad (D8)

**Behebt:** D8. **Aufwand:** L. **Abhaengig:** P8a
**Default-Entscheidung: NICHT umsetzen.**

#### Ziel

`globalUsageTotals` (`state-ops.js:1340-1358`) iteriert bei JEDEM `place_call` synchron
unter `store.withStoreLock` ueber ALLE Tenant-Buckets.

#### Warum diese Phase optional ist

Ein gepflegtes Aggregat schafft eine **neue fail-open-Flaeche auf genau der Achse, die
Regel 1 schuetzt** — gegen ein bei 28 Tenants nicht existentes Performanceproblem. Die
einfachste funktionsfaehige Loesung ist hier, die exakte Summe zu behalten. **Diese Phase
wird nur begonnen, wenn die Tenant-Zahl das Gate real messbar verlangsamt.**

#### Kern (falls doch umgesetzt) — bindende Regeln

- Das Aggregat wird **NICHT persistiert** und nach der Hydrierung **genau einmal** aus den
  Buckets neu berechnet. Drift bleibt damit auf eine Prozess-Lebensdauer begrenzt und heilt
  beim Neustart (auf Free Tier mit haeufigem Spin-down praktisch dauernd), statt sich nach
  unten festzuschreiben und den Notaus still blind zu machen.
- Ein-Stellen-Regel fuer die Mutation; der Lock-Body von `tryReserveOutboundBudget` bleibt
  **REIN SYNCHRON** (TOCTOU).
- **Abbruchbedingung:** wenn Ein-Stellen-Regel, Boot-Recompute und Property-Test nicht
  sauber stehen, wird die exakte Summe behalten. Ein blinder Notaus ist schlimmer als
  O(28).

#### Akzeptanzkriterium

- Der Gate-Pfad loest **0 Iterationen** ueber die Bucket-Sammlung aus.
- Nach beliebiger Misch-Sequenz stimmt das Aggregat exakt (Cent UND Mikro-Cent-Rest) mit
  der Neuberechnung ueberein.
- Boot-Recompute stellt die Invariante aus beliebigem Spiegelzustand her.
- `test/outbound-budget-concurrency.test.js` und
  `test/outbound-reserve-concurrency-http.test.js` bleiben unveraendert gruen.

#### Rot-vor-Fix-Test

- `s.usage` als Proxy mit Zugriffszaehler: `globalBudgetExceeded` und
  `globalReserveExceedsBudget` duerfen 0 Iterationen ausloesen (heute iteriert
  `globalUsageTotals`).
- Property-Lauf ueber 200 zufaellige Mutationen (`trackUsage` / `addVoiceUsageCostCents` /
  Monatswechsel) ueber 20 Tenants -> Aggregat === Neuberechnung, Cent und Mikro-Cent-Rest.
- Ein manuell verfaelschtes Aggregat stimmt nach Re-Hydrierung wieder.

#### Risiko

Ein gepflegtes Aggregat driftet still, sobald eine kuenftige dritte Mutationsstelle es
nicht mitzieht — und gefaehrlich ist genau **eine** Richtung: zu niedrig = Notaus blind,
also fail-open auf der Achse, die Regel 1 ausdruecklich schuetzt. Der Property-Test ist eine
DAUER-Zusicherung, kein einmaliger Beweis.

---

## 7. Reihenfolge und warum der Kostenschutz nie schwaecher wird

```
P0 (ENV, sofort)
 ├─> P1 ──> P2a ──> P2b ─┐
 │           │           │
 │           └──> P5a ───┤
 │                       │
 ├─> P3 ─────────────────┤     (P3 haengt an P0!)
 │                       │
 └─> P1 ──> P4 ──┬──> P5b │
                 └──> P6 ─┤
                          │
                          v
                         P7 ──> P8a ──> [P8b optional]
```

Azyklisch, verifiziert. `P1->P4`, `P2a->P2b`, `P2a/P2b->P5a`, `P4+P5a->P5b`,
`P4+P5a->P6`, `P2a/P2b/P3/P4/P6->P7`, `P7->P8a`, `P8a->P8b`.

**Schutzniveau je Zwischenstand:**

| Phase | Schutz gegenueber heute | Begruendung |
| --- | --- | --- |
| **P0** | **schwaecher (bewusst, 400 Cent)** | Einzige unkompensierte Lockerung vor P7. Explizit, beziffert, befristet, in `PLAN-SECURITY.md` datiert. |
| P1 | strenger | Reine Verschaerfung; auf gesunden Werten byte-identisch. Schliesst ein fail-open. |
| P2a | **nie schwaecher** | `min(tenant, global)` <= `global`. Der Plattform-Notaus bleibt parallel. 0-Sentinel erhaelt exakt das Bestandsverhalten. |
| P2b | identisch | Reiner Rename. |
| **P3** | **Ausfall-Risiko, nicht Schutz-Risiko** | Ein Boot-Refusal auf einem Host ohne Shell ist der einzige Zwischenstand, in dem der Dienst schlechter dastehen kann als heute. Deshalb: genau EINE fatale Klausel, `abhaengig: P0`, und ein Spawn-Test gegen die HEUTIGEN Live-Werte vor dem Merge. |
| P4 | identisch | Strikt additiv, kein Gate liest die neuen Felder. |
| P5a/P5b | identisch | Nur Anzeige und Texte; keine Praedikat-Aenderung. |
| P6 | identisch | Nur ein Audit-Ereignis; keine Ablehnungsentscheidung aendert sich. |
| **P7** | **schwaecher (die geplante Lockerung)** | Default AUS -> byte-identisch bis zum bewussten Flip. Der Flip erfolgt erst nach P6 (Sichtbarkeit) und nach Live-Beleg der Anker-Stabilitaet. **Rollback ist fail-closed**: Flag AUS faellt auf den dann groesseren Lebenszeit-Zaehler zurueck, also auf den strengeren Zustand. |
| P8a | identisch | Entfernt nur den Selektor. |
| P8b | Risiko, deshalb optional | s. Phase. |

Ausser P0 (bewusst, beziffert) und P3 (Ausfall-, nicht Schutz-Risiko) gibt es **keinen**
Zwischenstand mit schwaecherem Kostenschutz.

---

## 8. Offene Entscheidungen fuer den Owner

### Frage 1 — Hoehe und Semantik der beiden Caps beim Flip (P7)

Was darf EIN Nutzer pro Monat kosten (Tenant-Monatsdecke), und ab welchem Monatsbetrag
soll die Plattform hart stoppen (Notaus)? Geschaefts- und Risikoentscheidung, keine
technische.

- (a) Konservativ: Tenant 10 EUR/Monat, Plattform 50 EUR/Monat — deckt die 6 aktiven
  Tenants mit Reserve, ein Missbrauchsfall kostet hoechstens 10 EUR.
- (b) **Am Abo ausgerichtet:** Tenant = Abo-Minutenwert + Puffer (Starter 30 min * 20 ct =
  6 EUR -> Decke 10 EUR), Plattform = 5x die erwartete Monatslast.
- (c) Grosszuegig: Tenant 25 EUR, Plattform 200 EUR — kein Support-Fall wegen Deckel, aber
  der Notaus ist faktisch dekorativ.
- (d) Gestaffelt nach Plan (Starter/Business unterschiedliche Decken) — richtig, aber
  teurer, weil es die `tenant_budget`-Zeile am Abo-Webhook aufhaengt.

> **ENTSCHEIDUNG DES OWNERS (2026-07-19) + KORREKTUR DER FRAGESTELLUNG.**
>
> **Tenant-Decken, gestaffelt nach Plan — also (d), nicht (b):** Starter **3 EUR**,
> Business **9 EUR**. Grundlage sind gemessene, nicht geschaetzte Kosten (s.u.); die
> Staffelung braucht eine `tenant_budget`-Zeile am Abo-Webhook und ist damit eine eigene,
> noch nicht gebaute Phase. Bis dahin gilt EIN globaler Default in Hoehe des kleineren
> Werts (300 Cent).
>
> **Der Plattform-Notaus wird NICHT als feste Zahl gesetzt.** Alle vier Optionen oben
> nennen einen Absolutbetrag — das ist die falsche Form. Nach P2a ist die Gesamt-Exposition
> ohnehin durch die Summe aller Tenant-Decken begrenzt. Ein fester Plattform-Cap fuegt nur
> dann Schutz hinzu, wenn er UNTERHALB dieser Summe liegt — und dann loest er bei Wachstum
> aus und blockiert ALLE Kunden, auch die zahlenden. Bei Starter 3 / Business 9 EUR
> summieren sich 50 Business-Kunden auf 450 EUR; ein Notaus von 50 EUR (Option a) traefe
> bei etwa fuenf Kunden. **Erfolg wuerde einen Totalausfall ausloesen** — dieselbe Klasse
> von Defekt wie der geteilte Topf, nur eine Ebene hoeher.
>
> **Neue Form: `platformSpendCap = Summe(aktive Tenant-Decken) * 1.3`.** Waechst
> automatisch mit jedem Kunden mit, bestraft Wachstum nie und faengt weiterhin den Fall,
> gegen den der Notaus wirklich schuetzt: dass die Tenant-Decken selbst versagen
> (Seeding-Bug, Tenants ohne Zeile, Fehler in `effectiveCapCents` — exakt der Zustand vor
> P2a). Die P3-Invariante `tenantDefault < platformCap` bleibt dadurch automatisch erfuellt.
>
> **Verteidigungslinien, richtig sortiert:** die Tenant-Decke ist die eigentliche
> Kontrolle; die Warnung (P6) ist immer an und kann keinen Ausfall ausloesen;
> `OUTBOUND_FROZEN` ist der manuelle Not-Aus, den der Betreiber bewusst zieht; der
> automatische Plattform-Cap ist die DRITTE Linie und darf deshalb die lockerste sein.
>
> **Gemessene Grundlage** (Telnyx Usage Reports + ElevenLabs, 2026-07-19), ersetzt die
> Annahme von 20 ct/min: variable Kosten **5.4 ct/min** all-in (Telefonie 3.9, STT 0.6,
> TTS 0.6, Recording/Inference 0.05, Claude-Tokens 0.27). Damit Starter 30 min = 1.62 EUR,
> Business 120 min = 6.48 EUR. ElevenLabs ist ein FESTPREIS-Abo (6.00 USD netto/Monat) und
> gehoert NICHT in einen Minutentarif; es ist Plattform-Fixkost und wird in `costCents`
> gar nicht gebucht — ebenso wenig wie STT, TTS und die DID-Miete.

### Frage 2 — Duerfen die Zaehler ANDERER Tenants angefasst werden?

Die 5 Nicht-Owner-Tenants halten zusammen 4,29 EUR des heutigen Deckels.

- (a) **Nichts anfassen (Plan-Default):** `costCents` bleibt als Forensik-/
  Abrechnungsnachweis, der Flip loest die Blockade.
- (b) `costCents` anderer Tenants auf 0 setzen (ohne Flip).
- (c) Nur den Owner-Tenant zuruecksetzen.
- (d) `tenant_budget`-Zeilen fuer die 6 aktiven Tenants von Hand setzen.

**Empfehlung: (a).** Ein In-Place-Reset ist die riskanteste denkbare Operation in dieser
Codebasis: nicht atomar, faellt unter `FORCE RLS` ohne gesetzte `app.current_tenant`-GUC
still auf 0 Zeilen, und ein SQL-Schreiber gegen die Live-DB wird vom In-Memory-Spiegel beim
naechsten `flushUsage` (`pg.js:1055-1065`) lautlos ueberschrieben. Fuer den Fix ist er
ausserdem nicht noetig. **(d) ist als Ergaenzung vertretbar, sobald P2a steht** — aber als
Owner-Handgriff **ueber `setTenantBudget` im Prozess, nie ueber SQL**.

### Frage 3 — Kalendermonat (UTC) oder Stripe-Abrechnungsperiode als Anker?

- (a) **Kalendermonat UTC (Plan-Default):** immer definiert, gilt auch fuer Owner und
  pre-Payment-Tenants.
- (b) Stripe-Periode: deckungsgleich mit der Abrechnung, aber ohne Anker fail-closed —
  sperrt Owner und jeden Tenant vor der ersten Zahlung sofort und dauerhaft.
- (c) Stripe-Periode mit Kalendermonat als Fallback — korrekt, aber zwei Perioden-Begriffe
  auf einer Achse.
- (d) Kalendermonat plus halbierte Decke, um den 2x-Effekt zu neutralisieren.

**Empfehlung: (a)**, mit dem 2x-Effekt als datierte, bewusst akzeptierte Abweichung in
`PLAN-SECURITY.md`. (b) ist der Pfad, der den Owner erneut sperrt. (c) ist die saubere
Zielform, gehoert aber in eine spaetere Kette.

### Frage 4 — Boot VERWEIGERN oder nur WARNEN bei Konfig-Inkohaerenz?

- (a) **Plan-Default:** nur `tenantDefault >= platformCap` (bei Default > 0) ist fatal;
  D5/D6 und der 0-Sentinel warnen.
- (b) Alle fatal — maximale Lautstaerke, Brick-Risiko auf einem Host ohne Shell.
- (c) Alle nur WARN — kein Brick-Risiko, aber der Fehler, der die Tenant-Achse inert
  machte, kaeme wieder still durch.
- (d) Fatal nur, wenn eine Env-Variable ANDERS ist als beim letzten erfolgreichen Boot.

**Empfehlung: (a).** Ein Boot-Refusal wegen einer Ueber-Blockade tauscht ein Kostenproblem
gegen einen Totalausfall der Telefonie — heilbar nur ueber Dashboard-Env plus Redeploy,
waehrend der Dienst steht. (b) ist erst vertretbar, wenn ein Rollback-Weg ohne Deploy
existiert.

### Frage 5 — Ueber welchen Kanal erreicht die Fruehwarnung aus P6 einen Menschen?

- (a) Audit-Log + Dashboard-Banner (billigste Variante, in P6 enthalten).
- (b) **Zusaetzlich SMS/Push an den Owner** beim erstmaligen Ueberschreiten pro Monat.
- (c) E-Mail ueber den bestehenden Stripe-/Onboarding-Mailweg.
- (d) Externer Monitor pollt `/api/state`.

**Empfehlung: (b).** Der Dienst kann bereits SMS senden, die Kosten sind vernachlaessigbar
(eine Nachricht pro Monat und Schwelle), und es ist der einzige Kanal, den der Owner
nachweislich sieht. **Ohne einen solchen Kanal ist die Cap-Anhebung in P7 nicht zu
verantworten.**

### Frage 6 — hermes-db laeuft am 2026-07-24 ab (5 Tage). Reihenfolge?

- (a) **DB-Abloesung/Verlaengerung ZUERST**, dann ab P4 deployen (P0-P3 sind schema-frei
  und koennen sofort laufen).
- (b) P1-P8 durchziehen und die DB-Frage danach loesen.
- (c) Monats-Achse zunaechst nur im json-Backend, pg-Persistenz nach dem Umzug nachziehen.
- (d) Monats-Achse gar nicht persistieren (Anker nur im Prozess-Spiegel).

**Empfehlung: (a).** (d) waere fatal: ein Anker nur im Spiegel wird bei jedem Boot neu
gestempelt, und damit ist der Cap nach P7 faktisch wirkungslos — exakt das Todesszenario
aus dem Pre-Mortem.

### Frage 7 — Zielwert fuer `DEFAULT_TENANT_BUDGET_CENTS` (Vorbedingung fuer P2a)

Der Live-Dashboard-Wert ist zu verifizieren. Ist er `0`, ist P2a in Produktion ein No-Op
(der 0-Sentinel faellt weiterhin auf den Plattform-Cap). Ein positiver Wert MUSS gesetzt
werden, damit die Tenant-Achse ueberhaupt bindet — und er muss oberhalb des hoechsten
Bestands-Lebenszeitverbrauchs (heute 350 Cent) liegen, sonst blockt der Deploy sofort
Bestandsnutzer. **Empfehlung: 1000 (der Code-Fallback), abgestimmt mit Frage 1.**

---

## 9. Pre-Mortem (Juli 2027, rueckwaerts gelesen)

Zwei plausible Todesarten, beide mit derselben Wurzel: **eine Sicherung wurde entschaerft,
ohne dass eine Beobachtung an ihre Stelle trat.**

### TOD 1 — der Deckel wurde dekorativ

Der Lebenszeit-Akku war ein Bug, aber zugleich ein absoluter Deckel: die Plattform konnte
in ihrer gesamten Existenz nie mehr als 8 EUR kosten. Nach P7 kostet sie bis zum
Plattform-Cap, **jeden Monat, unbegrenzt oft**. Der alte Zustand schrie (der Owner konnte
nicht telefonieren); der neue fluestert — er blockt sauber, protokolliert eine 402 und
laeuft weiter. In der Woche nach dem Vorfall will niemand ein zweites Mal blockiert werden,
also werden die Caps mit "Kopffreiheit" gewaehlt; die Warnschwelle aus P6 landet im
Audit-Log, das niemand abonniert hat. Parallel bleibt D9 liegen: die Tenant-/
Nummern-Vermehrung laeuft weiter, jeder neue WorkOS-`sub` erzeugt Tenant plus DID-Kauf, und
im Herbst schoepfen zweihundert Tenants den neu dimensionierten Notaus Monat fuer Monat
aus. **Der Multiplikator, der den Monatsdeckel ueberhaupt erst gefaehrlich macht, ist nicht
das Budget-Modell, sondern die Vermehrung.**

Gegenmassnahmen, die deshalb IN der Kette stehen und nicht in einem Ticket: P6 ist
Vorbedingung von P7, nicht Nachtrag; der Warnkanal ist eine explizite Owner-Entscheidung
(Frage 5); die Cap-Hoehe wird an das Abo gekoppelt statt geraten (Frage 1); D9 wird als
naechste Kette terminiert.

### TOD 2 — fail-open durch Vergessen

Jemand fuehrt eine dritte Geld-Schreibstelle ein, die `spendMonthCostCents` nicht mitzieht.
Der Tenant liest dauerhaft 0, sein Gate ist blind, und niemand merkt es, weil **ein blindes
Gate keine Symptome hat** — es blockt nur nichts mehr. Das ist exakt die D7-Klasse, in
einer Kette, die D7 loest.

Genau dagegen ist die Achse **additiv** gebaut: `costCents` bleibt als unabhaengige
Gegenprobe stehen, gegen die sich eine vergessene Schreibstelle nachweisen laesst. Die
Variante davon in P8b: ein gepflegtes Plattform-Aggregat driftet nach unten, der
Boot-Recompute heilt es bei jedem Neustart gerade so weit, dass es nie auffaellt — deshalb
ist P8b optional, das Aggregat wird nie persistiert, und der Property-Test ist eine
DAUER-Zusicherung.

### Drei kleinere Risse, vorab entschaerft

1. **Uhr-Anomalie** — ohne den Monotonie-Riegel (P4) ist jedes Perioden-Modell ueber einen
   Clock-Skew beliebig oft ruecksetzbar, also der Cap abschaltbar.
2. **Achsen-Divergenz** — der Gate-Monat laeuft ab dem 1. UTC, die Stripe-Periode ab dem
   Anmeldetag; ein Tenant kann in EINER Rechnungsperiode zwei Gate-Monate ausschoepfen.
   Bewusst akzeptiert und **Pflichteintrag in `PLAN-SECURITY.md`**, sonst wird es in einem
   Jahr als Bug entdeckt statt als Entscheidung erinnert.
3. **Env-Vorbedingung** — die Neu-Dimensionierung haengt an Dashboard-Werten, die
   `render.yaml` nicht durchsetzt; deshalb ist der Kohaerenz-Boot-Guard (P3) eine eigene
   Phase VOR P7 und kein Pre-Mortem-Absatz.

### Vierter Riss (neu, aus dem Review)

**Der Boot-Guard selbst als Ausfallursache.** P3 fuegt eine `exit(1)`-Bedingung auf einem
Host ohne Shell hinzu. Wenn jemand spaeter `MAX_BUDGET_EUR` als Kosten-Reflex zurueck auf
einen kleinen Wert setzt und `DEFAULT_TENANT_BUDGET_CENTS` stehen laesst, bootet der Dienst
nicht mehr — kein `/voice`, kein `/mcp`, kein `/healthz`. Deshalb: `abhaengig: P0`, genau
EINE fatale Klausel, und ein Spawn-Test gegen die HEUTIGEN Live-Werte als Merge-Gate.

---

## 10. Was bewusst NICHT Teil dieses Plans ist

| Ausgeschlossen | Begruendung |
| --- | --- |
| **`usage_event` als Gate-Quelle** | Rundet pro Event (Sub-Cent-Verlust, P1-Safety-BLOCKER), ist nur bei `PAYMENT_ENABLED` vollstaendig, und ein wachsendes `SUM()` synchron unter `withStoreLock` verschaerft D8. |
| **Reset-Job / Cron / preDeploy** | Render Free Tier hat nichts davon. Ein externer Schreiber wird vom In-Memory-Spiegel beim naechsten `flushUsage` ueberschrieben. |
| **Aenderung historischer `costCents`** | Bleiben unangetastet — sie sind die Forensik und die Gegenprobe gegen TOD 2. |
| **Umbenennung der ENV `MAX_BUDGET_EUR`** | Live-Dienst ist Dashboard-managed; eine Env-Umbenennung ohne Shell erzeugt zwei Quellen fuer einen Cap. Nur der interne Key wird umbenannt (P2b). |
| **Semantikwechsel von `budgetExceeded` (reserve-bewusst machen)** | `telnyx-llm-shim.js:406` legt bei `true` MITTEN im Gespraech auf (ein Call wuerde sich an seiner EIGENEN Reserve selbst beenden) und `voice.js:242` wuerde kostenfreies INBOUND wegen fremder Outbound-Reserven abweisen. |
| **Praefix-Tarif-Tabelle / Senken der Worst-Case-Reserven** | Beruehrt Regel 1 material; D5 wird stattdessen diagnostizierbar gemacht (P3-WARN, P5a-Text). |
| **Ausgabe einer ausfuehrbaren `max_duration_s` in Ablehnungen** | Maschinenlesbare Umgehungsanleitung fuer den LLM-Aufrufer; zerstoert den Rueckdruck, der diesen Vorfall sichtbar gemacht hat. |
| **Minuten-Achse (`planMinutesExceeded`, Gate `minutes`)** | Kundenversprechen, nicht Kostenschutz. Eigene Achse, eigener Audit-Grund, bleibt unberuehrt. |
| **Vollstaendige Boot-Hydrierung des Mandantenbestands (`pg.js hydrate`)** | Der eigentliche sechsstellige Skalen-Blocker, aber ein eigenes Projekt. Diese Kette entfernt (optional, P8b) nur O(Tenants) aus dem PRO-ANRUF-Pfad. |
| **D9: Tenant-/Nummern-Vermehrung (28 Tenants, 22 ohne einen Call)** | Nach P2a traegt jeder Tenant seine eigene Decke — damit sind die Karteileichen fuer die **Budget-Achse** harmlos. Fuer die **DID-Kosten** sind sie es nicht, und das ist eine Identitaets-, keine Budget-Frage. Eigene Kette. |
| **Stripe-Periode als EUR-Anker** | Ohne Anker fail-closed -> wuerde Owner und pre-Payment-Tenants sperren (Frage 3, Option b). |

---

## Anhang — Verbindliche Namen (nicht erfinden)

| Konzept | Name | Ort |
| --- | --- | --- |
| Geld-Gueltigkeitspraedikat | `isBookableCents(x)` | `src/store/defaults.js` |
| Monatsschluessel | `spendMonthKey` / `spend_month_key` | `defaults.js` / `schema.sql` |
| Monatsverbrauch | `spendMonthCostCents` / `spend_month_cost_cents` | `defaults.js` / `schema.sql` |
| Leseprojektion | `spendMonthUsageCents(bucket, nowIso)` | `src/store/state-ops.js` |
| Tenant-Verbrauchsaufloesung (Gate) | `gateUsageCents(s, tenantId, cfg, nowIso)` | `src/store/state-ops.js` |
| Plattform-Verbrauchsaufloesung (Gate) | `gatePlatformUsageCents(s, cfg, nowIso)` | `src/store/state-ops.js` |
| Plattform-Cap (Config) | `platformSpendCapCents` (ENV bleibt `MAX_BUDGET_EUR`) | `src/config.js` |
| Warnschwelle | `PLATFORM_SPEND_WARN_PERCENT` / `platformSpendWarnPercent`, Default 80 | `src/config.js` |
| Umschalt-Flag | `BUDGET_MONTH_ENABLED`, Default AUS | `src/config.js` |
| Boot-Guard Kohaerenz | `spendCapCoherence({...})` | `src/boot-guard.js` |
| Boot-Guard Modellpreise | `unpricedModels(modelIds, modelPricesUsd)` | `src/boot-guard.js` |
| Tenant-Cap in der API | `tenantCapEur` (ersetzt `maxBudgetEur`) | `src/routes/api-read.js` |
| Audit-Gruende | `budget_tenant`, `budget_platform`, `reserve_ueber_rest`, `reserve_erschoepft`, `usage_korrupt` | `src/telephony/outbound-gates.js`, `src/store/state-ops.js` |
