# RCA: place_call 422 / 400 (2026-07-10)

Root-Cause-Analyse zu den fehlgeschlagenen Outbound-Calls call_mrex0hmw17ru und
call_mrex18fuptdr. Rein lesende Untersuchung (Render-Logs + Code). DB-Ebene nicht
verifizierbar (siehe Abschnitt 6). Scharf getrennt: **belegt** vs. **vermutet** vs. **offen**.

---

## 1. TL;DR

Es sind ZWEI unabhaengige Wurzeln, plus ein Untersuchungsartefakt:

**A) Der 422 (das eigentliche Blocker-Symptom) ist BELEGT.** Der Live-Env hat
`TELNYX_AI_ASSISTANT_ENABLED=true` (P11-Cutover ist im Render-Dashboard also faktisch
passiert, entgegen `render.yaml`-Default und Projekt-Memory). Dadurch laeuft Outbound ueber den
Call-Control-Pfad (`originateViaCallControl` -> `POST /v2/calls`) statt ueber TeXML. Dieser Pfad
uebergibt als `connection_id` denselben `TELNYX_CONNECTION_ID`, der aber eine **TeXML-Application-ID**
ist, keine **Call-Control-App-ID**. Telnyx lehnt das deterministisch ab:
`HTTP 422 (10015 Invalid value for connection_id (Call Control App ID))`.
Das erklaert den Determinismus (S2==S3) UND den Zeitpunkt-Wechsel (die frueheren Calls liefen ueber
den TeXML-Pfad, solange das Flag aus war; der Cutover hat den Pfad umgelegt).

Beleg (direktes Logzitat, Instanz srv-...-fhdn8, 12:31:50Z UTC):
`[place_call] originate fehlgeschlagen call=call_mrex0hmw17ru: Telnyx originateViaCallControl fehlgeschlagen: HTTP 422 (10015 Invalid value for connection_id (Call Control App ID))`
Der Funktionsname `originateViaCallControl` im Fehlertext ist der Beweis, dass der Call-Control-Zweig
lief (er ist in `src/telephony/adapters/telnyx/voice.js:114` hartkodiert und nur ueber
`server.js:1710 if (config.telnyxAiAssistantEnabled ...)` erreichbar).

**B) Der 400 bei nationaler Schreibweise (`01737252163`) ist BELEGT, aber ein separates,
kleineres Thema.** Der Tenant hat keine `privateNumber` gesetzt und als einzige aktive DID eine
US-Nummer (+17067101036). `homeCountryCode()` liefert daher `null`, `normalizeDialTarget` laesst die
fuehrende 0 unveraendert, das E164-Gate lehnt mit 400 ab. Das ist Eingabe-Normalisierung, nicht die
Call-Wurzel — mit `+49...`-Eingabe umgeht man es.

**C) Die "fehlende Historie" (S5) ist KEIN Datenverlust, sondern Log-Retention + Tenant-Trennung.**
Nicht abschliessend belegt (kein DB-Zugriff), aber die Log-Spur zeigt: fruehere erfolgreiche Calls
liefen unter einem ANDEREN User (`user_01KWSDW4...` am 07-06), die aktuellen Failures unter
`user_01KX600834...`. Render Free-Plan haelt Logs nur ~7 Tage.

**Die EINE Messung, die A endgueltig schliesst** (falls trotz des Logzitats noch Zweifel bestehen):
Im Telnyx-Portal pruefen, ob unter Call Control eine **Voice API / Call Control Application**
existiert, deren ID gleich `TELNYX_CONNECTION_ID` ist. Wenn `TELNYX_CONNECTION_ID` nur als
**TeXML Application** existiert (nicht als Call-Control-App), ist A bewiesen. Die eigentliche
Ursachen-Frage "warum failed jetzt, was frueher ging" ist aber schon durch den Flag-Flip
+ das Logzitat beantwortet.

---

## 2. Die drei Symptome getrennt

### (A) 422-Originate — Wurzel: aktivierter Call-Control-Pfad mit falscher connection_id

- **Wurzel:** `config.telnyxAiAssistantEnabled === true` live (P11-Flag im Dashboard gesetzt).
  `server.js:1710` verzweigt dann auf `originateAiAssistantCall` ->
  `voice.js:114 originateViaCallControl`, das `POST /v2/calls` mit
  `connection_id: config.telnyxConnectionId` sendet. Es gibt **keine separate
  Call-Control-Connection-ID** im Code (`voice.js:118` nutzt denselben Wert wie der TeXML-Pfad in
  `voice.js:77`). Die TeXML-Application-ID ist kein gueltiges Call-Control-App-Objekt -> Telnyx 10015.
- **Beleg (belegt):**
  - Logzitat mit Fehlercode 10015, Funktionsname `originateViaCallControl`, 12:31:50Z / 12:32:24Z UTC.
  - Boot-Guard `config.js:661-669` erzwingt bei aktivem Flag vier Zusatz-Env-Vars
    (`TELNYX_ASSISTANT_ID`, `TELNYX_API_KEY`, `TELNYX_CONNECTION_ID`, `TELNYX_SHIM_SHARED_SECRET`)
    oder Boot-Crash. Der Dienst bootete sauber -> die vier sind live gesetzt -> Flag ist an.
  - `PLAN-TELNYX-AI-ASSISTANT.md:411` hat genau dieses Risiko vorab benannt: "Eigene Connection-ID
    fuer Call Control getrennt von TELNYX_CONNECTION_ID (TeXML-App)? Vermutlich ja." — im Code
    unaufgeloest geblieben.
- **Status:** BELEGT (Mechanismus + Determinismus + Zeitpunkt-Wechsel vollstaendig erklaert).
  Offen bleibt nur, ob eine gueltige Call-Control-App ueberhaupt existiert (Portal-Check, Abschnitt 6).

### (B) E.164-Normalisierung — Wurzel: homeCountry=null bei US-DID ohne privateNumber

- **Wurzel:** `homeCountryCode([tenantPrivateNumber, findActiveNumber(...)?.e164])` = `null`, weil
  `privateNumber` nicht gesetzt und die aktive DID (+17067101036/US) kein Trunk-Zero-Land
  (`TRUNK_ZERO_COUNTRY_CODES=["+49","+33","+44"]`) ist. `normalizeDialTarget("01737252163", null)`
  gibt die Eingabe unveraendert zurueck; `E164.test` schlaegt fehl -> 400
  "to muss E.164 sein".
- **Beleg (belegt):** `src/store/defaults.js:298,318-344`; `src/server.js:646,784,1544-1548`.
  Reproduziert als reine Funktion: `homeCountryCode([null,"+17067101036"])===null`,
  `normalizeDialTarget("01737252163",null)==="01737252163"`,
  Gegenprobe mit `+49`-Kandidat -> `"+49173XXXXXXX"`.
- **Wichtig:** Wirkt NUR auf S1 (nationale Schreibweise). Bei `+49173XXXXXXX` ist
  `normalizeDialTarget` ein No-Op (der `+`-Zweig greift vor der Trunk-0-Regel) — B beruehrt S2/S3
  nicht.
- **Status:** BELEGT (fuer S1). Kein DB-Beweis fuer `privateNumber=NULL`, aber Kette belegt:
  Tenant != `BOOTSTRAP_TENANT_ID` -> kein Auto-Seed; kein UI-Feld in `public/tenant.html`.

### (C) Leere Call-Historie (S5) — Wurzel: Log-Retention + Tenant-Trennung, kein Datenverlust

- **Wurzel (vermutet):** Die ~100 behaupteten Erfolge existieren entweder nicht mehr im Log-Fenster
  (Free-Plan-Retention ~7 Tage) oder liefen unter einem anderen Tenant. Der Lesepfad selbst ist
  sauber: `GET /api/state` filtert via `store.exportTenantData(tenantId)`; `list_calls` und
  `get_agent_status` lesen beide dieselbe gescopte Antwort — kein Cross-Tenant-Leck, kein Filter-Gap.
- **Beleg (teilweise belegt):** Log-Spur zeigt 07-06-Erfolge unter `requestedBy=user_01KWSDW4...`,
  07-10-Failures unter `requestedBy=user_01KX600834...` — verschiedene User/Tenants.
  `src/routes/api-read.js:37-67`, `src/mcp-tools.js:570,637`.
- **Status:** OFFEN (Kern-Zahl "~100" unverifiziert). Der Lesepfad ist als bugfrei belegt; die
  Frage "wo sind die alten Calls" braucht die DB-Query aus Abschnitt 6. Log-Pipeline ist NICHT
  luckenhaft (siehe Nebenbefund).

---

## 3. Nebenbefunde

- **Kein Log-Luecke — falsches Suchfenster (Untersuchungsfehler).** Die Harten Fakten haben "12:31
  Uhr angezeigt" faelschlich als UTC+2 gerechnet und im Fenster 09:58-11:10Z gesucht. Die realen
  Events liegen bei **12:31:50Z / 12:32:24Z UTC**. Im richtigen Fenster existieren alle
  `[audit] place_call`- UND `[place_call] originate fehlgeschlagen`-Zeilen vollstaendig auf derselben
  Instanz (fhdn8). Die vermeintliche "ANOMALIE: keine tools/call / kein place_call-Audit" war reines
  Fenster-Artefakt. **Status: belegt.**

- **Log-Pipeline gesund.** Am 07-06 sind vollstaendige Erfolgs-Zyklen sichtbar
  (place_call -> voice/status completed). Fuer die untersuchten Fenster fehlt keine erwartete Zeile.
  ("Droppt NIE Zeilen" ist als Absolutaussage nicht beweisbar; operativ: keine Luecke in den
  strittigen Fenstern.) **Status: belegt (fuer die geprueften Fenster).**

- **get_agent_status calls=1 vs. list_calls 2 Eintraege.** Zwei verschiedene Felder derselben
  gescopten Antwort: `get_agent_status` liest den `usage.calls`-Zaehler (`usageFor`), `list_calls`
  das `scoped.calls`-Array (`exportTenantData`). `newCall` inkrementiert beide atomar, es gibt keinen
  Decrement-Pfad; failed Calls werden nicht zurueckgerollt. Divergenz 1 vs 2 ist plausibler
  Snapshot-Zeit-Artefakt zwischen zwei getrennten Tool-Requests, kein Zaehler-Bug. **Status: belegt
  (kein Bug), erklaert die ~100 nicht.**

- **Tenant-Drift.** MCP-Session-Tenant (`t_user_01KWKXZ3...`, Log 10:14Z/10:32Z),
  Failure-Requester (`user_01KX600834...`), 07-06-Erfolgs-Requester (`user_01KWSDW4...`) und ein
  kartenloser Web-Signup (`t_user_01KX5TCC...`, 10:50Z) sind verschiedene IDs. Fuer denselben
  WorkOS-`sub` konvergieren MCP- und Web-Kanal auf denselben Record (`t_`+sub / `idp_subject`);
  verschiedene subs = getrennte Tenants (eigene Nummer/Budget/Historie). Das ist Architektur, kein
  Bug — kann aber erklaeren, warum Historie "fehlt". **Status: teilweise belegt (Log-IDs), DB-Beweis
  offen.**

- **Widget-Polling (S6 "100x").** Reines Client-/Host-Verhalten in `src/ui/widgets/call.html`:
  Poll alle 8s (nicht 2s), kein absolutes Cap solange je eine Antwort ankam, `init()` startet den
  Loop beim (Re-)Mount ohne Terminal-Guard, 3-facher Bruecken-Fan-out solange kein Kanal bestaetigt.
  ABER: fuer die beiden failed Calls (kein `structuredContent` bei `isError`) entsteht vermutlich gar
  kein Widget; und im Log-Fenster steht KEIN `get_call_status`-tools/call. Die "100x" sind
  client-seitiges Rauschen (postMessage stirbt im iframe, erreicht den Server nie), kein Serverload,
  kein Bezug zum 422. **Status: Code-belegt, serverseitig ohne Last-Spur; kausal irrelevant fuer A/B.**

---

## 4. Ausgeschlossen (mit Begruendung)

**Falsche Hypothesen des Original-Reports (MCP-Client):**
- **"server.py" / Python-Backend:** existiert nicht. Repo ist Node.js/ESM, kein Build-Step, kein
  Python. Ausgeschlossen durch Repo-Struktur.
- **"ElevenLabs-Outbound-Endpoint":** ElevenLabs wird NUR fuer TTS-Vorab-Synthese (`<Play>`) genutzt,
  nie fuer Call-Origination. Origination laeuft ueber
  `src/telephony/adapters/{twilio,telnyx}/voice.js`. Ausgeschlossen durch Code.
- **"Twilio-Trial":** Der 422 traegt `err.providerStatus`, das im gesamten Code NUR der
  Telnyx-Adapter setzt (`telnyx/errors.js:58`). Der Twilio-Adapter kennt das Feld nicht. Der Call
  lief also ueber Telnyx, nicht Twilio. Der Twilio-Trial-Hint (`server.js:1767`) feuert nur bei
  `provider==="twilio"`. Ausgeschlossen durch Code.

**Weitere geprueft-und-ausgeschlossen:**
- **homeCountry/Normalisierung als 422-Ursache:** Nein. Normalisierung erzeugt 400 (S1), nicht 422.
  `+49173XXXXXXX` passiert sie unveraendert. Ausgeschlossen (aber S1-relevant, siehe B).
- **Guthaben (402):** Wirkt bei Origination NICHT als 402 wie beim Nummernkauf; hier steht ein
  konkreter 422/10015 im Log — ein Connection-ID-Fehler, kein Funding. Ausgeschlossen durch Logcode.
- **Outbound-Voice-Profile Laender-Whitelist (SIP-403 D13):** Waere ein asynchroner SIP-403 NACH
  erfolgreichem Create, kein synchroner Create-422. Ausgeschlossen durch Fehlerklasse.
- **US-DID->DE Routing intermittent:** Das dokumentierte Muster (Memory
  `telnyx-fresh-did-no-de-routing`) ist intermittent/asynchron; hier ist der Fehler synchron,
  deterministisch und traegt Code 10015 (connection_id), nicht Routing. Ausgeschlossen durch
  Determinismus + Logcode.
- **Nummer nicht der Connection zugewiesen (H-d):** Waere ein anderer 422-Titel; der Log nennt
  explizit "Call Control App ID", nicht Caller-ID-Zuordnung. Ausgeschlossen durch Logtext.
- **Log-Pipeline luckenhaft / Requests trafen Instanz nie:** widerlegt, Events im richtigen Fenster
  vorhanden. Ausgeschlossen.
- **Cross-Tenant-Nummern-Leck:** `findActiveNumber` filtert strikt `n.tenantId===tenantId` (I7);
  +17067101036 ist die eigene Nummer des Session-Tenants. Ausgeschlossen durch Code.
- **Widget-Poll als 422-Ursache:** Client-Downstream, sendet nur `get_call_status`, nie `place_call`.
  Ausgeschlossen durch Schichten-Trennung.

---

## 5. Fix-Plan (priorisiert)

### Fix 1 (KRITISCH, entblockt Outbound) — Call-Control-connection_id trennen ODER Flag zurueck

Zwei Optionen. **Owner-Entscheidung noetig** (Abschnitt 6), da unklar ist, ob P11 bewusst live
scharfgeschaltet wurde.

**Option 1a (schnell, sicher): Flag live wieder ausschalten.**
- Env: `TELNYX_AI_ASSISTANT_ENABLED=false` im Render-Dashboard.
- Wirkung: `server.js:1710` faellt in den TeXML-`else`-Zweig zurueck, exakt der Pfad der frueheren
  ~100 Calls. Kein Code-Change.
- Risiko: niedrig. Kein Barge-in (der P11-Zweck), aber Outbound funktioniert wieder.
- **Pre-Mortem (ein Jahr spaeter falsch):** "Wir haben das Flag aus-getoggelt, aber der TeXML-Pfad
  war inzwischen selbst kaputt (z.B. `TELNYX_CONNECTION_ID` in der Zwischenzeit geloescht/rotiert),
  also failte Outbound weiter, nur mit anderem Fehler." Gegenmassnahme: nach dem Toggle EINEN
  Test-Outbound (Owner) verifizieren, nicht blind vertrauen.

**Option 1b (richtig, laenger): eigene Call-Control-Connection-ID einfuehren.**
- Dateien: `src/config.js` (neue Var `TELNYX_CALL_CONTROL_CONNECTION_ID`, dokumentiert in
  `.env.example` + `render.yaml`), `src/telephony/adapters/telnyx/voice.js:118`
  (`originateViaCallControl` nutzt die neue Var statt `telnyxConnectionId`),
  Boot-Guard `config.js:661-669` (neue Var in die Pflichtliste bei aktivem Flag),
  ggf. `endCallViaCallControl`/`startAssistant` (dieselbe Call-Control-App).
- Risiko: mittel. Neue Env-Var + Boot-Guard-Kopplung; Test-Suite muss `BASE_ENV` in `test/helpers.js`
  nachziehen (fail-closed Default), sonst leakt lokales `.env` in Spawn-Tests.
- **Pre-Mortem:** "Wir haben eine zweite Connection-ID eingefuehrt, aber sie war wieder eine
  TeXML-App (Copy-Paste), also derselbe 10015 — nur teurer erkauft." Gegenmassnahme: Vor dem Deploy
  im Telnyx-Portal explizit eine **Call Control Application** anlegen und deren ID verwenden; im
  Boot-Guard/README dokumentieren, dass die zwei IDs unterschiedliche Objekt-Typen sind.
- Safety: kein Gate beruehrt, Offenlegungssatz unberuehrt, kein Secret in Logs (der Adapter loggt
  bereits nur `errors[].code+title`, kein Body/Key).

### Fix 2 (WICHTIG, Diagnose-Klarheit) — echten Telnyx-Fehlercode in die Client-Meldung/Log heben

Der Client bekam nur "Provider hat den Anruf abgelehnt (HTTP 422)". Der eigentliche Grund
(10015 connection_id) stand nur im Server-Log. Das hat die ganze Fehlsuche verursacht.
- Datei: `src/server.js:1762-1766`. Die generische Meldung darf bleiben (kein Roh-Body an den
  Client, Regel 4/5), aber `err.providerStatus` koennte um einen **allowlisted** Telnyx-Code
  (`errors[].code`, KEIN detail/title mit moeglichen Nummern-Fragmenten) ergaenzt werden, damit der
  Aufrufer "Konfigurationsfehler" von "Guthaben" unterscheiden kann.
- Risiko: niedrig-mittel — Achtung: `errors[].title` kann Nummern-/Auth-Fragmente tragen. NUR der
  numerische `code` ist sicher. `errors.js` reicht heute schon nur code+title serverseitig durch;
  fuer den Client strikt auf `code` beschraenken.
- **Pre-Mortem:** "Wir haben den Telnyx-Titel an den Client durchgereicht und damit eine
  Caller-ID/URL geleakt." Gegenmassnahme: harte Allowlist auf den Integer-Code, Test der die
  Meldung gegen ein Leak-Pattern prueft.

### Fix 3 (MITTEL) — Vertragsluecke der Tool-Description (S1)

`src/mcp-tools.js:355` verspricht bedingungslos "nationale Schreibweise mit 0 loest der Server ueber
das Heimatland auf". Real ist das an `privateNumber` ODER eine Trunk-Zero-DID gebunden.
- Datei: `src/mcp-tools.js:355` — Bedingung nennen bzw. das Modell anhalten, im Zweifel nach
  internationaler Schreibweise zu fragen. Optional praezisere 400-Meldung fuer den Fall
  "homeCountry=null wegen fehlender privateNumber" (vs. generisches E164-Format).
- Risiko: niedrig (Doku/Text).
- **Pre-Mortem:** "Wir haben stattdessen `homeCountry` auf `+49` gedefaultet — und ein
  franzoesischer/US-Tenant hat seine nationale Nummer nach Deutschland gewaehlt = **Falschanruf an
  einen Fremden**." **Das ist explizit verboten.** Fail-closed bleibt: bei `homeCountry=null` NICHT
  raten, ablehnen. Ebenso NICHT `+1` in `TRUNK_ZERO_COUNTRY_CODES` (NANP hat keine Trunk-0) und NICHT
  das Heimatland aus der DID ableiten (die US-DID liegt bewusst in einem anderen Land als der Nutzer).

### Fix 4 (NIEDRIG) — privateNumber-UI im Self-Service

`public/tenant.html` hat kein Feld fuer `privateNumber`, obwohl
`POST /api/self-service/private-number` existiert. Optionaler Nudge (NICHT Pflichtfeld — die
Owner-Entscheidung "optional" bleibt).
- Risiko: niedrig.
- **Pre-Mortem:** "Wir haben es zur Pflicht gemacht und das Onboarding gebrochen / eine
  DE-Privatnummer erzwungen, die der US/FR-Nutzer nicht hat." Gegenmassnahme: optional halten.

### Fix 5 (NIEDRIG, separat) — Widget-Poll-Robustheit

`src/ui/widgets/call.html`: `init()` sollte bei bereits terminalem Call keinen Loop starten; ein
absolutes Poll-Cap ergaenzen. Nicht die 422-Wurzel, reine Client-Hygiene.
- Risiko: niedrig (Client-only).
- **Pre-Mortem:** "Cap zu niedrig -> lange laufende Calls verlieren Status-Updates." Gegenmassnahme:
  Cap deutlich ueber realistischer Max-Gespraechsdauer.

---

## 6. Owner-Checkliste (Antonio) — manuell pruefen/tun

Reihenfolge = Prioritaet. Punkt 1 entblockt Outbound.

1. **Telnyx-Portal: Objekt-Typ von `TELNYX_CONNECTION_ID` klaeren.**
   - URL: https://portal.telnyx.com/ -> "Voice" -> "Programmable Voice" ->
     "TeXML Applications" UND "Call Control Applications".
   - Frage: Existiert der Wert von `TELNYX_CONNECTION_ID` als **Call Control Application**? Falls er
     NUR unter **TeXML Applications** steht -> Befund A bestaetigt (10015 = TeXML-ID an
     Call-Control-Endpunkt).
   - Falls eine Call-Control-App gewuenscht ist: eine anlegen, deren **Application ID** notieren
     (fuer Fix 1b `TELNYX_CALL_CONTROL_CONNECTION_ID`).

2. **Entscheidung P11: war der Live-Cutover Absicht?**
   - Render-Dashboard -> Service `vodafone-agent` (srv-d8m0fhflk1mc73bno570) -> "Environment" ->
     Wert von `TELNYX_AI_ASSISTANT_ENABLED` pruefen. Erwartung nach Befund: `true`.
   - Wenn NICHT gewollt: auf `false` setzen (Fix 1a) -> Outbound laeuft sofort wieder ueber TeXML.
   - Wenn gewollt (Barge-in): erst Fix 1b deployen (eigene Call-Control-App-ID), dann Flag an lassen.
   - Hinweis: Projekt-Memory sagte "Flag AUS/nicht gepusht, nur P11-Owner-Cutover offen" — das ist
     durch den Live-Boot (4 Pflicht-Env-Vars gesetzt) + das Logzitat **ueberholt**. Memory
     aktualisieren.

3. **Test-Outbound nach dem Fix.**
   - Ueber MCP `place_call to="+49173XXXXXXX"` (E.164!). Erwartung: `status:"dialing"`, dann
     `voice/status ... completed`. Falls weiter 422: Render-Log lesen (Punkt 5) und den neuen
     `errors[].code` pruefen.

4. **DB-Query fuer die "~100 Calls" (S5) — offen, braucht funktionierenden DB-Zugriff.**
   - Der lesende Weg `mcp__render__query_render_postgres` scheiterte in der Untersuchung technisch
     (`FATAL: SSL/TLS required` / `unexpected EOF`) bzw. wurde per Classifier verweigert — NICHT
     abschliessend klaerbar ohne funktionierende Verbindung.
   - Query (read-only), sobald Zugriff geht:
     ```sql
     SELECT tenant_id, count(*), min(started_at), max(started_at)
     FROM call GROUP BY 1 ORDER BY 2 DESC;
     ```
     Zeigt, unter welchem Tenant die Historie liegt und ob "~100" real ist.
   - Ergaenzend:
     ```sql
     SELECT id, tenant_id, e164, provider, status FROM number;
     SELECT id, owner_name, idp_subject, kyc_level, private_number FROM tenant;
     ```
     Klaert `private_number` (Befund B) und die Tenant-/Nummern-Zuordnung (Befund C, Drift).
   - Achtung Kosten/Frist: `hermes-db` (dpg-d8tpesreo5us73bogaig-a) Free-Plan **expiresAt 2026-07-24**.

5. **Render-Log richtig lesen (fuer kuenftige Debugs).**
   - Zeitfenster in **UTC** waehlen, nicht in Berlin-Lokalzeit. Die Client-Anzeige "12:31" war hier
     bereits UTC (12:31Z), NICHT +2h. Konkret fuer diesen Vorfall: Fenster 12:30-12:35Z, `text`-Suche
     `["place_call","originate"]`.

---

## Verifizierbarkeits-Status (Zusammenfassung)

| Punkt | Status | fehlt fuer "belegt" |
|---|---|---|
| A: 422 = Call-Control-Pfad + falsche connection_id | **belegt** | (Portal-Bestaetigung Objekt-Typ, optional) |
| Flag live = true | **belegt** | — (Boot-Guard + Logzitat) |
| B: 400 = homeCountry=null | **belegt** (Code+Repro) | DB-Wert `private_number` |
| C: Historie = Retention/Tenant-Drift | **offen** | DB-Query (Punkt 4) |
| Log-Luecke war Fenster-Fehler | **belegt** | — |
| Original-Report (server.py/EL/Twilio) | **ausgeschlossen** | — |
