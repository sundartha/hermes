# Next-Session-Prompt: Tenant-/Nummern-Vermehrung schliessen

> Kopiere alles ab "=== PROMPT START ===" in eine FRISCHE Session (nicht in diese hier
> weiterarbeiten — der Kontext ist voll). Der Prompt ist selbsttragend.

=== PROMPT START ===

Du arbeitest an Hermes (`/Users/antonio/Mein Unternehmen/MCP/vodafone-agent`, Node/ESM,
kein Build-Step). Lies zuerst `CLAUDE.md`, dann die Memory-Notizen
`tenant-number-proliferation`, `telnyx-call-control-app-id` und `rca-lessons-timezone-and-fixtures`,
und den vollen Report `tasks/rca-tenant-number-proliferation.md` (PII ist darin bereits redigiert).
Verlass dich NICHT auf diese Zusammenfassung — lies die genannten Quelldateien NEU.

## Das Problem (in einem Satz)

Jeder neue WorkOS-`sub` erzeugt einen bei Null startenden Tenant; aktiviert der ein Abo, kauft
Hermes automatisch eine neue echte Telnyx-DID — und es gibt KEINEN Pfad, der eine Nummer je wieder
freigibt (auch nicht bei Kuendigung oder DSGVO-Loeschung). Ergebnis am 2026-07-10: mind. 3
Tenant-IDs desselben Menschen, 4 aktive US-DIDs, Telnyx-Guthaben nur 3,97 USD.

Belegte Wurzeln (aus dem Code, nicht raten — verifiziere sie selbst neu):
- `src/store/defaults.js:141` `tenantIdForSubject = (sub) => t_${sub}` — Identitaet haengt roh am sub.
- `src/web-auth.js:445-462` `upsertOnFirstLogin` — `ON CONFLICT (id)`, Konfliktschluessel ist die
  tenantId, NIE die Email. `account.email` hat keine UNIQUE-Constraint (`src/db/schema.sql:356-365`).
- `src/store/state-ops.js:1600-1604` `resolveTenant` — matcht nur exakt auf `idp_subject`, kein Fallback.
- `releaseNumber` hat genau EINEN Aufrufer: den Provisioning-FAILED-Rollback (`src/onboarding.js:178`).
  `billing/webhook.js:228-240` (SUSPEND) setzt nur den Status. `eraseTenantData`
  (`state-ops.js:240-275`) laesst `numbers` bewusst unangetastet.

## Diese Arbeit ist NICHT-trivial — halte dich strikt an den Workflow

Das beruehrt Auth/Identitaet UND Kosten-Gates -> automatisch nicht-trivial (CLAUDE.md). Pflicht:
`.claude/refs/workflow.md` lesen, **Plan Mode**, `tasks/todo.md` mit deterministischem
Soll-Ergebnis + Verifikationsmethode PRO Schritt, Subagenten fuer Recherche, dualer Review
(`.claude/refs/clean-code.md`). Bei jeder Entscheidung Pre-Mortem: "ein Jahr spaeter war der Fix
falsch — was ist passiert?"

## Reihenfolge — erst klaeren, dann bauen. NICHT sofort einen Merge-Resolver coden.

### Phase 0 (BLOCKER, zuerst): Warum entstehen ueberhaupt neue subs?
Das ist die einzige offene Kernfrage und sie entscheidet, WO der Fix hingehoert. Der Report konnte
es read-only nicht belegen (WorkOS liegt ausserhalb des Repos). Moeglichkeiten:
- (a) WorkOS mintet pro Connector-Autorisierung / Login-Verfahren einen neuen `user.id` fuer dieselbe
  Person. Dann gehoert der Fix mit an die **WorkOS-/Login-Config**, nicht nur in einen Merge-Resolver.
- (b) Verschiedene Login-Wege (claude.ai-Connector-OAuth vs. Web-Login) liefern verschiedene subs.
- (c) Dieselbe Person nutzt echt verschiedene Accounts.
Vorgehen: WorkOS-Dashboard prüfen (Owner-gated — du kannst per Chrome/Portal nur MIT Owner-Login),
und/oder die Live-DB abfragen: tragen die verschiedenen Tenants dieselbe **verifizierte** Email?
DB-Zugriff: der Owner hat lesende SQL-Abfragen gegen `hermes-db` (`dpg-d8tpesreo5us73bogaig-a`)
frueher freigegeben, aber (1) der Render-MCP-`query_render_postgres` scheitert an TLS
("FATAL: SSL/TLS required"), (2) `psql` von der Owner-Maschine braucht die aktuelle IP in der
Telnyx-DB-... — nein: in der **Postgres**-IP-Allowlist (die Owner-IP hatte sich geaendert). Kläre
mit dem Owner, welchen Zugangsweg er will, BEVOR du DB liest. Die verifizierte-Email-Frage ist die
Vorbedingung fuer Fix 1 — ohne sie ist der Merge blind.

### Phase 1 (Owner-Entscheidungen einholen — VOR Code)
Stell dem Owner per AskUserQuestion diese Punkte (jeder aendert, was du baust):
1. **Merge-Strategie:** Email-basiertes Tenant-Merging NUR bei `email_verified===true`
   (Account-Takeover-Vektor sonst — nicht verhandelbar). Merge-Regel "aeltester Tenant gewinnt".
   Praeventiv (neue Logins) — was mit den 4 BESTEHENDEN Tenants/DIDs (retroaktiv mergen? behalten?
   aufraeumen?)?
2. **DID-Release:** NIE beim ersten payment_failed. Grace-Period + Reconcile-Job/Runbook statt
   Sofort-Delete im Webhook (Telnyx gibt eine released DID nicht garantiert zurueck = Rufnummern-
   Verlust fuer zahlende Kunden). Welche Karenzzeit? Auto oder manuell-bestaetigt?
3. **Scope dieser Session:** nur Fix 1 (Wurzel), nur Fix 2 (Kosten-Bremse), oder beides? (Empfehlung:
   Fix 1 zuerst als eigene Kette — er ist die Wurzel; Fix 2 kann parallel als Reconcile-Runbook laufen.)

### Phase 2+ (Umsetzung, gemäss Owner-Antworten)
Fix-Details mit Datei-Ankern stehen in `tasks/rca-tenant-number-proliferation.md` Abschnitt 6
(Fix 1 Identitaets-Resolver inkl. mehrwertiger sub->tenant-Mapping-Tabelle fuer den MCP-Arm; Fix 2
DID-Release; Fix 3 Mensch-Dimension im Cap + `createCustomer` sendet email/name; Fix 4 Governance).
Baue inkrementell, jede Phase mit Test + dualem Review. Neue Env-Vars an 4 Orten
(`config.js`, `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV — sonst leakt lokales .env
in Spawn-Tests). Migrations für neue Tabellen/Spalten sauber (i8-Lehre: `rowToCall`-Hydration).

## Harte Leitplanken (nicht aufweichen)
- CLAUDE.md Regel 1-7: Safety-Gates (Allowlist/Denylist/Budget/Max-Dauer/Signatur), Offenlegungssatz,
  Auth-fail-closed bleiben unangetastet. Kein Fix darf ein Gate umgehen.
- `email_verified`-Gate (`web-auth.js:321`) NIEMALS aufweichen — es ist die einzige Mitigation gegen
  Account-Takeover. Unverifizierte Email -> KEIN Merge, normaler neuer Tenant.
- DID-Release NIE aggressiv/sofort — Grace + Idempotenz + Status-Recheck + Audit.
- Provider-Fehler: IMMER zuerst das Render-Log lesen, nicht die generische Client-Meldung raten.

## Nebenbaustellen (nur wenn der Owner sie will, nicht ungefragt)
- Telnyx-Guthaben 3,97 USD — der Owner sollte aufladen, sonst HTTP 402 beim naechsten Provisioning.
- `MAX_NUMBERS` ist ein globaler Cap, kein Mensch-Schutz — erst nach Fix 1 sinnvoll neu bewertbar.
- Verwaiste Blank-Assistants + `ai-assistant-*`-TeXML-Apps loeschen (Checkliste im Report Abschnitt 7)
  — ABER `ai-assistant-dcf48d08` (2026-07-09) + TeXML-App `Hermes` (2982643896460248193) NICHT
  anfassen (produktiv bzw. gestagt fuer den laufenden P11-Cutover).
- `src/mcp-tools.js:355` Doku-Bug (verspricht 0-Normalisierung bedingungslos) — separater kleiner Fix,
  NIE `homeCountry` hart auf +49 defaulten (Falschanruf-Risiko).

## Was bereits erledigt ist (nicht nochmal anfassen)
Der 422-Bug (Call-Control-App-ID) ist gefixt und LIVE (`d53eab9`). Der Live-Testanruf durch den Owner
steht noch aus und ist zugleich der P11-Abnahmetest — das ist eine SEPARATE Baustelle, nicht Teil
dieser Session.

=== PROMPT END ===
