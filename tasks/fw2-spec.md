# Spec FW2 — Ein Guthaben-Ausfall beim LLM-Anbieter darf nicht die ganze Gespraechsfaehigkeit stilllegen

Quelle: `HANDOVER-FLOW-2026-09-07.md`, Befund **F2**, struktureller Teil. Der akute Teil
(DeepSeek-Guthaben aufladen bzw. `LLM_PROVIDER` umstellen) ist Konto-/Env-Arbeit des Owners und
NICHT Teil dieser Phase.

## Gemessener Ausgangszustand (Live-Log, nicht abgeleitet)

```
2026-09-06T12:44:23Z  [precall-briefing] uebersprungen: DeepSeek-Adapter: HTTP 402 - Insufficient Balance
2026-09-06T12:44:23Z  [opening-line]     uebersprungen: DeepSeek-Adapter: HTTP 402 - Insufficient Balance
```

Wiederkehrend ueber Tage, auch waehrend echter Anrufe. Wirkung im Budget-Weg: der Fehler landet im
`catch` von `/voice/turn` (`src/routes/voice.js`, Zweig `degradedSpeechFor(err, locale)` mit
`endCall: true`) — der Agent verabschiedet sich und legt auf. Aus Kundensicht: der Assistent nimmt
ab und beendet das Gespraech.

Zwei getrennte Defekte, beide in dieser Phase:

1. **Kein Ausweichen.** `LLM_PROVIDER` waehlt prozessweit genau einen Anbieter
   (`src/llm/provider.js`, `src/llm/registry.js` `adapterEntry()`). Faellt er aus, faellt er ganz
   aus — fuer jeden Turn, jeden Anruf, unbegrenzt lange.
2. **Kein Alarm auf dem Budget-Weg.** `isProviderBillingError` (`src/llm.js`) existiert bereits und
   wird im Telnyx-Assistant-Weg ausgewertet (`src/telnyx-llm-shim.js`, `logShimBillingAlarm`). Der
   Budget-Weg (`/voice/turn`) kennt diese Unterscheidung nicht — dort ist der Guthaben-Ausfall
   nicht von einem beliebigen Fehler unterscheidbar.

---

## FW2-A — Guthaben-Latch mit Ausweich-Anbieter

### Warum NICHT ein Zweitversuch im selben Turn

Der Voice-Webhook hat einen harten externen Deckel: `PROVIDER_WEBHOOK_HARDCUT_MS = 15000`
(`src/turn-budget.js`), abzueglich `TURN_NETWORK_RESERVE_MS = 1500` und der Synthese-Zeit. Ein
zweiter vollstaendiger Anbieter-Versuch im selben Turn verdoppelt die Worst-Case-Latenz und
sprengt das Budget, das `turn-budget.js` beim Boot nachrechnet — der Anruf reisst dann NICHT
kontrolliert ab, sondern laeuft in den Provider-Hardcut. Das waere schlechter als der heutige
Zustand.

### Entwurf

**Latch statt Retry.** Der erste Turn, der am Guthaben scheitert, degradiert wie heute. Er setzt
dabei einen prozessweiten Vermerk "Primaeranbieter ist zahlungsblockiert". Ab dem NAECHSTEN
Aufruf routet die Registry auf den Ausweich-Anbieter — ohne Zusatzlatenz im Normalbetrieb, weil nie
zwei Anbieter je Anfrage versucht werden.

1. **Konfiguration** (`src/config.js` + `.env.example` + `render.yaml` pruefen):
   - `LLM_PROVIDER_FALLBACK` — zulaessige Werte wie `LLM_PROVIDER` (`enumEnv` gegen
     `LLM_PROVIDER_VALUES`), **Default leer/ungesetzt = Funktion aus**. Ungesetzt heisst:
     Verhalten byte-identisch zum Bestand.
   - `LLM_BILLING_LATCH_COOLDOWN_MS` — wie lange der Vermerk haelt, benannte Konstante mit
     Default (Vorschlag 15 Minuten), damit ein wieder aufgeladenes Konto ohne Neustart
     zurueckfaellt.
   - Boot-Refusal fail-closed: `LLM_PROVIDER_FALLBACK` gleich `LLM_PROVIDER` ist ein
     Konfigurationsfehler (kein Ausweichen moeglich) und muss beim Boot abgelehnt oder
     mindestens als Konfig-Warnung gemeldet werden — Muster der bestehenden
     `FORCE_NUMBER_COUNTRY`-Boot-Warnung. Ein gesetzter Fallback ohne passenden API-Key ist
     ebenfalls ein Boot-Befund (Muster `DEEPSEEK_API_KEY (weil LLM_PROVIDER=deepseek)` in
     `src/config.js`).

2. **Latch** — neue kleine Einheit, rein und testbar, KEINE Zeit aus `Date.now()` im Fachcode
   verdrahtet (Uhr injizierbar, Muster Circuit-Breaker in `src/llm.js`):
   - `markBillingBlocked(provider, nowMs)` / `billingBlocked(provider, nowMs) -> boolean`.
   - Der Vermerk ist prozessweit (wie die Anbieterwahl selbst) und laeuft nach dem Cooldown ab.

3. **Routing** in `src/llm/registry.js`: `adapterEntry()` waehlt den Fallback, wenn der
   Primaeranbieter gelatcht ist UND ein Fallback konfiguriert ist. Der Eintrag bleibt eine
   Datenstruktur-Entscheidung — **keine Ternaries im Fachcode**, wie der Modulkopf es schon
   festhaelt. `activeLlmErrors()` muss die Klassifikation des TATSAECHLICH benutzten Anbieters
   liefern, sonst klassifiziert der Fallback-Fehler nach den Marken des Primaeranbieters.

4. **Setzen des Latch**: an genau EINER Stelle, dort wo der Guthaben-Fall bereits klassifiziert
   wird (`isProviderBillingError`, `src/llm.js`). Nicht in beiden Aufrufwegen doppelt (G5/S2).

### Invarianten (nicht verhandelbar)

- `LLM_PROVIDER_FALLBACK` ungesetzt -> **byte-identisches Verhalten** zum Bestand. Kein neuer
  Zweig, der ohne Konfiguration Wirkung entfaltet.
- Der Latch wird **ausschliesslich** von `isProviderBillingError` ausgeloest. Transiente Fehler
  gehoeren weiterhin Retry und Circuit-Breaker (`src/llm.js`) — kein zweiter, konkurrierender
  Ausfallmechanismus fuer denselben Fall.
- **Nie zwei Anbieter je Anfrage.** Kein In-Turn-Zweitversuch, keine Verdopplung der Latenz, keine
  Aenderung an `llmRequestTimeoutMs`/`llmMaxRetries`/`turn-budget.js`.
- Kein Secret in Logs, Fehlern oder Alarmtexten (Regel 4). Der Alarm nennt Anbieter-Namen und
  Anlass, nie einen Key.
- Der Offenlegungssatz, die Safety-Gates und die Signaturpruefung werden nicht beruehrt.
- Kosten-Sichtbarkeit: ein Wechsel auf den Ausweich-Anbieter aendert den Preis pro Turn. Er MUSS
  deshalb eine Audit-/Log-Zeile erzeugen (s. FW2-B) — ein stiller Anbieterwechsel ist ein
  Befund, kein Feature.

### Tests

- Latch gesetzt + Fallback konfiguriert -> die naechste Anfrage geht an den Fallback-Adapter
  (Adapter-Seam-Double zaehlt Aufrufe).
- Latch gesetzt + **kein** Fallback konfiguriert -> unveraendertes Bestandsverhalten.
- Cooldown abgelaufen (injizierte Uhr) -> Routing faellt auf den Primaeranbieter zurueck.
- Transienter Fehler (5xx/Timeout) setzt den Latch **nicht**.
- `activeLlmErrors()` liefert nach dem Latch die Klassifikation des Fallback-Anbieters.
- Konfig: `LLM_PROVIDER_FALLBACK === LLM_PROVIDER` wird beim Boot abgelehnt/gemeldet.

---

## FW2-B — Der Guthaben-Ausfall wird auf JEDEM Weg sichtbar

`isProviderBillingError` ist vorhanden und wird im Telnyx-Assistant-Weg bereits alarmiert
(`logShimBillingAlarm`). Der Budget-Weg (`/voice/turn`-Catch) unterscheidet den Fall nicht.

**Aenderung:** derselbe Alarm auch im Budget-Weg — EINE gemeinsame Alarm-Funktion (G5), nicht
eine zweite Kopie der Log-Zeile. Zusaetzlich wird bei einem Wechsel auf den Ausweich-Anbieter
(FW2-A) genau einmal je Latch-Setzung eine Zeile geschrieben, die Primaeranbieter, Fallback und
Anlass nennt.

**Nicht Teil dieser Phase:** eine neue Alarm-SENKE (SMS/E-Mail/Pager). Der Alarm nutzt den
bestehenden Weg. Eine zusaetzliche Senke waere eine eigene Entscheidung mit eigenen Kosten.

**Invariante:** der Degradations-/Sendepfad selbst bleibt unveraendert. `degradedSpeechFor(...)`
mit `endCall: true` bleibt, solange kein Fallback greift — hier wird beobachtet, nicht umgebaut.

### Tests

- Budget-Weg mit Guthaben-Fehler -> Alarm-Zeile vorhanden, Degradation unveraendert.
- Budget-Weg mit beliebigem anderem Fehler -> **kein** Guthaben-Alarm (keine falsche Meldung).
- Der bestehende Shim-Alarm-Test bleibt ohne Anpassung gruen.

---

## Pre-Mortem (ein Jahr spaeter, die Phase war ein Fehler — was ist passiert?)

1. **Der Fallback hat still Geld verbrannt.** Das Primaerkonto lief leer, niemand merkte es, und
   monatelang lief alles ueber den teureren Anbieter. *Massnahme:* der Latch schreibt bei jeder
   Setzung eine Alarm-Zeile (FW2-B) und laeuft nach dem Cooldown ab — er ist ein Notbehelf mit
   Verfallsdatum, kein stiller Dauerzustand.
2. **Der Fallback hat die Turn-Latenz gesprengt und Anrufe in den Provider-Hardcut laufen
   lassen.** *Massnahme:* Kernentscheidung dieser Spec — nie zwei Anbieter je Anfrage. Der Latch
   kostet im Normalbetrieb null Millisekunden.
3. **Der Latch hat bei einem Fehlalarm den Anbieter unnoetig gewechselt.** Eine falsch als
   Guthaben-Fehler klassifizierte Antwort haette den Wechsel ausgeloest. *Massnahme:* die
   Klassifikation wird NICHT erweitert — es bleibt bei `isProviderBillingError` in seiner heutigen
   Form; der Cooldown begrenzt den Schaden auf ein Zeitfenster.
4. **Zwei Ausfallmechanismen sind sich in die Quere gekommen.** Circuit-Breaker und Latch haetten
   sich gegenseitig zurueckgesetzt. *Massnahme:* strikt getrennte Anlaesse — transient gehoert dem
   Breaker, Guthaben dem Latch. Kein gemeinsamer Zustand.

## Deterministische Abnahme

```
node --check src/llm.js src/llm/registry.js src/config.js
npm test
```

Erwartet: gruen. Bekannt vorbestehend rot und NICHT von dieser Phase verursacht:
`test/kv2-10-tarifpaar.test.js` (2 Faelle, auf unveraendertem `master` reproduziert).
Zusaetzlich: bei ungesetztem `LLM_PROVIDER_FALLBACK` darf sich KEIN Bestandstest aendern muessen —
tut er es doch, ist die Byte-Identitaets-Invariante verletzt.
