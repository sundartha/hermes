# To-Do: Umbenennung vodafone-agent -> Sundartha (Planung)

> Erstellt 2026-06-20. Reine **Planung**, keine Umsetzung. Quelle: vollstaendiger
> `grep -rin vodafone`-Scan des echten Repos (Worktrees `.claude/worktrees/*`
> ausgenommen = Temp). Konvention: Deutsch ohne Umlaute. Workflow.md Regel 7: jedes
> Item traegt Soll-Ergebnis + Verifikation.

## Kern-Erkenntnis: ZWEI Risiko-Klassen, strikt trennen

Die Umbenennung ist **kein** einziges Find-and-Replace. Sie zerfaellt in:

- **Track A — Code/Doc-Rebrand (autonom, NULL Runtime-Risiko, kein externer Hang).**
  Interne Identifier, Banner, Kommentare, Dashboard-Texte, Doku. Offline test- und
  smoke-verifizierbar.
- **Track B — Infra/URL-Cutover (owner-koordiniert, HOCH-RISIKO, nicht autonom).**
  Aendert die oeffentliche URL und reisst damit live Telefonie + OAuth, wenn nicht
  gleichzeitig in allen externen Systemen nachgezogen.

**Pre-Mortem-Leitsatz:** Track B darf NIE im Alleingang/halb passieren. Ein Wechsel der
public URL ohne synchrone Nachfuehrung in Twilio/Telnyx/WorkOS/claude.ai = tote
Webhooks (kein Anruf kommt durch) UND 401 am MCP-Connector (OAuth-Resource passt
nicht). Empfehlung: **eigene Brand-Domain** als stabile Indirektion (s. Owner-
Entscheidung #2), damit der Render-Service-Name nie wieder die Brand-URL bestimmt.

---

## Owner-Entscheidungen ZUERST (blockieren Teile der Umsetzung)

> **ENTSCHIEDEN 2026-06-20 (Owner):**
> - **#1 Name = `Hermes`** — Produkt-/Agent-/MCP-Server-Name. Im Code/Disclosure hart
>   verdrahtet (NICHT "Sundartha"). Neue Disclosure: „hier spricht der KI-Assistent Hermes
>   im Auftrag von {Owner}." (bleibt erster, fest verdrahteter Satz, Regel 2).
> - **#2 Brand:** **Sundartha = Unternehmen** (`sundartha.com`); **Hermes = Produkt davon**.
>   Domain-Cutover = Track B.
> - **#3 Repo-Rename: ja → `hermes-call-mcp`** (Track B).
> - **#4 Timing:** **Track A jetzt; Track B später** (koordinierter Cutover, kein Alleingang).
> - **Migrations-Hinweis:** agentName-Default-Wechsel wirkt nur auf NEUE Tenants —
>   bestehende Owner-Tenants ggf. aktiv auf "Hermes" migrieren, damit System-Prompt und
>   die (hart verdrahtete) Disclosure konsistent sind.

- [ ] **#1 Assistent-Name (`agentName`-Default, `src/store/defaults.js:128` = "Vodafone
      Agent").** Das ist der Name, den der Agent am Telefon ueber sich sagt ("Du bist
      {agentName}..."). Optionen: (a) "Sundartha", (b) ein anderer (menschlicherer)
      Name, (c) unveraendert lassen (per-Tenant ueberschreibbar). **Migration:** bereits
      gespeicherte Tenants (json/pg) behalten ihren Wert — ein Default-Wechsel wirkt nur
      auf NEUE Tenants, ausser man migriert aktiv. Coupling: 4 Tests pinnen den String
      (s. Track A.4).
- [ ] **#2 Brand-URL-Strategie.** (a) **Eigene Domain** (z.B. `api.sundartha.de` /
      `sundartha.app`) auf den Render-Service zeigen lassen -> externe Configs
      referenzieren die Domain, entkoppelt vom Render-Namen (EMPFOHLEN, brand-stabil
      fuer Skala). (b) Nur neuer `*.onrender.com`-Subdomain via Service-Rename. (a)
      macht kuenftige Infra-Umzuege schmerzfrei.
- [ ] **#3 GitHub-Repos umbenennen?** origin `Antonio20045/vodafone-agent` +
      upstream `jonas986/vodafone-agent`. GitHub leitet alte URLs weiter, ABER Render
      deployt **upstream/jonas986** ([[deploy-repo-split]]) -> bei Rename die
      Render-Repo-Verknuepfung re-pointen + lokale Remotes aktualisieren. Owner haelt
      beide Repos.
- [ ] **#4 Timing/Owner-Zugriff Track B.** Render-Dashboard, WorkOS, Twilio- und
      Telnyx-Portal sind Owner-Schritte. Cutover in einem Low-Traffic-Fenster, mit
      Rollback (alte Config) bereit.

---

## ZU VERIFIZIEREN (nicht raten — Owner/Doku pruefen, bevor Track B startet)

- [ ] Ist ein Render-Service **in-place umbenennbar**, oder zieht der `.onrender.com`-
      Subdomain einen **neuen Service** nach sich? (Render-Doku/Dashboard pruefen.) Falls
      neuer Service noetig: DNS/Custom-Domain-Cutover statt Rename.
- [ ] WorkOS-Konfig auslesen: aktueller **Resource Indicator** (`.../mcp`) +
      **Redirect-URIs** (`.../auth/callback`) + Allowed Origins (heute
      `https://vodafone-agent.onrender.com`, belegt in `PLAN-SECURITY.md`/`tasks/todo.md`
      OAuth-Block).
- [ ] Twilio-Nummer-Webhook ("A call comes in") + Telnyx-TeXML-App-Webhook: aktuelle
      Ziel-URLs im Portal bestaetigen.

---

## Track A — Code/Doc-Rebrand (autonom, niedriges Risiko)

Soll-Ergebnis Gesamt: kein `vodafone` mehr in user-sichtbaren Strings/internen
Identifiern (ausser bewusst belassenen); `npm test` gruen, `node --check` sauber,
lokaler Smoke zeigt neuen Namen. Verifikation: `grep -rin vodafone src/ scripts/
public/ test/` -> nur bewusste Rest-Treffer; `npm test`; Dashboard-Smoke.

- [ ] **A.1 package-Identitaet.** `package.json:2` `name: "vodafone-agent"` ->
      `"sundartha"`. (Nur interner npm-Name, kein externer Hang.)
      Verif.: `node --check`, `npm test` laeuft (Name wird nirgends als Schluessel genutzt).
- [ ] **A.2 MCP-Server-Name (client-sichtbar).** `src/server.js:1056` +
      `src/mcp-server.js:11` `new McpServer({ name: "vodafone-agent" })` -> `"sundartha"`.
      HINWEIS: dieser Name erscheint im claude.ai-Connector. Niedrig-Risiko, aber sichtbar.
      Verif.: MCP-Smoke (Tools laden), Name im Banner.
- [ ] **A.3 Banner/Realm/Kommentare (rein kosmetisch).** `src/server.js:220`
      (`WWW-Authenticate realm="Vodafone Agent"`), `:1115` Start-Banner; `src/mcp-server.js:16`
      `[vodafone-agent]`; `scripts/check-setup.js:14` Setup-Banner; `src/mcp-tools.js:151`
      Kommentar "Vodafone-Demo". -> "Sundartha".
      Verif.: `node --check`, `npm run check` laeuft, Banner zeigt neuen Namen.
- [ ] **A.4 `agentName`-Default (NUR wenn Owner #1 = aendern).**
      `src/store/defaults.js:128` "Vodafone Agent" -> gewaehlter Name. MIT mitziehen:
      `test/i6-write-scope.test.js:35`, `test/tenant-erasure.test.js:56`,
      `test/store-pg-rls.test.js:163`, `test/helpers.js:123` (alle pinnen den String).
      Migration bestehender Tenants gemaess #1 entscheiden.
      Verif.: `npm test` gruen (Tests auf neuen Wert), Outbound-Smoke spricht neuen Namen.
- [ ] **A.5 Dashboards (user-sichtbar).** `public/index.html` (`:6` Title, `:136`
      "Vodafone Business Demo", `:145` Badge "Vodafone Verified" -> entfernen/umbenennen
      [Marken-Claim!], `:221/:223` MCP-Config-Beispiel mit `"vodafone-agent"` + Pfad),
      `public/tenant.html` (`:6` Title, `:104` "Vodafone Business Demo").
      Verif.: Dashboard-Smoke (Titel/Branding korrekt), `/api/state`-Poll unveraendert.
- [ ] **A.6 Doku-Text (Bulk, aber kein URL-Cutover hier).** `README.md`, `ONBOARDING.md`,
      `PLAN-SECURITY.md`, `docs/RUNBOOK-OPERATOR.md`, `STATUS.md`, `tasks/*`. **ACHTUNG:** Doku-Stellen, die die LIVE-URL
      (`vodafone-agent.onrender.com`) nennen, NICHT hier aendern, sondern **im Lockstep
      mit Track B** (sonst Doku falsch in die andere Richtung). Reine Produktnamen-
      Nennungen jetzt; URL-Nennungen spaeter.
      Verif.: `grep -rin "vodafone" --include='*.md'` -> nur bewusste/historische Reste.
- [ ] **A.7 Test-Fixtures (optional, kosmetisch).** `test/web-auth.test.js`
      `admin@vodafone.de` -> z.B. `admin@sundartha.de` (reine Fixture, kein Verhalten).
      Verif.: `npm test`.

> Bewusst NICHT in Track A: `render.yaml:5` (Service-Name = URL-Identitaet -> Track B).

---

## Track B — Infra/URL-Cutover (owner-koordiniert, hoch-Risiko)

Soll-Ergebnis: Neue stabile Brand-URL aktiv; live Inbound+Outbound-Call funktioniert;
OAuth-Login + claude.ai-Connector laden Tools; `[boot]`-Banner zeigt neuen Service.
Verifikation: Live-Smoke (s.u.) NACH jedem externen Update.

- [ ] **B.1 Brand-URL bereitstellen** (gemaess Owner #2): Custom-Domain an den Render-
      Service haengen ODER Service-Rename/neuer Service (gemaess Verifikations-Punkt).
      `render.yaml:5 name` ggf. anpassen; `PUBLIC_URL` explizit auf die Brand-Domain
      setzen (statt sich auf `RENDER_EXTERNAL_URL` zu verlassen, `config.js:97`) ->
      entkoppelt die App-URL vom Render-Namen.
- [ ] **B.2 Twilio-Portal:** Nummer-Webhook "A call comes in" -> `{BRAND_URL}/voice/incoming`,
      Status-Callback -> `{BRAND_URL}/voice/status`.
- [ ] **B.3 Telnyx-Portal:** TeXML-App-Webhook-URL -> `{BRAND_URL}/voice/...`.
- [ ] **B.4 WorkOS:** Resource Indicator -> `{BRAND_URL}/mcp`; Redirect-URI ->
      `{BRAND_URL}/auth/callback`; Allowed Origins -> `{BRAND_URL}`.
- [ ] **B.5 claude.ai-Connector:** MCP-Connector auf `{BRAND_URL}/mcp` umstellen
      (OAuth-Flow neu durchlaufen).
- [ ] **B.6 Git (gemaess Owner #3):** Repos umbenennen; **Render-Repo-Verknuepfung
      re-pointen** (deployt upstream/jonas986!); lokale Remotes `git remote set-url`.
- [ ] **B.7 Doku-URLs nachziehen (Lockstep mit B.1):** alle `vodafone-agent.onrender.com`
      in README/ONBOARDING/RUNBOOK/PLAN-SECURITY -> Brand-URL.
- [ ] **B.8 Lokaler Repo-Ordner** `.../MCP/vodafone-agent` -> `.../MCP/sundartha`
      (rein lokal/kosmetisch; Pfade in Editor-/MCP-Configs nachziehen, vgl.
      `public/index.html:223`-Beispielpfad).

---

## Pre-Mortem (ein Jahr spaeter, der Rebrand hat Schaden gemacht)

| Risiko | Szenario | Gegenmassnahme |
|---|---|---|
| **Tote Webhooks** | URL geaendert, Twilio/Telnyx zeigen auf alte URL -> kein Anruf kommt durch | B.2/B.3 synchron mit B.1; Live-Inbound-Smoke direkt danach |
| **OAuth-Bruch** | Resource Indicator/Redirect passt nicht -> MCP-Connector 401, Login kaputt | B.4+B.5 zusammen; OAuth-Login + Connector-Smoke |
| **Render-Rename unmoeglich** | Service nicht in-place umbenennbar -> halber Cutover | VORHER verifizieren; sonst Custom-Domain/neuer Service |
| **Deploy-Repo falsch** | Render deployt upstream -> Rename ohne Re-Point = kein Deploy live | B.6 inkl. Render-Verknuepfung; `[boot]`-SHA pruefen [[deploy-repo-split]] |
| **agentName-Drift** | Default geaendert, bestehende Tenants behalten alten Namen | #1 Migration bewusst entscheiden; Tests mitziehen (A.4) |
| **Doku-URL-Drift** | Doku-URL vor/nach Cutover inkonsistent | B.7 im Lockstep mit B.1, nicht in Track A |
| **Marken-Claim** | "Vodafone Verified"-Badge bleibt -> falsche Markenaussage | A.5 entfernt/ersetzt den Badge |

## Empfohlene Reihenfolge

1. Owner-Entscheidungen #1-#4 + Verifikations-Punkte klaeren.
2. **Track A komplett** (autonom, sofort, `npm test`-gruen) — ausser A.6-URL-Nennungen.
3. **Track B** als EIN koordinierter Cutover (Low-Traffic-Fenster): B.1 -> B.2-B.5
   parallel nachziehen -> Live-Smoke -> B.6/B.7/B.8.
4. **Live-Smoke (Gate):** ein Owner-Allowlist-Inbound + -Outbound-Call gegen die
   Brand-URL, OAuth-Login, claude.ai-Connector laedt Tools, `[boot]`-Banner = erwarteter
   Commit. Erst dann gilt der Rebrand als durch.

## Hinweis: nicht betroffen
- `OWNER_NAME` (Jonas) + `disclosureSentence` nutzen den Besitzer-Namen, NICHT die
  Marke -> vom Rebrand unberuehrt (Regel 2 bleibt).
- `.claude/worktrees/*`-Treffer sind Temp-Worktrees, kein echter Repo-Stand.
