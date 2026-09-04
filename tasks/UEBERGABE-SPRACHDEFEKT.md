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
