# Tool-Inventar

Dimension: D2 | Quelle: Code auf Branch master

## Kurzfassung

12 Tool-Registrierungen in `src/mcp-tools.js -> registerTools()`, davon 3 bedingt
(`await_call_event`/`answer_consult` nur wenn `consultAllowed`, `get_calendar` nur wenn
`allowCalendar`). `src/routes/mcp.js` filtert die Tool-LISTE nicht - es steuert nur, WELCHE
Flags `registerTools()` bekommt (scopedTenant, Profil, Sprache); ab da entscheidet
`registerTools()` selbst per `if`. `src/mcp-server.js` (stdio) registriert dieselbe Funktion
ohne Tenant/Consult -> `get_calendar` an, `await_call_event`/`answer_consult` aus.
**Schwerster Befund: KEIN Tool traegt `annotations` (readOnlyHint/destructiveHint/
openWorldHint) und KEIN Tool traegt `securitySchemes`** - beide von OpenAI als "Required"
gefuehrt (N-1, T-15), grep ueber `src/` liefert 0 Treffer. `place_call` loest eine echte
externe Aktion (Telefonanruf, reale Kosten) aus, ohne dass das im Tool-Metadatum sichtbar
ist - der Host kann seine Write-Action-Bestaetigungspflicht (N-8) technisch nicht auf
Annotationen stuetzen, weil keine da sind.

## Tool-Tabelle

| # | Name | Bedingung | uiTool/tool | outputSchema | Widget (_meta) | Auth/Gate vor Aufruf | Wirkung |
|---|---|---|---|---|---|---|---|
| 1 | `place_call` | immer | uiTool | ja (CALL_OUTPUT) | WIDGET_CALL (bei faehigem Host) | mcpAuth + Safety-Gates in `/api/calls` (server.js) | schreibt + loest echten Anruf aus |
| 2 | `await_call_event` | `consultAllowed` | uiTool | ja (AWAIT_EVENT_OUTPUT) | keins | mcpAuth | liest (Long-Poll GET `/api/calls/:id/consult`) |
| 3 | `answer_consult` | `consultAllowed` | uiTool | ja (ANSWER_CONSULT_OUTPUT) | keins | mcpAuth | schreibt (POST `/api/calls/:id/consult/answer`), beeinflusst laufenden Anruf |
| 4 | `get_call_status` | immer | uiTool | ja (CALL_STATUS_OUTPUT) | keins (bewusst entfernt, W2) | mcpAuth | liest (GET `/api/calls/:id`) |
| 5 | `get_transcript` | immer | uiTool | ja (TRANSCRIPT_OUTPUT) | keins (bewusst entfernt, W2) | mcpAuth | liest (GET `/api/calls/:id`) |
| 6 | `cancel_call` | immer | tool (Legacy, kein outputSchema) | nein | n/a | mcpAuth | schreibt + versucht echten Leitungsabbruch (nicht garantiert) |
| 7 | `get_my_number` | immer | uiTool | ja (MY_NUMBER_OUTPUT) | WIDGET_MY_NUMBER | mcpAuth | liest (GET `/api/state`) |
| 8 | `list_calls` | immer | uiTool | ja (CALLS_OUTPUT) | WIDGET_CALLS | mcpAuth | liest (GET `/api/state`) |
| 9 | `check_inbox` | immer | uiTool | ja (INBOX_OUTPUT) | keins | mcpAuth | **schreibt** (POST `/api/inbox/poll`, markiert Eintraege als "seen" - konsumierender Read) |
| 10 | `list_action_items` | immer | tool (Legacy) | nein | n/a | mcpAuth | liest (GET `/api/state`) |
| 11 | `get_calendar` | `allowCalendar` | uiTool | ja (CALENDAR_OUTPUT) | WIDGET_CALENDAR | mcpAuth | liest (GET `/api/state`) |
| 12 | `get_agent_status` | immer | uiTool | ja (AGENT_STATUS_OUTPUT) | WIDGET_AGENT_STATUS | mcpAuth | liest (GET `/api/state`) |

Gesamtzahl: **12** Tool-Registrierungen im Quellcode, davon **3 bedingt**. Fuer einen konkreten
Client sind es je nach Tenant-Profil/Consult-Flags 9-12 sichtbare Tools plus stdio-spezifisch
(kein `scopedTenant`, kein `consultAllowed`) 10 (Calendar an, Consult-Paar aus).

## Tool-Details

### 1. `place_call`
- Titel: keiner (nur `description`, kein `title`-Feld im Konfig-Objekt), src/mcp-tools.js:666-822
- Description: `PLACE_CALL_DESCRIPTION` (+ `PLACE_CALL_CONSULT_LOOP` wenn `consultAllowed`), src/mcp-tools.js:528-549. Erster Satz: "Starts a real phone call by the AI agent to a phone number, pursuing the given objective." Laenge Basis-Text ca. 640 Zeichen, mit Consult-Anhang ca. 1000 Zeichen.
- Input-Schema (src/mcp-tools.js:669-819), alle Felder `optional()` ausser `to`/`objective`:
  - `to` (string, required) - Zielnummer, keine Enum/Grenze, Server normalisiert
  - `objective` (string, required)
  - `briefing` (string, optional)
  - `constraints` (string, optional)
  - `mandate` (object, optional): `decide_freely` (string, optional), `fallback_order` (string, optional), `on_out_of_scope` (enum `MANDATE_OUT_OF_SCOPE_VALUES`, optional)
  - `context` (object, optional): `summary` (string, optional), `key_facts` (array<string>, optional, Beschreibung nennt max. 10 - kein `.max()` im Zod-Schema selbst, s. PP-D2-02), `recipient_relationship` (string, optional), `desired_outcome` (string, optional), `open_questions` (array<string>, optional, Beschreibung nennt max. 10, kein `.max()`)
  - `language` (string, optional, Beschreibung nennt Katalog aus `SUPPORTED_LANGUAGES`, kein Zod-`.enum()`)
  - `max_duration_s` (number, optional, `.int().positive().max(MAX_CALL_DURATION_CAP_S)`)
  - `diagnostic` (boolean, optional)
- Tut: POST `/api/calls` (src/mcp-tools.js:825). Externe Systeme: Telnyx/ElevenLabs (realer Anruf), LLM-Provider (Gespraechs-Loop), Store (Call-Record, Budget-Buchung).
- Rueckgabe (`CALL_OUTPUT`, structuredContent + Text): `call_id`, `status` (fix "dialing"), `duration_s` (0), `last_transcript_lines` ([]), `failure_reason` (null), `result_summary` (null), `objective_achieved` (null), `context_received` (active/summary/key_facts_count/recipient_relationship/desired_outcome, alles bool/number).
- Liest/Aendert/Loest aus: **loest reale externe Aktion aus** (Anruf, Kosten). Kein `readOnlyHint`/`destructiveHint`/`openWorldHint`.
- Auth/Gates: mcpAuth vor `/mcp`; die eigentlichen Safety-Gates (Verifikation/KYC, Denylist, Land, Stunden, Budget, `OUTBOUND_FROZEN`) sitzen laut CLAUDE.md und Kommentar Zeile 662-664 in `src/server.js` `/api/calls`, NICHT in mcp-tools.js selbst - hier nicht mitgelesen, nur referenziert.
- Annotations: keine.

### 2. `await_call_event`
- Registrierung nur wenn `consultAllowed` (Schnittmenge `consultEnabled` x `assistantContextEnabled` x `profile.allowConsult`, `src/consult/gate.js:19-23`), src/mcp-tools.js:857-889.
- Description (src/mcp-tools.js:860-866): erster Satz nennt Zweck und ~20s-Wartezeit; Hinweis "This tool NEVER returns audio."
- Input-Schema: `call_id` (string, required), `after_event_id` (string, optional).
- Tut: `pollConsult` -> GET `/api/calls/:id/consult?after=` mit `timeoutMs=CONSULT_POLL_ABORT_MS`; bei `event=done` zusaetzlich GET `/api/calls/:id`.
- Rueckgabe (`AWAIT_EVENT_OUTPUT`): `event`, `event_id` (nullable), `questions` (array<string>), `status` (nullable), `failure_reason` (nullable), `result_summary` (nullable), `objective_achieved` (bool|string, nullable), plus `RESULT_CARD_OUTPUT`-Spread: `outcome`, `commitments`, `counterparty_commitments`, `open_points`, `next_step`.
- Liest nur (Long-Poll). Kein Widget-`_meta`.
- Annotations: keine (waere laut MCP-Spec `readOnlyHint: true` korrekt gewesen).

### 3. `answer_consult`
- Nur bei `consultAllowed`, src/mcp-tools.js:891-963.
- Description (900-912): nennt explizite "working" vs. "final"-Pflicht, Zeichengrenze `KEY_FACTS_LIMITS.maxLen` (Wert dynamisch eingesetzt, nicht in Beschreibung hartkodiert).
- Input-Schema: `call_id` (string, required), `event_id` (string, required), `status` (enum `[CONSULT_ANSWER_MODE.WORKING, CONSULT_ANSWER_MODE.FINAL]`, optional), `answers` (array<string>, optional).
- Tut: POST `/api/calls/:id/consult/answer`. Beeinflusst direkt einen LAUFENDEN Anruf (Antworten gehen als Hintergrundwissen an den Sprachagenten).
- Rueckgabe (`ANSWER_CONSULT_OUTPUT`): `accepted` (bool), `merged_facts` (number). Bei HTTP 400/409 wird KEIN Fehler geworfen, sondern `accepted:false` mit Text zurueckgegeben (Sonderpfad, s. PP-D2-05).
- Annotations: keine, obwohl das Tool laufendes externes Gespraech beeinflusst (`destructiveHint`/`openWorldHint` waeren hier fachlich relevant).

### 4. `get_call_status`
- Immer registriert, src/mcp-tools.js:998-1007.
- Description: nennt Status-Enum `dialing|in_progress|completed|failed|cancelled` explizit im Text (kein Zod-Enum im Output, `status: z.string()`).
- Input: `call_id` (string, required).
- Tut: GET `/api/calls/:id`.
- Rueckgabe (`CALL_STATUS_OUTPUT`): `call_id`, `status`, `duration_s` (number), `last_transcript_lines` (array<string>, letzte 6 Zeilen), `failure_reason` (nullable).
- Rein lesend. Kein Widget mehr (bewusst entfernt, Kommentar 993-997). Annotations: keine.

### 5. `get_transcript`
- Immer registriert, src/mcp-tools.js:1014-1050.
- Description: erklaert explizit DSGVO-Loeschung des Rohtranskripts, nur Summary + Zielstatus.
- Input: `call_id` (string, required).
- Tut: GET `/api/calls/:id`; bei `status==="active"` fruehe Rueckgabe mit Fehlertext statt Daten.
- Rueckgabe (`TRANSCRIPT_OUTPUT`): `call_id`, `result_summary` (string), `objective_achieved` (bool|string), plus `RESULT_CARD_OUTPUT` (`outcome`, `commitments`, `counterparty_commitments`, `open_points`, `next_step`).
- Rein lesend, kein Rohtranskript. Annotations: keine.

### 6. `cancel_call`
- Immer registriert, src/mcp-tools.js:1057-1062. **EINZIGES Tool ohne `outputSchema`** (Legacy-`tool()`-Pfad, positionsbasiert).
- Description: `CANCEL_CALL_DESCRIPTION` (src/mcp-tools.js:558-559) - explizit KEINE Garantie fuer echten Leitungsabbruch.
- Input: `call_id` (string, required).
- Tut: POST `/api/calls/:id/cancel`, gibt den REST-Body unveraendert als Text zurueck (`text(await call(...))`) - **kein Whitelist-Filter, keine strukturierte Sicht**, roh durchgereicht.
- Rueckgabe: freier REST-Body als JSON-Text (kein `structuredContent`, kein Schema, keine Garantie ueber Feldinhalt).
- **Schreibend + potenziell externe Wirkung** (versucht Anrufabbruch). Kein `outputSchema`, kein `annotations` -> waere laut N-2/N-3 klar `readOnlyHint:false`, potenziell `destructiveHint:true`.

### 7. `get_my_number`
- Immer registriert, src/mcp-tools.js:1068-1087.
- Description: ein Satz, "Returns the phone number of the phone agent."
- Input: `{}` (keine Felder).
- Tut: GET `/api/state`.
- Rueckgabe (`MY_NUMBER_OUTPUT`): `number` (string, nullable). Text-Block gibt den ROHEN `s.agent.number` aus (kann `undefined` sein -> `"{}"`-artiger Text, structuredContent normalisiert auf `null`).
- Rein lesend. Annotations: keine.

### 8. `list_calls`
- Immer registriert, src/mcp-tools.js:1095-1114.
- Description: ein Satz.
- Input: `{}`.
- Tut: GET `/api/state`.
- Rueckgabe (`CALLS_OUTPUT`): `calls`: array von `{id, direction, counterparty (nullable), status, startedAt, summary (optional)}`.
- Rein lesend. Annotations: keine.

### 9. `check_inbox`
- Immer registriert, src/mcp-tools.js:1125-1144.
- Description: `CHECK_INBOX_DESCRIPTION` (src/mcp-tools.js:481-485), 293 Zeichen, mit explizitem Warnhinweis "CONSUMING: entries returned here are marked as seen and will NOT appear again."
- Input: `include_seen` (boolean, optional, `INCLUDE_SEEN_FIELD`).
- Tut: POST `/api/inbox/poll` - **schreibt** (markiert Eintraege serverseitig als gesehen), obwohl der Zweck fachlich ein "Lesen" ist.
- Rueckgabe (`INBOX_OUTPUT`): `entries` (array von `call_id, caller (nullable), at (nullable), summary (nullable), summary_unavailable (bool), outcome, commitments, counterparty_commitments, open_points, next_step, action_items (array<string>), action_required (bool)`), `remaining` (number).
- **Wichtigster Annotation-Kandidat fuer `readOnlyHint:false`** laut N-2 ("kann etwas aendern") - hier ohne jede Annotation. Annotations: keine.

### 10. `list_action_items`
- Immer registriert, src/mcp-tools.js:1149-1162. **EINZIGES weiteres Tool ohne `outputSchema`** (Legacy-`tool()`-Pfad).
- Description: "Lists open action items from all calls." (ein Satz).
- Input: `{}`.
- Tut: GET `/api/state`, filtert `actionItems` clientseitig auf `!a.done`.
- Rueckgabe: reiner Text-Block (kein `structuredContent`), Format `[id] Praefix Text` pro Zeile.
- Rein lesend. Kein Schema -> Client kann Struktur nicht validieren. Annotations: keine.

### 11. `get_calendar`
- Nur wenn `allowCalendar` (Profil-Flag), src/mcp-tools.js:1170-1197.
- Description: "Shows the owner's next calendar entries." (ein Satz).
- Input: `{}`.
- Tut: GET `/api/state`.
- Rueckgabe (`CALENDAR_OUTPUT`): `calendar`: array von `{title (nullable), start, end}` (Strings, formatiert nach Tenant-Sprache).
- Rein lesend. Annotations: keine.

### 12. `get_agent_status`
- Immer registriert, src/mcp-tools.js:1209-1238.
- Description: "Status of the phone agent: phone number, voice engine, model, monthly usage, permissions." (ein Satz).
- Input: `{}`.
- Tut: GET `/api/state`.
- Rueckgabe (`AGENT_STATUS_OUTPUT`): `number` (nullable), `owner` (nullable), `voiceEngine` (string), `model` (string), `calls` (number), `planUsagePercent` (number, nullable), `permissions` (string, zusammengesetzter Freitext aus drei Bool-Werten - s. PP-D2-04).
- Rein lesend. Annotations: keine.

## Filterung/Registrierung in mcp.js und mcp-server.js

- `src/routes/mcp.js:105-112` ruft `registerTools(server, {identity, scopedTenant, allowCalendar: profile.allowCalendar, consultAllowed: consultLoop, uiHost, language})` **pro Request neu** (stateless, ein frischer `McpServer` je POST, Kommentar Zeile 6-11). Es gibt KEINEN nachtraeglichen Filter auf die von `registerTools` zurueckgegebene Tool-Liste - die Steuerung passiert ausschliesslich ueber die drei Flags, die in `registerTools` selbst als `if` ausgewertet werden (Zeile 856 `if (consultAllowed)`, Zeile 1170 `if (allowCalendar)`).
- `src/mcp-server.js:26-28` (stdio) ruft `registerTools(server, {uiHost: {...}})` ohne `scopedTenant`/`consultAllowed`/`allowCalendar` -> Defaults greifen: `allowCalendar=true` (Default in der Funktionssignatur, Zeile 579), `consultAllowed=false` (Default Zeile 580). Damit hat der stdio-Pfad IMMER `get_calendar`, NIE `await_call_event`/`answer_consult`.
- GET/DELETE auf `/mcp` liefern immer 405 (routes/mcp.js:128-131), keine Tool-Liste dort.

## Pruefpunkte

### PP-D2-01 Annotations (readOnlyHint/destructiveHint/openWorldHint) fehlen auf allen 12 Tools
- Status: FAIL
- Evidenz: `grep -rn "readOnlyHint\|destructiveHint\|openWorldHint\|idempotentHint\|annotations" src/` liefert 0 Treffer in mcp-tools.js, mcp-server-info.js, ui/*. Keine der 12 Tool-Konfigurationen (src/mcp-tools.js:665-1238) setzt `annotations`.
- Risiko: OpenAI fuehrt diese drei Felder als "Required" (N-1). Ohne sie behandelt ChatGPT laut eigener Doku (N-7) jedes Tool ohne `readOnlyHint` als Write-Action - das trifft zufaellig sogar korrekt auf `place_call`/`cancel_call`/`answer_consult`/`check_inbox`, sperrt aber vermutlich auch reine Lesetools (`get_call_status`, `list_calls`, `get_agent_status`) unnoetig hinter eine manuelle Bestaetigung (N-8) und fuehrt bei der Submission zu einem dokumentierten Ablehnungsgrund (N-6).
- Empfehlung: Fuer jedes der 12 Tools ein `annotations`-Objekt ergaenzen: `readOnlyHint:false, destructiveHint:true, openWorldHint:true` fuer `place_call`/`cancel_call`; `readOnlyHint:false` fuer `answer_consult`/`check_inbox` (aendern Zustand); `readOnlyHint:true, openWorldHint:false` fuer die reinen `/api/state`-Lesetools.
- Prioritaet/Kategorie: P0 / A

### PP-D2-02 Keine tool-level `securitySchemes` (Mixed Auth)
- Status: FAIL
- Evidenz: `grep -rn "securitySchemes" src/` liefert 0 Treffer. Alle 12 Tools teilen sich ausschliesslich die eine `mcpAuth`-Middleware auf `/mcp` (src/routes/mcp.js:51).
- Risiko: T-15 verlangt pro Tool eine `securitySchemes`-Deklaration fuer Mixed-Auth-Betrieb (`noauth` vs. `oauth2` mit Scopes); ohne sie kann ChatGPT nicht unterscheiden, ob ein Tool eigene Scopes braucht - alle 12 Tools laufen effektiv unter derselben Berechtigungsstufe, obwohl `place_call` (loest Kosten aus) und `get_agent_status` (liest nur) fachlich unterschiedliche Risikostufen haben.
- Empfehlung: `securitySchemes` je Tool im `registerTool`-Konfig-Objekt ergaenzen, ausgerichtet an vorhandenen Scopes im OAuth-Server.
- Prioritaet/Kategorie: P1 / A

### PP-D2-03 `cancel_call` und `list_action_items` ohne `outputSchema`
- Status: PARTIAL
- Evidenz: src/mcp-tools.js:1057-1062 (`tool("cancel_call", ...)`) und src/mcp-tools.js:1149 (`tool("list_action_items", ...)`) nutzen den Legacy-`server.tool()`-Pfad (Kommentar Zeile 649 "frozen API, kein outputSchema/_meta"); alle anderen 10 Tools nutzen `uiTool`/`registerTool` mit `outputSchema`.
- Risiko: T-18/T-19 verlangen `outputSchema` fuer alles, was `structuredContent` liefert - diese zwei Tools liefern GAR KEIN `structuredContent`, nur freien Text. `cancel_call` reicht sogar den rohen REST-Body ungefiltert durch (Zeile 1061: `text(await call(...))`), ohne die sonst ueberall angewandte Whitelist-Disziplin (Regel 5/DSGVO-Muster der Datei) - ein zukuenftiges REST-Feld in der Cancel-Antwort landet ungeprueft beim Client.
- Empfehlung: Beide Tools auf `uiTool`/`registerTool` mit explizitem `outputSchema` heben, `cancel_call` durch eine Whitelist-Funktion filtern statt den Body durchzureichen.
- Prioritaet/Kategorie: P1 / B

### PP-D2-04 `key_facts`/`open_questions` in `place_call` ohne Zod-`.max()`, nur in Beschreibung begrenzt
- Status: PARTIAL
- Evidenz: src/mcp-tools.js:751-756 (`key_facts: z.array(z.string()).optional().describe("...max. 10...")`) und Zeile 519-524 (`OPEN_QUESTIONS_FIELD`, gleiches Muster) - die "max. 10"-Grenze steht NUR im Beschreibungstext, nicht im Schema selbst (kein `.max(10)`).
- Risiko: N-14 verlangt minimale, klar begrenzte Eingaben; ein Modell (oder ein manipulierter Client) kann beliebig viele Eintraege senden, das JSON-Schema selbst erzwingt nichts. Die tatsaechliche Deckelung liegt laut Kommentar in `routes/_validation.js` (`OPEN_QUESTIONS_LIMITS`) - also serverseitig hinter dem MCP-Layer, nicht im MCP-`inputSchema` selbst sichtbar/erzwingbar.
- Empfehlung: `.max(10)` direkt im Zod-Schema ergaenzen, damit das MCP-`inputSchema` (das der Client/Host sieht) die reale Grenze traegt.
- Prioritaet/Kategorie: P2 / C

### PP-D2-05 `answer_consult` behandelt HTTP 400/409 als Erfolgsantwort mit `accepted:false`
- Status: PARTIAL
- Evidenz: src/mcp-tools.js:950-960, `notAccepted()` (Zeile 298-301) liefert `content` + `structuredContent:{accepted:false, merged_facts:0}` OHNE `isError:true`.
- Risiko: W-14/T-20 unterscheiden Protokollfehler von Ausfuehrungsfehlern ueber `isError`; hier wird ein abgelehnter/ueberholter Consult bewusst NICHT als `isError` markiert (Kommentar Zeile 951: "KEIN Werkzeugfehler"). Das ist eine Design-Entscheidung (Modell soll weiterpollen), aber sie weicht vom MCP-Standardmuster ab und ist nirgends als Ausnahme dokumentiert/getestet, nur im Code-Kommentar.
- Empfehlung: Keine Code-Aenderung noetig, aber Abweichung explizit in Submission-Testfaellen (O-10) als Negativfall dokumentieren, damit ein Reviewer sie nicht als Bug wertet.
- Prioritaet/Kategorie: P2 / C

### PP-D2-06 `get_agent_status.permissions` ist unstrukturierter Freitext statt strukturierter Felder
- Status: PARTIAL
- Evidenz: src/mcp-tools.js:349-354 (`permissionsSummary`) baut einen String wie `"summaries=true, personalData=false, bankData=true"`; `AGENT_STATUS_OUTPUT.permissions: z.string()` (Zeile 385).
- Risiko: Kein Schema-Vertrag fuer die drei Bool-Werte - ein Client, der programmatisch pruefen will, ob Bankdaten erlaubt sind, muss den String parsen. Kein OpenAI-Pflichtverstoss (kein exakter Anforderungstreffer), aber Bruch mit W-08/T-18-Geist ("expliziter inputSchema/outputSchema" fuer strukturierte Daten).
- Empfehlung: `permissions` als Objekt (`{summaries: bool, personalData: bool, bankData: bool}`) statt String ausgeben; Text-Block kann weiterhin den Freitext zeigen.
- Prioritaet/Kategorie: P2 / C

## Offene Fragen (nicht am Repo entscheidbar)

- Welche OAuth-Scopes der produktive Authorization Server (WorkOS) tatsaechlich ausstellt und ob sie granular genug sind, um `securitySchemes` pro Tool sinnvoll zu befuellen (T-15) - das Repo zeigt nur `mcpAuth`/`jose`-Verifikation, nicht die Scope-Konfiguration beim IdP.
- Ob ChatGPT die 12 Tools ohne Annotationen tatsaechlich alle als Write-Actions einstuft (N-7) oder ob es eine andere Fallback-Heuristik gibt - das ist Host-Verhalten, nicht im Repo pruefbar.
- Ob `MAX_CALL_DURATION_CAP_S`, `KEY_FACTS_LIMITS.maxLen` und `MANDATE_OUT_OF_SCOPE_VALUES` (aus `src/store/defaults.js`, hier nicht gelesen) selbst dokumentiert/stabil genug sind, um in einer OpenAI-Submission als "Grenzen" angegeben zu werden - erfordert Lesen von `store/defaults.js`, das ausserhalb dieser Dimension liegt.

## Vollstaendigkeits-Nachweis

Suchmuster: `grep -n '^\s*tool(\|^\s*uiTool(' src/mcp-tools.js` (alle Aufrufe der beiden lokalen
Registrierungs-Fabriken `tool`/`uiTool`, definiert Zeile 650/655-656, selbst Wrapper um
`server.tool`/`server.registerTool` - es gibt in der Datei KEINE weitere Registrierungsroute)
ergab 12 Treffer, jeder einem der 12 oben gelisteten Namen zugeordnet (Zeilen 666, 858, 892,
999, 1015, 1058, 1069, 1096, 1126, 1149, 1172, 1210). Gegengeprueft: `grep -n "server\.\(tool\|registerTool\)" src/mcp-tools.js` liefert dieselben 12 Stellen (keine direkten SDK-Aufrufe
ausserhalb der beiden Fabriken). `src/routes/mcp.js` und `src/mcp-server.js` rufen beide
ausschliesslich `registerTools()` auf und definieren selbst keine weiteren Tools (verifiziert
durch Volltextlesen beider Dateien, 134 bzw. 32 Zeilen). Es gibt keine zweite Tool-Quelle
(kein `src/ui/*` registriert eigene MCP-Tools - `WIDGET_*`-Importe sind reine `_meta`-Anhaenge,
keine Tools).

## Randbefund (ausserhalb dieser Dimension)

`cancel_call` reicht den rohen REST-Antwortkoerper ungefiltert an den Client durch (kein
Whitelist-Pattern wie bei allen anderen Tools) - relevant fuer die Datenminimierungs-Dimension
(O-13), nicht Kern dieser Inventar-Dimension.
