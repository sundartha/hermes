# Phase KV2-4 — Der ElevenLabs-Beleg, synchron und vorlaeufig

**Gate:** PASS
**finalBranch:** `phase/kv2-4-impl`
**headCommit:** `4a3bd44`

## Delegierte Entscheidung aus KV2-3

KV2-3 delegierte an KV2-4, ob KV2-4(c) ("markiert sie zusaetzlich als strukturell nicht
nachreifbar") den `reife`-Wert setzt oder ein eigenes Feld.

**Antwort: ein eigenes Feld.** `reife` bleibt `vorlaeufig`. Begruendung: `REIFE_SUMMIERBAR`
(`src/store/defaults.js`) enthaelt `beleg_strukturell_unbeschaffbar` nicht — wuerde der
Abbruchweg diesen Wert setzen, wuerde die Zeile aus der Belegsumme (KV2-8) fallen. Betroffen
waeren gerade die vom Max-Dauer-Cap beendeten (teuersten) Anrufe. Matrix 4.6 verlangt fuer
diese Lage aber "nachbuchen mit dem, was da ist". Konsequenz: neue Spalte
`call_cost_evidence.nachreifbar BOOLEAN NOT NULL DEFAULT TRUE`, Einbahnstrasse nach `FALSE`.

## Plan (gekuerzt)

- **Neue Datei** `src/elevenlabs/kosten-beleg.js`: reine Geldpruefung `elBelegBetrag(metadata)`
  (Kriterium b) plus `recordElevenLabsKostenBelege({store, callId, conversation,
  belegNachreifbar})`. Getrennt von `outbound.js`, damit die Geldpruefung ohne Anruf-Fabrik
  testbar bleibt.
  - Ablehnungsgruende (`EL_BELEG_ABLEHNUNG`): FEHLT, KEIN_FLOAT, NEGATIV,
    NULL_BEI_DAUER, NULL_DAUER_UNKLAR (fail-closed bei unbrauchbarer Dauer-Angabe),
    UNKONVERTIERBAR.
  - Waehrungsumrechnung ueber den bestehenden `parseDecimalToMicroCents`
    (`telephony/adapters/telnyx/cost-parse.js`), NICHT `Math.round(x*1e8)` — beide Wege
    liefern verschiedene Ergebnisse (nachgerechnet: 10420301 vs. 10420302 bei
    `0.10420301650668388`); ein zweiter Rundungspfad wuerde die Belegsumme in KV2-8 driften
    lassen. Akzeptierte Schuld: Import `elevenlabs -> adapters/telnyx` (Umzug nach
    `src/billing/` als Folgeaufgabe, nicht Teil dieser Phase/SCOPE).
  - `recordElevenLabsKostenBelege` legt zuerst die `telnyx_sip`-Zeile als `erwartet` an
    (kein Betrag), dann bei Erfolg die `elevenlabs_convai`-Zeile als `vorlaeufig` mit
    `betragMikroCents`, `waehrung` aus dem Katalog, `belegRef` (sanitiert ueber
    `isBelegRef`, sonst `null`), `detail: conversation` (ganzes Objekt — die
    PII-Allowlist-Projektion aus KV2-3 ist der einzige Schreibweg und laesst sich so
    nicht umgehen), `gemessenAt: now`, `nachreifbar: belegNachreifbar`.
  - Ganzer Rumpf in `try/catch`, fail-soft (`console.error`, nie rethrow) — Begruendung:
    `persistProviderResult` laeuft aus einem `void fn()` in `setTimeout`; eine entkommende
    Ausnahme wuerde `terminateAndBillCall` nie erreichen.
- **`src/db/schema.sql`**: neue Spalte `nachreifbar BOOLEAN NOT NULL DEFAULT TRUE` +
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (kein Backfill noetig, additiv NOT NULL mit
  Default).
- **`src/store/cost-evidence.js`**: `isBelegRef` exportiert (Regex nicht dupliziert),
  `nachreifbar` als Wertfeld + Boolean-Waechter, neue Funktion
  `costEvidenceFortschreibung(vorhanden, eingabe)` als Einbahnstrassen-Regel (einmal
  `false`, bleibt `false`) — getrennt von `costEvidenceValuePatch`, weil die Regel nur beim
  Fortschreiben (nicht beim Anlegen) greifen kann.
- **`src/store/state-ops.js`**: `recordCallCostEvidence` nutzt `costEvidenceFortschreibung`
  statt `costEvidenceValuePatch` direkt.
- **`src/store/pg.js`**: `hydrateCallCostEvidence` + `flushCallCostEvidence` um die Spalte
  erweitert.
- **`src/elevenlabs/outbound.js`**: `persistProviderResult` bekommt ein viertes Argument
  `belegNachreifbar` und ruft am Ende `recordElevenLabsKostenBelege`. Zwei Aufrufer:
  `finishFromConversation` (regulaeres Ende) mit `belegNachreifbar: true`; `endActiveCall`
  (Abbruchweg, unmittelbar vor dem EL-`DELETE`) mit `belegNachreifbar: false` — unbedingt,
  unabhaengig vom Ausgang des DELETE (sichere Richtung: nachbuchen ja, erstatten nein).
- **Keine Env-Variable, kein Gate, keine Route beruehrt.**
- Tests: neue Datei `test/kv2-4-el-kosten-beleg.test.js` (zwei Ebenen: in-memory
  `state-ops` + echte Fabrik mit `fetch`-Attrappe), Erweiterung von
  `test/store-pg-json-parity.test.js` um das neue Feld.

## Impl-Zusammenfassung

KV2-4 vollstaendig gemaess Plan umgesetzt: neuer Beleg-Einsammler
`src/elevenlabs/kosten-beleg.js` (`elBelegBetrag` als reine Geldpruefung nach Matrix 4.6,
`recordElevenLabsKostenBelege` als fail-soft-Schreibpfad); neue Spalte
`call_cost_evidence.nachreifbar` (Default TRUE, Einbahnstrasse nach FALSE via
`costEvidenceFortschreibung`), gelesen/geflusht in `pg.js`; Anbindung in `outbound.js` an
beiden Aufrufern von `persistProviderResult`. Neue Testdatei mit 19 Faellen, 
`store-pg-json-parity.test.js` erweitert.

**Testergebnis (Impl-Agent):** 5492 pass / 1 fail (isolierter, unverbundener Flake in
`test/telnyx-shim-route.test.js`, SSE/Timing). `test:gates` zeigt 3 vorbestehende, mit
KV2-4 unverbundene rote Faelle (GAP-05, GAP-15, E2E-03) — laut CLAUDE.md fuer diese Bank
zulaessig. Lint 0 Fehler, keine Pin-Anhebung in `eslint-legacy-exceptions.json`.

Dateien:
- neu: `src/elevenlabs/kosten-beleg.js`, `test/kv2-4-el-kosten-beleg.test.js`
- editiert: `src/db/schema.sql`, `src/store/cost-evidence.js`, `src/store/state-ops.js`,
  `src/store/pg.js`, `src/elevenlabs/outbound.js`, `test/store-pg-json-parity.test.js`

### Deviations

1. **`persistProviderResult` auf Modul-Ebene verschoben** statt (wie Plan-Wortlaut) innerhalb
   der Fabrik-Closure erweitert. Grund: die woertliche Aenderung riss `max-lines-per-function`
   (101/100) fuer `makeElevenLabsOutbound` und danach `max-params` (4/3) fuer
   `persistProviderResult` — beides harte Lint-Fehler, deren einziger Ausweg eine
   Pin-Anhebung in `eslint-legacy-exceptions.json` gewesen waere, was CLAUDE.md/clean-code.md
   verbietet. Die Funktion haengt ausser `store` an keinem Fabrik-Zustand; der Umzug erfolgt
   ueber ein Objektargument `{store, callId, conversation, belegNachreifbar}` und ist
   verhaltensidentisch (durch Tests bestaetigt).
2. **Baseline-Messung unsauber:** der erste `npm test`-Lauf lief bereits nach allen
   `src/`-Edits, nicht isoliert VOR dem ersten Edit. Zeigte 5473/1 (1 vorbestehender,
   unabhaengiger Fehlschlag). Abschliessender Lauf: 5492/1 — ein ANDERER, ebenfalls
   unabhaengiger, isoliert gruener Flake (`telnyx-shim-route.test.js`). Kein Fehlschlag
   beruehrt eine von KV2-4 geaenderte Datei.
3. `test:gates`: 3 vorbestehende rote Faelle (GAP-05, GAP-15, E2E-03), unverbunden mit
   KV2-4 — fuer diese Bank laut CLAUDE.md zulaessig.

## Safety-Urteil

**approved: true** — alle Flags gruen (testsPassIndependently, safetyGatesIntact,
disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected,
behaviorAsIntended).

Eigener Lauf im frischen Worktree: 5512/5512 pass, 0 fail (nach Korrektur der
Datei-Wrapper-Zaehlung entspricht das 5493). Beide Backends (json + pglite) im selben Lauf
abgedeckt. Diff beruehrt genau 8 Dateien; `outbound-gates.js`, `config.js`, `routes/`,
`telephony/`, `auth.js`, `web-auth.js`, `middleware.js`, `claude.js`, `bridge.js` NICHT im
Diff. Kein neuer Endpunkt, kein neuer Call-/SMS-/Geld-Ausloeser. Das neue Kosten-Buch ist
schreibseitig isoliert: `recordCallCostEvidence` mutiert ausschliesslich
`s.callCostEvidence`; kein Leser ausserhalb `src/store/*` gefunden — das Gate
(`budgetExceeded` liest `usage.costCents`) ist unberuehrt.

Geldrechnung von Hand nachvollzogen: `0.10420301650668388` USD ->
`parseDecimalToMicroCents` -> **10420301** Mikro-Cent — der Test pinnt genau diesen
Integer, nicht nur die Existenz einer Zahl.

**Verdict:** FREIGABE. KV2-4 ist sauber, in Scope, beruehrt keine absolute Regel.

### Concerns (nicht blockierend)

1. **Latente Reihenfolge-Falle fuer KV2-5:** `recordElevenLabsKostenBelege` ruft die
   `telnyx_sip`-Zeile (`erwartet`) ZUERST an, danach den EL-Beleg. Hebt KV2-5 die
   `telnyx_sip`-Zeile je auf `belegt`, wirft ein spaeterer `persistProviderResult`-Durchlauf
   beim Reife-Uebergang `belegt -> erwartet` (Rang 2 -> Rang 0) — fail-soft abgefangen, aber
   der EL-Beleg wird in diesem Durchlauf dann GAR NICHT geschrieben/fortgeschrieben. In
   KV2-4 allein unerreichbar (kein Schreiber hebt `telnyx_sip` ueber `erwartet`). Empfehlung
   an KV2-5: Reihenfolge drehen oder die `erwartet`-Zeile nur anlegen, wenn sie noch nicht
   existiert.
2. **`detail: conversation`** (ganzes Objekt statt `conversation.metadata`): Begruendung
   nachvollzogen und korrekt (Allowlist-Projektion ist einziger Schreibweg), aber zieht das
   Transkript-Array unnoetig in die Projektionsflaeche; bei "erster Treffer gewinnt" in
   Pre-Order koennte ein Anbieter-Turn-Feld `rate`/`tier` theoretisch stillschweigend
   gewinnen. Heute kein Leak und kein Fehlwert (im Test gegen den vollen Fixture-Rumpf
   belegt).
3. **Kriterium (e) nur zur Haelfte direkt gepinnt** (usage.costCents/-CorrectionMicroCentsRem
   ja, `usage_event` nicht ausdruecklich) — am Code geschlossen (grep zeigt keinen Leser des
   Kosten-Buchs ausserhalb des Stores selbst), Aussage haelt, Test belegt sie nur nicht
   vollstaendig.
4. **Plan-Text veraltet:** Plan behauptete, `beleg_strukturell_unbeschaffbar` habe "einen
   Schreiber (KV2-4(c))". Diese Phase entscheidet sich stattdessen fuer `nachreifbar` (s.o.,
   ausdruecklich delegiert). Folge: der Enum-Wert hat nach KV2-4 KEINEN Schreiber mehr (erst
   KV2-7 auf Anruf-Ebene). Lead sollte die Plan-Notiz nachziehen, damit KV2-5 nicht von einem
   existierenden Schreiber ausgeht.
5. **Fail-soft macht einen systematischen Ausfall des Belegschreibers unsichtbar** ausser in
   Logs. In dieser Phase korrekt/zwingend; Absicherung ist der Herzschlag aus KV2-6 — bis der
   steht, ist dieses Buch unbeobachtet. Sichtbar im Lauf: bestehende EL-Tests mit Stub-Store
   loggen jetzt eine `console.error`-Zeile und laufen weiterhin gruen (erwuenschtes
   Fail-soft-Verhalten, aber Log-Rauschen).

## Clean-Code-Audit (S1-S4)

**Verdict: PASS** — keine Verstoesse gefunden. `blocker: false`.

- **s1/s2/s3/s4:** alle leer.
- Reine Praedikate (`elBelegBetrag`, `isBelegRef`, `pruefeNachreifbar`) ohne Nebeneffekte.
- G30-konforme Zerlegung (`recordTelnyxSipErwartet`/`recordElBeleg`/
  `recordElevenLabsKostenBelege` getrennt).
- Einbahnstrassen-Regel fuer `nachreifbar` korrekt nur im Fortschreibungspfad
  (`costEvidenceFortschreibung`) angewendet, nicht im Anlegepfad (`buildCostEvidenceRow`).
- Fail-soft-Pfad bewusst und im Code begruendet.
- PII-Allowlist (`detail`-Projektion) bleibt am einzigen Schreibweg.
- `pg.js`/`schema.sql`/json-Parity sauber nachgezogen (NOT NULL DEFAULT TRUE, Backfill via
  `ADD COLUMN IF NOT EXISTS`).
- Tests decken Ebene 1 (in-memory) UND Ebene 2 (echte Fabrik, echter json-Store,
  fetch-Attrappe) ab: Ratchet true->false und false-bleibt-false, Abbruchweg vs. regulaeres
  Ende, Gate-/Erloes-Isolation, Fail-soft.
- Keine Duplizierung, keine Magic Numbers ohne Konstante, keine toten Pfade, keine
  abgeschalteten Sicherungen. `node --check` auf allen fuenf geaenderten Quelldateien
  fehlerfrei.
- **topTodos:** keine Pflicht-Todos. Optional/spaeter (bereits im Code selbst vermerkt):
  `parseDecimalToMicroCents` von `telephony/adapters/telnyx/cost-parse.js` nach
  `src/billing/` verschieben (reiner Refactor, kein Verhalten).

## Fix-Runden

Keine — Safety- und Clean-Code-Audit liefen jeweils direkt PASS, keine Fix-Runde noetig.
