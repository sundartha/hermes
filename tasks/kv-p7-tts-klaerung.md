# KV-P7 - Klaerung: erreicht TTS-Geld die Gate-Achse, und waere ein Preis-pro-Zeichen-Parameter eine Doppelbuchung?

Basis: `master` @ `37953ca`. Alle Zeilennummern gegen den ausgecheckten Branch gelesen (Repo-Lehre KV-M0), nicht geraten.

## (a) Erreicht der von Telnyx berechnete TTS-Betrag die Gate-Achse? JA.

Vier Glieder, jedes am Code:

1. **`text-to-speech` ist zuordenbar.** `src/telephony/adapters/telnyx/voice.js:50-53`
   listet `text-to-speech` in `COST_RECORD_TYPES`; `:168` schliesst NUR `inference`
   ueber `UNASSIGNABLE_COST_RECORD_TYPES` aus; `:177-179` bildet
   `ASSIGNABLE_COST_RECORD_TYPES` als abgeleitete Gegenmenge. `text-to-speech` ist
   dabei. `COST_RECORD_TIME_FIELDS` (`:190-198`) fuehrt fuer diesen Typ `created_at`
   als Zeitfeld - Bestaetigung derselben Zuordenbarkeit.
2. **Geld und Zeichen kommen aus DEMSELBEN Beleg.** `voice.js:425-450`
   (`toCostRecord`) - eine Funktion je Beleg: `costMicroCents =
   parseDecimalToMicroCents(raw.cost)` UND daneben `ttsCharacters:
   elevenLabsCharactersOf(raw)` (`:409-417`).
3. **Die Summe ist typ-blind.** `src/billing/cost-truing.js:289-297`
   (`sumRecordMicroCents`) addiert `r.costMicroCents` ueber ALLE zugeordneten Records
   ohne Typ-Filter -> `classifyRecords(...).actualCostMicroCents` (`:316-330`).
4. **Der Ist-Betrag geht auf die Gate-Achse.** `cost-truing.js:466-479`
   (`bookCorrectionFor`) -> `store.applyCostCorrectionCents(...)` ->
   `src/store/state-ops.js:2491` (`bookCostCorrectionCents`) -> `bookCents(usage, ...)`
   (`:2322`) - genau die Achse, die `budgetExceeded` liest.

**Beleg als gruener Bestandstest:** `test/cost-truing-tts-characters.test.js:130`
pinnt `callA.actualCostMicroCents === 4_226_660` mit dem Kommentar
`"0 + 4010000 + 0 + 200000 + 16660"`. Die `16660` sind exakt der text-to-speech-Beleg
(`cost: "1.666E-4"`, `:112`, 238 Zeichen). Der TTS-Betrag ist testgepinnt Teil des
Ist-Betrags. Seit KV-P3 laeuft der Ist-Abgleich richtungsoffen (bestaetigt durch die
KV-M1-Messung: 13 zugeordnete Belege, `complete:true`, auch inbound).

## (b) Waere ein zusaetzlicher Preis-pro-Zeichen-Parameter eine Doppelbuchung? JA.

Gerechnet am KV-M1-Anruf: 729 Zeichen, 51.030 Mikro-Cent TTS-Anteil,
3.731.030 Mikro-Cent Ist-Betrag gesamt.

Variante A (Preis am gemessenen Telnyx-Satz 51.030/729 = 70 Mikro-Cent/Zeichen):

| Weg | Betrag (Mikro-Cent) |
|---|---|
| Ist-Abgleich (enthaelt TTS bereits) | 3.731.030 |
| + 729 x 70 (neuer Parameter) | + 51.030 |
| Gate-Achse gesamt | 3.782.060 |

Dieselben 729 Zeichen wuerden zweimal gebucht: einmal ueber den Provider-Beleg
(Punkt a), ein zweites Mal ueber den neuen Parameter. +1,4 % je Anruf ist klein genug,
um nie wie ein Fehler auszusehen - und PERMANENT: der Ist-Abgleich ist konvergent
(`deltaCents = bucketCents - estimatedCostCents`), eine zusaetzliche `bookCents`-Zeile
waere additiv und laege ausserhalb dieser Konvergenz. `costTruedAt` schliesst den Call
danach fuer immer ab (`cost-truing.js:281-287`, `isTruingCandidate`) - keine
Selbstheilung moeglich.

Variante B (Preis am ElevenLabs-Fixtarif: `ttsCharacterQuota=39.981`
`config.js:748` gegen `platformFixedCostCentsPerMonth=600` `config.js:769` ->
15.007 Mikro-Cent/Zeichen, 214x der Telnyx-Satz): 729 x 15.007 = 10,94 ct AUF einen
bereits vollstaendigen Ist von 3,73 ct -> 14,67 ct, das 3,9-fache der echten Kosten.

Der Faktor 214 ist selbst ein Befund: Telnyx' TTS-Gebuehr ist NICHT die durchgereichte
ElevenLabs-Rechnung, sondern Telnyx' eigene Relay-Gebuehr - unser ElevenLabs-Vertrag
laeuft ueber unseren eigenen Key (`config.js:354-360`, `apiKeyRef`) und steht auf
keiner Telnyx-Position. Variante B waere die Umlage einer festen Monatsgebuehr auf
Anrufe = Preisfrage, ausdruecklich ausserhalb dieser Phase.

## (c) Was bleibt offen? Eine KONTINGENT-Luecke, keine GELD-Luecke.

| Zaehler | gespeist von | Wirkung |
|---|---|---|
| `usage[tenant].ttsCharacters` (`state-ops.js:3261`) | Ist-Abgleich (`cost-truing.js:494-497`) | keine (reine Anzeige) |
| `platformTtsUsage.characters` (`state-ops.js:3141`) | NUR `src/tts/directive-synth.js:92` | Warnschwelle + Erschoepfung |
| `actualCostMicroCents` -> Gate-Achse | ALLE zugeordneten Belege (inkl. text-to-speech) | Geld, GEDECKT (s. a) |

Repo-weiter Grep (`grep -rn "recordTtsCharacters(" src/`) nach Aufrufern von
`recordTtsCharacters`: genau EINER (`directive-synth.js:92`), hinter
`config.voice.elevenLabsPlayTts.enabled` (Default `false`, `config.js:367-371`). Der
Relay-Pfad (`voice.js:316-323`, `speakVoiceFields`, `config.telnyx.telnyxElevenLabs`)
laeuft davon unabhaengig, verbraucht DASSELBE ElevenLabs-Konto und erreicht diesen
Zaehler strukturell nie - unabhaengig davon, ob Play-TTS an oder aus ist.

Geld-frei ist das, weil (1) Telnyx' Anteil ueber (a) bereits gedeckt ist, (2) der
ElevenLabs-Vertrag eine Fixgebuehr ohne belegte Grenzkosten ist (s. Faktor 214 oben),
(3) `ttsQuotaExhausted` (`state-ops.js:3104-3106`) an genau zwei Stellen wirkt
(`directive-synth.js`), beide im Play-TTS-Pfad, beide degradieren nur auf
Azure-`<Say>` - keine Sperre.

Offen bleibt trotzdem etwas Reales: der Zaehler, den `GET /api/billing/platform-costs`
zeigt (`src/api-billing.js:160`) und an dem die Warn-SMS haengt
(`src/server.js:187-191`), steht bei 0, waehrend das ElevenLabs-Konto ueber den Relay
laengst verbraucht wird. Eine blinde Sicherung, aus der jemand Sicherheit ableiten
koennte.

## (d) Urteil: Massnahme 4 (Preis-pro-Zeichen-Parameter) entfaellt ersatzlos.

Dafuer sprach in der Erstfassung des Plans: "die Zeichen liegen vor, es fehlt nur
Zeichen->Geld" - stimmt als Beobachtung, der Weg ist aber bereits gegangen, ueber den
Provider-Beleg statt ueber einen neuen Parameter. "Ein fehlender Preis ist lautlos eine
0" trifft hier nicht zu - der Preis kommt bereits vom Provider in `raw.cost`. "Der
Owner will TTS im Kundenrahmen" ist bereits erfuellt, seit KV-P3 auch fuer Inbound.

Dagegen: eine zweite, permanente, nicht selbstheilende Buchung (Variante A) oder eine
erfundene Umlage (Variante B); eine neue Env-Variable fuer einen bereits gemessenen
Wert; und die bindende Vorgabe dieser Phase - die Gate-Achse nur bei belegter,
UNGEDECKTER Kante beschreiben. Sie ist hier nicht belegt, sie ist widerlegt.

**Scope-Folge:** Diese Phase baut KEINEN Preis-pro-Zeichen-Parameter. Die Zeile
`play_tts_characters` in `src/billing/cost-ledger-map.js` bleibt `kind: null,
ledger: false, gate: false` - nur ihr `preisquelle`-Text wird um die korrigierte
Aussage aus (a) ergaenzt (die heutige Formulierung ist nach KV-M1/KV-P3 unvollstaendig:
sie beschreibt nur den Play-TTS-Pfad, nicht dass TTS-Geld ueber den Ist-Abgleich
generell die Achse erreicht). Die eigentliche Arbeit der Phase ist Massnahme 3 (den
Kontingent-Zaehler fuer den Relay-Verbrauch sehend machen) und die zwei Boot-Guards.
