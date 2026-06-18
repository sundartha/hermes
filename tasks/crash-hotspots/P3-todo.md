# P3 — Realtime-Audio-Haertung (OT-2) — Working-Todo

> Branch `feat/crash-p3-audio-hardening` off master (4254939, P0+P6+P1).
> Disjunkt von P1/P2 (nur `bridge.js` + `telephony/adapters/twilio/media.js`, KEIN `server.js`).
> Working-Todo P3-scoped gehalten (nicht `tasks/todo.md`), damit kein Merge-Konflikt mit dem
> parallelen P2-Worktree entsteht. Baseline gemessen: 478 pass / 0 fail.

## Deterministische Ziele + Verifikation (Pflicht, workflow.md Regel 7)

| # | Task | Erwartetes, pruefbares Ergebnis | Verifikation (Befehl) |
|---|---|---|---|
| 1 | T-P3-01 RED→GREEN: malformter Twilio-`start`-Frame | `twilioMedia.parseMediaFrame({event:"start"})` wirft NICHT, liefert `{event:"start",streamRef:undefined,callId:undefined,streamToken:"",providerCallRef:undefined}` | `node --test test/media-transport.test.js` -> neuer Test gruen, Bestand gruen |
| 2 | T-P3-03 RED→GREEN: `canSend`-Vorbedingung | `canSend({readyState:WebSocket.OPEN})===true`; `readyState` 0/2/3 / `null` / `undefined` -> `false` | `node --test test/bridge-hardening.test.js` -> gruen |
| 3 | Provider-Handler-Regression (AC2/AC4 System-Contract): malformter `start` ueber `/media` | child-stdout enthaelt `unbekannte call_id, trenne` (hardened Pfad hat das Frame sauber verarbeitet) UND NICHT `[guard] uncaughtException` (kein Throw entkommt zum P0-Backstop) | `node --test test/bridge-hardening.test.js` -> gruen; RED auf master = `[guard] uncaughtException` / Timeout |
| 4 | AC3 Impl: `readyState`-Guard an `bridge.js` :141/:167-171 + :225 via `canSend` | 4 Call-Sites nutzen `canSend(openaiWs)`; keine Magic-Number `1` | `node --check src/bridge.js` + grep |
| 5 | AC1/AC2 Impl: aeusserer try/catch um beide `message`-Handler-`switch` | innerer `JSON.parse`-catch unveraendert; catch-Body loggt secret-frei (`e?.message`), nie leer | `node --check src/bridge.js` |
| 6 | AC4 Impl: `twilio/media.js` `msg.start` -> `msg.start?.` (4 Derefs) | wohlgeformte Frames byte-identisch (T-P3-02 Regression gruen) | `node --check src/telephony/adapters/twilio/media.js` + `node --test test/media-transport.test.js` |
| 7 | Gesamt-Suite | `478 + neue` pass, 0 fail; `media-transport`/`media-token` unveraendert gruen | `npm test` |
| 8 | PLAN-SECURITY.md: P3-Eintrag (Prozess-Survival-Haertung Audio-Pfad) | Abschnitt vorhanden, Gates explizit als unangetastet vermerkt | Review |

## Bewusste Grenze (ehrlich dokumentiert)

- **AC1 (OpenAI-`message`-Handler) hat KEINE Offline-Unit-Isolation in dieser Phase.** Der
  OpenAI-WS waehlt AUSwaerts (`wss://api.openai.com`), ist im gespawnten Server nicht injizierbar,
  und der Handler ist eine Closure ohne Seam. Der Plan (T-P3-04 Hinweis) bietet Weg (a) Extract /
  (b) kein Extract; Hand-off mandatiert **(b)** — Extract erst in P4. AC1 ist daher abgedeckt durch:
  (1) den additiven try/catch (symmetrisch zu AC2), (2) den manuellen Real-Call-Smoke (Pflicht-Gate).
- **Manueller Real-Call-Smoke (5 Szenarien, HEIKLE STELLE)** ist nicht automatisierbar (echte
  Telefonie, Kosten) -> **kann ich nicht selbst ausfuehren** -> Gate fuer Jonas geparkt.

## Fortschritt

- [x] 1 T-P3-01 RED gesehen (`TypeError: ...reading 'streamSid'`) -> GREEN
- [x] 2 T-P3-03 RED gesehen (`SyntaxError: ...no export named 'canSend'`) -> GREEN
- [x] 3 Provider-Integration RED gesehen (`[guard] uncaughtException: TypeError ...'streamSid'`, waitForLog-Timeout 4188ms) -> GREEN (200ms)
- [x] 4-6 GREEN-Impl (canSend @4 Call-Sites, 2x try/catch, twilio `?.`)
- [x] 7 `npm test` 481 pass / 0 fail (478 + 3)
- [x] 8 PLAN-SECURITY.md P3-Abschnitt
- [x] `node --check` bridge.js + twilio/media.js OK
- [ ] **Manueller Real-Call-Smoke (Jonas-Gate, BLOCKER vor Merge)** — echte Telefonie/Kosten, von mir nicht ausfuehrbar
- [ ] rebase auf master + merge (erst NACH Smoke)

## Review (Endstand)

- **TDD eingehalten:** 3 neue-Verhalten-Tests zuerst RED gesehen, dann GREEN. canSend +
  T-P3-01 als reine Offline-Unit; Provider-Handler als System-Integration (gespawnter Server,
  malformter `start` ueber `/media`, Diskriminator = `[guard] uncaughtException` fehlt + positiver
  `unbekannte call_id, trenne`-Pfad-Log via `waitForLog`).
- **Verhaltens-Erhaltung bewiesen:** `git diff -w` zeigt im `switch`-Body NUR die drei
  `canSend`-Guards (sonst nur Whitespace + Wrapper/Kommentare) -> Logik byte-identisch. Bestehende
  Charakterisierungs-Tests (`media-transport` well-formed, `media-token`) unveraendert gruen.
- **HEIKLE STELLE:** rein additiv (aeusserer try/catch + readyState-Guards). Keine Logik-Umstellung,
  keine Reihenfolge-Aenderung, keine neuen Timer. `execTool` laeuft weiter UNbedingt, nur der Send
  ist geguarded.
- **Bewusste Grenze (ehrlich):** AC1 (OpenAI-Handler) ohne Offline-Unit-Isolation — Weg (b) gewaehlt
  (kein Extract in der HEIKLEN STELLE, P4-Decomposition), abgedeckt durch try/catch-Symmetrie + Smoke.
- **CLAUDE.md-Gates unberuehrt:** Allowlist/Budget/Max-Dauer/Signatur/Offenlegungssatz nicht angefasst.
- **Geaenderte Files:** `src/bridge.js`, `src/telephony/adapters/twilio/media.js`. Tests:
  `test/bridge-hardening.test.js` (neu) + `test/media-transport.test.js` (T-P3-01). Doku:
  `PLAN-SECURITY.md`, dieses `P3-todo.md`. KEIN `server.js` -> disjunkt von P1/P2.
