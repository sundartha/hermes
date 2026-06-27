# Handoff fuer JONAS — MCP direkt nutzen + Gespraech optimieren (Stand 2026-06-27)

> Prompt fuer Jonas' Claude-Session. Sprache ohne Umlaute (Repo-Konvention).
> Arbeitsteilung: **Antonio macht den Buchungs-/Billing-Flow. Jonas nutzt das MCP und
> optimiert die Gespraechsqualitaet.** -> Billing/Self-Service/Onboarding/Provisioning
> NICHT anfassen (das ist Antonios Revier).

## ZUERST LESEN (Dateien NEU lesen)
1. CLAUDE.md, .claude/refs/workflow.md, .claude/refs/clean-code.md
2. NEXT-SESSION-ACCOUNT-MCP.md  <- Infra-Fakten (dashboard-managed Service, Deploy via upstream,
   Live-Env, Render-MCP-Workspace). Die OFFENEN PUNKTE dort (Idempotenz/Provisioning/Webhook)
   gehoeren Antonio, nicht dir.
3. PLAN-CONVERSATION-QUALITY.md (Gespraechsqualitaet G0-G4) + src/claude.js (Gespraechslogik:
   System-Prompts, Tool-Loop, tenantContext, fest verdrahteter Offenlegungssatz)
4. Echten Live-Stand SELBST pruefen: gh api repos/jonas986/vodafone-agent/commits/master,
   bzw. Boot-Banner [boot] deployed commit=... in den Render-Logs (Render-MCP list_logs).

## TEIL 1 — MCP DIREKT NUTZEN (so wirst du live)

Live laeuft `/mcp` im **OAuth-Modus** (MCP_AUTH=oauth) — und der **claude.ai-App-OAuth-Flow
scheitert** an WorkOS (`invalid_target` = WorkOS lehnt den RFC-8707-`resource`-Parameter ab).
Das zu fixen ist eine eigene Baustelle. **Schneller, funktionierender Weg fuer dich: Legacy-
Token + Claude Code/Desktop.** Dann mappt MCP auf den **Owner/Bootstrap-Tenant, der die aktive
Nummer schon hat** (server.js:1643-1644: kein req.auth -> identity null -> Owner) -> du kannst
sofort Anrufe ausloesen, ohne Provisioning/OAuth.

Voraussetzung (Antonio/Owner setzt das im Render-Dashboard, Service `vodafone-agent`):
- **`MCP_AUTH` auf LEER** setzen (Legacy-Token-Modus). `MCP_AUTH_TOKEN` ist schon generiert.

Dann du (Token aus Render-Env -> Environment -> MCP_AUTH_TOKEN kopieren):
```
claude mcp add --transport http hermes https://app.sundartha.com/mcp \
  --header "Authorization: Bearer DEIN_MCP_AUTH_TOKEN"
```
(Claude Desktop: per mcp-remote mit --header; die claude.ai-Web/Phone-App kann KEINEN
statischen Bearer schicken -> dort braucht es den OAuth-Fix.)

Verifizieren: neue Session -> Hermes-Tools da -> einen Anruf an eine **Allowlist-Nummer**
ausloesen (ALLOWED_NUMBERS). Outbound nutzt die Owner-Nummer (Bootstrap-Tenant). Tools sind in
src/mcp-tools.js definiert (sprechen mit der REST-API). Audio laeuft NIE durch MCP — nur
Transkripte/Status.

## TEIL 2 — GESPRAECH OPTIMIEREN (dein eigentlicher Fokus)

- Live-Engine = **budget** (turn-basiert, Gather/STT), Sprache **de-DE** (empirisch korrekt,
  NIE auf "de" zurueck -> sonst Englisch-Fallback). Die Gespraechslogik sitzt in src/claude.js
  (pro Tenant ueber tenantContext); der resiliente LLM-Seam ist src/llm.js.
- Vorgehen: ueber das MCP echte Test-Anrufe ausloesen, Transkript/Status lesen (MCP-Tool bzw.
  Dashboard), Dialog haerten (Begruessung, Anliegen-im-Erst-Gather, STT-Endpointing/speechTimeout,
  Reprompt, Identitaets-Bindung). PLAN-CONVERSATION-QUALITY.md hat die Forensik + G0-G4-Schritte;
  pruefe, was davon schon LIVE ist (Test-Anruf), bevor du etwas aenderst ("nie raten").
- Jede Aenderung an der Gespraechslogik = nicht-trivial: node:test-Test + Smoke; Telefonie-Bugs
  lassen sich lokal ohne echten Anruf reproduzieren (SKIP_TWILIO_SIGNATURE_CHECK=true + curl auf
  /voice/*). Der Offenlegungssatz bleibt fest verdrahtet (Regel 2) — nie abschalten.

## LEITPLANKEN
- **NICHT anfassen (Antonios Revier):** Billing/Stripe, Self-Service/Onboarding, Provisioning,
  die offenen Punkte aus NEXT-SESSION-ACCOUNT-MCP.md.
- Safety-Gates (Allowlist/Denylist/Land/Budget/Max-Dauer/Signatur) + Offenlegungssatz NIE
  aufweichen. Neue config-Var -> BASE_ENV (test/helpers.js) nachziehen.
- Deploy live nur ueber upstream (autoDeploy auf Commit); Push erst nach Owner-OK; Live-Commit
  per Boot-Banner pruefen. Secrets/Token nie loggen/committen.
- Service ist dashboard-managed -> Env setzt der Owner im Dashboard, nicht via render.yaml.
