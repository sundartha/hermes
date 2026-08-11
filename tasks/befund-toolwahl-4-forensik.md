# Laufzeit-Forensik: look_up/get_consult im letzten echten Anruf (2026-08-11)

Quellen: Render-Logs (`srv-d8m0fhflk1mc73bno570`), Prod-DB (`psql`, RLS via
`set_config('app.current_tenant', ...)`). Nur gelesen, nichts geschrieben.

## 1. Letzter echter Anruf

`call_msor2k4pefds`, **outbound**, ausgeloest per MCP `place_call`.

```
[audit] place_call ip=::1 to=+49173725XXXX call=call_msor2k4pefds provider=telnyx
  requestedBy=user_01KX600834GCJFV9GTZQKWZMTH   (14:22:52.778Z)
[voice/call-control] event ... call.initiated   (14:22:53.581Z)
[voice/call-control] event ... call.answered    (14:23:02.415Z)
[voice/call-control] event ... call.hangup hangup_cause=normal_clearing
  hangup_source=callee sip_hangup_cause=200      (14:24:12.897Z)
```

DB bestaetigt (Tabelle `call`, RLS-GUC auf `t_user_01KX600834GCJFV9GTZQKWZMTH`):
`direction=outbound status=completed provider=telnyx requested_by=user_01KX600834GCJFV9GTZQKWZMTH`.
Kein Anruf danach bis 14:45 Uhr (Suchfenster-Ende) im Log.

## 2. offeredToolNames — WOERTLICH pro Turn (Kernbefund)

Feld existiert, wird UNCONDITIONAL geloggt (`[telnyx-shim] turn_ok`, unabhaengig von
`METRICS_ENABLED`):

| turnSeq | offeredToolNames | toolNames (gefeuert) | consultPollFresh |
|---|---|---|---|
| 2 | `["end_call","take_message","get_consult"]` | `[]` | true |
| 3 | `["end_call","take_message"]` | `[]` | false |
| 4 | `["end_call","take_message","get_consult"]` | `[]` | true |
| 6 | `["end_call","take_message","get_consult"]` | `[]` | true |
| 7 | `["end_call","take_message","get_consult"]` | `[]` | true |

turnSeq 1 und 5: `[telnyx-shim] gate {"reason":"provider_nudge",...}` — Telnyx-Anstoss,
nie bis zum Modell durchgereicht (kein turn_ok, kein Werkzeugsatz).

**`look_up` steht in KEINEM einzigen Turn dieses Anrufs im angebotenen Satz — auch nicht
tagesweit** (`text:["look_up"]` ueber den ganzen 2026-08-11 im Log: 0 Treffer).
**`get_consult` stand in 4 von 5 beantworteten Turns im Satz, wurde aber in KEINEM
Turn gefeuert** (`toolNames` durchgehend `[]`, `roundtrips` durchgehend `1`).

## 3. Wurzel fuer look_up: Tenant-Profil, nicht Modellwahl

Boot-Banner (Instanz `jjkh9`, 13:48:11, aktueller Deploy `a3e3ee5`):
```
In-Call-Nachschlag: AKTIV (LOOKUP_ENABLED=true) - EXA_API_KEY gesetzt,
  wirkt nur mit allowLookup am Tenant
Consult-Kanal: AKTIV (CONSULT_ENABLED=true) - wirkt nur mit
  ASSISTANT_CONTEXT_ENABLED=true und allowConsult am Tenant
```
Beide globalen Schalter + Key sind AN. Die Tenant-Achse entscheidet:

DB, Tabelle `profile` (Policy `profile_global`, `USING(true)` — kein RLS-Filter):
```
tenant_id: t_user_01KX600834GCJFV9GTZQKWZMTH
data: {"allowLookup": false, "allowBooking": false, "allowConsult": true,
       "unrestricted": false, "allowCalendar": false, "allowedNumbers": [],
       "maxCallsPerHour": null, "allowedCountryCodes": []}
```
Das ist exakt `PAID_PLAN_PROFILE` (`src/plans.js:105`): `allowConsult=true` seit
Deploy `dep-d9tdruajobas73co4i6g` (08:31 Uhr, "Rueckfrage-Kanal fuer alle Plaene
freigeben"), `allowLookup=false` bewusst weiter gesperrt ("bleibt Owner-Faehigkeit,
bis Testanruf und Datenschutzerklaerung durch sind").

Der Anruf lief NICHT unter dem Bootstrap-/Owner-Tenant (`tenant_id="owner"`, dort
waere `allowLookup` hart auf `true` gepinnt, `resolveProfileFrom` ignoriert dafuer
sogar eine gespeicherte Zeile) — `requested_by`/Tenant-ID sind identisch
`user_01KX600834GCJFV9GTZQKWZMTH` / `t_user_01KX600834GCJFV9GTZQKWZMTH`, ein
Paid-Plan-Tenant.

**Befund: `look_up` war fuer diesen Anruf strukturell unerreichbar — Konfigurations-
gate, kein KI-Ermessen.** `get_consult` war real angeboten (4/5 Turns, inkl. frischem
MCP-Client-Poll) und wurde trotzdem nie aufgerufen — DAS ist die offene Modell-
verhaltens-Frage.

## 4. MCP-Client-Poll fuer get_consult

`consultPollFresh` (aus `consult/in-call.js`) war in 4 von 5 beantworteten Turns
`true` (turnSeq 2/4/6/7, Alter 2,2s-22,7s), nur turnSeq 3 `false` (25,1s alt — genau
dort fehlte `get_consult` im Satz). Ein aktiv pollender MCP-Client war also
ueberwiegend vorhanden; die Nichtnutzung ist nicht durch fehlenden Poll erklaerbar.

## 5. LLM-Fehler/Timeouts/Retries/Breaker

Alle 6 `[metrics] llm`-Zeilen dieses Anrufs: `"outcome":"success","attempts":1,
"breakerState":"closed"` (Latenzen 1218/1999/2602/2572/1737/7846 ms — letzte ist der
Post-Hangup-Summary-Call). Tagesweite Suche nach `breaker-open`/`timeout`/`circuit`/
`"outcome":"error`/`abbruch`: **ein Treffer, aber SIP-Ebene**, nicht LLM:
`event_type=call.hangup hangup_cause=timeout` auf einem ANDEREN Call
(`call_msonnmbtaavz`, 12:48:11, sip_hangup_cause=487 = kein Antworten/Abbruch beim
Ziel). Kein LLM-seitiger Timeout/Retry/Breaker-Trip an diesem Tag.
`LLM_REQUEST_TIMEOUT_MS` selbst steht in KEINER Boot-Banner-Zeile — Default-Fallback
im Code ist 3500 ms (`config.js:431`), der tatsaechlich gesetzte Render-Env-Wert ist
aus Logs NICHT ablesbar (MESSLUECKE).

## 6. Boot-Banner des aktuellen Deploys (a3e3ee5, live seit 13:48:11)

```
Modelle: CLAUDE_MODEL=deepseek-v4-pro | PRECALL_BRIEFING_MODEL=deepseek-v4-pro |
  AKTIV (ELEVENLABS_PLAY_TTS_ENABLED=true)
Preisstaffeln: deepseek-v4-pro ab 2026-08-07 (naechste: keine) |
  deepseek-v4-pro ab 2026-08-07 (naechste: keine)
Vorab-Recherche: aus (RESEARCH_ENABLED=false) - wirkt nur mit allowResearch am Tenant
In-Call-Nachschlag: AKTIV (LOOKUP_ENABLED=true) - EXA_API_KEY gesetzt, wirkt nur
  mit allowLookup am Tenant
Consult-Kanal: AKTIV (CONSULT_ENABLED=true) - wirkt nur mit
  ASSISTANT_CONTEXT_ENABLED=true und allowConsult am Tenant
```
Anruf lief also bereits unter DeepSeek (deployed 13:48:11, Anruf 14:22-14:24).

## 7. Turns / Median-Dauer

7 Shim-Requests (turnSeq 1-7), davon 2 als `provider_nudge` gegated (kein Modell-
Aufruf), 5 mit `turn_ok` (echte Antwort). Turn-Latenzen (`turn_ok.latencyMs`, ms):
1369, 2000, 2603, 2573, 1738 → **Median 2000 ms**. Gespraechsdauer (answered->hangup):
70,5 s.

## MESSLUECKE

- `offeredToolNames`/`toolNames` stehen NUR in der Shim-Zeile `turn_ok`
  (`[telnyx-shim]`); der opt-in-Kanal `[metrics] turn` traegt nur `toolNames`, NIE
  `offeredToolNames` — ohne den unconditional Shim-Kanal waere Frage 2 unbeantwortbar.
- `LLM_REQUEST_TIMEOUT_MS` (und generell gesetzte, nicht-defaultete Env-Werte) stehen
  in keiner Boot-Banner-Zeile — nur der Code-Fallback ist aus Logs ablesbar, der reale
  Render-Wert nicht.
