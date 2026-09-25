# Kettenstand "EIN Gespraechs-System" — 2026-09-14 frueh

Ersetzt die Abschnitte 0, 0b, 2 und 9 von `tasks/kickoff-inbound-ein-system.md`, soweit sie
hier widersprochen werden. Alles andere dort gilt weiter.

## Das Ziel ist NICHT erreicht

Von vier Gespraechs-Gehirnen sind **zwei** entfernt. **Zwei laufen weiter:** die
Budget-Engine (Inbound, live) und der EL-ConvAI-Agent (Outbound, live). Der Umstieg von
Inbound auf den Agenten (IE5) ist **nicht gebaut**, weil seine Messung (IE1) nicht gefahren
werden konnte. Damit ist auch IE6 Stufe 3 (Budget-Engine loeschen) nicht moeglich.

| Phase | Stand | Commit |
|---|---|---|
| IE1 Anbieter-Vertrag messen | **nicht gemessen** — Classifier verweigert echte Testanrufe; was ohne Anruf belegt ist und der fertige Probe-Aufbau: `tasks/ie1-messbericht.md` | — |
| IE5 Inbound am EL-Agenten | **nicht gebaut** — haengt an IE1, und IE1 hat eine neue Praemisse aufgedeckt (s.u.) | — |
| IE6-S1 Telnyx-AI-Assistant entfernen | **gemergt, lokal** | `6621039` |
| IE6-S2 OpenAI-Realtime-Bridge entfernen | **gemergt, lokal** | `aa4a681` |
| Doku-Nachzug (2 verwaiste Verweise) | gemergt, lokal | `d333a25` |
| IE6-S3 Budget-Engine entfernen | **blockiert** bis IE5 live und bewaehrt | — |

**Nichts davon ist live.** `master` ist nicht auf `upstream` gepusht, kein Deploy ausgeloest.

## Korrekturen am Kickoff (gemessen, nicht vermutet)

1. **"Keine der vier EL-Nummern traegt `inbound_trunk_config`" — falsch.** Die
   Spike2-Registrierung (`phnum_1101m00…`, …0177) nimmt INVITEs von `0.0.0.0/0` an. Offene
   Messung M20, nicht angefasst.
2. **"Telnyx-AI-Assistant (gebaut, Schalter aus)" — falsch.** Live stand
   `TELNYX_AI_ASSISTANT_ENABLED=true`; nur der Inbound-Handoff war aus. Der Assistant war ein
   scharfer, ruhender Outbound-Rueckfall hinter dem EL-Zweig und hielt den Shim-Endpunkt
   `/v1/chat/completions` offen. Nach S1 faellt Outbound bei abgedrehtem EL-Schalter auf den
   TeXML-Budget-Zweig; bei heutiger Live-Konfiguration aendert sich an keinem Anruf etwas.
3. **"IE1 braucht den Owner nicht" — falsch.** Echte Testanrufe, ein Tunnel fuer Rueckrufe
   und Prod-DB-Lesen werden dem Agenten verweigert.

## Neue Praemisse fuer IE5 (Befund B-2 im Messbericht)

Der Live-Agent referenziert 14 dynamic variables, nur 4 haben Ersatzwerte. Ohne die
Pflichtvariablen beendet ElevenLabs das Gespraech direkt nach dem Abheben (Code 1008,
gemessen in Spike 2). SIP-Header liefern nur `sip_*`-Variablen. Und die `first_message` des
Agenten ist der **Outbound**-Offenlegungssatz — nach unserem Inbound-Pflichtsatz waere das
eine Doppelansage mit falschem Inhalt. Ein Override-Kanal ueber SIP existiert nicht.
K1 braucht also zusaetzlich zu F-A…F-F eine Antwort auf "wie beginnt der eine Agent ein
Inbound-Gespraech ohne Outbound-Eroeffnung" — `attributes_to_headers`, der
Initiations-Webhook oder eine zweite Agenten-Konfiguration. Das ist eine Owner-Frage, bevor
IE5 gebaut wird.

## Testbaenke nach S1+S2

- Regression nach S1: 5610 / 5610 gruen (vorher 6045; minus 435 Tests der entfernten Pfade,
  ~45 Testdateien, namentlich in `tasks/ie6-s1-report.md`). Katalog-Tests GAP-24 und OUT-27
  sind mit Kennung an den ueberlebenden Pfad umgezogen.
- **Abschlusslauf auf `d333a25`:** Regression 5543 / 5543 gruen (exit 0). Gates 741 / 744 —
  die drei roten (GAP-05 Promotion-Codes, GAP-15 EN-Rechtstexte, E2E-03 Sprachumstellung im
  Anruf) sind am Stand vor der Nacht (`e4764aa`) **genauso rot**, also keine Verschlechterung.
- `npm run elevenlabs:drift` vorher = nachher (ROT, dieselben 5 Bestandsabweichungen).
- Abnahme-Bank: 13 von 14, `test/abnahme-ausgewandert.json` unveraendert bei 13.
- Smoke-Boot: `/healthz` 200, unbekannte Inbound-Nummer -> gueltiges TeXML (Satz + Hangup),
  `POST /v1/chat/completions` -> 404, kein Assistant-Banner. Lokal nur mit
  `COST_TRUING_REQUIRED_RECORD_TYPES=sip-trunking,call-control` (Live-Wert) — die lokale `.env`
  hat ihn nicht, der Boot-Riegel ist Bestand.

## Restbefunde aus den Reports (keiner blockiert, keiner ist live wirksam)

- **R-1** Streaming-/Abbruch-Naht in `agentTurn` (`onSpeechChunk`, `abortSignal`,
  `streamSinkFor`, `THINKING_SIGNAL_ENABLED`) hat seit S1 keinen Produktionsaufrufer —
  faellt mit Stufe 3.
- **R-2** Doku ausserhalb `src/`: `README.md`, `docs/RUNBOOK-TELNYX-ASSISTANT.md`,
  `src/db/schema.sql`-Kommentar, und in `CLAUDE.md` (Owner-Entscheidung OC) der Halbsatz
  "EL-Weg wie Budget-/Telnyx-Weg" — bewusst nicht angefasst, weil es Owner-Text ist.
- **R-4** `src/route-policy.js` nennt beim Consult-Webhook "Runbook-Fall 2", und Fall 2 war
  der entfernte Shim.
- **O-1** Hangup-Zweig fuer persistierte `callControlId`-Altlegs in Stufe 3 bzw. IE5 neu bewerten.
- **R-S2-1** `stream_token` wird weiter erzeugt (Spalte `NOT NULL`), aber nicht mehr geprueft;
  Entfernen waere ein Schema-Cutover.
- **R-S2-2** `OPENAI_API_KEY` ist nach S2 ungenutzt — beim Anbieter rotieren oder loeschen,
  falls live gesetzt.
- **R-S2-3** `.claude/workflows/phase-impl*.js` und `.claude/refs/clean-code*.md` nennen
  `bridge.js` noch (Absolute-Regeln-Block). Diese Dateien darf der Agent laut Bestandslehre
  nicht selbst aendern (Classifier: Selbst-Modifikation).
- **R-S2-4** `EINSAMMLER.NICHT_BELEGPFLICHTIG` ist Vokabular ohne vergebenes Profil.
- **R-S2-5** `docs/architektur/02-telephony.dot` (untrackt) zeigt noch den Media-Adapter.

## Vor dem naechsten Deploy pruefen (sonst schlaegt der Boot fail-closed fehl)

- Render-Env `VOICE_TARIFF_GRUNDBETRAG_CENTS`: darf keine der entfernten Routen nennen
  (`telnyx_assistant`, `telnyx_inbound_realtime`) — ein unbekanntes Profil ist Boot-Refusal.
  Der Wert ist nicht auslesbar; Blueprint und Vorschlag nennen nur `el_convai_sip`.

## Aufraeumen, das der Owner entscheidet (nichts davon eilt)

- Render-Env-Werte der entfernten Schalter sind danach wirkungslos:
  `TELNYX_AI_ASSISTANT_ENABLED`, `TELNYX_INBOUND_HANDOFF_ENABLED`, `TELNYX_ASSISTANT_ID`,
  `TELNYX_CALL_CONTROL_APP_ID`, `TELNYX_PER_CALL_TRANSCRIPTION_ENABLED`, `VOICE_ENGINE`,
  `OPENAI_*`/`REALTIME_*` (vollstaendige Listen in beiden Reports).
- Bei Telnyx verwaist: vier `ai-assistant-…`-TeXML-Apps, die Call-Control-App
  "Hermes Call Control" (`3000979485014098987`).
- Zwei IE1-Wegwerf-Apps ohne Nummer (IDs im Messbericht, Abschnitt 2) — behalten, falls die
  Messung gefahren wird, sonst loeschen.
- Neue Pins in `eslint-legacy-exceptions.json` aus S1/S2: der vorgesehene Weg fuer angefasste
  Altlast-Dateien, alle Befundzahlen gesunken, keine Regel abgeschaltet — Owner-Freigabe
  steht nach dem FW2-Praezedenzfall aus.

## Kosten dieser Nacht (aus `scripts/workflow-kosten.mjs`, nicht aus `subagent_tokens`)

| Lauf | Token | davon Cache-Reads | teuerster Agent |
|---|---|---|---|
| IE6-S1 `wf_3348159c-a25` | 754,6 Mio | 750,2 Mio | Umsetzung, 1159 Turns, 636,5 Mio |
| IE6-S2 `wf_952955ac-19a` | 374,8 Mio | 371,9 Mio | Umsetzung, 852 Turns, 307,8 Mio |

Beide Umsetzungs-Agenten lagen weit im teuren Bereich (>150 Turns). Grosse Loeschungen in
einem einzigen Agenten sind genau das quadratische Muster aus `.claude/refs/workflow.md` 2a.

## Naechste Schritte, in dieser Reihenfolge

1. Owner: IE1 freigeben (Permission-Regel) oder selbst per `!` fahren — Aufbau steht.
2. Owner: die B-2-Frage entscheiden (wie der eine Agent Inbound eroeffnet).
3. IE5 bauen, Schalter aus = byte-identisch.
4. Push + Deploy, Inbound-Testanruf mit Schalter an, Beobachtungsfrist.
5. IE6 Stufe 3 + 3b.
