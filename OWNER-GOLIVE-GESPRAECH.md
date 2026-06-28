# Owner-Checkliste — MCP live nehmen + Gespraechs-Live-Gates (G2/G3) abnehmen

> Fuer Jonas (Owner). Stand 2026-06-28. Sprache ohne Umlaute (Repo-Konvention).
> Diese Schritte kann Claude NICHT selbst: sie brauchen Render-Dashboard-Zugang,
> einen statischen Bearer-Token im MCP-Client und ECHTE Test-Anrufe (Kosten).

## Worum es geht (Kontext in 4 Saetzen)

Die Gespraechsqualitaets-Kette **G0-G4** (PLAN-CONVERSATION-QUALITY.md) ist **code-fertig auf
master + live abgenommen** (`npm test` = 1172 gruen). **Live-Gates am 2026-06-28 BESTANDEN:**
G2 (kein 15-Sekunden-Loch nach der Offenlegung) und G3 (kein abgeschnittenes STT-Fragment). Das
Runbook unten (Block A-F) bleibt fuer Re-Tests / kuenftige Tenants. G4 (Log-Cleanup + Reprompt)
ist auf deinen Wunsch vorgezogen + gemergt.

## Harte Fakten (nicht verwirren lassen)

| Punkt | Wert |
| --- | --- |
| Render-Service | `vodafone-agent`, id `srv-d8m0fhflk1mc73bno570`, **dashboard-managed** (Env im Dashboard, NICHT render.yaml) |
| MCP-URL | `https://app.sundartha.com/mcp` |
| Live-Engine | `budget` (turn-basiert, Gather/STT), Provider `telnyx`, Sprache `de-DE` |
| Deploy | LIVE nur ueber upstream (jonas986) + autoDeploy auf Commit; Env-Aenderung im Dashboard loest Redeploy aus |
| Live-Stand pruefen | Boot-Banner `[boot] deployed commit=...` in den Render-Logs |

---

## BLOCK A — MCP auf Legacy-Token schalten (Render-Dashboard)

Der claude.ai-App-OAuth-Flow scheitert an WorkOS (`invalid_target`). Schneller Weg fuer dich:
Legacy-Bearer-Token + **Claude Code/Desktop** (die claude.ai-Web/Phone-App kann KEINEN
statischen Bearer schicken).

**A1.** Render-Dashboard -> Service `vodafone-agent` -> Environment.

**A2.** Setze `MCP_AUTH` auf **LEER** (Wert komplett loeschen, Variable behalten).
- Wirkung: `auth.js` faellt vom OAuth-Pfad auf die statische Bearer-Pruefung (`config.mcpAuthToken`).

**A3.** Pruefe, dass `MCP_AUTH_TOKEN` einen Wert hat (ist bereits generiert). Wenn leer:
einen langen Zufallswert setzen (z.B. `openssl rand -hex 32` lokal erzeugen). **Diesen Token
brauchst du in Block C** — nicht weitergeben, nicht committen, nicht loggen.

**A4.** Speichern -> Render deployt neu. Warten bis "Live".

**Verify A:**
- Render-Logs zeigen einen frischen `[boot] deployed commit=...`.
- `curl -s -o /dev/null -w "%{http_code}" https://app.sundartha.com/mcp` ohne Header -> **401**
  (kein Token = abgewiesen = fail-closed korrekt).
- `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer <MCP_AUTH_TOKEN>" -X POST https://app.sundartha.com/mcp` -> **nicht** 401 (200/4xx je nach Body, aber Auth passiert).

---

## BLOCK B — Bootstrap-Tenant braucht einen Auftraggeber-Namen (sonst 403)

**Warum kritisch:** Im Legacy-Modus mappt MCP ohne Identitaet auf den **Owner/Bootstrap-Tenant**
(der die aktive Nummer haelt). Seit **G1** sperrt der Outbound-Gate (`server.js:1094`) jeden
Anruf mit **403 "Kein registrierter Auftraggeber-Name"**, wenn dieser Tenant keinen `ownerName`
gesetzt hat. `scripts/bootstrap-tenant.js` setzt nur die Nummer, **nicht** den Namen.

**B1.** Pruefen, ob der Bootstrap-Tenant einen Namen hat. Im Owner-Dashboard
(`app.sundartha.com/app`) einloggen -> der angezeigte Auftraggeber-/Owner-Name darf nicht leer
sein. (Alternativ in den Render-Logs nach einem fruehen `place_call_denied ... grund=keine_identitaet`
suchen — taucht das auf, fehlt der Name.)

**B2.** Falls leer: Namen setzen ueber die Self-Service-Registrierung des Owner-Tenants
(`POST /api/onboard` mit `firstName` + `lastName` -> `registerTenant`). Im Dashboard ist das
das Registrierungs-/Profil-Formular mit **Vorname** und **Nachname** (zwei Felder, Owner-
Entscheidung §5.1). Beispiel: firstName=`Jonas`, lastName=`Kroh`.
- Offenlegung im Anruf = **voller Name** (`firstName lastName`).
- LLM-Persona im Gespraech = **firstName**.

**Verify B:** Nach dem Setzen liefert ein Outbound-Versuch (Block D) **keinen** 403 mehr.

---

## BLOCK C — MCP-Client verbinden (Claude Code / Desktop)

**C1.** In Claude Code (Terminal):
```
claude mcp add --transport http hermes https://app.sundartha.com/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```
(Claude Desktop: gleicher Server per `mcp-remote` mit `--header`.)

**C2.** Neue Claude-Session starten -> die **Hermes-Tools** muessen auftauchen.

**Verify C (LESEND, kein Anruf, keine Kosten):** Ein read-only Hermes-Tool aufrufen
(z.B. Call-Status/Liste lesen). Kommt eine echte Antwort statt 401 -> Auth + Mapping auf den
Owner-Tenant stehen. Audio laeuft NIE durch MCP — nur Transkripte/Status.

---

## BLOCK D — G2-Live-Gate: kein 15-Sekunden-Loch (echter Test-Anruf)

**Kosten/Sicherheit:** Echter Anruf = echtes Geld. Ziel-Nummer MUSS auf der **Allowlist**
(`ALLOWED_NUMBERS`) stehen — nimm deine eigene Handynummer und trag sie dort ein. Der
Offenlegungssatz ist fest verdrahtet und kommt als ERSTER Satz. Budget-Gate `MAX_BUDGET_EUR`
bleibt scharf.

**D1.** Eigene Handynummer in `ALLOWED_NUMBERS` (Render-Env) sicherstellen.

**D2.** Ueber das Hermes-MCP einen Outbound-Call an deine Nummer ausloesen, mit einem klaren
Auftrag (`goal`), z.B. *"Frag nach den Oeffnungszeiten am Samstag"*.

**D3.** Annehmen und ZUHOEREN.

**Verify D (das ist der Gate):**
- **Hoerbar:** Direkt nach der Offenlegung sagt der Agent im **selben** Atemzug sein Anliegen
  (das `goal`) — **kein ~15s Stille-Loch** mehr davor.
- **Wichtig (Outbound-Semantik):** Der ERSTE Turn ist der Agent — er spricht zuerst
  (Offenlegung+Anliegen), also `heard=0`/`SpeechResult=0` BY DESIGN, das ist KEIN Fehler. Das
  G2-Signal ist: KEINE Stille vor dem ersten Agenten-Satz, und der Satz enthaelt hoerbar
  Offenlegung+Anliegen. Die erste Antwort des Angerufenen (`SpeechResult>0`) erscheint im
  Transkript erst auf einem SPAETEREN Turn. (Die `[turn-recv]`-Diagnose-Logs sind mit G4
  entfernt; Abnahme per Gehoer + Transkript.)
- Notiere: Anruf-Id + ob das Loch weg ist (ja/nein).

---

## BLOCK E — G3-Live-Gate: kein abgeschnittenes STT-Fragment

**E1.** Im selben (oder einem zweiten) Test-Anruf einen Satz **mit kurzer Denkpause in der
Mitte** sprechen, z.B. *"Ich haette gerne einen Termin ... am Donnerstag bitte"*.

**Verify E (das ist der Gate):**
- Der Agent reagiert auf den **ganzen** Satz, nicht nur auf das erste Fragment (frueher kam
  z.B. nur "geht" statt des kompletten Satzes).
- Im Dashboard-Transkript: der erfasste Satz ist vollstaendig, nicht nur das erste Wort/Fragment.
- **Latenz** subjektiv akzeptabel (kein neues, langes Warten durch das feste STT-Fenster).

**Tuning ohne Code:** Der Stille-Timeout ist `STT_SPEECH_TIMEOUT_SEC` (Render-Env, Default **2**).
- Schneidet immer noch zu frueh ab -> Wert leicht erhoehen (z.B. 3).
- Fuehlt sich traege an -> Richtung 1-2 senken.
- Wirkt nur auf die **Folge-Gathers**; der Outbound-Erst-Gather bleibt bewusst auf `auto`
  (sonst kaeme das G2-Loch zurueck).

---

## BLOCK F — Ergebnis zurueck an Claude

Wenn **D und E gruen** sind (Loch weg + voller Satz), melde Claude:
- Anruf-Id(s), ob G2-Loch weg, ob G3-Satz vollstaendig, finaler `STT_SPEECH_TIMEOUT_SEC`-Wert.

**G4 ist bereits umgesetzt** (TEMP-Diagnose-Logs entfernt + No-Speech-Reprompt verschlankt,
master-Commit `4c94e9d3`, 1172 Tests gruen, noch nicht gepusht) — es bleibt KEIN Code-Rest in
dieser Kette. Die Live-Gates D/E sind die reine Abnahme. Stimmt etwas nicht (Loch wieder da /
Satz abgeschnitten), meldest du es und Claude geht der Wurzel nach (Wurzel statt Symptom).

---

## Sicherheit / Rollback

- **Echte Kosten + echte Menschen:** nur Allowlist-Nummern, Budget-Gate `MAX_BUDGET_EUR`
  scharf lassen, Offenlegungssatz NIE abschalten (fest verdrahtet, Regel 2).
- **Token-Hygiene:** `MCP_AUTH_TOKEN` ist ein Vollzugriff-Bearer auf den Owner-Tenant
  (kann Anrufe ausloesen). Nicht committen, nicht teilen, nicht in Screenshots.
- **MCP wieder zumachen:** `MCP_AUTH` zurueck auf `oauth` setzen -> der statische Token gilt
  nicht mehr, `/mcp` ist wieder OAuth-only (claude.ai-App bleibt bis zum WorkOS-Fix aussen vor).
- **Nicht anfassen (Antonios Revier):** Billing/Stripe, Self-Service/Onboarding, Provisioning,
  die offenen Punkte in NEXT-SESSION-ACCOUNT-MCP.md.

## Offene Abhaengigkeit (falls Block C scheitert)

Brauchst du Hermes in der **claude.ai-Web/Phone-App** (nicht Claude Code/Desktop), geht das erst
nach dem **WorkOS-AuthKit <-> MCP-OAuth-Fix** (`invalid_target` / RFC-8707-`resource`). Das ist
eine eigene Baustelle und blockiert die Live-Gates oben NICHT (die laufen ueber Claude Code).
