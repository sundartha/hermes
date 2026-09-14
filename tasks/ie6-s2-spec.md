# Spec IE6-S2 (Lead, 2026-09-14)

Diese Datei hat fuer diesen Lauf VORRANG vor `PLAN-INBOUND-PARITAET.md`. Rahmen dort:
Abschnitt 2.6 Punkt 2, 3 (Pre-Mortem Q7), 5 (Clean-Code-Auflagen) und "Phase IE6" Stufe 2.
Stufe 1 (Telnyx-AI-Assistant) ist bereits auf `master` gemergt. Stufe 3 und IE5 sind NICHT
der Auftrag.

## Phase IE6-S2 - Die OpenAI-Realtime-Bridge (der vierte Zweig) ersatzlos entfernen

### Freigabe

Der Owner hat am 2026-09-13 angeordnet, die ueberzaehligen Gespraechs-Engines zu entfernen.
Die Realtime-Bridge ist nie live gelaufen. Stufe 2 haengt fachlich weder an IE1 noch an IE5.

### Gemessener Live-Stand (Render-Boot-Banner 2026-09-13 20:22 UTC)

`Voice-Engine: budget`. Laut Code-Kommentar in `src/routes/api-calls.js` verhindert ein
Boot-Riegel `VOICE_ENGINE=realtime` bereits heute. Kein Live-Anruf nimmt diesen Weg.

### Scope

Entfernen, ersatzlos, nicht per Flag abschalten:

1. `src/bridge.js` samt seinen `HEIKLE STELLE`-Abschnitten und seinen Tests.
2. `VOICE_ENGINE=realtime` als Wert samt allen Sonderfaellen: der Realtime-Early-Return in
   `rearmActiveCallTimers`, die Realtime-Bedingung in `consultAvailableFor`, jede
   `VOICE_ENGINE.REALTIME`-Verzweigung in Routen, Lifecycle, Boot und Kostenrechnung.
   Ob `VOICE_ENGINE` als Schalter mit dann nur noch EINEM Wert ueberhaupt bestehen bleibt,
   entscheidet der Plan am Katalog (G9: ein Schalter ohne zweite Stellung ist toter Code) —
   aber Stufe 3 steht noch aus, die Budget-Engine bleibt also; im Zweifel den Schalter auf
   seinen einzigen Wert zurueckschneiden und das im Bericht begruenden.
3. `DIRECTIVE.STREAM` und `streamDirectives`, `MEDIA_PATH`, die Media-Event-Naht
   (`src/telephony/media-events.js`) und der Media-Adapter (`adapters/telnyx/media.js`),
   die WebSocket-Upgrade-Verdrahtung fuer Media-Streams, `scripts/telnyx-ws-echo.mjs`, soweit
   nur dieser Zweig sie traegt.
4. `KOSTENPROFIL.TELNYX_INBOUND_REALTIME`, `KOSTENART.OPENAI_REALTIME` samt
   Registry-/Tarifpaar-Zeilen, `REALTIME_MID_CALL_BUDGET_CHECK`, die Boot-Guard-Befunde
   `REALTIME_NO_MIDCALL_BUDGET` und `REALTIME_CARRIER_UNCOLLECTED` und jeder weitere
   Befund, der nur diesen Zweig betrifft.
5. OpenAI-Konfiguration (Schluessel, Modell, Stimme, Realtime-URL o.ae.) in `src/config.js`,
   `.env.example`, `render.yaml`, `test/helpers.js#BASE_ENV` — **nur**, soweit nach
   Konsumenten-Zaehlung je Funktion ausschliesslich die Bridge sie liest. Wird z.B. ein
   OpenAI-Schluessel noch fuer etwas anderes gelesen (Zusammenfassung, Recherche, LLM-Seam),
   bleibt er.
6. Eine npm-Abhaengigkeit (z.B. `ws`) entfaellt **nur**, wenn nach der Entfernung kein
   anderer Import sie mehr braucht — belegt per grep ueber `src`, `scripts`, `test`,
   `apps` und `package.json`-Skripte. Weniger Abhaengigkeiten ist erwuenscht, eine
   faelschlich entfernte ist ein Bootfehler.
7. **Doku, die die Bridge als lebend beschreibt, im selben Commit nachziehen:** `CLAUDE.md`
   (Kopfzeile "optional OpenAI Realtime (Streaming-Audio)", Absatz "Architektur": "Zwei
   Voice-Engines … `realtime` (Streaming-Audio ueber `bridge.js`)" und die Zeile
   "`src/bridge.js` — Audio-Bridge … HEIKLE STELLE", Abschnitt "Vor Edits": "Tools werden von
   Budget-Engine UND Realtime-Bridge genutzt"), `README.md` und `.env.example`. Nur die
   betroffenen Saetze, kein Umschreiben drumherum. Deutsch mit Umlauten in Markdown-Doku ist
   in `CLAUDE.md` NICHT ueblich — dort ASCII (ue/oe/ae) wie im Bestand.

### NICHT-Scope

- Keine Stufe 3: `/voice/turn`, Folge-Gather, `claude.js#agentTurn`, Inbound-Prompt,
  STT-Seam und `KOSTENPROFIL.TELNYX_INBOUND_BUDGET` bleiben unangetastet. Kein IE5-Code.
- Kein Entfernen oder Aufweichen einer Sicherung. Ed25519-Signatur, Wiederholungs-Riegel,
  Tenant-Aufloesung, Kostendecke (beide Richtungen), Max-Dauer, Offenlegung, Outbound-Gates
  bleiben; die Reihenfolge in `/voice/incoming` bleibt.
- **Offenlegung:** `disclosureSentence` in `src/claude.js` bleibt byte-identisch. Die Bridge
  traegt eine eigene Verwendung des Offenlegungssatzes; die verschwindet MIT dem Zweig. Das
  ist kein Aufweichen der Absoluten Regel 2, sofern `claude.js` und jeder ueberlebende
  Outbound-Weg (EL `first_message`, Budget-Outbound) unveraendert bleiben.
- `src/telephony/ports.js`, `registry.js` und die Telnyx-Adapter als Abstraktion bleiben;
  entfernt wird nur, was ausschliesslich Media-Streaming bedient.
- Kein Loeschen eines Katalog- oder Abnahmetests; Umzug mit Kennung und Bank, oder
  namentliche Begruendung, warum die Zusicherung mit dem Zweig gegenstandslos wird. Die Zahl
  der Eintraege in `test/abnahme-ausgewandert.json` sinkt nicht (Regel D13).
- Keine Live-Aenderung, kein Anbieter-Aufruf, kein Deploy.

### Invarianten (byte-identisch)

- Bei `VOICE_ENGINE=budget` (Live-Stand) liefern `/voice/incoming`, `/voice/turn` und
  `/voice/outbound` byte-identisches TeXML; der EL-Outbound-Anfragekoerper ist byte-identisch.
- Max-Dauer-Notbremse und `rearmActiveCallTimers` wirken fuer Budget- und EL-Anrufe
  unveraendert (nur der Realtime-Sonderfall faellt weg).
- `test/route-auth-inventory.test.js` bleibt gruen; eine entfernte Route verschwindet auch
  aus `src/route-policy.js`.
- Kein Export ohne Konsumenten, kein auskommentierter Code.

### Abnahmekriterium

```
grep -rln "bridge.js\|OPENAI_REALTIME\|TELNYX_INBOUND_REALTIME\|REALTIME_MID_CALL_BUDGET_CHECK\|MEDIA_PATH\|streamDirectives\|DIRECTIVE.STREAM" src scripts test render.yaml .env.example CLAUDE.md README.md
NODE_ENV=test node test/testbaenke-run.mjs regression --test-concurrency=4
node --check <jede geaenderte .js-Datei>
PORT=0 SKIP_TWILIO_SIGNATURE_CHECK=true npm start  -> Boot ohne Fehler, /healthz 200
```
Erwartet: grep nennt keine Datei (oder nur einen Test, der das Nicht-mehr-Erreichbar-Sein
beweist — namentlich im Bericht); Regression-Bank gruen, Testzahl nur um die Tests des
entfernten Zweigs gesunken, namentlich im Bericht; der Server bootet.

**Testbank-Hinweis:** ohne `--test-concurrency=4` flaked die Bank (Bestandsverhalten).

### Testpflicht

- **Neu:** `VOICE_ENGINE=realtime` in der Env fuehrt NICHT mehr auf einen Media-Stream-Pfad
  (der Wert wird abgelehnt oder ist wirkungslos — der Test beweist das eine oder das andere,
  je nachdem, wie der Plan den Schalter zurueckschneidet).
- **Bestand:** Signatur-, Route-Auth-, Budget-, Kostenarten-, Offenlegungs- und
  Outbound-Snapshot-Tests gruen ohne Anpassung ihrer Erwartung.

### Risiko + Rueckfall

Risiko: ein Leser ausserhalb der Bridge hing an `MEDIA_PATH`, an der Media-Event-Naht oder an
einer OpenAI-Konfiguration (Q7). Gegenmittel: Konsumenten je Funktion zaehlen, im Zweifel
stehen lassen und benennen. Rueckfall: `git revert`; kein Schema, kein Datenzustand. Die
Bridge ist bei Bedarf aus der git-Historie wiederherstellbar — derselbe bewusst akzeptierte
Preis wie beim Twilio-Verifizierer 2026-08-07.
