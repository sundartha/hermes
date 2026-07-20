# Phase P6 — Fruehwarnung: der Plattform-Notaus wird sichtbar, BEVOR er blockt

**Gate:** PASS
**finalBranch:** `phase/ba-p6-fruehwarnung`
**headCommit:** `31a7d35e143bdbb9f8aa26e17675cfc9c14b690e`
**Basis:** `master` @ `768df00` (P1-P5b bereits gemergt)
**Tests:** 2620/2620 gruen (Autor-Lauf), zusaetzlich 2628/2628 im unabhaengigen Safety-Review-Lauf (inkl. 8 adversarialer Zusatztests)
**Committed:** ja (Worktree-Branch, noch nicht in `master` gemergt)

---

## 1. Kernaussage

Nach einer **erfolgreichen** Reservierung im letzten Outbound-Gate (`reserve_budget`) wird — genau einmal pro Spend-Monat — ein Audit-Ereignis (und optional eine SMS an eine Betreiber-Nummer) ausgeloest, sobald die Plattform-Ausgaben (settled + In-Flight) eine konfigurierbare Warnschwelle (Default 80 % des globalen Caps) ueberschreiten. **Kein Praedikat, kein Gate, kein Ablehnungstext, keine Ablehnungsentscheidung aendert sich.** Der Warnpfad ist strukturell unfaehig, einen Anruf zu verhindern (dreifach fail-soft, s. §5).

Ziel der Phase: die in P1-P5b gebaute Budget-Architektur bekommt eine Fruehwarnung, bevor der globale Notaus (Totband, s. Memory `budget-axes-deadband`) tatsaechlich Anrufe blockiert — damit ein Betreiber reagieren kann, statt erst am blockierten Call zu merken, dass der Plattform-Topf fast leer ist.

---

## 2. Plan (gekuerzt)

### 2.1 Emissionsort

- **Nicht** in den Praedikaten `globalBudgetExceeded`/`globalReserveExceedsBudget` (`src/store/state-ops.js`, explizit als "reine Query, kein IO" dokumentiert) — ein `audit()`/`sendSms()` dort waere Command-Query-Vermischung und die Funktionen laufen zusaetzlich im Lock.
- **Nicht** in `deny()` (`src/telephony/outbound-gates.js`) — die Warnung muss feuern, wenn der Call **erlaubt** wird, nicht bei Ablehnung.
- **Ort:** Gate `reserve_budget` (letztes Glied der Gate-Kette), in zwei bewusst getrennten Haelften:
  1. **Entscheiden + Entprellen** (rein synchron, mutiert den Marker) — in `reserveOutcome(ctx)`, **im `withStoreLock`-Callback** (verhindert Race zwischen zwei nebenlaeufigen `place_call`).
  2. **Melden** (Audit + SMS, IO) — **nach** dem Lock, nur im Erfolgszweig, kein `await`, das den Lock oder den Anrufpfad haelt.

### 2.2 Gemessene Groesse

`globalUsageTotals(s).costCents + reservationsTotal(s)` — exakt dieselbe linke Seite, die `globalReserveExceedsBudget` gegen `globalCapCents(cfg)` haelt. Die Warnung misst also genau das, was spaeter blockt (keine zweite Wahrheit).

### 2.3 Entprell-Datenstruktur

- Neues Feld `platformSpendWarnedMonth` in `makeDefaultState()`, direkt neben `reservations: {}`.
- **Strukturell ephemer** (wie `reservations`): `json.js` schliesst den Key im `save()`-Destructuring aus; `pg.js` hat keine Spalte dafuer.
- Bewusst **kein** `||=`-Migrationsdefault: ein fehlendes Feld liest als `undefined`, und `undefined !== "2026-07"` heisst "noch nicht gewarnt" = laut. Ein Default waere nur Rauschen.
- Neue reine Ops-Funktion `claimPlatformSpendWarning(s, cfg, nowIso)`: prueft Schwelle, liefert `{totalCents, monthKey}` beim erstmaligen Ueberschreiten (und setzt den Marker), sonst `null`. Unlesbarer Zeit-Anker → meldet, setzt aber **keinen** Marker (sonst wuerde `null === null` die Warnung dauerhaft verschlucken).
- Fehlerrichtung ist strukturell konservativ: die einzige moegliche Abweichung ist **zu laut** (Restart, Monatswechsel, unlesbare Uhr), nie stumm.

### 2.4 Neue Env-Variablen (`src/config.js`, Namespace `billing`)

- `PLATFORM_SPEND_WARN_PERCENT` (Default 80, 0-100, `0` = Warnung AUS, byte-identisch zum Bestand)
- `PLATFORM_ALERT_SMS_TO` (Default leer = nur Audit, keine SMS; **niemals** die Privatnummer eines Tenants — es gibt keine natuerliche Plattform-Zielnummer, da das Owner-Konzept aus dem Code entfernt ist)

Mitzuaendern: `CONFIG_NAMESPACES.billing`, `test/config-namespaces.test.js` (Zaehler), `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV (neutral: `0`/leer, verhindert Log-Drift in den ~2500 Spawn-Tests).

### 2.5 Fail-soft SMS-Pfad (als Safety-Blocker geplant)

`makeOutboundGates` bekommt `audit` und `messaging` als zusaetzliche injizierte Dependencies (Muster `makeCallFinish`). Emission:

- Audit-Detail **ausschliesslich** `summe_cents=<N> monat=<YYYY-MM>` — keine tenantId, keine Nummer, kein `requestedBy` (Cross-Tenant-Leck-Schutz, Absolute Regel 4/6).
- Absender der SMS: `ctx.fromNumber`/`ctx.outboundProvider` (aktive Store-Nummer des Tenants, der die Schwelle gerissen hat — es gibt keine eigene Plattform-DID).
- **Kein** `recordUsageEvent`, keine `dailySmsCount`-Beruehrung — eine Plattform-Warnung wird keinem Kunden verrechnet und verbraucht dessen Tages-Cap nicht.
- Drei Schutzschichten: (1) eigener try/catch um den Claim selbst — verhindert, dass ein Store-Fehler aus einem bereits reservierten Call ein 402 macht und die Reserve haengen laesst; (2) try/catch um den gesamten Emissions-Rumpf — faengt synchrones Werfen von `messaging()`; (3) `sendSms` wird **nicht** awaitet, nur mit `.catch()` behandelt — kein Lock-Halten, keine Dial-Verzoegerung, kein unhandled rejection.

### 2.6 Tests (Plan)

Neue Datei `test/platform-spend-warning.test.js`, 15 geplante Faelle (T1-T15): Ops-Ebene (Entprellung, Grenzwert `>=`, Monatswechsel, AUS-Schalter, In-Flight zaehlt mit, unlesbares `nowIso`, JSON-Ephemeralitaet) + Gate-Ebene (Audit-Detail-Inhalt/-Leck, Call bleibt erlaubt, drei Fehlerklassen SMS-reject/SMS-throw/Claim-throw, SMS_TO leer, kein Feuern ohne Ueberschreitung, Quelltext-Scan dass die Praedikate nebeneffektfrei bleiben). Plus je eine Fake-Zeile in zwei Bestandstests (`outbound-gates-order.test.js`, `deny-diagnosability.test.js`).

Nicht angefasst laut Plan: `globalUsageTotals`, `globalSpendOrDeny`, `globalBudgetExceeded`, `globalReserveExceedsBudget`, `budgetExceeded`, `reserveExceedsBudget`, `tryReserveOutboundBudget`, `effectiveCapCents`, `tenantBudgetSnapshot`, `spendMonth*`, `src/db/schema.sql`, alle Ablehnungstexte, die Gate-Reihenfolge.

---

## 3. Implementierungs-Zusammenfassung

Plangetreu umgesetzt. `reserve_budget` meldet nach einer erfolgreichen Reservierung — im selben `withStoreLock`, danach IO — genau einmal pro Spend-Monat ein Audit-Ereignis und optional eine SMS. Neue reine Funktion `claimPlatformSpendWarning(s, cfg, nowIso)` in `state-ops.js` vergleicht dieselbe Groesse wie `globalReserveExceedsBudget` gegen `platformSpendCapCents * platformSpendWarnPercent / 100` (ganzzahlig skaliert via `PERCENT_SCALE`, kein Fliesskomma auf der Geld-Kante). Der Entprell-Marker ist strukturell ephemer (json/pg beide ausgeschlossen). `globalBudgetExceeded`/`globalReserveExceedsBudget` bleiben nachweislich unveraendert nebeneffektfrei.

Zwei neue Env-Variablen vollstaendig verdrahtet (`config.js`, `CONFIG_NAMESPACES.billing`, `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV neutral auf `0`/leer). Die SMS ist dreifach fail-soft (Claim-try/catch, Rumpf-try/catch, unbewaited `.catch()`), alle drei Fehlerklassen einzeln getestet. Kein Gate, kein Praedikat, keine Ablehnungsentscheidung, kein Ablehnungstext, keine Gate-Reihenfolge hat sich geaendert (`EXPECTED_ORDER` in `outbound-gates-order.test.js` unveraendert bei 17 Gliedern).

Volle Suite (json + pglite-in-process): **2620/2620 gruen**. Basis-Commit `768df00` wie gefordert; Branch `phase/ba-p6-fruehwarnung`, ein Commit `31a7d35`.

Zusaetzlich drei manuelle Spawn-Belege (nicht als Testdatei committet, siehe Deviations):
- (a) `PLATFORM_SPEND_WARN_PERCENT=abc` → Boot-Refusal, exit 1, exakte `numEnv`-Fehlermeldung.
- (b) kohaerente Werte → Boot exit 0 + `/healthz` 200.
- (c) echter Server-Spawn mit `FAKE_ORIGINATE=true`, echtem `POST /api/calls` (`max_duration_s=1`, `PLATFORM_SPEND_WARN_PERCENT=1`) → Call bleibt `200`/`dialing` **und** genau eine Log-Zeile `[audit] platform_spend_warning ip=system summe_cents=60 monat=2026-07` (keine tenantId, kein `to=`).

### 3.1 Deviations gegenueber dem Plan

1. In `test/config-namespaces.test.js` musste zusaetzlich zu den drei geplanten Zahlen (`billing` 15→17, `EXPECTED_TOTAL_KEYS` 103→105) auch die Zaehl-Assertion `checked` (96→98) samt Kommentar/Testname aktualisiert werden — die zwei neuen primitiven billing-Blaetter werden vom bestehenden Setter-Durchschlag-Test automatisch mitgezaehlt, sonst waere dieser Bestandstest rot geworden. Notwendige Konsequenz der geplanten Config-Erweiterung, keine Verhaltensaenderung.
2. Der Spawn-Beleg (inkohaerente vs. kohaerente Konstellation) sowie der End-to-End-Smoke (`FAKE_ORIGINATE` + echter `POST /api/calls`) liefen als Ad-hoc-Scripte im Scratchpad, nicht als dauerhafte Testdatei — der Plan sah dafuer keine permanente Testdatei vor, und die 16 automatisierten Faelle in `test/platform-spend-warning.test.js` decken das Verhalten bereits vollstaendig ab.

(Faktisch entstanden 16 statt der 15 im Plan grob skizzierten Faelle — T2b als zusaetzlicher expliziter Grenzwerttest kam dazu; siehe Testliste unten.)

### 3.2 Betroffene Dateien

| Datei | Aenderung |
| --- | --- |
| `src/config.js` | 2 neue Keys + `CONFIG_NAMESPACES.billing` |
| `src/store/state-ops.js` | `platformSpendWarnedMonth` in `makeDefaultState`; neuer Block (`PERCENT_SCALE`, 2 private reine Funktionen, `claimPlatformSpendWarning`) |
| `src/store/json.js` | Wrapper (ohne `save`) + Key in die rest-omit-Destrukturierung von `save()` |
| `src/store/pg.js` | Wrapper-Parity im Reserve-Ledger-Block |
| `src/store.js` | Re-Export |
| `src/telephony/outbound-gates.js` | `audit`+`messaging` in Factory-Signatur; 3 Konstanten; `warningDetail`, `logWarningFailure`, `emitPlatformSpendWarning`, `claimSpendWarning`; 2 Zeilen in `reserveOutcome`/`run` |
| `src/server.js` | 2 Deps an `makeOutboundGates` |
| `.env.example`, `render.yaml`, `test/helpers.js` | Env-Doku + BASE_ENV |
| `test/config-namespaces.test.js` | 3 Zahlen (`billing`, `EXPECTED_TOTAL_KEYS`, `checked`) |
| `test/outbound-gates-order.test.js`, `test/deny-diagnosability.test.js` | je 1 Fake-Zeile (`claimPlatformSpendWarning: () => null`) |
| `test/platform-spend-warning.test.js` | **neu**, 16 Tests |

Nicht angefasst (wie geplant): `globalUsageTotals`, `globalSpendOrDeny`, `globalBudgetExceeded`, `globalReserveExceedsBudget`, `budgetExceeded`, `reserveExceedsBudget`, `tryReserveOutboundBudget`, `effectiveCapCents`, `tenantBudgetSnapshot`, `spendMonth*`, `src/db/schema.sql`, alle Ablehnungstexte, die Gate-Reihenfolge.

---

## 4. Rot-vor-Fix-Beleg

Kommando: `NODE_ENV=test node --test test/platform-spend-warning.test.js`

**(1) Trivial rot VOR jeglicher Implementierung** (nur Testdatei geschrieben, `state-ops.js` unveraendert):
```
SyntaxError: The requested module '../src/store/state-ops.js' does not provide an export named 'claimPlatformSpendWarning'
tests 1 / pass 0 / fail 1
```

**(2) Rot NACH `state-ops.js`-Implementierung, VOR Facade-/Gate-Verdrahtung** (json.js/pg.js/store.js/outbound-gates.js/server.js noch unveraendert): 12 pass, 4 fail —
- T7 (Ephemeralitaet json): `TypeError: store.claimPlatformSpendWarning is not a function`
- T8 (Gate-Ebene, Audit-Detail): `AssertionError 0 !== 1` (auditCalls.length)
- T10 (fehlschlagende SMS geloggt): `AssertionError 'der SMS-Fehler wurde geloggt' actual=false`
- T13 (SMS_TO leer → nur Audit): `AssertionError 0 !== 1` (auditCalls.length)

T1-T6 (reine state-ops-Funktion) sowie T9/T11/T12/T14/T15 waren zu diesem Zeitpunkt bereits gruen (byte-identisches Bestandsverhalten bzw. bereits implementierter Teil) — genau das erwartete Zwischenbild.

Nach vollstaendiger Verdrahtung: alle 16 Faelle gruen.

Der unabhaengige Safety-Reviewer hat den Rot-vor-Fix-Zustand zusaetzlich selbst auf `master` reproduziert: dort wirft `test/platform-spend-warning.test.js` beim Import (fehlender Export), die eigene adversariale Reviewer-Testdatei lief auf `master` durch und war 7/8 inhaltlich rot ("genau EIN Warn-Ereignis, war: 0", "Marker bleibt unberuehrt", ...) — nur der Fall "Gate-Entscheidung unveraendert" war schon auf `master` gruen, wie es sein muss.

---

## 5. Safety-Urteil (unabhaengiger Review)

**Verdikt: APPROVED.** Alle P6-Invarianten ausfuehrbar nachgewiesen, keine Verletzung der absoluten Regeln. `approved=true`, `safetyGatesIntact=true`, `disclosureIntact=true`, `authFailClosedIntact=true`, `noSecretsLeaked=true`, `behaviorAsIntended=true`, `scopeRespected=true`, `redBeforeFixVerified=true`, **keine Blocker**.

### 5.1 Unabhaengiger Testlauf

- Frischer Worktree, eigener Lauf: volle Suite auf `phase/ba-p6-fruehwarnung` — 2620/2620 pass, 0 fail (77s), beide Backends abgedeckt (58/58 pglite-/RLS-Tests gezielt nachgefahren).
- Mit 8 eigenen Zusatztests: 2628/2628 pass, 0 fail, kein Flake beobachtet.

### 5.2 Eigene adversariale Testdatei (8/8 gruen)

Gebaut mit **echtem** state-ops-Store hinter dem Gate (statt des Autor-Fakes, der die Warnung immer meldet):

- **R1**: zehn Anrufversuche ueber der Schwelle → genau ein Ereignis, alle 10 Reserven echt gebucht.
- **R2**: haengende SMS (Promise loest nie auf) → Gate liefert `null` in unter 500ms, Reserve steht, Lock frei.
- **R3**: synchron werfendes `audit()` → kein 402, Reserve intakt.
- **R4**: Emission liegt nachweislich ausserhalb des Store-Locks (Lock-Zustand waehrend audit und sendSms beobachtet = false).
- **R5**: AUS-Zustand (percent=0 + SMS-Ziel leer) → 0 Ereignisse, 0 messaging()-Zugriffe, Marker null.
- **R6**: Audit-Detail matcht strikt `/^summe_cents=\d+ monat=\d{4}-\d{2}$/`, enthaelt weder tenantId noch Ziel-/Absendernummer noch requestedBy.
- **R7**: Praedikate verhaltensbasiert nebeneffektfrei (State-Snapshot vor/nach 5x Aufruf identisch).
- **R8**: ueber dem Cap lehnt das Gate weiter ab, dabei feuert keine Warnung und wird keine Reserve gebucht.

### 5.3 Mutationsproben gegen Vakuitaet — alle drei gefangen

- Marker-Zuweisung entfernt → R1 rot (10 statt 1 Ereignis).
- Emission ins Lock verschoben → R4 rot ("audit lief unter gehaltenem Store-Lock").
- SMS awaitet → R2 laeuft in Test-Timeout (8000ms) — beweist, dass die ausgelieferte Fassung genau das nicht tut (Anruf wuerde sonst nie zustande kommen).

### 5.4 Byte-Identitaet

Sonde (`denial-probe.mjs`) druckt alle Ablehnungen des `reserve_budget`-Gates plus die vollstaendige Gate-Reihenfolge; Ausgabe auf `master` (768df00) und Phase-Branch per Diff verglichen → **byte-identisch**, inkl. Fehlertexte und Audit-Details.

### 5.5 Haertester Punkt (Warnung gefaehrdet nie einen Anruf) — bestanden

Die Emission liegt strukturell nach `await store.withStoreLock`, nicht darin. Der Claim laeuft atomar im Lock, Audit + SMS danach. `sendSms` wird nicht awaitet und traegt sofort `.catch`; der ganze Rumpf liegt zusaetzlich in try/catch, der Claim in einem eigenen. Haengende SMS, asynchroner Reject, synchron werfendes `messaging()` und werfendes `audit()` wurden gefahren: in jedem Fall liefert das Gate `null`, die Reserve bleibt exakt gebucht, der Lock ist frei.

### 5.6 Concerns (keine Blocker, Hinweise fuer P7)

1. Die Warn-SMS geht mit `ctx.fromNumber` (der DID des Tenants, der die Schwelle gerissen hat) als Absender raus und erzeugt kein `usage_event` — anders als die Summary-SMS. Kosten vernachlaessigbar (~1 SMS/Monat/Prozess), aber unverbuchter Betrag und der Betreiber sieht eine Kunden-DID als Absender. Sollte vor P7 bewusst entschieden werden.
2. Der Entprellungs-Marker ist prozess-lokal; auf Render kann die Warnung nach jedem Neustart erneut feuern. Vom Plan ausdruecklich akzeptiert ("nie stumm"), am Code bestaetigt.
3. `PLATFORM_ALERT_SMS_TO` wird nicht auf E.164 validiert und hat keinen Boot-Guard; ein Tippfehler faellt nur als geloggter SMS-Fehler auf. `render.yaml` liefert die Variable leer aus — solange sie leer ist, existiert die Warnung nur im Audit-Log. Das ist exakt das im Plan benannte Risiko "Schwelle ohne verdrahteten Kanal" und damit eine harte P7-Vorbedingung, kein P6-Defekt.
4. `logWarningFailure` loggt `e.message` aus dem Provider-SDK; eine Provider-Fehlermeldung koennte theoretisch die (betreiber-eigene) Alarmnummer echoen. Kein Secret, keine Tenant-PII — akzeptabel.

---

## 6. Clean-Code-Audit

**Verdikt: PASS — keine S1/S2-Befunde.** `blocker=false`. Diff sauber, fail-soft korrekt umgesetzt, volle Suite 2620/0 gruen (inkl. 16 neuer Tests), keine Gate-Aenderung nachgewiesen (T15 Quelltext-Scan). Nur kosmetische S4-Hinweise.

### S1 (Blocker)
Keine.

### S2 (schwerwiegend, kein Blocker mehr noetig)
Keine.

### S3 (bestandene Checks, dokumentiert)
- **N7-Check bestanden**: `claimPlatformSpendWarning` (Check+Mutation, Muster `tryReserveOutboundBudget`) und `emitPlatformSpendWarning` (Audit+SMS) tragen ihren Nebeneffekt korrekt im Namen; `platformSpendObservedCents`/`platformWarnThresholdScaled` sind reine Queries und auch so benannt — keine Verstoesse gefunden.
- **G25 bestanden**: `PERCENT_SCALE=100` ist eine benannte Konstante mit Begruendungskommentar; keine nackten Magic Numbers in der neuen Logik (Default 80 in `config.js`/`.env.example`/`render.yaml` ist dokumentierter Konfigurationswert, kein verstecktes Magic Number).

### S4 (kosmetisch)
- Minimale, bewusst dokumentierte Duplizierung: `platformSpendObservedCents` (state-ops.js) berechnet `total + reservationsTotal(s)` parallel zu `globalSpendOrDeny`/`globalReserveExceedsBudget`, statt diese wiederzuverwenden — Begruendung im Code (Vermeidung des `denyCorruptUsage`-Seiteneffekts auf einem reinen Beobachtungspfad) ist nachvollziehbar; als moegliche spaetere Extraktion vermerkt (gemeinsamer "bookable total"-Helfer ohne Seiteneffekt).
- `PLATFORM_ALERT_SMS_TO` wird in `config.js` nicht auf E.164-Format geprueft (nur `|| ""`); Fehlverhalten faengt der fail-soft try/catch in `emitPlatformSpendWarning` ab (durch T10/T11 belegt), ein Boot-Zeit-Format-Check waere aber sauberer, bevor die Variable in Produktion scharf geschaltet wird.
- Die Warn-SMS wird technisch "from" der Nummer des Tenants gesendet, dessen Call zufaellig die Monatsschwelle ueberschritten hat — funktional harmlos (fail-soft, kein Gate-Effekt), operativ evtl. verwirrend fuer den Betreiber; nur Betriebsnotiz.

### Top-TODOs aus dem Audit
1. Vor produktivem Setzen von `PLATFORM_ALERT_SMS_TO`: optional E.164-Formatpruefung beim Config-Boot ergaenzen (aktuell nur laufzeit-fail-soft).
2. Optional: gemeinsamen Bookable-Total-Helfer fuer `platformSpendObservedCents` und `globalSpendOrDeny` extrahieren, falls die Logik erneut divergiert (aktuell nur 2 Zeilen, nicht dringend).
3. Keine harten Fixes noetig — mergefaehig aus Clean-Code-Sicht.

---

## 7. Fix-Runden

Keine. Die Implementierung erreichte PASS beim ersten Review-Durchlauf; das FIXES-Segment im Workflow-Output ist leer. Es waren weder Safety- noch Clean-Code-Blocker vorhanden, die eine Nachbesserung erzwungen haetten.

---

## 8. Offene Deploy-Vorbedingungen

Diese Phase ist gemergt-faehig, aber **nicht** deployed. Vor einem Deploy bzw. vor P7 sind folgende Punkte zu klaeren (aus Plan §8 "Pre-Mortem", Safety-Concerns und Clean-Code-S4 zusammengezogen):

1. **`PLATFORM_ALERT_SMS_TO` muss im Render-Dashboard auf eine echte Betreiber-Nummer gesetzt werden**, bevor die Warnung praktisch nutzbar ist — solange leer, existiert die Warnung nur im Audit-Log (Server-Stdout), niemand wird aktiv benachrichtigt. Dies ist die dokumentierte Todesursache "niemand hat die Warnung gelesen" und eine harte Vorbedingung fuer P7 (formal vs. praktisch erfuellt).
2. Bewusst **kein Boot-Guard** fuer diese Env-Variable (Entscheidung im Plan begruendet: ein Boot-Refusal wegen einer reinen Beobachtungsluecke wuerde ein Kostenproblem gegen einen Telefonie-Totalausfall auf einem Host ohne Shell eintauschen — dieselbe Entscheidungsregel wie in einer frueheren Phase). Optional waere eine reine Format-(E.164)-Pruefung beim Config-Boot sauberer als der jetzige laufzeit-fail-soft-Pfad (Clean-Code-TODO 1).
3. Absender-Frage bewusst offen gelassen: die Warn-SMS geht ueber die DID des zufaellig ausloesenden Tenants, wird nirgends kostenverbucht (kein `usage_event`), maximal 1x/Monat. Vor P7 sollte bewusst entschieden werden, ob das operativ akzeptabel bleibt oder ob eine dedizierte Plattform-Absendernummer eingefuehrt wird.
4. Der Entprellungs-Marker ist prozess-lokal (nicht persistiert) — auf Render kann die Warnung nach jedem Neustart innerhalb desselben Monats erneut feuern. Vom Plan als akzeptierte Asymmetrie festgehalten ("zu laut ist erlaubt, stumm nie"); keine Aenderung noetig, nur als Betriebswissen relevant.
5. Kein Merge nach `master` im Rahmen dieses Reports — der Branch `phase/ba-p6-fruehwarnung` liegt bereit, Merge-Entscheidung liegt beim Lead-Prozess.
