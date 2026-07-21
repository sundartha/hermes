# Frage 6 — ElevenLabs-Verbrauch pro Tenant (Messprotokoll, read-only, keine Telnyx-API-Aufrufe)

Stand: 2026-07-21. Basis: master=3516c31. Nur Read/grep/WebSearch/WebFetch, keine Aenderung
unter src/, kein Commit, kein Sweep-Aufruf.

## (a) CODE — Ausgangslage verifiziert

**Befund Q6-a1 — BELEGT: zwei getrennte ElevenLabs-Pfade, unterschiedliche Zahler.**

1. **Budget-Pfad (Play-TTS, Server synthetisiert selbst):**
   - `src/tts/directive-synth.js:43-68` (`synthToServeUrl`) ruft `synthesizeSpeech` auf
     (`src/tts/synth.js:12-42`), die direkt `POST {apiBase}/v1/text-to-speech/{voiceId}` mit
     `xi-api-key: cfg.apiKey` aufruft (synth.js:23-28). `cfg.apiKey` = `config.voice.elevenLabsPlayTts.apiKey`
     = `process.env.ELEVENLABS_API_KEY` (src/config.js:236, als SECRET markiert).
   - Zaehler-Erhoehung: `directive-synth.js:64` — `store.recordTtsCharacters(chars, ...)`,
     NUR bei `result.ok` (Kommentar directive-synth.js:14-21, 63).
2. **Assistant-Pfad (Telnyx synthetisiert, Live-Relay bzw. Assistant-Objekt):**
   - `src/telephony/adapters/telnyx/voice.js:172-190` baut den `voice`/`voice_settings`-Block
     fuer das Telnyx-Assistant-/Call-Control-Objekt: `voice: elevenLabsVoiceName(el)`,
     `voice_settings: { type: "elevenlabs", api_key_ref: el.apiKeyRef }` (voice.js:181-182).
     `el = config.telnyx.telnyxElevenLabs` (config.js:215-221).
   - `scripts/telnyx-assistant-provision.mjs:180-181` provisioniert denselben Block im
     Telnyx-Assistant-Objekt (`voice`, `api_key_ref: apiKeyRef`).
   - **Hier ruft NICHT unser Server ElevenLabs auf** — Telnyx selbst tut das serverseitig,
     unser Prozess sieht davon nichts (kein fetch, kein Text, keine Zeichen im eigenen Scope).
     `directive-synth.js` wird auf diesem Pfad nicht durchlaufen (Kommentar directive-synth.js:16-18
     bestaetigt das ausdruecklich: "der Telnyx-gehostete Relay-Pfad laeuft NICHT hier durch").

**Befund Q6-a2 — BELEGT: der Zaehler ist global, nicht pro Tenant, und deckt nur Pfad 1.**
- `src/store/state-ops.js:2351` `recordTtsCharacters(s, chars, cfg, nowIso)` schreibt auf
  `s.platformTtsUsage` — ein EINZELNES Objekt im Store (kein Array/Map ueber tenantId,
  Gegenprobe: `usage`/`budgetUsage` etc. sind an anderer Stelle `Map tenantId -> Bucket`
  (state-ops.js:3 "usage ist eine Map tenantId -> Bucket"), `platformTtsUsage` folgt diesem
  Muster NICHT — Name und Kommentarzeile 2344 "verbucht ... auf dem globalen Zaehler"
  bestaetigen das explizit).
- Einziger Aufrufer von `store.recordTtsCharacters` im ganzen Baum:
  `directive-synth.js:64` (grep bestaetigt: `recordTtsCharacters` taucht nur in
  json.js/pg.js/store.js (Fassade) und state-ops.js (Impl) sowie hier als Aufrufer auf).
- Ausgehende Anrufe laufen laut Auftrags-Ausgangslage grundsaetzlich ueber den
  Assistant-Pfad — d.h. der einzige gefuetterte Zaehler misst NICHT den Pfad, ueber den
  outbound tatsaechlich synthetisiert wird. **Die Ausgangslage des Auftrags ist damit
  durch den Code bestaetigt, nicht widerlegt.**

**Befund Q6-a3 — BELEGT: wer den ElevenLabs-Zugang bezahlt.**
- `config.js:208-214` (Kommentar, wortgleich zitiert): "apiKeyRef = IDENTIFIER des
  Telnyx-Integration-Secrets, das den ElevenLabs-API-Key haelt (der Key selbst liegt NUR
  bei Telnyx, nie hier). Bewusste Vereinfachung: EIN Plattform-Key - TTS-Zeichen aller
  Tenants laufen ohne per-Tenant-Metering aufs Owner-ElevenLabs-Konto (Paid-Plan noetig)."
- D.h.: Telnyx haelt nur die REFERENZ (`api_key_ref`), der zugrunde liegende ElevenLabs-Key
  ist UNSER eigener (Owner-)Account, nicht Telnyx' eigener Vertrag mit ElevenLabs. WER
  BEZAHLT: der Owner, ueber sein eigenes ElevenLabs-Konto — das beantwortet die gestellte
  Frage direkt aus einem Code-Kommentar, keine weitere Messung noetig.
- `scripts/telnyx-assistant-provision.mjs:157` bestaetigt dasselbe fuer den
  Assistant-Provisioner: "apiKeyRef ist die REFERENZ auf das in Telnyx liegende
  Integration-Secret (KEIN [Key selbst])".

## (b) Beleg-Spur in den vorhandenen LCT-Messberichten

**Befund Q6-b1 — TEILWEISE BELEGT: ein `text-to-speech`-Record faellt auf dem
Assistant-Pfad tatsaechlich an.**
- `tasks/lct-fix-1-report.md:179` (Live-Smoke, reale Belegformen, in-process gegen
  gestubbtes fetch): "`text-to-speech` ueber `call_session_id`" ... "`costMicroCents`
  4010000 / 100000 / 16870" — der dritte Wert (16870 Mikro-Cent = 0,1687 ct) gehoert zum
  `text-to-speech`-Record.
- `PLAN-LIVE-COST-TRACING.md:185` (Tabelle 2.6, echte Stichprobe von 293 Records,
  read-only, 2026-07-20): `text-to-speech` Beispiel-`cost` `"1.687E-4"` bzw. `"0.003216"`,
  Beispiel-`rate` `"7.0E-7"`, `currency` USD, Notation teils wissenschaftlich.
- `PLAN-LIVE-COST-TRACING.md:387-389`: "16 von 50 `text-to-speech`-Records tragen ihren
  `cost` als `"1.61E-4"`, `"1.687E-4"`, `"1.75E-4"`" — bestaetigt, dass `text-to-speech`
  als eigener `record_type` bei Telnyx regelmaessig auftaucht, nicht nur einmalig.
- **Das beantwortet die erste Haelfte von (b): JA, ein `text-to-speech`-Beleg faellt auch
  auf dem Assistant-Pfad an** (Telnyx verrechnet die ElevenLabs-Synthese, die es in
  unserem Auftrag ausfuehrt, offenbar als eigene Kostenposition durch).

**Befund Q6-b2 — UNBELEGT: keine Mengenangabe (Zeichen/Einheiten) im dokumentierten Feldsatz.**
- `PLAN-LIVE-COST-TRACING.md:170-171` (Kapitel 2.6, Wortlaut): "`GET
  /v2/detail_records?filter[record_type]=<typ>` liefert **pro Datensatz** `cost`, `rate`,
  `currency`, `rate_measured_in`." Das ist der VOLLSTAENDIGE dokumentierte Feldsatz aus der
  echten Stichprobe (293 Records). Kein Feld fuer Zeichenzahl, Dauer, oder sonstige Menge
  wird in den LCT-Berichten (P1/P3/P4/FIX-1) irgendwo erwaehnt oder zitiert.
  `rate_measured_in` beschreibt vermutlich die Einheit der `rate` (z.B. "pro Zeichen"),
  aber KEIN Bericht zitiert einen konkreten Wert dieses Feldes fuer `text-to-speech` —
  UNBELEGT, ob/wie er die tatsaechlich verbrauchte Zeichenzahl hergibt.
- **Klaerende Messung (fuer den API-Agenten, spaeter):** `GET /v2/detail_records?filter[record_type]=text-to-speech&page[size]=1`
  gegen einen bekannten Call-Zeitraum, volles JSON-Objekt eines einzelnen Records loggen
  (inkl. `rate_measured_in` und aller sonstigen Felder) — klaert, ob `rate` x Menge = `cost`
  rekonstruierbar ist und ob eine Zeicheneinheit im Record steckt.

## (c) ElevenLabs-Seite (Web-Recherche, mit Quelle)

**Befund Q6-c1 — BELEGT: History-API mit Zeichenzahl pro Generierung, aber ohne
externes Referenzfeld.**
- `GET /v1/history/{history_item_id}` liefert laut Doku u.a. `history_item_id`, `voice_id`,
  `voice_name`, `date_unix`, `request_id` (nullable), `character_count_change_from`,
  `character_count_change_to`, `model_id`, `text`, `settings`, `source`, `voice_category`.
  ("Get history item", https://elevenlabs.io/docs/api-reference/history/get)
- `GET /v1/history` (Liste) unterstuetzt Filter `voice_id`, `model_id`,
  `date_before_unix`/`date_after_unix`, `sort_direction`, `search` (Text-Suche im `text`-Feld),
  `source`, `page_size` (max 1000). ("Get generated items",
  https://elevenlabs.io/docs/api-reference/history/list)
- **Kein Feld fuer eine selbst vergebene externe Referenz/ID** wird in beiden Dokumenten
  erwaehnt — es gibt `request_id` (ElevenLabs-intern), aber keinen dokumentierten
  Metadaten-Parameter, den man beim Synth-Aufruf mitgeben und in der History wiederfinden
  koennte.
- Konsequenz: Zuordnung zu einem Anruf waere nur ueber **Zeitfenster-Korrelation**
  moeglich (Call-Start/-Ende bekannt, `date_after_unix`/`date_before_unix` filtern,
  ggf. `search` auf den gesprochenen Text, falls das rohe Transkript zu dem Zeitpunkt noch
  vorliegt — Lehre `umlaut-transliteration-root-cause`: Rohtranskript wird nach der
  Summary geloescht, die Korrelation muesste also zeitnah laufen), nicht ueber eine feste ID.

**Befund Q6-c2 — BELEGT: Usage-Analytics erlaubt Aufschluesselung nach API-Key, aber
kein Autotagging pro externem Request.**
- "Usage analytics" (https://elevenlabs.io/docs/overview/administration/usage-analytics):
  Workspace-Usage-Tab laesst sich "by voice, product, or API key" aufschluesseln, zusaetzlich
  bei Workspace-Nutzern "by individual user or workspace group", Zeitraum "by day, week,
  month or cumulatively". Kein dokumentiertes Feld zur Attribution auf einen einzelnen
  externen Call/Request.

**Befund Q6-c3 — BELEGT: mehrere API-Keys pro Workspace mit eigenem Zeichen-/Credit-Limit.**
- "API Keys" (https://elevenlabs.io/docs/overview/administration/workspaces/api-keys):
  beliebig viele Keys anlegbar/widerrufbar, jeder Key optional mit eigenem
  Zeichen-/Credit-Kontingent pro Monat und eigenen Scope-/IP-Restriktionen konfigurierbar.
  Das waere technisch der Hebel fuer "1 Key = 1 Tenant" (dann liesse sich Usage pro Key
  in den Analytics direkt lesen) — ABER: keine Aussage in der Doku zu einer harten
  Obergrenze der Zahl gleichzeitig aktiver Keys pro Workspace gefunden (UNBELEGT), und ein
  Key-pro-Tenant-Modell skaliert der Deklaration nach ("Millionen Menschen") strukturell nicht
  (ein Key je von potenziell Millionen Tenants ist ein anderes Betriebsmodell als "ein
  Plattform-Key", vgl. Q6-a3).

## (d) Empfehlung mit Kosten-Groessenordnung

**Materialitaets-Rechnung (aus dem belegten Stand des Auftrags, nicht neu gemessen):**
TTS-Anteil eines 57-s-Assistant-Anrufs = 0,000167 USD von 0,094267 USD Gesamtkosten
= **0,177 % (~0,18 %)** der Anrufkosten. Zum Vergleich: der Assistant-Aufschlag allein
(0,05 USD flat/Minute) ist ~300x so gross wie der TTS-Anteil.

**Empfehlung: Option B (nicht pro Tenant erfassen, pauschal einpreisen, als bewusste
Luecke im Plan fuehren) — mit Fristigkeits-Vorbehalt.**
Begruendung:
- Der Fehler ist mit 0,18 % der Anrufkosten nicht materiell — er liegt unterhalb der
  Rundungs-/Notations-Rauschgrenze, die die Kette bei anderen Kostenarten schon toleriert
  (z.B. die 60-Sekunden-Aufrundung aus D11, oder die Tatsache, dass `speech-to-text` auf dem
  Assistant-Pfad laut belegtem Stand ohnehin nicht separat berechnet wird).
- Option A (pro Tenant erfassen) hat laut (c) KEINEN sauberen Hebel: kein externes
  Referenzfeld beim Synth-Call, Korrelation nur ueber Zeitfenster + ggf. Transkripttext
  (der oft schon geloescht ist), UND das einzig saubere Modell (Key pro Tenant) skaliert
  nicht auf die deklarierte Millionen-Zielgroesse (Q6-c3).
- Der bereits gemessene Assistant-Aufschlag (flat 0,05 USD/Minute) ist so viel groesser
  als der TTS-Anteil, dass er den Fehler in der Praxis vollstaendig ueberdeckt — eine
  Praezisionskorrektur, die 0,18 % der Kosten genauer macht, waere Aufwand ohne
  wirtschaftliche Wirkung, solange der Sweep bereits die anderen, weit groesseren
  Kostenarten (sip-trunking, ai-voice-assistant) korrekt zuordnet.
- Vorbehalt: diese Rechnung gilt fuer die HEUTIGE Tarifstruktur (0,05 USD/Minute Aufschlag).
  Sollte der Owner den TTS-Anbieter wechseln oder die Tarifstruktur so aendern, dass TTS
  einen groesseren Anteil traegt (z.B. laengere durchschnittliche Sprechdauer, teurere
  ElevenLabs-Modelle), muss diese Materialitaetsrechnung neu gemessen werden — sie ist
  KEINE dauerhafte Garantie, sondern gilt nur fuer die heute gemessene Konfiguration
  (Kalibrierungs-Reichweite-Regel).
- Konkrete Umsetzung falls Option B: `platformTtsUsage`/`recordTtsCharacters`
  (state-ops.js:2351) im Code-Kommentar UND in PLAN-LIVE-COST-TRACING.md als "misst NUR
  den Budget-Pfad, deckt NICHT den produktiven Assistant-Pfad ab; TTS-Anteil < 0,2 % der
  Anrufkosten, bewusst nicht pro Tenant/Assistant-Pfad erfasst" dokumentieren, damit die
  Luecke nicht erneut als unbemerkter Blindfleck durchgeht.

Falls der Owner spaeter doch Option A will: die einzige beleg-basierte Route waere ein
periodischer ElevenLabs-History-Sweep (eigener API-Key, eigenes Rate-Limit, GETRENNT vom
Telnyx-Sweep) mit Zeitfenster-Korrelation gegen Call-Start/-Ende — kein Big-Bang, sondern
ein eigener kleiner Plan mit eigener Rate-Limit-Messung (Lehre aus D1: nie ungemessen gegen
ein Rate-Limit fahren).
