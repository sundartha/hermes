# Report — Phase telnyx-p9 (Engine-Flag/Selektion: Audit + Flag-Matrix)

**Stand:** 2026-07-08 · **Branch:** `phase/telnyx-p9-flag-matrix` (aus `master`) · **Produktions-Aenderung:** KEINE (`src/` byte-identisch).

## Ergebnis in einem Satz

Der Audit beweist: jede `voiceEngine`-Stelle in `src/` behandelt einen C-Telnyx-Call (`voiceEngine==="budget"`)
korrekt — die Hangup-/ID-Wahl haengt seit P6 an `call.callControlId`-Praesenz (`hangUpAction`), nicht an
`voiceEngine`. P9 ist reine Verifikation: **1 neue Testdatei**, **0 Zeilen Produktionscode**.

## 1. Audit — alle `voiceEngine`-Stellen in `src/`

`git grep voiceEngine master -- src/**` + Gegenprobe `VOICE_ENGINE`/`"realtime"`-Literale (inkl. `bridge.js`):
13 Treffer in 6 Dateien, vollstaendig erfasst.

| # | Datei · Symbol | Art | Erreicht ein C-Telnyx-Call sie? | Verdikt |
|---|---|---|---|---|
| 1 | `config.js:523` · `voiceEngine: process.env.VOICE_ENGINE \|\| "budget"` | Definition | – | n.z. — reine Config-Ableitung, kein Branch |
| 2 | `server.js:1082` · `/voice/incoming`: `if (config.voiceEngine === "realtime")` → `streamDirectives` | Runtime-Branch | Ja (Inbound) | **Korrekt.** C-Telnyx=budget → `false` → faellt in den P8-Branch `inboundAssistantHandoffXml` (Zeile 1091). Kein Realtime-Zweig. |
| 3 | `server.js:1219` · `/voice/outbound`: `if (config.voiceEngine === "realtime")` → `streamDirectives` | Runtime-Branch | Nein | **Korrekt.** C-Telnyx-Origination setzt `webhookUrl=/voice/call-control` (telnyx-origination.js), nie `/voice/outbound`. Handler wird von C-Telnyx nie betreten. |
| 4 | `server.js:1734` · Origination-`else`: `if (config.voiceEngine !== "realtime") armMaxDurationTimer(call, tw.sid)` | Runtime-Branch | Nein | **Korrekt.** Liegt im `else` von `if (config.telnyxAiAssistantEnabled && outboundProvider === PROVIDER.TELNYX)` (Zeile 1709). C-Telnyx nimmt den `if`-Zweig mit eigenem `armMaxDurationTimer(call, null)` (Zeile 1718) — erreicht den `tw.sid`-Arm nie. |
| 5 | `server.js:2442` · `rearmActiveCallTimers`: `if (config.voiceEngine === "realtime") return` | Runtime-Branch | Ja (Boot) | **Korrekt (Befund 1, P6).** C-Telnyx=budget → kein early-return → rearmt via `terminateCappedCall`/`scheduleMaxDurationEnd` → `hangUpAction(voiceControl, call, twilioSid)` waehlt bei gesetztem `call.callControlId` `endCallViaCallControl`, ignoriert das `twilioSid`-Argument. Bereits gepinnt in `telnyx-p6-cap-callcontrol.test.js` (T1/T2/T5) + `telnyx-p6-boot-rearm.test.js` (R1/R2). |
| 6 | `server.js:2522` · Boot-Banner-Log | Kosmetik | – | n.z. — reine Ausgabe |
| 7 | `mcp-tools.js:210/224/645` · `voiceEngine`-Projektion in `get_agent_status` | Display/Schema | – | n.z. — zeigt `config.voiceEngine` an, kein Call-Routing |
| 8 | `routes/api-read.js:65` · `voiceEngine: config.voiceEngine` in `/api/state` | Display | – | n.z. — Projektion, kein Branch |
| 9 | `telephony/call-termination.js:32/38` · Kommentare | Kommentar | – | n.z. — erklaeren bereits, dass `hangUpAction` an `callControlId` (nicht `voiceEngine`) verzweigt |
| 10 | `ui/widgets/agent-status.html:47` · `data-mcp="voiceEngine"` | Display-Binding | – | n.z. — Widget-Anzeige |
| — | `bridge.js` | Realtime-Engine-Impl | Nein | n.z. — enthaelt KEINEN `voiceEngine`-Branch; nur bei `VOICE_ENGINE=realtime` erreicht |

**Fazit:** Die einzigen echten Laufzeit-Branches sind #2–#5. Alle vier sind unter "C-Telnyx ⇒ budget" korrekt;
keine Stelle schickt einen C-Telnyx-Call durch einen falsch-behandelnden `voiceEngine`-Zweig (insbesondere kein
TeXML-Hangup mit `twilioSid` statt `callControlId`). Erwartung bestaetigt: keine Produktions-Aenderung.

## 2. Orthogonalitaets-Randbefund → P10-Carryover (nicht in P9 gefixt)

Die Korrektheit von #2 (`/voice/incoming`) haengt an der Invariante **C-Telnyx ⇒ `voiceEngine="budget"`**. Wird
**gleichzeitig** `VOICE_ENGINE=realtime` UND `TELNYX_AI_ASSISTANT_ENABLED=true` gesetzt, greift an
`/voice/incoming` der Realtime-Guard (`streamDirectives`) VOR dem P8-Handoff-Branch → ein Inbound-Telnyx-Call
liefe in die Realtime-Bridge statt in den Assistant. Das ist eine **Fehlkonfiguration**, kein Fehl-Branch im
P9-Sinn (Befund 1 = falsche Hangup-ID; hier eine unzulaessige Engine-Kombination).

**Carryover fuer P10:** `productionFootguns`/`assertConfig` muss die Kombination
`voiceEngine==="realtime" && telnyxAiAssistantEnabled` fail-closed ablehnen (Boot-Refusal). P9 pinnt bewusst
nur den intendierten `budget`-Betrieb (BASE_ENV `VOICE_ENGINE="budget"`). Hinweis: `tasks/telnyx-chain-carryover.md`
existiert nicht im Git-Tracked-Baum dieses Branches (offenbar nur lokal/untracked beim Owner) — der Carryover
ist deshalb ausschliesslich hier dokumentiert, nicht dupliziert.

## 3. Produktions-Code-Aenderungen

**Keine.** `git diff --stat master -- src/` ist leer. Die Bestandssuite blieb ohne inhaltliche Aenderung gruen.

## 4. Deliverable: `test/telnyx-p9-flag-matrix.test.js`

Vier Tests, orthogonale Komposition **Flag × Provider ueber alle drei Origination-Oberflaechen**
(Outbound `/api/calls`, Inbound `/voice/incoming`, Shim `/v1/chat/completions`) auf je einem laufenden Server:

- **Flag AUS + Telnyx:** Outbound=TeXML (`fake_`), Inbound=`<Gather`, Shim=404.
- **Flag AN + Telnyx:** Outbound=Call-Control (`fake_cc_`), Inbound(Telnyx-Header)=Handoff (kein `<Gather`),
  Inbound(NICHT-Telnyx-Header, **NEU-2**)=`<Gather` (Orthogonalitaet — Provider-Klassifikation ist Header-,
  nicht Flag-getrieben), Shim=403 (erreichbar, fail-closed ohne per-Call-Token).
- **Flag AN + NICHT-Telnyx (Twilio-Owner, NEU-1):** Outbound faellt trotz Flag AN auf TeXML zurueck.
- **Regressions-Lock (Quelltext-Wiring):** `rearmActiveCallTimers` delegiert weiterhin an
  `terminateCappedCall`/`scheduleMaxDurationEnd` (kein inline `endCallViaCallControl`/`endCall`) — sichert
  Befund 1 gegen Drift, ohne die P6-Runtime-Tests zu klonen.

Jede Zelle assertiert nur den groben Pfad-Diskriminator (Praefix-Regex / `<Gather`-Praesenz / HTTP-Status) —
keine Wiederholung der P5/P6/P8-Tiefe (kein Token-Regex, keine exakte `webhookUrl`, keine Budget-/Billing-Cents-
Mathematik). Die Ueberlappung mit P5/P8-Zellen ist eine bewusste, begruendete Breiten-Ausnahme auf
Diskriminator-Ebene (Matrix an einem Ort), keine versehentliche Duplizierung.

### Coverage-Map (was NICHT dupliziert wird)

| Zelle | Bereits gepinnt in |
|---|---|
| Outbound flag-aus+Telnyx → TeXML | `telnyx-p5-origination.test.js` |
| Outbound flag-an+Telnyx → Call-Control | `telnyx-p5-origination.test.js` |
| Inbound flag-aus+Telnyx → Gather | `telnyx-p8-inbound.test.js` |
| Inbound flag-an+Telnyx(+ccid) → Handoff | `telnyx-p8-inbound.test.js` |
| Shim flag-aus → 404 / flag-an → 403 | `telnyx-shim-route.test.js` |
| Boot-Re-Arm C-Telnyx (Befund 1) | `telnyx-p6-cap-callcontrol.test.js` T1/T2/T5 + `telnyx-p6-boot-rearm.test.js` R1/R2 |
| **NEU-1:** Outbound flag-an + NICHT-Telnyx → Bestand | **telnyx-p9-flag-matrix.test.js** (P5 testet nur Telnyx-Owner) |
| **NEU-2:** Inbound flag-an + NICHT-Telnyx (Header) → Bestand | **telnyx-p9-flag-matrix.test.js** (P8 testet nur Telnyx-Header) |

## 5. Safety / Absolute Regeln

Unberuehrt. Der Audit fasst keine Gate-Kette an (`numberGateError`, Budget, Disclosure, Signatur, Auth); das
Flag schaltet weiterhin nur Origination-Art/Inbound-Handoff/Shim-Existenz. Kein Secret in Assertions (Shim-
Zellen pruefen nur Statuscodes, kein Token-Echo).

## 6. Deterministisches Ergebnis

```
node --check test/telnyx-p9-flag-matrix.test.js   → Exit 0, keine Ausgabe
node --test test/telnyx-p9-flag-matrix.test.js    → pass 4, fail 0
npm test                                          → pass 1898 (1894 Baseline + 4 neu), fail 0
git diff --stat master -- src/                    → leer
```

## 7. Verifikation (durchgefuehrt)

- `node --check` auf `test/telnyx-p9-flag-matrix.test.js` → OK.
- `node --test test/telnyx-p9-flag-matrix.test.js` → 4/4 gruen.
- `npm test` (json-Backend Default + pglite-Tests laufen in-process in derselben Suite) → **1898 pass, 0 fail**
  (Baseline vor der Phase: 1894 pass, 0 fail).
- Smoke (best-effort, manueller Boot mit `TELNYX_AI_ASSISTANT_ENABLED=true`): `/healthz` → 200,
  `POST /v1/chat/completions` ohne Token → 403 (Shim erreichbar, fail-closed) — bestaetigt den Flag-Pfad
  unabhaengig von der Testsuite.

## 8. Blast-Radius

1 neue Testdatei (`test/telnyx-p9-flag-matrix.test.js`) + 1 Report-Datei (diese). `src/` = 0 Zeilen geaendert.
