# Arbeits-Todo (Scratch)

Dieses File ist der Arbeits-Scratch fuer die jeweils laufende Phase (siehe
`.claude/refs/workflow.md`) und wird pro Aufgabe neu befuellt.

- Dauerhafter Ueberblick ueber offene Punkte: **`STATUS.md`**
- Lehren aus abgeschlossenen Aufgaben: **`tasks/lessons.md`**

---

# Task: Widget-Politur (Icon + i18n + Design-Cleanup) — 2026-07-02

Owner-Auftrag (3 Punkte, Chat-Widget bei MCP-Aufruf):

1. Chat-Header-Icon zeigt Default-Wuerfel statt Fluegel.
2. Widgets sind hart deutsch — international machen (en/de/fr, EN-Default).
3. Design eleganter (Hermes/griechisch), Debug-Infos im Fuss entfernen
   (call_id/FAILED/ui-notifications-Zeile/Timestamp), Fluegel+Animation bleiben.

Verifizierte Vorab-Befunde (Lead, empirisch):

- Connector-URL ist `https://app.sundartha.com/mcp`; `serverInfo.icons[0].src`
  zeigt via PUBLic_URL auf `vodafone-agent.onrender.com` -> Cross-Origin-Icon,
  claude.ai verwirft es (Higgsfield=Custom-Connector MIT Icon beweist Machbarkeit).
  Icon-PNG zudem 592KB/1024px. Beide Origins liefern das PNG mit 200.
- Alle 5 Widget-Templates (src/ui/widgets) tragen deutsche Labels; call.html
  zusaetzlich STATUS_VIEW-Labels im Inline-Skript + sichtbare Diag-/ID-Zeilen.
- BIND_SCRIPT schreibt raw-Werte in [data-mcp]-Slots und laeuft NACH dem
  Inline-Skript -> sichtbare formatierte Dauer braucht eigenes Display-Element
  ohne data-mcp; call_id-Slot bleibt verstecktes Funktions-Slot (currentCallId).
- Token-Gate (scripts/check-token-sync.js) prueft Widgets nur auf @import-Verbot;
  keine neuen Hex-Token einfuehren, bestehende Tokens/rgba nutzen.
- design-system/mcp/call.html = manuell gepflegtes Specimen (DESIGN ONLY) ->
  nach Aenderung nachziehen.

## Todos (erwartetes Ergebnis + Verifikation, workflow.md Regel 7)

- [x] 1. Icon als data-URI: kleines optimiertes PNG (<=256px) als
      `icons[0]` (data:) + bestehende https-URL als `icons[1]` in
      HERMES_SERVER_INFO. Erwartet: icons[0].src beginnt mit
      `data:image/png;base64,`, decodiert mit PNG-Magic, < 150KB.
      Verifikation: neuer Test in test/ + `npm test`.
- [x] 2. `src/ui/widget-i18n.js`: DICT en/de/fr + I18N_SCRIPT
      (window.HermesI18n.t, [data-i18n]-Swap bei DOMContentLoaded,
      html.lang setzen; Locale: window.openai.locale || navigator.language,
      Fallback en). Erwartet: Key-Paritaet aller Locales, t()-Fallback en.
      Verifikation: neuer Test test/mcp-ui-widget-i18n.test.js.
- [x] 3. widget-catalog: I18N-Platzhalter-Injektion in <head> aller 5 Widgets.
      Erwartet: widgetHtml(id) enthaelt HermesI18n fuer alle 5, kein
      Platzhalter-Leak. Verifikation: Test + npm test.
- [x] 4. 5 Widget-Templates: EN-Default-Texte + data-i18n-Keys; call.html
      Inline-Skript nutzt t() fuer STATUS_VIEW/Button; failure_reason-Map
      (no-answer/busy/...) lokalisiert; objective_achieved bool->Yes/No
      lokalisiert. Erwartet: keine deutschen Hardcodes mehr in den Templates.
      Verifikation: grep + angepasste W1-Tests.
- [x] 5. call.html Design: .diag-Zeile weg (setDiagnostic nur noch interner
      Zustand, Fallback-Timeout-Verhalten bleibt), id-Block versteckt
      (funktional), Dauer als m:ss via Display-Element, Footer als
      HERMES-Inschrift + dezenter Maeander-Akzent (nur bestehende
      Farb-Tokens/rgba-Weiss). Erwartet: kein sichtbares call_id/FAILED/
      ui-notifications/Timestamp mehr. Verifikation: W1-Tests angepasst +
      visueller Harness.
- [x] 6. design-system/mcp/call.html Specimens nachziehen (EN + neuer Fuss).
      Verifikation: npm test (Sync-/Token-Gates gruen).
- [x] 7. Visueller Loop lokal: Harness in Scratchpad (kompiliertes Widget-HTML
      + postMessage-Simulation dialing/in_progress/completed/failed ×
      en/de/fr) via Chrome-Screenshots. Erwartet: EN/DE/FR korrekt, kein
      Debug-Fuss, Fluegel+Ring unveraendert.
- [x] 8. `node --check` alle geaenderten Dateien + `npm test` komplett gruen.
- [x] 9. Commit + push origin UND upstream (Render autodeploy), healthz +
      [boot]-Banner pruefen.
- [ ] 10. Live-Verifikation claude.ai (Chrome): neuer Chat, read-only Tool
      (get_my_number o.ae.) triggern -> Widget EN/DE pruefen; Connector-Seite:
      Fluegel-Icon statt Wuerfel (ggf. Cache/Reconnect-Hinweis an Owner).

## Bewusste Abgrenzungen

- Tool-Result-TEXTE (content[0].text, z.B. "Noch keine Anrufe.") bleiben
  deutsch — Claude uebersetzt im Chat selbst; separater Task falls gewuenscht.
- Listen-Widgets (calls/calendar): keine Datums-/Feld-Formatierung in diesem
  Task (nur Labels/i18n).
- PUBLIC_URL/Origin-Cutover (Track B) unangetastet.

# Task: Deterministische Wahl-Ziel-Normalisierung (Wurzelfix LLM-Ziffern-Regeneration)

RCA call_mr3upd4uz8p3 (02.07. 18:41): Chat-Client (LLM) formte "01737252163" in
E.164 um und erfand dabei eine Ziffer (+4917237252163, 32s Klingeln bei Fremdem).
Wurzelfix: Server normalisiert deterministisch, Tool-Description verbietet dem
Modell das Umformen (Option 1, Owner-entschieden: Telefon-Konvention).

- [x] 1. defaults.js: homeCountryCode(candidates) + normalizeDialTarget(num, home).
      Erwartet: ("01737252163","+49")->"+491737252163"; ("0049...",*)->"+49...";
      ("+...",*)->unveraendert; ohne home->unveraendert. Verifikation: Unit-Tests
      in test/dial-target-normalization.test.js.
- [x] 2. server.js POST /api/calls: to nach TENANT_REJECT-Check normalisieren
      (Heimatland: privateNumber -> aktive DID), C4-Trunk-0-Praedikat auf dem
      Ergebnis wiederholen. Erwartet: Gates+Dial sehen NUR die normalisierte
      Nummer; kein Heimatland -> 400 E.164 (fail-closed). Verifikation:
      HTTP-Tests (400/500-Diskriminator wie e164-trunk-zero-reject.test.js).
- [x] 3. mcp-tools.js place_call: to-Description umdrehen (zeichengenau
      uebernehmen, NIE umformen; Auslands-National-Format -> nachfragen).
      Erwartet: reiner Text-Diff. Verifikation: node --check + npm test.
- [x] 4. node --check (3 Dateien) + npm test komplett gruen; Smoke:
      PORT=3999 lokal + curl /api/calls mit "01737252163" (mit DE-privateNumber
      geseedet -> passiert Format-Gate; ohne -> 400).
- [x] 5. Clean-Code-Review (Sonnet-Subagent, .claude/refs/clean-code.md);
      S1/S2 fixen bis PASS.

## Review (02.07.2026)

- Verifikation 1-3: test/dial-target-normalization.test.js 16/16 gruen
  (Unit-Sektion + HTTP-400/500-Diskriminator, inkl. privateNumber-vor-DID,
  DID-Fallback, fail-closed ohne Heimatland, Trunk-0-Wiederholungspruefung).
- Verifikation 4: node --check ok, npm test 1620/1620 gruen (Smoke =
  HTTP-Sektion: echter Server-Spawn + curl-aequivalente fetch-Requests).
- Verifikation 5: Sonnet-Audit S1:0 S2:1 S3:1 -> beide gefixt
  (isTrunkZeroFormatError-Praedikat statt dupliziertem Guard; benannte
  homeCountry-Zwischenvariable); Suite danach erneut 1620/1620.
- Gate-Reihenfolge vom Auditor explizit als PASS bestaetigt (Normalisierung
  nach Tenant-Aufloesung, vor allen Ziel-Gates; Denylist-Praezedenz gewahrt).
---

# Task: ElevenLabs-TTS ueber Telnyx (globale Plattform-Stimme)

Plan: /Users/antonio/.claude/plans/woolly-mapping-parrot.md (Owner-approved).
Kern: Telnyx rendert `<Say voice="ElevenLabs.<Model>.<VoiceId>" api_key_ref="...">`,
wenn config.telnyxElevenLabs (apiKeyRef+voiceId) gesetzt ist - sonst Azure
byte-identisch. STT bleibt Deepgram (Telnyx kann ElevenLabs nur fuer TTS).
Twilio + Realtime unberuehrt. KEINE Store-/UI-/server.js-Aenderung.

## Schritte

1. [x] `src/config.js`: `telnyxElevenLabs` {apiKeyRef, voiceId, model="Default"}
       aus TELNYX_ELEVENLABS_API_KEY_REF / _VOICE_ID / _MODEL.
2. [x] `.env.example`: 3 Vars dokumentiert (inkl. bewusster Vereinfachung:
       EIN Plattform-Key, kein per-Tenant-TTS-Metering).
3. [x] `render.yaml`: 3 Env-Eintraege (REF/VOICE_ID sync:false, MODEL value Default).
4. [x] `test/helpers.js` BASE_ENV: alle 3 mit "" (Lehre test-base-env-drift).
5. [x] `src/telephony/adapters/telnyx/render.js`: opts-Durchreichung
       (renderDirectives(directives, opts={})) + sayVoiceAttrs(d, opts):
       ElevenLabs-Zweig NUR wenn apiKeyRef UND voiceId (fail-safe, kein Wurf),
       OHNE language-Attribut; gatherAttrs byte-unveraendert; innerer
       Gather-Say erbt opts.
6. [x] `src/telephony/registry.js`: Telnyx-voiceRenderer injiziert
       { elevenLabs: config.telnyxElevenLabs }; Twilio unveraendert.
7. [x] Neu `test/telnyx-elevenlabs-render.test.js`: Snapshots (Say/Gather DE,
       FR/EN-STT-Locale, Gate halb/aus -> Azure, Model-Override v3).
8. [x] Integrationstest `test/telnyx-elevenlabs-inbound.test.js`: Spawn mit
       Env-Vars + Telnyx-Inbound -> ElevenLabs. + api_key_ref +
       transcriptionEngine="Deepgram"; Gegenproben: ohne Env -> Azure,
       Twilio-Inbound -> ElevenLabs-frei.

## Erwartetes Ergebnis (deterministisch)

- Env leer (Default): `npm test` komplett gruen, telnyx-render.test.js
  byte-identisch (kein Verhaltenswechsel).
- opts {apiKeyRef:"elevenlabs_prod", voiceId:"abc123", model:"Default"}:
  `<Say voice="ElevenLabs.Default.abc123" api_key_ref="elevenlabs_prod">` ohne
  language-Attribut; Gather-Attribute byte-identisch zum Azure-Bestand.
- Spawn-Test mit Env: /voice/incoming-Response matcht /ElevenLabs\./ und
  /api_key_ref="elevenlabs_prod"/ und /transcriptionEngine="Deepgram"/.

## Verifikation (gelaufen in dieser Session, alles gruen)

- `node --check` auf alle geaenderten src-/test-Dateien: OK.
- `npm test`: 1581/1581 gruen (inkl. 7 neuer Tests); Bestands-Snapshots
  telnyx-render/directive-render/g3-speech-timeout unveraendert gruen
  (Default aus = byte-identisch belegt).
- Lokaler curl-Smoke (PORT=3999, SKIP_TWILIO_SIGNATURE_CHECK=true, REF+VOICE_ID
  gesetzt): Telnyx-Inbound rendert `<Say voice="ElevenLabs.Default.abc123"
  api_key_ref="elevenlabs_prod">` im Gather OHNE language-Attribut, Gather-STT
  byte-identisch (Deepgram/nova-3/de-DE/auto); Twilio-Inbound unveraendert
  Polly.Vicki-Neural (beobachteter TeXML-Output).

## Live-Schaltung (2026-07-02, Owner-genehmigt, autonom ausgefuehrt)

- [x] Merge origin/master (cc5ed53) + Push origin/upstream master; Deploy live,
      [boot] deployed commit=cc5ed53 (19:25 UTC), healthz 200.
- [x] ElevenLabs: Voice "Ela - Empathetic & Warm" (SJJe86Va82zRzg6zi2dX, Library-
      Voice fuer Customer-Support/AI-Agents) in My Voices; API-Key "telnyx-tts"
      restriktiert (TTS Access, Voices Read, Models Access, User Read).
- [x] Telnyx: Integration Secret identifier=elevenlabs_prod (per API, Key nur
      via Clipboard, nie geloggt).
- [x] Render-Env: TELNYX_ELEVENLABS_API_KEY_REF=elevenlabs_prod,
      TELNYX_ELEVENLABS_VOICE_ID=SJJe86Va82zRzg6zi2dX, _MODEL=Default.

## Offen (nur Owner, echtes Telefon)

- Testanruf DE + EN auf die Telnyx-Nummer: spricht der Gather-innere Say
  ElevenLabs? STT weiter ok? Latenz vs. Azure akzeptabel?
- Rollback jederzeit: die zwei Env-Vars in Render leeren (ein Restart).
