# Clean-Code-Stichproben-Audit — 2026-07

6 Sonnet-Auditoren, je eine Schicht, geprueft gegen `.claude/refs/clean-code.md`.
Schwerpunkt: die Fragilitaets-Treiber (Duplizierung G5/S2, Kopplung P2/P4/G22/G31),
weil der Auftrag war: "wir reparieren hier was und woanders geht was kaputt".

## Noten je Schicht

| Schicht | Note | Kern |
|---|---|---|
| Gateway (`server.js` 2679) | C | Gott-Modul; Gate-Kette nur per Kommentar geordnet |
| Persistenz (`state-ops`/`json`/`pg`) | B | Anti-Dupl haelt; aber pg/json-Drift + tote gruene Seeds |
| Conversation/LLM (`claude`/`mcp-tools`/shim) | B | Keine Prompt/Tool-Dupl; aber `bridge.js`-Asymmetrie |
| Config/Auth (`config` 789 / `web-auth` 844) | C | Flaches 100-Key-Gott-Objekt; Auth selbst fail-closed |
| Telephony (ports/registry/adapters) | C+ | Naht sauber INNEN, leckt in `server.js` (7-8 Switches) |
| Billing/Provisioning | B | Geld = Cents (sauber); aber Webhook-Race |

## Kernbefund: NICHT Verlotterung, sondern zwei strukturelle Ursachen

Die Anti-Duplizierungs-Disziplin haelt weitgehend (agentTurn = eine Quelle,
state-ops = eine Quelle, Registry = ein Dispatch, Geld = Cents). Es gibt KEIN
flaechendeckendes Copy-Paste. Das "fix hier / kaputt dort" kommt aus zwei Mustern:

### Ursache A — Ueberwachsene Hubs (Kopplung)
`server.js` (2679 Z.) buendelt: Outbound-Safety-Gates + Provider-Webhook-Parsing
+ Stripe-Webhook-Route + Terminieren/Billing + Onboarding/Provisioning-Drain +
MCP-Endpoint + Boot/Shutdown. `config.js` ist ein flaches ~100-Key-Objekt, das
JEDES Modul importiert. Aenderung in einem Hub zwingt zum Nachdenken ueber alles
andere im selben Scope -> Seiteneffekt woanders wird uebersehen.

### Ursache B — Invarianten per Konvention statt Struktur (G31/G27) — der eigentliche Treiber
Dieselbe Form fand sich in FAST JEDER Schicht unabhaengig:
- **Gateway:** `POST /api/calls` ~280 Z., ~15 Safety-/Geld-Gates, Reihenfolge NUR
  per Kommentar ("Reihenfolge load-bearing") erzwungen. `finishCall`-Idempotenz
  (`billedAt`/`reserveReleased`/`summarySmsSentAt`) wirkt nur, wenn JEDER
  Terminierungspfad durch `finishCall` laeuft — nichts erzwingt das.
- **Conversation:** `handleChatCompletion` 8 Gates per Kommentar-Nummerierung.
  `agentTurn`-Safety-Guards (`suppressEndCall`, `shapeForSpeech`) fehlen in
  `bridge.js` — ein Quality-Fix in agentTurn wirkt NICHT fuer Realtime.
- **Billing:** `applyStripeWebhook` ohne Per-Tenant-Lock (s.u.).
- **Persistenz:** pg/json muessen symmetrisch bleiben — nichts erzwingt es (Drift s.u.).
- **Telephony:** DIP-Naht per Konvention offen gehalten; leckt in server.js.

Ein Fix, der lokal korrekt aussieht, bricht lautlos eine Invariante anderswo,
weil die Invariante im Code nicht SICHTBAR/ERZWUNGEN ist. Das ist die mechanische
Erklaerung fuer die Erfahrung des Users.

## Konkrete Bugs (nicht nur Smells) — priorisiert

### S1 — Sicherheit/Geld/Korrektheit
1. **Stripe-Webhook-Race** — `billing/webhook.js:190-246` + `server.js:414-443`.
   `applyStripeWebhook` laeuft ohne Per-Tenant-Lock; Stripe liefert at-least-once,
   ohne Reihenfolge, kein Event-ID-Dedup. Zwei konkurrierende Events koennen in
   falscher Reihenfolge abschliessen -> Tenant bleibt `active`+`kycLevel=CARD`
   trotz gescheiterter Zahlung -> **Outbound-Gate faelschlich offen** (Absolute Regel 1).
   Ungetestet. Fix: denselben Chain-Mutex pro tenantId wie beim Provisioning-Drain
   um den GESAMTEN Aufruf legen (NICHT naiv `store.withStoreLock` — Deadlock mit
   verschachteltem `provision()`).
2. **`maxBudgetEur` = Float-Euro** — `config.js:68-72`. Einziger Geld-Wert als
   Float, waehrend alle anderen Cent-Integer sind (G26-Kommentare direkt daneben).
   Bildet mit `defaultTenantBudgetCents` eine Gate-Schnittmenge -> Einheiten-
   Verwechslung (Cent vs. Euro) an einem Budget-Safety-Gate. Fix: auf Cents-Integer.
3. **`objective_achieved` Typ-Drift** — `store/pg.js:1303-1306` schreibt
   `String(false)`, `:804` liest ohne Rueck-Coercion. Nach JEDEM pg-Neustart
   (jedes Deploy, Live-Default) wird Boolean zu String `"false"`; Widget
   `call.html:422-427` prueft `=== false` -> zeigt Rohstring statt "Ja"/"Nein".
   json-Backend hat den Bug nie -> **im lokalen Dev (json) unsichtbar**. Fix:
   symmetrische De-Serialisierung in `rowToCall`.
4. **`usage.costEur` als Float** — `defaults.js:244`, `state-ops.js:1362-1379`,
   `pg.js:840-847`. Budget-Gates (`budgetExceeded`/`reserveExceedsBudget`,
   Absolute Regel 1) vergleichen direkt gegen diesen driftenden Float. Im Code
   als akzeptiertes Risiko dokumentiert. Fix (falls priorisiert): Ganzzahl-Cents.

### S2 — Duplizierung (der klassische "eine Kopie vergessen"-Treiber)
- `tenantOwnsCall` doppelt: `server.js:987` vs. `routes/_tenant.js:88` ("kanonisch").
  Kommentar sagt selbst, die Umstellung sei nie passiert.
- `TENANT_REJECT`-Check in `POST /api/calls` (`server.js:1612-1615`) reimplementiert
  `requireTenant()` (`_tenant.js:164-171`).
- `safeEqual` reimplementiert: `web-auth.js:47-50` statt `util.js`-Import.
- TTL `1800` doppelt: `web-auth.js:12` vs. `config.js:595-598`.
- Datumsformat doppelt: `claude.js:51-58` (`fmtDate`) vs. `mcp-tools.js:48-55`
  (`fmt`, hart "de-DE") -> Telefon-Ausgabe und MCP-Widget-Text koennen driften.
- Log-Zeilen-Format doppelt: `telnyx-llm-shim.js:215-217` vs.
  `telnyx-conversation-watchdog.js:162-163` (dead-air-Zeile).
- `voiceAttrs`-Lookup wortgleich: `twilio/render.js:20-24` vs. `telnyx/render.js:40-44`.

### S2 — Tote/asymmetrische Pfade, die gruene Tests haben (Test-Luege)
- `seedBootstrapPrivateNumber`/`seedBootstrapIdentity` (`state-ops.js:605-618`,
  `:724-726`): exportiert, dokumentiert, je eigene gruene Testdatei — aber KEIN
  Produktions-Aufrufer (anders als die verdrahteten Geschwister). Owner-Removal-
  Altlast. Fix: verdrahten oder samt Tests loeschen.
- Play-TTS-Felder nur im Telnyx-Renderer, nicht Twilio (`twilio/render.js:44-53`),
  ungetestet, nur durch externes Gate `server.js:918` maskiert.

## Struktur-Empfehlungen (groesser, bewusst angehen)
1. **Outbound-Gate-Kette aus `server.js` extrahieren** (`server.js:669-878`) nach
   `telephony/outbound-gates.js` als `makeOutboundGates({store,config})`-Factory
   (Muster wie `makeTenantResolver`) UND die Kette in `POST /api/calls` als
   geordnetes `{name,check}`-Array + eine Schleife -> Gate hinzufuegen/umsortieren
   wird Ein-Zeilen-Diff statt Freihand-Chirurgie. Isoliert testbar.
2. **Provider-Webhook-Parsing hinter einen Port** (`extractSpeech`/
   `extractLifecycleEvent`/`extractSpeakOutcome`, `server.js:588-641`) -> stoppt
   die 7-8 `if(provider===)`-Lecks, dritter Provider = nur Adapter + Registry-Zeile.
3. **`config.js` nach Feature gruppieren** (`config.telnyxAssistant={...}`) statt
   flachem 100-Key-Namensraum — mechanisch, grep-verifizierte Caller-Liste je Key.
4. **`finishCall` strukturell erzwingen** — Statuswechsel weg von "active" nur ueber
   den Settlement-Callback (Bucket-Brigade statt Konvention).
5. **`state-ops.js` aufspalten** (1742 Z. -> `store/ops/{calls,numbers,billing,...}`)
   — niedrige Prioritaet (S4), intern sauber.

## Meta-Lehre (warum die Tests das "kaputt dort" nicht fangen)
Zwei Befunde erklaeren es direkt: (a) der pg-Boolean-Drift ist im lokalen
json-Dev unsichtbar und taucht nur nach echtem pg-Neustart auf; (b) tote Seeds
haben gruene Tests. "Test gruen = Pfad live" gilt hier nicht durchgaengig —
Invarianten und Backend-Symmetrie sind nicht test-erzwungen.
