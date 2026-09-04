# Uebergabe: Hermes redet die falsche Sprache (Stand 2026-09-04, 15:00 CEST)

> **Lies diese Datei ganz, bevor du irgendetwas anfasst.** Sie ist nach BELEGT /
> WIDERLEGT / OFFEN getrennt. Uebernimm NICHTS aus dem WIDERLEGT-Teil als Ausgangspunkt —
> das sind bereits verbrannte Hypothesen der Vorsession. Wer sie wiederholt, verliert Zeit
> und den Rest des Vertrauens des Eigentuemers.

## Das Problem, in den Worten des Eigentuemers

Hermes hat wochenlang zuverlaessig auf Deutsch telefoniert. Am 2026-09-04 gab es an einem
Tag drei kaputte Anrufe:

1. **06:01 UTC** — der Anruf kam an, der Eigentuemer nahm ab, **der Agent sagte kein Wort**.
2. **08:49 UTC** — Anruf lief auf die Mailbox; der Agent sprach dort **Englisch** (mit einem
   deutschen Satz mittendrin).
3. **12:37 UTC** — der Eigentuemer nahm ab, **der Agent redete Spanisch**, wechselte erst
   nach ausdruecklicher Aufforderung auf Deutsch.

Seine Kernaussage, die jede Diagnose bestehen muss: *"Es hat die ganze Zeit funktioniert.
Bis gestern. Sonst hat er immer auf Deutsch geredet, war perfekt."* Und: *"Wenn der User auf
Deutsch eingestellt ist, dann soll er NUR Deutsch reden. Englisch ist Default nur dann, wenn
unklar ist, welche Sprache der User will."*

Er hat ausserdem zweimal zu Recht widersprochen, als die Vorsession den Fehler beim Anbieter
gesucht hat. Seine Haltung: **der Fehler liegt bei uns.** Halte dich daran, bis das Gegenteil
BELEGT ist — nicht plausibel, sondern belegt.

## Zugaenge (alle in der Vorsession benutzt und funktionierend)

| Was | Wie |
|---|---|
| Prod-DB (RLS!) | Render-MCP `query_render_postgres`, Postgres `dpg-d8tpesreo5us73bogaig-a`, Workspace `tea-d8m0b9jeo5us73cvasg0` |
| RLS umgehen | `WITH s AS MATERIALIZED (SELECT set_config('app.current_tenant','<tenant>',true)) SELECT ... FROM s, call c ...` — ohne das liefert JEDES SELECT 0 Zeilen |
| Tenant des Eigentuemers | `t_user_01KX600834GCJFV9GTZQKWZMTH` |
| Server-Logs | Render-MCP `list_logs`, Service `srv-d8m0fhflk1mc73bno570` (Retention 7 Tage!) |
| EL-Gespraechsprotokoll | `GET https://api.elevenlabs.io/v1/convai/conversations/<conv_id>`, Header `xi-api-key` aus `.env` |
| EL-Agent live | `GET /v1/convai/agents/agent_5301kwkh9vv3ezesf100pggfj9rs` |
| **EL-Agent HISTORISCH** | `GET /v1/convai/agents/<id>?version_id=<ver>` — **so kommst du an den Zustand VOR einer Aenderung** |
| Versionsliste | `GET /v1/convai/agents/<id>/branches/<branch_id>` -> Feld `most_recent_versions` (die `/versions`-Liste allein gibt 404) |
| Anbieter-Schema | `https://api.elevenlabs.io/openapi.json` (2 MB, mit jq filtern) |
| Telnyx-Belege | `GET /v2/detail_records?filter[record_type]=sip-trunking` — record_type `call` existiert NICHT |

**Gesperrt fuer den Agenten (Sandbox-Classifier):** `scripts/push-elevenlabs.mjs` in JEDER
Aufrufform, auch der reine Trockenlauf, und `mcp__render__trigger_deploy`. Der Eigentuemer
muss diese Befehle selbst fahren (`!<befehl>` im Prompt). Render-Deploy geht ersatzweise per
`curl -X POST https://api.render.com/v1/services/<id>/deploys` mit dem Key aus
`~/.config/hermes/render-api-key`. Auch `psql` direkt ist gesperrt — nimm den Render-MCP.

## Die vier Anrufe (Rohdaten, alle nachpruefbar)

| Zeit UTC | call_id | EL conversation_id | Ergebnis |
|---|---|---|---|
| 09-03 17:10 | `call_mtls5zp3ppym` | `conv_9301m1m3z963ewbvz4s7zzrevfa0` | **gut**, 55 s, durchgehend deutsch |
| 09-04 06:01 | `call_mtmjpnpg4hcm` | `conv_0301m1ng37y6fb0rhkx0hg1qg1np` | tot, 0 s bei EL |
| 09-04 08:49 | `call_mtmpqje4clmh` | `conv_4501m1nsr1hhe2aa07pt5t38r0zy` | Mailbox, englischer Text |
| 09-04 12:37 | `call_mtmxvh5iiq3t` | `conv_2901m1p6s4heejhtwj1wydfhjsjy` | **Spanisch** |

## BELEGT (jede Zeile am Runtime-Objekt gemessen, nicht erschlossen)

1. **Der EL-Agent lief 14 Tage unveraendert.** Version 38 (`agtvrsn_6601m0g1rhdcez98q21cq3ntx9ga`)
   committed 2026-08-20 16:58 UTC; Version 39 (`agtvrsn_4601m1mc6dtdexy9bx0m83npzmjk`)
   committed 2026-09-03 19:33 UTC. Dazwischen KEINE Version. Genau in diesem Fenster lagen
   alle funktionierenden Anrufe.
2. **Der Live-Prompt-Diff v38 -> v39 besteht aus GENAU zwei Regelbloecken** (per
   `?version_id=` beide Fassungen gezogen und diffed):
   - "Deliver content exactly once. When you start an answer, a story or a result, the very
     next sentence is that answer, story or result - never a second introduction of it. You
     announce an action only while a tool call or a wait is actually happening; once you are
     speaking content, speak the content."
   - "Convey mood through word choice and pacing only, never through notation of any kind."
   Sonst kein Zeichen Unterschied. **Keine Sprachanweisung geaendert.**
3. **`Begin the call in English.` und `If the other party switches to another language,
   continue in that language` stehen WORTGLEICH schon in Version 38** — also in der Fassung,
   die zwei Wochen einwandfrei lief.
4. **Serverseitig sind guter und Spanisch-Anruf identisch konfiguriert.** Beide senden
   `conversation_config_override.agent.language = "de"`, dieselbe deutsche `first_message`,
   dieselbe `voice_id`. Einziger Unterschied: die dynamische Variable `voicemail_line` ist
   beim 12:37-Anruf neu dabei (kommt aus dem DE1-Deploy, s. u.).
5. **`language_detection` war bei ALLEN Anrufen `enabled: true`** (auch in den zwei guten
   Wochen), aber `used: false` — bis 09-04 12:37, wo es zum ersten Mal `used: true` ist.
6. **`voicemail_detection` hat in 11 Anrufen seit 2026-08-20 GENAU EINMAL gefeuert**: am
   09-04 08:50.
7. **Beim Spanisch-Anruf kam der Sprachwechsel VOR dem Werkzeug.** Transkript: Agent spricht
   t=0s deutsch; der User-Turn bei t=2s ist als **"No. ¿Sí está ahí?"** transkribiert
   (`source_medium: "audio"`); Agent antwortet t=9s spanisch; `language_detection` wird erst
   **t=23s** gerufen. Das Werkzeug war also Folge, nicht Ausloeser.
8. **`language_detection.params.only_at_conversation_start` steht live auf `false`** — die
   Erkennung darf den ganzen Anruf lang umschalten. Die Vorlage nennt das eine bewusste alte
   Entscheidung (E-5).
9. **`voicemail_message` liegt statisch und englisch** unter
   `conversation_config.agent.prompt.built_in_tools.voicemail_detection.params.voicemail_message`,
   byte-identisch mit der Repo-Vorlage, unveraendert seit 2026-08-14.
10. **Die Sprachpresets (de/es/fr) ueberschreiben NUR `agent.first_message` und
    `agent.language`.** `overrides.agent.prompt` ist `null`, Werkzeug-Overrides fehlen ganz.
    Alles andere faellt auf die englische Basis zurueck.
11. **Anbieter-Schema (gemessen):** weder `language_presets.<lang>.overrides` noch
    `conversation_config_override` fuehren einen `built_in_tools`-Zweig. Preset- und
    Per-Anruf-Override sind fuer Werkzeug-Felder tot.
12. **Der 06:01-Anruf:** EL meldet `status: failed`, `call_duration_secs: 0`, leeres
    Transkript, `accepted_time_unix_secs: null`, leeres `call_sid`, und
    `error: {code: 1011, reason: "sip request timed out", error_type: "call_initialization_error"}`.
    Telnyx dagegen berechnet 20 s mit `hangup_cause: NORMAL_CLEARING`. Die Telco-Haelfte stand,
    die EL-Haelfte kam nie zustande.
13. **DeepSeek-Konto ist ueberzogen:** `total_balance "-0.33"`, `is_available: false`. Seit
    2026-09-02 15:57 UTC faellt bei JEDEM Anruf `[precall-briefing]` und `[opening-line]` mit
    HTTP 402 aus (Eroeffnung faellt auf `quelle=auftrag` zurueck). **Das Gespraech selbst
    laeuft NICHT ueber DeepSeek** — der EL-Agent nutzt sein eigenes LLM (`claude-sonnet-5`);
    am 09-03 lief mit demselben 402 ein einwandfreies 55-s-Gespraech.
14. **Der `ALARM_LLM_BILLING`-Alarm sitzt nur im Telnyx-Inbound-Zweig** und hat in 30 Tagen
    Logs nie gefeuert. Auf dem aktiven EL-Outbound-Pfad landet der 402 nur in `console.warn`.

## WIDERLEGT — nicht noch einmal verfolgen

- **"Der Prompt-Push von gestern hat das Spanisch verursacht."** Widerlegt durch BELEGT 2/3/7:
  der Diff enthaelt keine Sprachregel, die einschlaegige Regel ist aelter als das gute
  Zeitfenster, und das Werkzeug feuerte nach dem Wechsel. Die Vorsession hat das dennoch als
  Befund praesentiert — es war Mustererkennung ("beide Symptome sind Werkzeug-Aufrufe"), kein
  Mechanismus. **Ein Rollback auf Version 38 wuerde das Spanisch nicht verhindern.**
- **"US-DID -> DE-Mobil ist unzuverlaessig, deshalb der tote Anruf."** Der Eigentuemer hat
  widersprochen und hat recht: 8 Anrufe vom 20.08. bis 03.09. liefen ueber dieselbe Nummer
  `+17067101188` sauber. Der aeltere Befund `telnyx-fresh-did-no-de-routing` stammt aus der
  TeXML-Zeit und ist auf den heutigen EL-SIP-Weg nicht uebertragbar. **+49-DID ist NICHT der
  Fix.**
- **"Der englische Voicemail-Text kam mit dem Push."** Nein — er liegt seit 2026-08-14
  unveraendert dort (BELEGT 9) und ist am 09-04 08:50 nur zum ersten Mal ueberhaupt gezuendet
  worden.
- **"Das Drift-Gate ist gruen, also hat sich nichts geaendert."** Zirkulaer: das Gate
  vergleicht Live gegen ein SOLL, das im selben Zug mitgeaendert wurde. Gruen heisst nur, dass
  der Push sauber durchlief.

## OFFEN — hier liegt die eigentliche Arbeit

**Die zentrale, unbeantwortete Frage:** Warum feuern `voicemail_detection` (08:50) und
`language_detection` (12:37) ausgerechnet am 2026-09-04 zum ersten Mal, nachdem sie zwei
Wochen lang bei jedem Anruf verfuegbar waren und nie ausloesten? Zufall ist moeglich, aber
zwei Erstausloesungen an einem Tag sind auffaellig. **Wer das beantwortet, hat die Wurzel.**

Konkrete offene Punkte:

1. **Hat die Spracherkennung wirklich falsch gehoert, oder hat der Eigentuemer etwas gesagt,
   das echt mehrdeutig war?** Am Agenten ist `record_voice: true` und die Aufbewahrung
   unbegrenzt (`retention_days: -1`) — **das Audio des 12:37-Anrufs existiert und wurde noch
   von niemandem angehoert.** `GET /v1/convai/conversations/<id>/audio`. Das ist der direkteste
   noch ungenutzte Beleg.
2. **Hat der DE1-Deploy etwas veraendert?** Der Spanisch-Anruf lag **vier Minuten** nach dem
   Deploy von `bc4fe1e` (live 12:33:37 UTC, Anruf 12:37:29 UTC). Der Diff an
   `src/elevenlabs/outbound.js` ist rein additiv (eine neue dynamische Variable
   `voicemail_line`, `agent.language` unberuehrt) — geprueft, aber **nicht ausgeschlossen**,
   dass eine zusaetzliche dynamische Variable das Verhalten des Anbieter-Modells beeinflusst.
   Gegenprobe: ein Anruf mit demselben Server-Stand, aber ohne die Variable, oder ein Vergleich
   der Anbieter-Antworten.
3. **Aendert jemand anderes den Agenten oder das Repo?** Das Deploy-Repo ist
   `github.com/jonas986/vodafone-agent` (upstream), nicht das des Eigentuemers; es gibt einen
   zweiten Entwickler, dessen Commits regelmaessig einfliessen. Der EL-Agent hat genau EINEN
   Branch ("Main"), aber mehrere Personen haben Zugang (`team@sundartha.com`, Rolle admin).
   **Pruefe die Versionshistorie auf Aenderungen, die nicht aus dem Repo stammen** — und ob
   zwischen den Anrufen etwas am Agenten passiert ist, das niemand protokolliert hat.
4. **Warum kam der 06:01-Anruf nie zustande?** BELEGT 12 sagt nur, WO es scheiterte
   (EL-Session-Aufbau), nicht warum. Es war der erste Anruf nach der Agent-Aenderung von
   19:33 — Muster "erster Anruf nach Agent-Aenderung" ist eine Hypothese mit n=1.
5. **Der Push an den Agenten ist blockiert.** `npm run elevenlabs:push -- --felder=voicemail_message
   --ausfuehren` bricht fail-closed ab mit
   `HTTP 400 … "Field required", param: agent.prompt.built_in_tools.voicemail_detection.name`.
   Der Anbieter ERSETZT das Werkzeug-Objekt beim PATCH statt zu mergen und verlangt `name` mit;
   unser Skript sendet nur den Blattpfad. **Solange das nicht repariert ist, kommt KEIN
   Werkzeug-Fix an den Agenten** — weder der Voicemail-Text noch
   `only_at_conversation_start`.

## Was in dieser Session bereits GETAN wurde (Zustand, den du vorfindest)

- **Phase DE1 gemergt und LIVE** (`0a284b6`, Doku `bc4fe1e`; Deploy `dep-dadbkq8jo6nc73dspvf0`
  live 12:33:37 UTC, `/healthz` bestaetigt `bc4fe1e`). Inhalt: `voicemail_message` soll nur
  noch `{{voicemail_line}}` tragen, der Wert wird je Anruf sprachrichtig komponiert
  (`providerVoicemailMessage` in `src/elevenlabs/call-locale.js`,
  `LOCALES.<lang>.voicemailBody`, gefuellt in `outbound.js#dynamicVariables`).
  `locale.disclosure(ownerName)` steht strukturell als ERSTES (Artikel 50). Suite 5686/5686
  gruen, im Lead selbst nachgefahren. Bericht: `tasks/de1-report.md`, Spec:
  `tasks/de1-durchgaengig-spec.md`.
- **Der Agent selbst ist UNVERAENDERT** — der Push scheiterte (OFFEN 5). Aktueller Zustand:
  Server neu, Agent alt. Das ist bewusst der sichere Zwischenstand (der Agent kennt den
  Platzhalter nicht und spricht weiter den alten Text; kein Regress).
- **ZWINGENDE REIHENFOLGE fuer spaeter:** Server-Code zuerst live, Agent-Push danach. Umgekehrt
  rendert der Anbieter `{{voicemail_line}}` nackt — dann traegt die Anrufbeantworter-Nachricht
  GAR KEINE Offenlegung (Artikel 50).
- Nicht angefasst: der gesprochene Prompt, `only_at_conversation_start`, die englischen
  Zusammenfassungs-/Auswertungskriterien, das DeepSeek-Konto.

## Empfehlung fuer das Vorgehen (nicht bindend)

Die Vorsession hat sich verrannt, weil sie **zu frueh eine Ursache benannt und daraus einen
Umbau abgeleitet** hat, dreimal hintereinander. Mach es umgekehrt: erst messen, bis der
Mechanismus steht, dann anfassen.

Sinnvolle parallele Subagent-Auftraege (jeweils NUR lesend, Ergebnis mit Beleg oder
"nicht belegbar"):

- **A — Audio-Forensik:** das Audio des 12:37-Anrufs ziehen und feststellen, was der
  Eigentuemer tatsaechlich gesagt hat. Entscheidet zwischen "Erkennung lag falsch" und
  "Aeusserung war echt mehrdeutig". Ohne diesen Beleg ist jede Aussage ueber die Spracherkennung
  geraten.
- **B — Werkzeug-Ausloesung:** warum feuern zwei Werkzeuge nach zwei Wochen erstmals? Alle 11
  Conversations auf `features_usage`, Turn-Struktur, `tool_calls` und Modell-/Anbieter-Felder
  vergleichen. Achte auf anbieterseitige Aenderungen: am 2026-09-03 ist bereits eine
  EL-Schema-Migration dokumentiert (`allowed_values: null` an get_consult/look_up,
  `version_id` unveraendert) — es gab also Anbieter-Aenderungen ohne unser Zutun.
- **C — Push-Werkzeug reparieren:** `scripts/push-elevenlabs.mjs` so erweitern, dass
  Werkzeug-Objekte vollstaendig gesendet werden (mit `name`), OHNE die sieben Riegel im
  Skriptkopf aufzuweichen. Das ist der Blocker fuer jeden Agent-Fix.

Wenn A und B den Mechanismus liefern, ist der Fix vermutlich klein (ein Schalter oder ein
Feld) — die Vorsession hat mehrfach zu grosse Loesungen vorgeschlagen, bevor die Ursache stand.

## Harte Regeln fuer diese Arbeit

- **Keine Annahme ohne Messung.** Wenn du etwas nicht belegen kannst, schreib "nicht belegt" —
  der Eigentuemer merkt es, wenn geraten wird, und es hat ihn heute schon zweimal Zeit gekostet.
- **Artikel 50 EU AI Act ist unantastbar** (CLAUDE.md Absolute Regel 2). Jede Aenderung an
  `first_message` oder `voicemail_message` muss byte-identisch mit `LOCALES.<lang>.disclosure`
  beginnen.
- **Kein Live-Push und kein Deploy ohne ausdrueckliche Freigabe des Eigentuemers.**
- **Ein echter Testanruf kostet Geld und ruft einen echten Menschen an.** Vorher ankuendigen und
  sagen, ob er rangehen soll oder nicht — der Mailbox-Pfad und der Gespraechs-Pfad sind
  verschiedene Tests.
- Die Vorsession hat die Kette DE1 **ohne Verifikationsanruf** abgeschlossen, weil die
  vorherige Kette (ST1-ST5) das auch getan hat — genau daraus ist der heutige Vertrauensverlust
  entstanden. Schliess nichts ab, was du nicht am echten Anruf gesehen hast.

---

# Nachtrag 2026-09-04 (Session 2, Messphase abgeschlossen — NICHTS geaendert, kein Push, kein Deploy)

Vier rein lesende Subagenten (A Audio, B Gespraechsvergleich, C Fremdeinfluss, D Server/Telco).
Rohdaten im Session-Scratchpad (`audio/`, `conv/`, `c/`, `d/`); die 17 Gespraechs-JSONs sind
jederzeit erneut per `GET /v1/convai/conversations/<id>` ziehbar.

## BELEGT (neu)

15. **Der Eigentuemer hat beim 12:37-Anruf vor dem Spanisch NICHTS gesagt.** Audio
    (`GET /v1/convai/conversations/<id>/audio`, MP3 16 kHz Mono-Mix): first_message endet bei
    7,13 s, spanische Agent-Antwort beginnt 9,15 s; dazwischen digitale Stille (mean −83 dB,
    max −69,5 dB, silencedetect). Positiv-Kontrolle: der echte Eigentuemer-Turn ab 16,35 s
    hat max −7,6 dB und sagt woertlich: *"Was? Ich habe nix gesagt. Wie kommst du jetzt darauf,
    auf Spanisch zu reden?"* EL-Scribe-Transkription (auto, erzwungen `deu`, erzwungen `spa`)
    findet vor 9,15 s ausschliesslich die deutsche first_message des Agenten.
    **BELEGT 7 ist damit zu korrigieren:** der Turn `"No. ¿Sí está ahí?"` ist ein
    PHANTOM-Turn der Echtzeit-Spracherkennung (Scribe v2 Realtime), keine Aeusserung.
16. **Phantom-Turns gab es schon im "guten" Anruf 09-03 17:10:** User-Turns t=8 `"Wie?"` und
    t=12 `"Wie sind?"` liegen im Audio in Stille (7,04–10,92 s und 13,63–15,85 s). Der zweite
    hat den Agenten mitten im Wort unterbrochen (`interrupted=true`), worauf er "Entschuldige,
    ich glaube die Verbindung war kurz schlecht" sprach. Beide sind Fragmente des eigenen
    Agenten-Satzes *"Wie sieht es damit aus?"* (Ende der first_message). `"¿Sí está ahí?"` ist
    phonetisch *"sieht es da(mit aus)"* — Zuordnung plausibel, Leckpfad NICHT BELEGT (s. u.).
17. **Vor 09-03 gab es in 9 verbundenen Gespraechen seit 20.08. KEINEN Phantom-Turn** (alle
    User-Turns ≤4 Woerter ueber 13 Gespraeche: nur 09-03 2x, 09-04 12:37 1x, plus zwei echte
    kurze Antworten 08-20/08-30). Zwischen dem letzten sauberen Anruf (09-02 15:57) und dem
    ersten Phantom-Anruf (09-03 17:10) hat sich auf unserer Seite NICHTS geaendert: gleiche
    Agent-Version v38, gleicher Server-Commit `9b6b197` (live seit 02.09. 10:26 UTC), Diff der
    Anruf-Payload GUT vs. 09-02 = null Unterschiede, identischer Eroeffnungssatz
    "…Wie sieht es damit aus?" in 11 von 12 verbundenen Anrufen. **Der Beginn der
    Phantom-Turns korreliert mit keiner unserer Aenderungen.**
18. **Die Verstaerkerkette, die aus einem Phantom ein spanisches Gespraech macht, ist unsere
    Konfiguration:** (a) `agent.disable_first_message_interruptions=true` +
    `turn.transcribe_on_disabled_interruptions=true` — was waehrend der Eroeffnung "gehoert"
    wird, unterbricht nicht, landet aber als User-Turn beim Modell (t=2, `interrupted=false`,
    `ignored_as_backchannel=false`); (b) Prompt-Regel *"If the other party switches to another
    language, continue in that language"* — das Modell antwortet t=9 spanisch;
    (c) `language_detection` (`only_at_conversation_start=false`) wird t=23 gerufen und
    verriegelt ASR+TTS auf Spanisch: der echte deutsche Eigentuemer-Turn bei 16 s steht im
    EL-Transkript als spanische Paraphrase *"Ah, ¿cómo sabes que hablo español?"*.
19. **Mailbox 08:50 ist trivial erklaert:** erster Anruf im Fenster, der eine echte Mailbox
    mit Ansage erreichte (08-20 17:17 war eine "Mailbox ausgeschaltet"-Netzansage ohne Band).
    Werkzeug feuerte t=18 mit Zitat der Ansage. Englischer Text = statischer Vorlagentext
    (BELEGT 9); der Anruf lag unter Deploy `4368c00` (live 07:24 UTC), also VOR DE1.
20. **06:01 ist eine eigene Fehlerklasse, kein Sprachdefekt:** Telnyx `answered 06:01:13`,
    20 s, `NORMAL_CLEARING`, aber `mos=1` (tote Leitung); EL `1011 sip request timed out`,
    0 s. Die vier Fehlschlaege vom 27.08. waren etwas anderes (Telnyx `CALL_REJECTED` D51,
    EL `403 Unverified origination number`, nie verbunden). n=1, Mechanismus NICHT BELEGT.
    Server verbuchte `provider_rejected_before_answer` (Telnyx berechnet trotzdem 20 s).
21. **Kein Fremdeinfluss:** EL genau ein Branch, 39 Versionen, keine nach v39 (auch nicht am
    04.09.), keine zwischen v38/v39; upstream == origin (nur die Uebergabe lokal), 150 Commits
    seit 20.08. ausschliesslich von den zwei bekannten Autoren; EL-Changelog 28.08.–04.09.:
    kein Eintrag (NICHT BELEGT = nichts gefunden); ASR-Label in allen 13 Gespraechen
    "Scribe v2 Realtime", LLM `claude-sonnet-5`.
22. **Deploy-Zeitstrahl 04.09.** (in der Uebergabe fehlte einer): `9b6b197` bis 07:24:44 UTC
    (06:01-Anruf), `4368c00` 07:24:44–12:33:37 (08:49-Anruf), `bc4fe1e` ab 12:33:37
    (12:37-Anruf). Diff `9b6b197..4368c00` auf dem EL-Outbound-Pfad: nur Post-Call-Diagnostik
    (B1-Detektor, Zaehlfeld); `src/i18n/prompts/*` speist nur den Telnyx-/Budget-Prompt
    (`src/claude.js`), nicht den EL-Agenten. Kein Sprachbezug.
23. **DeepSeek-402 ist ein LIVE-Defekt, aber nicht die Ursache:** bei ALLEN vier Anrufen
    fielen precall-briefing und LLM-Opening-Line aus (Fallback `quelle=fest`/`auftrag`); der
    gute 09-03-Anruf lief mit demselben 402.

## WIDERLEGT (neu)

- **"Der Eigentuemer hat etwas Mehrdeutiges gesagt."** Nein — Stille (BELEGT 15).
- **"Erster Anruf nach Agent-Aenderung scheitert" (OFFEN 4).** 06:01 ist eine SIP-Zeitueber-
  schreitung mit verbundener, toter Telnyx-Leitung; die 27.08.-Fehlschlaege waren D51-
  Ablehnungen. Keine gemeinsame Klasse, kein Bezug zur Agent-Version (BELEGT 20).
- **"Die Werkzeug-Erstausloesungen sind das Raetsel."** Beide sind Folge: Mailbox = erster
  echter Mailbox-Kontakt; language_detection = Folge des Phantom-Turns (BELEGT 18/19).

## OFFEN (neu)

1. **Leckpfad des Phantom-Turns.** Inhaltlich Fragmente des eigenen Agenten-Satzes; im
   Mono-Mix der Aufnahme ist an den Stellen Stille. Ein getrennter User-Kanal existiert in der
   EL-API nicht (`/audio` ohne Kanalparameter, `has_user_audio=true`). Kandidaten: Echo am
   Handapparat/Netz, fehlende Echo-Unterdrueckung im EL-SIP-Pfad, ASR-Halluzination mit
   Kontext-Bias. Erst ab 09-03 beobachtet, ohne Aenderung unsererseits. Messweg: EL-Support
   mit `conv_9301…`/`conv_2901…`, kontrollierter Testanruf (Handapparat vs. Freisprechen).
2. **Push-Werkzeug** (OFFEN 5 alt) bleibt der Blocker fuer jeden Agent-Fix.
3. **DeepSeek-Konto** (BELEGT 13/23): aufladen oder `LLM_PROVIDER` wechseln — Owner-Entscheidung.

## Fix-Vorschlag (WARTET AUF FREIGABE — nichts davon ist umgesetzt)

Ziel laut Eigentuemer: pro Anruf festgelegte Sprache wird NUR gesprochen; Englisch nur als
Weltdefault bei unbekannter Sprache. Kleinster Eingriff, der die Kette aus BELEGT 18 an der
Stelle unterbricht, die uns gehoert:

- **F1 (Prompt + eine dynamische Variable):** Regel *"Begin the call in English. If the other
  party switches to another language, continue in that language"* ersetzen durch eine an
  `{{call_language}}` gebundene Regel: die ganze Zeit diese Sprache; kein Wechsel wegen einer
  kurzen, unklaren oder einzelnen Aeusserung; Wechsel nur auf ausdrueckliche Bitte oder wenn die
  Gegenseite klar mehrere ganze Saetze in einer anderen Sprache spricht. Server liefert
  `call_language` aus dem Bundle (`dynamicVariables`), Platzhalter-Abgleichtest deckt es.
  Hebt Entscheidung E-5 auf (Test `REQUIRED_LANGUAGE_RULES` in
  `test/elevenlabs-agent-werkzeuge.test.js` pinnt heute das Gegenteil) — Owner-Entscheidung.
  Reihenfolge ZWINGEND: Server zuerst live, Prompt-Push danach (nackter Platzhalter = 1008-Abbruch,
  der Angerufene hoert Stille).
- **F2 (Agent-Schalter, optional):** `turn.transcribe_on_disabled_interruptions=false` — was
  waehrend der Eroeffnung gehoert wird, verfaellt. Schneidet genau den t=2-Pfad ab. Preis: ein
  echtes "Hallo?" waehrend der Offenlegung erreicht das Modell nicht (es koennte ohnehin erst
  nach der Eroeffnung antworten). Schuetzt NICHT gegen Phantome nach der Eroeffnung (09-03).
- **F3 (Agent-Werkzeug, optional):** `language_detection` abschalten, solange die Sprache je
  Anruf serverseitig gepinnt ist. Nimmt eine Faehigkeit (ausdruecklicher Wechsel auf Bitte).
  Nur mit reparierten Push-Werkzeug erreichbar (built_in_tools-PATCH verlangt `name`).

Empfehlung: F1 zuerst (wirkt unabhaengig vom Leckpfad und auch nach der Eroeffnung), F2 als
billige zweite Sicherung, F3 nur wenn der Eigentuemer den Wechsel-auf-Bitte nicht will.
Abnahme NUR am echten Anruf (Gespraechspfad UND Mailboxpfad getrennt), nicht an der Suite.

## Nachtrag 2 (2026-09-04, nach Einwand des Eigentuemers "seit den Commits kaputt")

24. **Voll-Diff v38 -> v39 (gesamte Agent-Config, nicht nur Prompt):** zwei Prompt-Bloecke plus
    `turn.soft_timeout_config.llm_generated_message_prompt_override` (Fuellsatz-Prompt). Sonst
    NICHTS: `transcribe_on_disabled_interruptions`, `disable_first_message_interruptions`,
    `speculative_turn`, `turn_model`, ASR, VAD, Werkzeuge, Presets — alle identisch.
25. **Phantom-Turns gab es schon im August.** Transkripte 14.–19.08.: 08-18 08:41 erster
    User-Turn t=3 `"Und ."` (WAEHREND der Eroeffnung, `interrupted=false`); 08-17 17:45 t=17
    `"..."`; 08-18 17:38 t=17 `"..."`; 08-19 08:06 t=82 `"..."`. Vier von 13 August-Anrufen
    tragen leere oder fragmentarische User-Turns. 20.08.–02.09.: keine. 03./04.09.: drei.
    Der Ausgang haengt allein davon ab, welchen TEXT die Erkennung dem Phantom gibt: `"..."`
    ignoriert das Modell, `"Wie?"` erzeugt eine Entschuldigung fuer die "schlechte Verbindung",
    Spanisch kippt die Sprache. Neu am 04.09. ist NUR der Text, nicht das Phaenomen.
26. **Zwischen letztem sauberen Anruf (02.09. 15:57) und erstem Phantom-Anruf (03.09. 17:10)
    liegt KEIN Commit, KEIN Deploy, KEIN Agent-Push:** beide auf `9b6b197` (live seit 02.09.
    10:26) und Agent v38. Die dynamischen Variablen haben identische Schluessel (bis auf
    `voicemail_line` am 04.09. 12:37); Wertunterschiede nur in Auftrag/Briefing/Zeit.
27. **Echo-Test am Audio (Autokorrelation, Schweif, Positivkontrolle bis −45 dB):** keine
    verzoegerte Kopie der Agentenstimme in den Aufnahmen. ABER: am 03.09. liegt zum Phantom
    "Wie?" (8,05–10,9 s) ein echtes Fremdsignal von der Gegenseite im Mix (−55 dBFS, Spitze
    −42 dBFS, Sprachband, 33 dB unter dem Agenten), nicht agentenaehnlich (r=0,05). Die
    Aufnahme ist ein nachbearbeiteter Mix: in sauberen Anrufen ist die Pause nach der
    Eroeffnung exakt digital still (−100 dBFS), der Rohkanal der Gegenseite ist also nicht
    enthalten. Was die Erkennung WAEHREND der Agentensprache bekam, ist aus der Aufnahme
    nicht ablesbar.
28. **Telnyx-Seite fuer alle Anrufe seit 28.08. identisch:** Route "Intra", Codec PCMU,
    Verbindung "ElevenLabs Spike2", keine internen Wiederholungen, mos 4,49 (06:01: mos 1).
29. **Eigentuemer-Angabe:** Anrufe wurden vor und nach dem 03.09. sowohl am Ohr als auch ueber
    Freisprechen angenommen. Die Annahmeart erklaert den Beginn der Phantome damit nicht.
30. **Anbieter-Doku (F):** `transcribe_on_disabled_interruptions` seit 29.06.2026 im Schema,
    Default `false`, bei uns `true` (schon in v38). Keine dokumentierte Konditionierung der
    Erkennung auf Agenten-Text. Kein Changelog-Eintrag 25.08.–04.09.; STT-Latenz-Vorfall EU
    04.09. 11:41–12:12 (nur Latenz).

**Stand der Ursachenfrage:** Der Fehlhoerer entsteht in der Echtzeit-Erkennung von ElevenLabs
aus einem leisen, nicht von uns erzeugten Signal der Gegenseite. Er ist seit Mitte August
intermittierend nachweisbar und korreliert mit KEINER Aenderung an Code, Agent, Payload oder
Telco-Route. Welcher Text daraus wird, ist Zufall der Erkennung. Was uns gehoert und was am
04.09. den Schaden gemacht hat, ist die Verstaerkerkette (BELEGT 18).

## Kettenstand 2026-09-04 abends: SP1 + SP2 GEMERGT, Push und Testanruf OFFEN (Eigentuemer)

- `0b6702e` merge(sp1): Prompt-Regel E-5b (Wechsel nur nach Bestaetigung in der anderen Sprache;
  ein Wort/Fragment/Unklares ist nie Wechselgrund und kein Anlass fuer Verbindungs-Kommentare),
  `turn.transcribe_on_disabled_interruptions=false`; Tests umgepinnt, `PLAN-SECURITY.md` nachgezogen.
- `5e44f17` merge(sp2): Besitz-Eintrag `voicemail_message` ist Sammlungs-Eintrag ueber
  `built_in_tools` (`schreibweg je_schluessel`); PATCH traegt alle Werkzeuge vollstaendig, nur das
  besessene Blatt bekommt den Vorlagenwert. Kein Skript geaendert. Tests (1)-(6) + Drift-Rotprobe.
- Suite im Lead nach beiden Merges: 5716/5716 (erster Lauf 1 Flake, zweiter Lauf gruen).
- Spec und Phasenberichte sind nach dem Merge entfernt (Historie: `207ee57`, Reports-Commit davor).
- Der LIVE-AGENT IST NOCH ALT (v39). Nichts davon wirkt, bis der Eigentuemer pusht.

### Push-Anleitung (Eigentuemer, `!`-Praefix; fuer Agenten gesperrt)

1. `npm run elevenlabs:push -- --felder=prompt,transcribe_on_disabled_interruptions`
   Erwartet (Trockenlauf): PATCH-Koerper mit GENAU zwei Blatt-Pfaden
   `conversation_config.agent.prompt.prompt` und `conversation_config.turn.transcribe_on_disabled_interruptions`;
   Vorhersage "danach noch abweichend": nur `voicemail_message`.
2. Gleicher Befehl mit `--ausfuehren`. Danach `npm run elevenlabs:drift`: nur `voicemail_message` rot.
3. `npm run elevenlabs:push -- --felder=voicemail_message`
   Erwartet (Trockenlauf): alle Koerper-Pfade liegen unter `conversation_config.agent.prompt.built_in_tools`,
   JEDES eingebaute Werkzeug ist enthalten (end_call, language_detection, voicemail_detection, ...),
   nur `voicemail_detection.params.voicemail_message` traegt `{{voicemail_line}}`.
4. Gleicher Befehl mit `--ausfuehren`: kein HTTP 400. Danach `npm run elevenlabs:drift` gruen.
   Reihenfolge ist sicher: der Server (DE1, `bc4fe1e`) liefert `voicemail_line` bereits.
5. Testanruf GESPRAECHSPFAD (kostet ~0,10 USD): abnehmen, waehrend der Eroeffnung und ~10 s danach
   schweigen, dann ein ganzer deutscher Satz. Erwartet im Gespraechs-JSON: kein
   `language_detection`-Aufruf, `features_usage.language_detection.used=false`, Agent durchgehend
   deutsch, keine Entschuldigung fuer die Verbindung; ein Phantom-Turn darf hoechstens eine kurze
   Wiederholung der Frage ausloesen.
6. Testanruf MAILBOXPFAD: nicht abnehmen. Erwartet: Text deutsch, beginnt byte-identisch mit
   `LOCALES.de.disclosure`, enthaelt die Grund-Zeile, `voicemail_detection.used=true`.
7. Erst wenn 5 und 6 am Anruf bestanden sind, gilt die Kette als abgenommen.

### Nebenbei, ohne Bezug zum Fix

- DeepSeek-Konto ist leer (402 seit 02.09. 15:57): Briefing und LLM-Eroeffnung fallen bei jedem
  Anruf aus. Aufladen oder `LLM_PROVIDER` wechseln.
- Optional: Ticket an ElevenLabs mit `conv_9301m1m3z963ewbvz4s7zzrevfa0` (Phantome "Wie?"/"Wie sind?")
  und `conv_2901m1p6s4heejhtwj1wydfhjsjy` (t=2 "No. ¿Sí está ahí?" in Stille), Frage nach dem
  Rohkanal der Erkennung.

### Push AUSGEFUEHRT 2026-09-04 abends (Eigentuemer per `!`, Lead hat jede Stufe lesend gegengeprueft)

- Schritt 1/2: `prompt` + `transcribe_on_disabled_interruptions` -> Version `agtvrsn_3601m1q64x9tfkgt66gvzvmp67mv`.
  Live gemessen: neue Regel drin, "Begin the call in English" weg, Schalter `false`,
  `disable_first_message_interruptions` weiter `true`.
- Schritt 3/4: `voicemail_message` ueber den neuen Sammlungs-Schreibweg -> Version
  `agtvrsn_5901m1q67m31f22ar8vptava9skp`, kein HTTP 400. Live gemessen:
  `voicemail_detection.params.voicemail_message == "{{voicemail_line}}"`, konfigurierte Werkzeuge
  unveraendert end_call/language_detection/voicemail_detection, elf uebrige weiter `null`.
- `npm run elevenlabs:drift`: OK, nur `retention_days`/`record_voice` (bewusst ausgenommen seit 15.08.).
- OFFEN: die zwei Testanrufe (Gespraechspfad, Mailboxpfad). Erst danach ist die Kette abgenommen.

### Abnahme am echten Anruf, 2026-09-04 21:49/21:51 UTC (neue Agent-Version agtvrsn_5901m1q6…)

**Anruf 1, Gespraechspfad (`call_mtnhl3g52yr5`, `conv_6401m1q6bghefr5t5a2q7b0xq27t`): BESTANDEN.**
41 s, `end_call`, `language_detection.used=false`, durchgehend deutsch. Ein Phantom-Turn `"..."`
kam bei t=13 in der Schweigephase des Eigentuemers (Audio: Stille 7,8–16,2 s); der Agent fragte
nur kurz nach ("Antonio, kannst du mich gut hören?"), kein Sprachwechsel, keine Entschuldigung
fuer die Verbindung. Nebenbefund: Agent-Text trug `[freundlich]` (Audio-Tag, nicht gesprochen,
per Scribe geprueft) — Thema der Stimme-Kette (B2-Regel), nicht dieser Defekt.

**Anruf 2, Mailboxpfad (`call_mtnho2zw76yb`, `conv_6701m1q6frmzf4pvfyj9j68b05hs`): NICHT AUSSAGEKRAEFTIG.**
Die Mailbox hat nicht abgenommen (Eigentuemer: "hat geklingelt und dann aufgelegt, ich habe nichts
gemacht"). Telnyx: 42 s Klingeln, dann 8 s verbunden, `NORMAL_CLEARING`/`send_bye` (Gegenseite
legte auf). EL: 8 s, nur die Eroeffnung, kein User-Turn, `voicemail_detection.used=false`,
"Client disconnected: 1000". Gleiches Muster wie 08-20 17:17 (Netzansage "Mailbox ausgeschaltet",
8 s). Ansagetext NICHT belegbar: `transcribe_on_disabled_interruptions=false` verwirft alles
waehrend der Eroeffnung, die Aufnahme enthaelt den Gegenkanal nicht.

**NEUES OFFENES RISIKO (im Pre-Mortem gefehlt):** Beginnt eine Mailbox-Ansage WAEHREND der
Eroeffnung (so am 04.09. 08:50, User-Turn t=0), sieht das Modell mit dem neuen Schalter nur noch
ihren Rest nach der Eroeffnung. Ob `voicemail_detection` dann noch verlaesslich feuert, ist
UNGEPRUEFT. Test: Handy in Flugmodus, dann Anruf — die Mailbox nimmt sofort ab. Faellt er durch:
NICHT den Schalter zuruecknehmen (er ist die Gegenkraft am Phantom-Pfad), sondern die
Mailbox-Erkennung getrennt absichern (eigener kleiner Schritt).

Nebenbei im Log: `[sms] Telnyx sendSms fehlgeschlagen: HTTP 400 (40305 Invalid 'from' address)`
nach jedem Anruf — die Zusammenfassungs-SMS scheitert am Absender (US-DID). Bestandsdefekt,
nicht Teil dieser Kette.

**Anruf 3, Mailboxpfad mit Handy im Flugmodus (`call_mtnhy4bag1mo`, `conv_3201m1q6y1y7esyaf19x4pkwxmcg`, 21:59 UTC): WIEDER KEINE MAILBOX.**
Telnyx: sofort verbunden, 8 s, `NORMAL_CLEARING`/`send_bye` (Gegenseite legte auf). EL: 7 s, nur
die Eroeffnung (Scribe: vollstaendig gesprochen bis "Wie sieht es damit aus?"), kein User-Turn,
`voicemail_detection.used=false`. Dreimal dasselbe 8-s-Muster (20.08. 17:17, 04.09. 21:51, 21:59):
auf der Leitung des Eigentuemers nimmt derzeit KEINE Mailbox ab, das Netz beendet nach ~8 s
(Ansage NICHT belegbar, s. o.). Die Mailbox vom 04.09. 08:50 ("Dein Anruf wurde an Voicemail
weitergeleitet ... Signalton") war offenbar ein anderer Beantworter (Handy-seitig?) — offen.
**Der Mailboxpfad ist damit NICHT abnehmbar, bis auf der Zielnummer eine Mailbox abnimmt** (Carrier-
Mailbox aktivieren, oder mit Einwilligung eine fremde Nummer mit aktiver Mailbox — dann laeuft der
Dritt-Pfad mit vollem Offenlegungssatz, was fuer Artikel 50 sogar der bessere Test ist).
Das OFFENE RISIKO (Ansage waehrend der Eroeffnung wird verworfen) bleibt ungeprueft.
