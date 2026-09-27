# T2-09 - Geldpfad: neutrale Fehlertexte an der MCP-Grenze (Spec fuer den Bau-Agenten)

Umfang: GENAU O-13, O-20. Basis: master 33d7f80. Branch `phase/openai-t2-09-neutral-error-texts`,
Worktree `.../scratchpad/wt-t2-09`. Diese Datei bleibt ungetrackt im Haupt-Arbeitsbaum.

## Anforderung (OpenAI-Fassung, 00-openai-anforderungen.md)

- O-13: Datenminimierung; keine Diagnose-/Telemetrie-/internen Kennungen in Tool-Antworten.
- O-20: kein Anzeigen/Starten von Abo-/Upgrade-Flows ("must not display subscription plans,
  initiate new subscriptions, or promote upgrades").

## Vorher-Messung (stdio, echter tools/call, Gateway-Attrappe; Skript lag in scratchpad/logs-t2-09/probe.mjs)

| Fall | Tool-Text heute |
|---|---|
| 402 minutes | `Inkludierte Plan-Minuten aufgebraucht. Bitte Tarif anpassen oder neue Abrechnungsperiode abwarten.` |
| 403 frozen | `Outbound-Anrufe sind derzeit gesperrt (OUTBOUND_FROZEN).` |
| 500 ohne Body | `HTTP 500` |
| Gateway nicht erreichbar | `fetch failed` |
| list_action_items | `[ai_internal_123] Rueckruf` |

Ursache: `api()` (src/mcp-tools.js:72) baut `new Error(json.error || "HTTP <status>")`, und
`wrapHandler` (src/mcp-tools.js:977-981) gibt `err.message` aus, wenn kein ToolError-Code da ist.

## Entscheidungen dieser Spec

1. Die Ablehnungstexte an der MCP-Grenze folgen der bestehenden i18n-Struktur (de/en/fr ueber
   `loc.mcp`), nicht "nur Englisch" wie der Plan sagt. Grund: MCP-05/MCP-12 verlangen, dass jeder
   Fehlerpfad der Tenant-Sprache folgt; stdio hat keine Sprache und faellt auf den Weltdefault `en`.
   DE-Werte bleiben ASCII-transliteriert (Modulkopf mcp-texts.js: MCP-Texte werden nie gesprochen).
2. Der maschinenlesbare Grund heisst im REST-Body `reason` (Praezedenz: `{error, reason}` in
   sec-p3). Er wird ADDITIV an genau den ZWEI Stellen gesetzt, an denen eine Gate-Ablehnung die
   Route verlaesst (api-calls.js:475 und der Ablehnungszweig von `antwortOhneNeuenAnruf`
   api-calls.js:354-356), NICHT in `deny()` in outbound-gates.js (Plan): drei Ablehnungen werden
   dort gar nicht ueber `deny()` gebaut (`makeAniOwnershipGate` :274-278, `quotaDenialOf` :289-295,
   `runOutboundGates` :329-333). Die Route ist die eine Stelle, die alle sieht. Quelle ist
   `denial.audit.grund`. Ohne `audit` (reine 400-Formatfehler) kein `reason`. Gate-Objekte,
   Status, `error`-Text, Audit und Metrik bleiben byte-identisch; die Gate-Datei wird NICHT
   angefasst.
3. Status 400 ohne `reason` (Eingabefehler des Aufrufers) wird weiter als Text durchgereicht.
   Grund: das sind Korrekturhinweise zur EIGENEN Eingabe (z.B. Laengengrenze von objective,
   `unsupported_language: ...`, der laut api-calls.js:262-265 bewusst fuer das Client-Modell gebaut
   ist); sie tragen keine interne Kennung, keinen Env-Namen, keinen Tarif-Hinweis. Ohne sie koennte
   das Modell die Eingabe nicht korrigieren (Pre-Mortem a). Alles andere wird NICHT mehr
   durchgereicht.
4. Keine Zahlen mehr in den Budget-Ablehnungen an der MCP-Grenze (heute: "12,00 von 20,00 EUR",
   "es fehlen x EUR, Spend-Monat endet am ..."). Die neutrale Tabelle ist statisch und verweist fuer
   Details auf das Hermes-Dashboard; das Dashboard behaelt seine Texte mit Zahlen (REST `error`
   unveraendert).

## Schritte

### S1 - REST: additives Feld `reason` an Gate-Ablehnungen
- Wo: src/routes/api-calls.js - neuer Modul-Helfer (Muster `beobachteAblehnung`, Modul-Ebene, damit
  `makeCallRoutes`/der gepinnte async-Handler NICHT waechst), z.B.
  `denialResponseBody(denial) = denial.audit ? { ...denial.body, reason: denial.audit.grund } : denial.body`.
  Einsatz an :475 (`res.status(denial.status).json(denialResponseBody(denial))`, dieselbe Zeile) und
  in `antwortOhneNeuenAnruf` :354-356 (Rueckgabe `{ status, body: denialResponseBody(...) }`).
- IDs: O-13, O-20 (Voraussetzung fuer S3/S4).
- Pfade: REST `/api/calls` - von HTTP /mcp (prozessinterner Hop) UND stdio (GATEWAY_URL) gleich
  benutzt; OAuth/Legacy unerheblich (Hop ist localhost-intern).
- Beweis (b): neuer Test (Datei s. S6), echter Serverprozess:
  - `OUTBOUND_FROZEN=true`, POST /api/calls -> Status 403, `body.error` exakt der Bestandstext,
    `body.reason === "frozen"`, kein neuer Call im Store (Vorher/Nachher-Zaehlung ueber /api/state).
  - b2-Fixture (PAYMENT_ENABLED, erschoepfte Minuten, Muster test/b2-quota-gate.test.js) ->
    402, `body.error` exakt Bestand, `body.reason === "minutes"`, kein Call.
  - Formfehler (z.B. `briefing` als Zahl) -> 400 und `"reason" in body === false`.

### S2 - Texttabelle je Ablehnungsgrund (i18n, de/en/fr)
- Wo: neues Modul `src/i18n/mcp-denial-texts.js` (je Sprache ein Objekt `grund -> Text`), in
  `src/i18n/mcp-texts.js` als `MCP_TEXTS.<lang>.denials` eingehaengt (Muster FAILURE_REASON_TEXTS).
  Zusaetzlich in `MCP_ERROR_CODE` + `errors` je Sprache (mcp-texts.js:20-40, :56-73, :143-158,
  :198-213): `DENIAL_UNKNOWN`, `NOT_FOUND`, `NOT_PERMITTED`, `REQUEST_REJECTED`.
- Gruende, die die Tabelle abdecken MUSS (aus src/telephony/outbound-gates.js abgeleitet, Stand
  33d7f80 - 21 Stueck): frozen, tenant_unbekannt, kyc, keine_identitaet, denylist, format, land,
  stundenlimit, ziel_limit, abo, billing_hold, allowlist, keine_tenant_nummer, herkunft,
  ani_not_owned, budget_tenant, minutes, reserve_error, reserve_ueber_rest, reserve_erschoepft,
  gate_error. (Die Liste hier ist NUR Orientierung - der Test leitet sie aus der Quelle ab, S6.)
- Textregeln (jede Sprache): sachlich, sagt WAS passiert ist, dass KEIN Anruf entstand, und was der
  Nutzer tun kann; KEIN Env-/Konfig-Name, KEINE Zahl aus Konfiguration, KEINE Kennung, KEIN
  "HTTP <n>"; keine Woerter `tarif|upgrade|\bplans?\b|pricing|price|preis|abo\b|abonn|subscri|forfait`;
  "tenant" heisst "Konto/account/compte". Vorschlag EN (DE/FR sinngemaess):
  - frozen: "Outbound calls are temporarily paused by the Hermes operator. No call was placed. Please try again later."
  - tenant_unbekannt: "This sign-in is not linked to a Hermes account that may place calls. No call was placed. Please sign in with your Hermes account."
  - kyc: "Outbound calls require a verified identity for your Hermes account. No call was placed. Please complete the verification in the Hermes dashboard."
  - keine_identitaet: "Your Hermes account has no registered name for the call disclosure. No call was placed. Please add your name in the Hermes dashboard."
  - denylist: "This number cannot be called (emergency, premium-rate or service number). No call was placed."
  - format: "The destination number is not in a valid international format. No call was placed."
  - land: "Calls to this country are not enabled for your Hermes account. No call was placed."
  - stundenlimit: "The hourly limit for outbound calls has been reached. No call was placed. Please try again later."
  - ziel_limit: "The repeat limit for this destination has been reached. No call was placed. Please try again later."
  - abo / allowlist: "Outbound calls are not enabled for your Hermes account. No call was placed. Please check your account status in the Hermes dashboard."
  - billing_hold: "Outbound calls are on hold because of an open payment issue. No call was placed. Please check your payment details in the Hermes dashboard."
  - keine_tenant_nummer: "Your Hermes account has no active phone number to call from. No call was placed. Please check your number in the Hermes dashboard."
  - herkunft: "Your Hermes number cannot be used to call this destination country. No call was placed."
  - ani_not_owned: "The line for outgoing calls is temporarily unavailable. No call was placed. Please try again later."
  - budget_tenant / reserve_erschoepft: "Your monthly cost limit has been reached. No call was placed. Details are shown in the Hermes dashboard."
  - reserve_ueber_rest: "This call does not fit into the remaining monthly cost limit. No call was placed. Details are shown in the Hermes dashboard."
  - minutes: "The call minutes included for the current billing period are used up. No call was placed. More minutes become available when the next billing period starts."
  - reserve_error: "The call could not be prepared. No call was placed. Please try again."
  - gate_error: "The safety check could not be completed right now. No call was placed. Please try again later."
  - DENIAL_UNKNOWN: "The call was refused by a safety or account check. No call was placed. Details are shown in the Hermes dashboard."
  - NOT_FOUND: "No call with this ID was found for your account. list_calls shows the recent calls."
  - NOT_PERMITTED: "This action is not available for your Hermes account."
  - REQUEST_REJECTED: "The request was rejected. Please check the input and try again."
- IDs: O-13, O-20.
- Pfade: geteilt (registerTools laeuft auf HTTP /mcp und stdio).
- Beweis (b): Vollstaendigkeits-/Reinheitstest S6 (Schleife ueber Quelle x SUPPORTED_LANGUAGES).

### S3 - `api()` reicht keinen rohen `json.error` mehr durch
- Wo: src/mcp-tools.js:60-83. Bei `!res.ok` einen Fehler mit sprachneutralen Feldern werfen:
  `httpStatus` (BLEIBT - answer_consult :1301/:1303 braucht 400/409), `reason` (nur wenn
  `typeof json.reason === "string"`), `inputHint` (NUR bei Status 400 ohne `reason` und
  `typeof json.error === "string"`). Die `message` traegt nichts Nutzerlesbares mehr (z.B. neutrale
  Kennung wie `upstream_status`), sie wird nirgends mehr ausgegeben.
- IDs: O-13, O-20.
- Pfade: HTTP /mcp und stdio (api() ist der einzige Hop beider Transporte).
- Beweis (a): `grep -n "json.error" src/mcp-tools.js` liefert nur noch die 400-inputHint-Zeile;
  `grep -n "HTTP \${" src/mcp-tools.js` liefert nichts. (b) al-p13-consult-channel-Tests (400/409)
  bleiben gruen.

### S4 - Eine Abbildung Fehler -> Text, auf Modul-Ebene
- Wo: `wrapHandler` src/mcp-tools.js:966-985 ruft eine NEUE Modul-Funktion (Muster `boundedHop`
  :348, damit der gepinnte registerTools-Befund in eslint-legacy-exceptions.json nicht waechst),
  z.B. `toolErrorText(err, texts)`, Reihenfolge:
  1. `texts.errors[err.code]` (ToolError, bestehend: HOP_TIMEOUT, CALL_START_UNCONFIRMED, ...)
  2. `err.reason` -> `texts.denials[err.reason]`; unbekannt -> `texts.errors[DENIAL_UNKNOWN]` PLUS
     `console.warn` serverseitig mit dem auf `[a-z_]` und max. 40 Zeichen bereinigten Grund
     (NIE `console.log` - stdout ist im stdio-Transport das Protokoll).
  3. `err.inputHint` (nur 400, s. S3) -> durchreichen.
  4. `httpStatus` 404 -> NOT_FOUND; 403 -> NOT_PERMITTED; sonstige 4xx -> REQUEST_REJECTED.
  5. alles andere (5xx, Netzfehler "fetch failed", TypeError aus einem Handler) ->
     `texts.errors[UPSTREAM_UNREACHABLE]`; `console.error` mit `err.name` und `err.message`
     serverseitig (secret-frei wie im Bestand), nie an den Client.
  Der Kommentar :970-976 ("err.message behaelt sein Bestandsverhalten") ist dann falsch und wird
  ersetzt.
- IDs: O-13, O-20.
- Pfade: HTTP /mcp und stdio (wrapHandler haengt an JEDEM Tool, beide Transporte).
- Beweis (b): Draht-Tests S6.

### S5 - list_action_items ohne interne ID
- Wo: src/mcp-tools.js:1527-1533 - die Zeile wird `${prefix}${text}` statt `[${a.id}] ...`.
  Keine MCP-Funktion und keine REST-Route nimmt eine Action-Item-ID entgegen (geprueft: kein Tool,
  kein Route-Handler) - die ID ist also nicht "strictly required". Beim Umbau den Kurz-Bezeichner
  `a` durch einen sprechenden Namen ersetzen; sinkt dadurch der id-length-Pin fuer 'a' in
  eslint-legacy-exceptions.json, den Pin auf den gemessenen Wert SENKEN (nie anheben).
- IDs: O-13.
- Pfade: HTTP /mcp und stdio (Text-Ergebnis, kein outputSchema, kein Widget).
- Beweis (b): Draht-Test (stdio + HTTP) `list_action_items` enthaelt kein `[` gefolgt von der
  Seed-ID und keine Seed-ID ueberhaupt; Positiv-Kontrolle: der Item-Text ist enthalten.
- Bestehende Tests, die brechen und angepasst werden: test/mcp-tools.test.js:244-245 und :282-285
  (`[a1] ...`, `[b1] ...`), test/mcp-tools-language.test.js:490 und :494.

### S6 - Tests (neue Datei, Name ohne Katalog-Praefix, z.B. test/openai-t2-09-neutrale-fehlertexte.test.js)
- (T1) Vollstaendigkeit aus der Quelle: liest src/telephony/outbound-gates.js als Text, sammelt
  alle Gruende ueber `grund:\s*"([a-z_]+)"`, `denialAudit\(\s*"([a-z_]+)"` und den Wert von
  `export const GATE_ERROR_GRUND = "..."`. Zusaetzlich STRUKTUR-Waechter: das erste Argument JEDES
  `denialAudit(`-Aufrufs ist ein String-Literal, `GATE_ERROR_GRUND`, `grund` oder `<bezeichner>.grund`
  - sonst rot (ein neuer, indirekter Grund-Lieferant fiele sonst durch). Positiv-Kontrolle: die
  Menge enthaelt `minutes`, `frozen`, `gate_error`, `reserve_error` und hat >= 20 Eintraege.
  Assertion: fuer JEDE Sprache in SUPPORTED_LANGUAGES ist Quelle ⊆ Tabellen-Schluessel UND
  Tabellen-Schluessel ⊆ Quelle (keine toten Eintraege).
- (T2) Reinheit: jeder Tabellentext (alle Sprachen) und die vier neuen `errors`-Texte matchen NICHT
  `/tarif|upgrade|\bplans?\b|pricing|price|preis|\babo\b|abonn|subscri|forfait/i`, NICHT
  `/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/` (Env-Namen), NICHT `/HTTP \d{3}|fetch failed/`, keine Ziffer
  (`/\d/`), und sind nicht leer; EN/FR-Texte enthalten kein deutsches Signalwort
  (`/\b(Anruf|nicht|bitte|gesperrt|Konto)\b/i`).
- (T3) Draht HTTP /mcp, echter Serverprozess, Legacy-Modus (Owner/Bootstrap): `OUTBOUND_FROZEN=true`,
  `tools/call place_call` -> `isError === true`, Text === `MCP_TEXTS[<lang>].denials.frozen`,
  kein `OUTBOUND_FROZEN` im Text; Gegenprobe ohne Tool: POST /api/calls liefert 403 wie vorher.
  Kein Call im Store.
- (T4) Draht HTTP /mcp, OAuth-Modus mit Nicht-Bootstrap-Tenant (Mini-IdP `startIdp` aus
  test/helpers.js, Muster test/am6-oauth-tenant.test.js; Seed wie test/b2-quota-gate.test.js,
  PAYMENT_ENABLED + PLAN_PRICE_BOOT_ENV): `place_call` -> `isError`, Text ohne
  `/tarif|upgrade|\bplan\b|pricing/i` und ohne deutsche Woerter bei en-Tenant, Text ===
  `denials.minutes` der Tenant-Sprache. Kein Call. Laesst sich der Nicht-Bootstrap-Tenant ueber
  /mcp nicht herstellen: UNKNOWN im Bericht mit Grund, dann T5 als Ersatzbeleg fuer den
  402-Minuten-Fall am Draht (stdio) plus S1-REST-Test.
- (T5) Draht stdio (echter Kindprozess `src/mcp-server.js`, Gateway-Attrappe wie
  test/openai-p5b-geldpfad.test.js:199-235): (a) 402 `{error:"<Bestandstext minutes>", reason:"minutes"}`
  -> Text === `MCP_TEXTS.en.denials.minutes`; (b) 403 `{error:"...(OUTBOUND_FROZEN).", reason:"frozen"}`
  -> kein `OUTBOUND_FROZEN`; (c) 402 `{reason:"voellig_neu"}` -> DENIAL_UNKNOWN-Text, und im
  stderr des Kindprozesses steht die Warnzeile; (d) GATEWAY_URL `http://127.0.0.1:1` -> Text ===
  UPSTREAM_UNREACHABLE, kein `fetch failed`; (e) 500 ohne Body -> kein `HTTP 500`; (f) 400
  `{error:"objective ist zu lang ..."}` ohne reason -> Text wird durchgereicht (Positiv-Kontrolle
  fuer Entscheidung 3); (g) list_action_items mit Seed-ID -> ID nicht im Text.
- (T6) Einheit ueber captureTools je SUPPORTED_LANGUAGES: 404 -> NOT_FOUND, 403 ohne reason ->
  NOT_PERMITTED, 409 ausserhalb answer_consult -> REQUEST_REJECTED; answer_consult 400/409 liefern
  weiter `accepted:false` mit consultAnswerRejected/consultNoLongerOpen (Regression AL-P13).
- Bestehende Tests, die voraussichtlich angepasst werden muessen: nur S5 (list_action_items). Die
  Bestands-Tests T-P4-07/T-P4-07b (mcp-tools.test.js:138-180) und MCP-05 (mcp-tools-i18n.test.js:104)
  bleiben gruen (sie pruefen isError bzw. "kein deutscher Satz"). Rot gewordene Tests erst
  ISOLIERT bestaetigen (`NODE_ENV=test node --test --test-name-pattern="<name>" test/<datei>.test.js`).

### S7 - PLAN-SECURITY.md: ein Satz, ohne Produktionswerte
- Wo: PLAN-SECURITY.md, beim Eintrag zur MCP-Grenze/Regel 4: "Die MCP-Grenze reicht seit T2-09
  keinen rohen REST-Fehlertext mehr durch (Ausnahme: 400-Eingabehinweise); Gate-Ablehnungen tragen
  im REST-Body additiv `reason`, das MCP-Werkzeug zeigt einen neutralen Text je Grund."
- IDs: O-13. Pfade: Doku. Beweis (a): `grep -n "T2-09" PLAN-SECURITY.md`.

### S8 - Abschluss-Pruefungen
- `node --check src/mcp-tools.js src/routes/api-calls.js src/i18n/mcp-texts.js src/i18n/mcp-denial-texts.js`
- `npm run lint` (Pins: nie anheben; gesunkene Befunde auf den gemessenen Wert senken).
- `npm test -- -- --test-concurrency=4 > <log> 2>&1`, nur `# pass`/`# fail` zaehlen.
- Nachher-Messung mit demselben stdio-Probe-Muster wie die Vorher-Messung: keine der fuenf
  Vorher-Zeilen darf mehr erscheinen.
- `ps ax -o pid,command | grep -E "src/server.js|mcp-server.js" | grep -v grep` -> leer.

## Nicht bauen (mit Grund)
- Keine Aenderung an outbound-gates.js (weder `deny()` noch Texte noch Gruende): der Grund steht
  schon im Audit-Objekt; die Route setzt `reason` additiv (Entscheidung 2). Safety-Gates und
  Offenlegungssatz unangetastet (CLAUDE.md Regel 1/2).
- Keine Aenderung der REST-`error`-Texte und der Dashboard-Texte (gate-texts.js bleibt, inkl. Zahlen).
- Keine Umbenennung der internen Grund-Kennungen (Audit/Metrik-Forensik haengt daran).
- `list_calls` (`[call-id]`, mcp-tools.js:493) und `check_inbox` (`[call_id]`, :538): die Call-ID
  ist fuer get_call_status/get_transcript/cancel_call strikt noetig (O-13 "unless strictly
  required") - nicht Teil der gepinnten IDs.
- Keine neue Env-Variable (keine vier Orte).
- Keine Lokalisierung der 400-Eingabehinweise (Entscheidung 3) - eigener Schritt, falls je verlangt.
- Keine Aenderung an failure_reason/result_summary im await_call_event-Pfad (P5b, bereits minimiert).
- apps/web wird nicht angefasst (npm test deckt es nicht ab; `reason` ist additiv).

## Pre-Mortem (ein Jahr spaeter war T2-09 ein Fehler - was ist passiert?)
1. Nutzer erfaehrt nicht, warum der Anruf nicht rausging ("tell the user what failed" laeuft ins
   Leere) -> jeder Grund hat einen eigenen Satz mit "kein Anruf" + Handlungsschritt; T1 erzwingt
   Vollstaendigkeit je Sprache; die Budgetzahlen stehen weiter im Dashboard.
2. Neuer Gate-Grund faellt stumm in "unknown" -> T1 leitet die Menge aus der Quelle ab und
   waechtert auch indirekte Lieferanten; zur Laufzeit neutraler Text PLUS console.warn.
3. Ein Text behauptet etwas Falsches ("kein Anruf" obwohl gewaehlt) -> Texte nur fuer Gate-
   Ablehnungen (laufen VOR dem Originate) und Status-Klassen; CALL_START_UNCONFIRMED/HOP_TIMEOUT
   (koennen gelaufen sein) behalten ihren Vorrang (Schritt 1 in S4).
4. Ein gebrochener Client: answer_consult unterscheidet 400/409 nicht mehr -> `httpStatus` bleibt,
   T6 + al-p13-Tests.
5. stdio-Protokoll zerschossen, weil der Warn-Log auf stdout geht -> nur console.warn/error;
   T5(c) liest die Warnzeile aus stderr und der tools/call kommt trotzdem sauber zurueck.
6. Ungewollter Anruf / Kosten: ausgeschlossen, weil keine Gate-Entscheidung, kein Status und keine
   Reihenfolge angefasst wird; S1-Test prueft "kein Call" bei frozen und minutes.
7. Leak ueber den neuen Kanal: `reason` ist ein fester Code aus dem Quelltext (keine Nummer, keine
   Tenant-ID, kein Betrag); der Warn-Log bereinigt ihn; `inputHint` nur bei 400.
8. Das Modell kann die Eingabe nicht mehr korrigieren -> 400-Hinweise bleiben (T5 f).
9. Lint-Pin-Drift in mcp-tools.js/api-calls.js -> Helfer auf Modul-Ebene, keine neuen Zeilen in
   den gepinnten Funktionen; Pins nur senken.

## Widersprueche Plan <-> Code
- Plan nennt `src/mcp-tools.js:1438-1441` fuer list_action_items; tatsaechlich :1513-1536 (Zeile
  mit der ID :1530).
- Plan nennt `outbound-gates.js:667` fuer den OUTBOUND_FROZEN-Text; tatsaechlich :692.
- Plan nennt `outbound-gates.js:894-900` fuer den 402-Tariftext; tatsaechlich :921-927.
- Plan nennt `src/mcp-tools.js:73` fuer `json.error`; tatsaechlich :72 (`new Error(json.error || \`HTTP ${res.status}\`)`).
- Plan: `reason` "in deny(), nur Body" - drei Ablehnungen laufen nicht ueber deny(); Spec setzt
  `reason` in der Route (Entscheidung 2).
- Plan: "neutrale englische Texte" - Spec: je Tenant-Sprache (de/en/fr) nach bestehender
  i18n-Struktur (Entscheidung 1).
- Plan: "api() reicht keinen rohen json.error mehr durch" - Spec behaelt die 400-Eingabehinweise
  (Entscheidung 3).
- Lead-Notiz "gesprochene DE-Strings tragen Umlaute": MCP-Fehlertexte werden nie gesprochen; nach
  Modulkonvention (mcp-texts.js:1-10) bleiben sie ASCII.

## Owner-Punkte
- Nach Deploy (Owner-Gate), Live-Probe in Claude/ChatGPT: `list_action_items` aufrufen -> keine
  `[...]`-Kennung vor den Eintraegen. `place_call` an `112` -> isError mit dem denylist-Text der
  Tenant-Sprache, kein "HTTP", kein Env-Name, kein Anruf (die Denylist lehnt vor jedem Waehlen ab;
  `112` steht fest in `EMERGENCY_SHORT_CODES`, src/telephony/number-denylist.js:11).
- Keine Deploy-Vorbedingung (keine Env-Variable, kein Live-Wert).

## Baseline
- `npm test -- -- --test-concurrency=4` im Worktree auf 33d7f80: `# tests 6366`, `# pass 6366`,
  `# fail 0` (Log: scratchpad/logs-t2-09/baseline-npm-test.log).
