# Befund: Kostenpfade im Code (Auftrag "code", 2026-08-30)

Diese Datei beantwortet NUR die Code-Kartierungs-Fragen aus `tasks/kostenv2/AUFTRAG.md`.
Was dort als BELEGT steht (B1-B6), wird hier nicht neu hergeleitet, nur an Datei:Zeile
verankert, wo es fuer die Architektur-Frage gebraucht wird. Alles unten ist am Code
gelesen (Stand des Arbeitsbaums dieser Session), nicht am laufenden System gemessen.

## 1. Die zwei Buecher: Struktur und EINE physische Schreibkante je Buch

**Buch A (Verbrauchs-Ledger, `usage_event`, append-only, Stripe-Meter-Quelle):**
Genau EINE Schreibfunktion, `recordUsageEvent` (`src/store/state-ops.js:4096-4128`).
Sie wirft fail-closed bei unbekanntem `kind` (Zeile 4112-4113, `USAGE_EVENT_KIND`-Enum-
Pruefung). Drei Aufrufer im ganzen Repo (`grep -rn "recordUsageEvent(" src/` ausserhalb
von `state-ops.js`/`json.js`/`pg.js`, die nur den Store-Wrapper bilden):

| Aufrufer | Datei:Zeile | Kind |
|---|---|---|
| `meterAiTokens` | `src/llm-usage.js:25` | `AI_TOKEN` |
| SMS-Beleg nach erfolgreichem Send | `src/telephony/call-finish.js:353` | `SMS` |
| `recordVoiceMinuteMeter` | `src/billing/metering.js:104` | `VOICE_MINUTE` |
| `recordNumberMonthMeter` | `src/billing/metering.js:170` | `NUMBER_MONTH` |

**Buch B (Gate-Achse, `usage.costCents`/`usage.spendMonthCostCents`, gelesen von
`budgetExceeded`):** Genau EINE physische Schreibkante, `bookCents`
(`src/store/state-ops.js:3609-3615`) - sie mutiert `costCents` UND stempelt/akkumuliert
`spendMonthCostCents` in einem Schritt. Fuenf Aufrufer, alle in `state-ops.js` selbst
(kein Aufrufer ausserhalb der Datei ruft `bookCents` direkt):

| Aufrufer (Datei:Zeile) | Oeffentliche Funktion, die ihn exportiert | Wer ruft sie |
|---|---|---|
| `state-ops.js:3655` (in `trackUsage`) | `trackUsage` (`state-ops.js:3640`) | `store.trackUsage` in `src/llm-usage.js:63`/`74` |
| `state-ops.js:3669` (in `addUsageCostCents`, privat) | `addVoiceUsageCostCents` (`3679`), `addResearchFeeCostCents` (`3687`) | `metering.js:140`, `llm-usage.js:108/123` |
| `state-ops.js:3784` (in `bookCostCorrectionCents`, positiver Zweig) | `bookCostCorrectionCents` (`3780`) ueber `applyCostCorrectionCents` (`3798`) | `cost-truing.js:478` |
| `applyCreditCents` (`3756-3764`, eigene Kante, KEIN `bookCents`-Aufruf - eigene 3-Achsen-Logik mit 0-Boden) | `bookCostCorrectionCents` (negativer Zweig) | `cost-truing.js:478` |

Bedeutung: Buch B hat strukturell GENAU EINE Stelle, die `costCents` je erhoeht
(`bookCents`) und eine zweite, benannte fuer Gutschriften (`applyCreditCents`) mit
eigenem 0-Boden und Perioden-/Monats-Kompensation. Jede neue Kostenart, die Buch B
erreichen soll, MUSS ueber eine dieser beiden Kanten laufen - es gibt keinen dritten Weg,
der `usage.costCents` mutiert (verifiziert per `grep -n "costCents +=" src/store/state-ops.js`:
nur `bookCents:3610`, `applyCreditCents` rechnet ueber `Math.max(0, vorher + deltaCents)`
bei `3758`).

## 2. Ablauf am Call-Ende (Reihenfolge, IST-Zustand)

`src/telephony/call-finish.js` (Funktion `finishCall`, Aufrufkette
`terminateAndBillCall -> bill() -> finishCall`):

1. `metering.recordVoiceMinuteMeter(call)` (`call-finish.js:262`, NUR wenn
   `config.billing.paymentEnabled`) - Buch A, Schaetzung `minutes * callTariffCentsPerMin(call)`.
2. `metering.reconcileVoiceBudget(call)` (`call-finish.js:263`, IMMER) - Buch B, dieselbe
   Schaetzformel; schreibt zusaetzlich `estimatedCostCents` + `chargeAnchors` an den
   Call-Datensatz (`metering.js:141-144`, ueber `store.recordCallEstimatedCostCents`).
3. `store.markBilled(call.id)` (`call-finish.js:264`).
4. Erst NACH Schritt 1-3 (spaeter, asynchron, per Intervall-Sweep NICHT im
   `finishCall`-Pfad): `cost-truing.js` korrigiert `estimatedCostCents` gegen
   Telnyx-`/v2/detail_records`, IMMER nur fuer den Provider `call.provider` (heute
   ausschliesslich `"telnyx"`, s. `costRecordControlFor(call.provider)`,
   `cost-truing.js:588`).

Fuer den EL-Weg (`src/elevenlabs/outbound.js`) laeuft VOR Schritt 1-3 zusaetzlich
(synchron, im selben Tick, noch bevor `finishCall` ueberhaupt aufgerufen wird):

- `persistProviderResult(callId, conversation)` (`outbound.js:1283-1316`), aufgerufen aus
  `finishFromConversation` (`outbound.js:1332-1333`, regulaeres Ende) UND aus
  `endActiveCall` (`outbound.js:1452`, Abbruch-Pfad) - **beide Male mit der VOLLEN
  ElevenLabs-`conversation`-Antwort bereits im Speicher**, aus der aktuell NUR
  `analysis.transcript_summary`, `objectiveAchieved`, die vier ABNAHME-D1-Felder, der
  Absender (`recordAbsenderMessung`) und der Join-Schluessel
  `conversation.metadata?.phone_call?.call_id` (`outbound.js:1312`, ueber
  `store.recordSipCallId`) gelesen werden.
- `terminateAndBillCall(...)` (`outbound.js:1345`) ruft `finishCall` ueber `billThunk` -
  DIESELBE Kette wie oben, kein zweiter Buchungsweg.

## 3. Wo die ElevenLabs-Kosten heute NICHT eingehaengt sind (Bruchstellen im Code)

**Bruch 1 - `conversation.metadata.cost`/`cost_fiat`/`charging` wird an KEINER Stelle
gelesen.** `grep -rn "metadata.cost\|cost_fiat\|charging" src/` liefert 0 Treffer
ausserhalb von `AUFTRAG.md`. `persistProviderResult` haelt die komplette Antwort in der
Variable `conversation` (`outbound.js:1283`) und liest daraus gezielt einzelne Felder -
die Kostenfelder sind in DEMSELBEN Objekt vorhanden (per AUFTRAG B2 am Anbieter
gemessen), werden aber nirgends destrukturiert.

**Bruch 2 - der Join-Schluessel wird geschrieben, aber von `cost-truing.js` nicht
gelesen.** Der Call-Datensatz traegt `sipCallId` (`state-ops.js:389`, Kommentar
`state-ops.js:382-388` nennt es ausdruecklich "PHASE-6-VORAUSSETZUNG ... der EINZIGE
Join zwischen unseren zwei Kostenquellen auf der SIP-Trunk-Strecke") sowie
`elevenlabsConversationId` (`state-ops.js:380`). Beide werden befuellt
(`recordSipCallId`, `state-ops.js:918-928`, mit Form-Waechter `isTelnyxSipCallId` aus
`src/telephony/sip-call-id.js`; `recordElevenlabsConversationId`,
`state-ops.js:895-897`). `cost-truing.js:138` liest fuer den Join aber ausschliesslich:

    const providerLegIdOf = (call) => call.twilioSid || call.callControlId || null;

`sipCallId` fehlt in dieser Kette komplett - fuer jeden EL-Call ist der Ausdruck `null`,
`isRetrievable` (`cost-truing.js:581`) also `false`. Das ist exakt B1, jetzt mit der
Gegenstelle benannt, an der der fehlende Join beginnt.

**Bruch 3 - selbst mit korrigiertem `providerLegIdOf` bliebe der Telnyx-Adapter blind.**
`src/telephony/adapters/telnyx/voice.js:140` setzt
`const ANCHOR_ID_FIELD = "call_control_id";` und `assignCostRecords`
(`voice.js:903-918`) matcht Stufe 1 ausschliesslich `call_control_id === legId` gegen die
Roh-Belege. Ob ein `sip-trunking`-Beleg von Telnyx ueberhaupt ein Feld traegt, das den
`otb_...`-Wert unter `call_control_id` (oder einem anderen, vom Adapter gelesenen Feld)
fuehrt, ist NICHT im Code entscheidbar - das ist AUFTRAG-Frage O1 und bleibt offen (siehe
unten). Der Code-Befund ist: der Adapter kennt heute kein zweites Anker-Feld fuer
SIP-Call-IDs, nur `call_control_id`/`telnyx_session_id`/`call_session_id`
(`voice.js:140,160`).

**Bruch 4 - `cost-cross-check.js` (KV-M4) ist strukturell Telnyx-only.** Die monatliche
Gegenprobe (`src/billing/cost-cross-check.js:1-22`) vergleicht Telnyx-Rechnungssumme,
abgerufene Telnyx-Ist-Kosten und Telnyx-Gate-Buchungen - drei Zahlen, keine davon kann
EL-Kosten enthalten. Ein Ausfall wie B1 waere fuer diese Gegenprobe unsichtbar, weil sie
nie nach EL fragt.

**Ein bereits existierender, ABER separater ElevenLabs-Kostenpfad: Zeichen-Kontingent,
NICHT Cent-Buchung.** `recordTtsCharacters`/`recordRelayTtsCharacters`
(`state-ops.js:4464-4489`, ueber `bumpPlatformTtsQuota`, `state-ops.js:4434-4457`) zaehlen
ElevenLabs-TTS-**Zeichen** (nicht Cents) fuer zwei ANDERE Pfade - Play-TTS
(`src/tts/directive-synth.js`) und den Telnyx-"Assistant"-Relay-Pfad. Weder Ledger noch
Gate werden davon beruehrt (`cost-ledger-map.js:121-137`, Zeile `play_tts_characters`,
`ledger:false, gate:false`). Das ist NICHT der ConvAI-SIP-Trunk-Pfad aus dem Auftrag -
eine Verwechslung waere naheliegend, weil beide "ElevenLabs" heissen, aber es ist
architektonisch ein anderes Feature (aeltere Phase, andere Datei
`src/elevenlabs/nummern-registrierung.js` bzw. Telnyx' eigener Relay, kein
`src/elevenlabs/outbound.js`-Aufruf).

## 4. Die EINE Stelle (bzw. die zwei EINEN Stellen) fuer eine neue EL-Kostenart

Der Auftrag fragt nach GENAU EINER Stelle. Der Code-Befund zeigt: es gibt zwei
UNABHAENGIGE Kostentraeger (ElevenLabs selbst + der Telnyx-SIP-Trunk-Anteil, s. AUFTRAG
"Topologie"), und jeder braucht seinen EIGENEN Belegweg - eine einzelne Stelle koennte
nur einen der beiden abdecken, ohne den anderen zu erfinden. Beide Wege konvergieren aber
auf DIESELBEN vorhandenen Buchungsprimitive (Abschnitt 1) - es entsteht KEIN dritter
Cent-Schreibweg.

**4a. ElevenLabs-eigener Anteil (`metadata.cost_fiat`/`charging`), synchron, kein neues
Netz-IO:**
Hook-Punkt ist `persistProviderResult` (`outbound.js:1283-1316`) - die Antwort liegt hier
bereits vollstaendig vor (beide Aufrufer, regulaeres Ende UND Abbruch, s. Abschnitt 2).
Eine neue, benannte Buchung (Muster `recordSipCallId` direkt daneben, Zeile 1312) koennte
`conversation.metadata?.cost_fiat` lesen und - ueber `convertProviderMicroToBucketCents`
(`state-ops.js:3705-3716`, bereits waehrungs-generisch: "Provider-Mikro-Cent (USD) ->
Ziel-Bucket-Cent (EUR)", NICHT Telnyx-spezifisch benannt oder implementiert) - in
`applyCostCorrectionCents`/`bookCostCorrectionCents` einspeisen. Diese Funktion (s.
`state-ops.js:3798-3819`) traegt BEREITS die von AUFTRAG-Punkt 2/B6 verlangte
Asymmetrie (Nachbuchung immer, Ruecknahme nur bei `dataComplete`) - sie muesste NICHT neu
gebaut werden, nur mit EL-Daten statt Telnyx-Daten aufgerufen werden. Zeitlich liegt
dieser Hook VOR `finishCall`/`reconcileVoiceBudget` (Schritt in Abschnitt 2) - die
EL-Korrektur koennte die Schaetzung also schon vor dem ersten Gate-Zugriff auf den
richtigen Wert bringen, statt (wie beim Telnyx-Weg) Tage auf den Sweep zu warten.

**4b. Telnyx-SIP-Anteil, asynchron, ueber den bestehenden Sweep:**
Hook-Punkt ist `providerLegIdOf` (`cost-truing.js:138`) - `call.sipCallId` als dritte
Alternative ergaenzen (`call.twilioSid || call.callControlId || call.sipCallId`) - UND,
davon abhaengig, `ANCHOR_ID_FIELD`/`assignCostRecords`
(`adapters/telnyx/voice.js:140,903`) um ein zweites Anker-Feld fuer SIP-Belege
erweitern, sofern O1 das als moeglich bestaetigt. Dieser Weg bleibt strukturell auf
Telnyx' Anteil begrenzt - er kann die ElevenLabs-Kosten NIE liefern, weil Telnyx sie nicht
kennt (getrennte Rechnungssteller). Ohne 4a bliebe der Telnyx-Anteil allein die B6-Falle:
eine Korrektur nur gegen die SIP-Minuten wuerde ~90% der echten Kosten aus der Schaetzung
herausrechnen (unveraendert von AUFTRAG B6, hier nur bestaetigt: `bookCorrectionFor`,
`cost-truing.js:475-486`, kennt keine zweite Kostenquelle, gegen die es die Vollstaendigkeit
pruefen koennte - `refundProven`, Zeile 453-460, sieht nur EINEN `measured`-Wert).

**Konsequenz fuer die Architektur:** die "eine Stelle" aus dem Auftrag ist real EIN
Muster (dieselben zwei state-ops-Primitive), angewendet an ZWEI unabhaengigen
Ursprungsorten. Ein Entwurf, der nur 4a oder nur 4b baut, bleibt unvollstaendig: 4a allein
deckt den ElevenLabs-Anteil, aber lieferte weiterhin keinen Beleg fuer den echten
Telnyx-SIP-Anteil (der laut B5 heute geschaetzt in der 30-ct-Pauschale steckt); 4b allein
liefe in die B6-Falle. Beide zusammen ergeben `Ist = EL-Anteil (4a) + Telnyx-SIP-Anteil
(4b)`, gegen `estimatedCostCents` verglichen mit der VOLLSTAENDIGKEIT beider Teile als
Voraussetzung fuer eine Ruecknahme (die in AUFTRAG-Punkt 2 verlangte Mehr-Traeger-Version
von `refundProven`).

## 5. Beurteilung: taugt `cost-ledger-map.js` als Vollstaendigkeits-Struktur?

**Teilweise - fuer eine bekannte Luecke ja, fuer eine ganz neue Kostenart NICHT
automatisch.**

Was die Tabelle strukturell erzwingt (belegt):
- Jede Zeile braucht `ledger`/`gate`/`preisquelle` OHNE Default - ein fehlendes Feld wirft
  beim MODUL-IMPORT (`assertRow`, `cost-ledger-map.js:32-41`, Validierungsschleife Zeile
  143). Das ist ein Bauzeit-Fehler, kein Testlauf-Fehler.
- `test/kv-p1-cost-ledger-map.test.js:372-379` (KV-P1-8) erzwingt: jeder Wert in
  `USAGE_EVENT_KIND` MUSS mindestens eine Tabellenzeile haben. `KV-P1-9`
  (Zeile 382-387) erzwingt umgekehrt: jede `ledger:true`-Zeile muss auf einen ECHTEN
  `USAGE_EVENT_KIND`-Wert zeigen. `KV-P1-10` (Zeile 414+) erzwingt zusaetzlich
  Singularitaet EINES Buchungsaufrufs (`addVoiceUsageCostCents` genau einmal in `src/`) -
  ein Muster, das eine neue EL-Buchung uebernehmen sollte.

Was sie NICHT erzwingt (Luecke, am Enum belegt):
`USAGE_EVENT_KIND` (`src/store/defaults.js:169-174`) kennt genau vier Werte -
`VOICE_MINUTE`, `AI_TOKEN`, `SMS`, `NUMBER_MONTH`. Es gibt keinen fuenften Wert fuer
ElevenLabs, und nichts im Code oder in der Testsuite ZWINGT jemanden, einen anzulegen,
wenn ein neuer externer Kostentraeger (wie der ConvAI-Wechsel) hinzukommt. Die Pruefung
KV-P1-8 laeuft NUR gegen die bereits vorhandenen Enum-Werte - ein Enum-Wert, der nie
angelegt wurde, kann per Definition nie eine fehlende Zeile auswerfen. Es existiert
keine externe, unabhaengig gepflegte Liste ("alle Kostentraeger, die dieses System
kennen MUSS"), gegen die das Enum selbst geprueft wird.

Formuliert als Unterscheidung: die Tabelle macht **"jemand hat einen `kind` angelegt und
vergessen, ihn in der Landkarte einzutragen"** zu einem Bauzeit-Fehler. Sie macht
**"ein voellig neuer Kostentraeger ist live gegangen, und niemand hat ueberhaupt daran
gedacht, einen `kind` dafuer anzulegen"** NICHT zu einem Bauzeit-Fehler - das bleibt ein
Sorgfaltsproblem, das exakt der hier untersuchte Fall ist (der ConvAI-Umstieg am
19.08. legte keinen neuen `kind` an, keine Zeile, keinen Test - `cost-ledger-map.js`
konnte das nicht verhindern, weil es strukturell nichts gab, das haette scheitern
koennen). Fuer eine echte Vollstaendigkeits-Garantie muesste die Enum-Erweiterung selbst
an eine unabhaengige Quelle gebunden sein (z.B. ein Test, der explizit gegen eine
Liste bekannter Anbieter-Produkte/Preisparameter prueft, nicht nur gegen sich selbst).

## 6. Verhaeltnis zum Auftrag (AUFTRAG.md)

Kein Widerspruch zur dortigen Beweislage (B1-B6). Eine Ergaenzung: der Auftrag fragt nach
"der EINEN Stelle" - der Code zeigt, dass es aus zwei unabhaengigen Kostentraegern
(ElevenLabs + Telnyx-SIP-Anteil) zwei Hook-Punkte braucht (Abschnitt 4), die aber auf
dieselben bestehenden Buchungsprimitive konvergieren. Eine zweite Ergaenzung: die
Scaffolding fuer den Join (`sipCallId`, `elevenlabsConversationId`,
`test/el-sip-call-id-join.test.js`, Referenzen "PHASE-6-VORAUSSETZUNG"/"Fertig-Punkt 7"
in `.fortschritt.md:2834-2866,3138`) existiert bereits und wurde am 17.08.2026
ausdruecklich FUER diesen Zweck gebaut - der Bruch liegt nicht im Fehlen der Kennung,
sondern darin, dass `cost-truing.js` und der EL-Ergebnisabruf sie bisher nicht lesen.

## 7. Offene Fragen (nicht im Code klaerbar, hier ausdruecklich offen gelassen)

- **O1/O2/O3/O4/O5** aus `AUFTRAG.md` bleiben unveraendert offen - sie sind Fragen an den
  Anbieter/die Produktionsdaten, nicht am Code lesbar. Diese Session hatte per Auftrag
  ausschliesslich Code-Zugriff (keine Anbieter-Calls) und der Telnyx-MCP-Server war zudem
  mit HTTP 401 nicht erreichbar (System-Hinweis dieser Session) - beides haette O1 ohnehin
  nicht beantwortet, weil O1 eine Frage an Telnyx' Live-API ist.
- **O6 (Inbound ueber ElevenLabs?):** im Code nicht abschliessend zu entscheiden ohne
  Config-Stand zu lesen, der ausserhalb des Auftrags-Scopes "code" liegt
  (`config.telephony.*`/Registry-Dispatch, wer den Inbound-Zweig fuer welchen Tenant
  waehlt). Der hier gelesene Code (`outbound.js`) deckt nur den ausgehenden Weg; ob ein
  strukturell identischer Inbound-Zweig existiert, wurde in dieser Session nicht geprueft
  (ausserhalb des zugewiesenen Einstiegs-Sets).
- **Ob Telnyx `sip-trunking`-Belege ueberhaupt ein fuer den Adapter lesbares Anker-Feld
  tragen** (Voraussetzung fuer 4b) ist identisch mit O1 und bleibt aus demselben Grund
  offen.
