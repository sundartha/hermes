# IEL-Cutover Arbeitsprotokoll - Etappe 1 (Runbook Schritte 0, 1, 2)

Quelle: `tasks/iel-spec.md` Abschnitt 7. Ausgangsstand: master = 9917db7, upstream/master = fa24414 (Vorfahr).
Keine Geheimnis-Werte, Nummern nur mit letzten 4 Ziffern.

## Schritt 0 - Spike2 entfernen

| Zeit (UTC) | Befehl | Ergebnis | Lesebeleg |
|---|---|---|---|
| 2026-09-15T04:24:05Z | `node scripts/el-nummern-registrierung.mjs --trunk-inventar` | ROT (erwartet) | Exit 1; 4 Registrierungen, 1 offen = `phnum_1101m00pjrg7e1js7aaxwp8hdw38` ("Spike2 Telnyx", …0177) |
| 2026-09-15T04:24:10Z | `… --registrierung-loeschen --id=phnum_1101m00pjrg7e1js7aaxwp8hdw38` | GRUEN | Trockenlauf, nichts gesendet |
| 2026-09-15T04:24:15Z | `… --registrierung-loeschen --id=phnum_1101m00pjrg7e1js7aaxwp8hdw38 --ja-wirklich` | GRUEN | HTTP 204; LOESCH-BELEG GRUEN (id gelistet: nein, Inventar GRUEN) |
| 2026-09-15T04:24:20Z | `node scripts/el-nummern-registrierung.mjs --trunk-inventar` | GRUEN | Exit 0; 3 Registrierungen (…1188, …4874, …8341), 0 offen, 0 mit Zugangsdaten, 3 "Annahme unbelegt" |

## Schritt 1 - Allowlist, Push, Deploy, DID-Beleg, Geheimnisse setzen (Schalter bleibt aus)

| Zeit (UTC) | Befehl | Ergebnis | Lesebeleg |
|---|---|---|---|
| 2026-09-15T04:24:25Z | 1a `node scripts/iel-geheimnisse.mjs allowlist-uebernehmen` | GRUEN | Trockenlauf; OWNER_SELF_CALL_TENANT_IDS Status 200, Anzahl 1; nichts geschrieben |
| 2026-09-15T04:24:30Z | 1a `… allowlist-uebernehmen --ausfuehren` | GRUEN | Exit 0; PUT Status 200, ELEVENLABS_INBOUND_TENANT_IDS Anzahl 1, gleich OWNER_SELF_CALL_TENANT_IDS: ja |
| 2026-09-15T04:24:41Z | 1b `git status --short` | GRUEN | nur bekannte Aenderung `.claude/workflows/runs/inbound-paritaet-lean.js` + bekannte untrackte Dateien; HEAD 9917db7 |
| 2026-09-15T04:24:50Z | 1b `git push upstream master` | GRUEN | fa24414..9917db7 master -> master (fast-forward) |
| 2026-09-15T04:25:05Z | 1b `list_deploys` | GRUEN | kein Auto-Deploy (Dienst autoDeploy=no); live war dep-dajtcoh594qs73di7ijg @ fa24414 |
| 2026-09-15T04:25:14Z | 1b `trigger_deploy` (workspace tea-d8m0b9jeo5us73cvasg0, einziger Workspace, ownerId des Dienstes) | gestartet | dep-dakchah42hec73a3i4cg @ 9917db7 |
| 2026-09-15T04:26:13Z | 1b `get_deploy` + `list_logs` ("Inbound-EL", "fatal", "Boot") | GRUEN | dep-dakchah42hec73a3i4cg live, Commit 9917db7 = master-HEAD; `[boot] deployed commit=9917db7…`; Banner "Inbound-EL: aus, 1 Tenants"; kein fataler Befund (nur Bestands-Warnungen: TELNYX_FQDN/OVP-ID leer, PLAY_TTS-Konfig-Warnung, Tarif-Drift zu wenig Proben) |
| 2026-09-15T04:26:21Z | 1c Sondenzeile (`list_logs`) + `get_my_number` + `node scripts/el-nummern-registrierung.mjs --trunk-inventar` | GRUEN | Sonde "Inbound-EL-Allowlist: 1 Tenants, aktive DIDs …1188"; get_my_number …1188; Inventar Exit 0, genau 1 Registrierung mit …1188 (phnum_0701m18z3h2tex79r3vscsk5jxqq) |
| 2026-09-15T04:26:30Z | 1d `node scripts/iel-geheimnisse.mjs setzen --nummer=<DID …1188>` | GRUEN | Trockenlauf; Vorab-Riegel ohne ROT; Reihenfolge Render SIP_USER -> SIP_PASSWORD -> INIT_WEBHOOK_TOKEN -> Workspace-Secret (anlegen) -> Registrierung …1188; nichts geschrieben |
| 2026-09-15T04:26:43Z | 1d `… setzen --nummer=<DID …1188> --ausfuehren` | GRUEN | Exit 0; alle 5 Ziele Status 200; Render-Belege vorhanden/gleich ja (Laengen 32/64/64); `secret_id LUfn05jEghzQiMn2s83c` (Liste enthaelt: ja); Workspace-Init-Webhook ohne widersprechenden Verweis; Registrierung has_auth_credentials ja, username gleich ja, allowed_numbers [DID] ja, outbound_trunk unveraendert ja, media_encryption=allowed; Inventar abschliessend GRUEN; SETZEN GRUEN |

## Schritt 2 - Deploy (laedt die Geheimnisse aus 1d)

| Zeit (UTC) | Befehl | Ergebnis | Lesebeleg |
|---|---|---|---|
| 2026-09-15T04:27:22Z | `trigger_deploy` | gestartet | dep-dakciah5efls73dh9tmg @ 9917db7 |
| 2026-09-15T04:28:27Z | `list_deploys` + `list_logs` ("Inbound-EL", "deployed commit", "fatal", "[boot]") | GRUEN | dep-dakciah5efls73dh9tmg live (Vorgaenger dep-dakchah42hec73a3i4cg deactivated), Commit 9917db7 = master-HEAD; Instanz -75qd7; Banner "Inbound-EL: aus, 1 Tenants"; Sonde unveraendert "1 Tenants, aktive DIDs …1188"; kein fataler Befund (dieselben Bestands-Warnungen); einmal Loki 503 beim Log-Lesen, Wiederholung ok |
| 2026-09-15T04:28:36Z | `node scripts/iel-geheimnisse.mjs beleg-init` | GRUEN | Exit 0; ZIEL-URTEIL GRUEN (wirksamer Origin https://app.sundartha.com, Ziel …/webhooks/elevenlabs/init); ohne Token 403, mit Token 404 |

## Auffaelligkeiten

- `configHash=90c7d824…` ist in beiden Deploys identisch, obwohl zwischen ihnen drei Render-Env-Geheimnisse gesetzt wurden. Vermutlich hasht configHash keine Geheimnisse; die Wirksamkeit belegt `beleg-init` (mit Token 404 = Server traegt den Render-Token-Wert).
- Registrierung …1188: `media_encryption=allowed` (nur Hinweis, kein Befund des Skripts).
- Render-Dienst `autoDeploy=no`: jeder Deploy ist manuell (`trigger_deploy`); `trigger_deploy` verlangt `workspaceId` (einziger Workspace tea-d8m0b9jeo5us73cvasg0).
- DID …1188 ist eine US-Nummer (+1).

## Stand nach Etappe 1

Schalter `ELEVENLABS_INBOUND_ENABLED` aus. Nicht ausgefuehrt: Prompt-Push (3), Workspace-Webhook (5), Agent-Schalter (6), alles danach. `secret_id` fuer Schritt 5: `LUfn05jEghzQiMn2s83c`.

---

# Verifikation Runbook 11, 12, 13 (Verifikations-Agent, nur lesend, 2026-09-15 ~08:04 UTC)

Live-Stand: `dep-dakes3h5efls73dp68p0` (live 07:05:36 UTC, Banner "Inbound-EL: an, 1 Tenants"), Instanz -scmpg. DID …1188.
Seit 07:05 UTC genau EIN Inbound-Anruf (eine `inbound_path`-Zeile) und EIN Outbound-Anruf; keine fremden Anrufer.

## Schritt 11 - Owner-Inbound-Testanruf `call_mu2dlfnebk9c`

| Zeit (UTC) | Beleg | Ergebnis |
|---|---|---|
| 07:54:07.612 | `[inbound-path] inbound_path {"path":"elevenlabs"}` | GRUEN |
| 07:54:08.920 | `[play-tts] Synthese vollstaendig (erstes Audio 444 ms, Gesamt 1306 ms)` (Pflichtsatz vor dem Dial) | Hinweis |
| 07:54:15.572 | `[el-bein] status in-progress angenommen:true` | GRUEN |
| 07:54:16.031 | `[el-init] gebunden call=call_mu2dlfnebk9c` - kein `grund=token`, keine zweite Zeile (keine Wiederholung) | GRUEN; Zeile traegt KEINE "ms seit Dial" (Messluecke). Abgeleitet: 459 ms nach Bein-answered, 8,42 s nach `inbound_path` |
| 07:55:07.914 | `[el-rueckfall] quelle=dial_ende entscheidung=auflegen` | GRUEN: Erfolgsfall Dial-Ende -> Redirect -> Hangup (§8 "Dial-Ende -> Redirect"), KEIN Rueckfall-Start |
| 07:55:07.980 | `[voice/status] completed`, callDurationS 59, hangupCause normal_clearing, hangupSource hangup-xml, sipHangupCause 200 | GRUEN; EL-Bein endete zuerst (Agent-Seite), Traeger per TeXML-Hangup beendet |
| 07:55:07.980 | `[el-inbound] nachlauf gestartet` - genau eine Zeile | GRUEN |
| 07:55:18.513 | `[join-schluessel] verworfen grund=keine_telnyx_sip_call_id` (console.error; EL `phone_call.call_id` ist UUID, kein `otb_…`) | BEFUND (s.u.) |
| 07:55:25.703 | `[metrics] llm` mit callId, 825/380 Tokens (Summary) | GRUEN |
| 07:55:25.887 | `[sms] Telnyx sendSms fehlgeschlagen: HTTP 400 (40305 Invalid 'from' address)` | ROT, Bestand (gleiche Zeile seit >= 10.09. nach jedem Anruf) |
| - | kein `speech_result`/`turn roundtrips` seit 07:05; kein `Ergebnis beim Beenden nicht abrufbar` | GRUEN |
| 08:0x | `conversation-beleg --richtung=inbound --seit=2026-09-15T07:53:30Z --nummer=<DID …1188>` | GRUEN: `conv_0801m2j0ydhwef7b2t171csdf3xn`, direction inbound, status done, call_duration_secs 51; phone_number_id == Registrierung ja; sip_hermes_call_binding vorhanden (Laenge 32); tenant_token vorhanden, leer ja; inbound_situation Laenge 1057; zusaetzlich `sip_telnyx_call_control_id` vorhanden; erste Agent-Zeile = Begruessungsrest ("Hallo, hier ist der KI-Assistent von …", nicht Outbound-Offenlegung, kein doppelter Pflichtsatz) -> M11 GRUEN |
| 08:0x | `get_call_status` duration_s 60; inbound_path 07:54:07.6 -> completed 07:55:07.98 = 60,4 s | endedAt = completed-Zeile: GRUEN (indirekt, Store nicht gelesen) |
| 08:0x | `check_inbox include_seen=true` (kein Marker geaendert, Log `inbox_poll neu=0`) | GRUEN: Eintrag vorhanden, Zusammenfassung deutsch, Terminwunsch "Mittwoch 17:00" (= morgen) + Weitergabe-Bitte + Anrufername erfasst, action_required true |

M-R4-7: Traeger callDurationS 59 / Store-Dauer 60 s / EL call_duration_secs 51 -> Abstand 8-9 s (= Pflichtsatz-Play + Dial-Aufbau bis Bein-answered). Gebuchte Dauer selbst nicht gelesen (kein Log, keine Prod-DB) -> OFFEN.
Owner-Hoereindruck (E19/M19): "richtige Stimme, Niveau wie Outbound" -> GRUEN.

## Schritt 12 - Outbound-Kontrollanruf `call_mu2dot7pivaj` (M6)

| Zeit (UTC) | Beleg | Ergebnis |
|---|---|---|
| 07:56:45.159 | `[audit] place_call … call=call_mu2dot7pivaj provider=telnyx` | - |
| 07:56:45-07:57:27 | keine `[el-init]`-Zeile (einzige `[el-init]` seit 07:05: 07:09:12 zwei Ablehnungen `grund=token` / `kein_wartender_anruf sip_headers=fehlt` = Werkzeug-Probe beleg-init nach Schritt 10, sowie 07:54:16 Inbound) | GRUEN (M6) |
| 07:57:26.924 | `[el-tags] marken=[fröhlich]` - Agent sprach Klammerausdruck | Bestand (11.09., 12.09., 13.09. gleiche Zeile) |
| 07:57:27.169 | `[sms] … 40305` | ROT, Bestand |
| 08:0x | `conversation-beleg --richtung=outbound --seit=2026-09-15T07:56:00Z` | GRUEN: `conv_7001m2j12zv7fdh9nzpyvwf017nj`, direction outbound, status done, call_duration_secs 20; inbound_situation vorhanden ja, == "" ja; tenant_token vorhanden, leer nein, Laenge 64; sip_hermes_call_binding nein; uebrige Schluessel = die 14 Vorher-Variablen (iel-r1-fakten.md 3) + system__*; erste Agent-Zeile = Owner-Outbound-Eroeffnung ("Hallo Antonio, hier ist dein KI-Assistent …") |
| 08:0x | `list_calls`/`get_transcript` | GRUEN: completed mit Summary (englisch, wie Bestand); objective_achieved false (Hinweis, nicht IEL) |

## Schritt 13 - Nachlese

- F-D-Inbound (detail_records Kindbein-Typen): OFFEN. `iel-mess.mjs N-D` liest nur Kennungen aus der Nachdeploy-Ergebnisdatei (N1/N2), nicht die Owner-Session, und schreibt eine Ergebniszeile -> nicht ausgefuehrt. Telnyx-MCP nicht verbunden (401).
- Buchung/Kostenprofil `TELNYX_INBOUND_EL_CONVAI` am Call: OFFEN (kein Log, keine Prod-DB). Indiz: keine `[kostenprofil] fehlt`-Zeile.
- Kosten-/reconcile-/sweep-Log seit 07:54: keine Zeilen (reconcile loggt im Erfolgsfall nicht; Sweep ggf. noch in COST_TRUING_DELAY).
- Fehler/Warnungen seit 07:05 mit IEL-Bezug: nur `[join-schluessel] verworfen` (07:55:18). Sonst Boot-Bestandswarnungen (PLAY_TTS, Tarifpaar zu wenig Proben inkl. route=telnyx_inbound_el_convai), `[sms] 40305` (Bestand), `[el-tags]` (Bestand).

## Befunde Verifikation

1. `[join-schluessel] verworfen grund=keine_telnyx_sip_call_id` je IEL-Inbound-Anruf (`src/elevenlabs/outbound.js:1098` -> `src/store/state-ops.js:1072`): EL liefert fuer den Telnyx-Dial-Weg eine UUID als `phone_call.call_id`. Waechter wirkt korrekt (sipCallId bleibt null); Profil TELNYX_INBOUND_EL_CONVAI hat keinen TELNYX_SIP-Traeger. Einschaetzung: erwartete Abweichung mit Fehler-Log-Rauschen auf jedem Inbound-EL-Anruf; Kostenjoin des Dial-Kindbeins haengt an F-D (offen).
2. `[el-init] gebunden` ohne ms-seit-Dial (`src/routes/webhooks-elevenlabs-init.js:172`): Messluecke gegen Runbook-Wortlaut, Latenz aus Zeitstempeln ableitbar.
3. `[sms] 40305 Invalid 'from' address`: Bestandsdefekt (US-DID nicht SMS-faehig), nicht IEL.
4. Gebuchte Dauer, Kostenprofil, F-D-Inbound: OFFEN (Messluecke ohne Prod-DB/Telnyx-Lesezugang).
