# KS-P8 — Nutzer sieht Prozent statt Euro (E4) — Bericht

Basis: `master` = `f789a36`. Branch: `phase/ks-p8-prozent-statt-euro`.

## Entscheidungen (D1–D6)

- **D1** — Tenant ohne Plan/Kontingent: `planUsagePercent: null` + Text „kein Kontingent
  hinterlegt". Fail-closed, **niemals `0 %`** (ein Prozentwert ohne Bezugsgroesse
  behauptet ein Kontingent, das es nicht gibt). Regressionsschutz: K4
  (`test/ks-p8-percent-projection.test.js`), Mutationsprobe M1 gruen widerlegt.
- **D2** — Bezugsgroesse ist die Minuten-Achse (`quotaView`/`includedMinutes`/
  `usedMinutes`/`exhausted`), dieselbe Achse wie das Outbound-Gate
  (`planMinutesExceeded`) — Anzeige == Gate bleibt Repo-Invariante.
- **D3** — Rundung `Math.floor`. Invariante: 100 % genau dann, wenn `exhausted`.
  Mutationsprobe M2 (`Math.round` statt `Math.floor`) faellt K6 rot.
- **D4** — `exhausted` (inkl. fehlendem Perioden-Anker, inkl. widerrufenem
  Periodenguthaben) -> 100 %. Kein zweit-kodiertes Praedikat (G5). Mutationsprobe M4
  (den `exhausted`-Zweig entfernt) faellt K7 rot (`NaN`-Fall).
- **D5** — Der Betreiber verliert die EUR-Zahlen in `/api/state` mit. `/api/state` hat
  keine Rollen-Weiche; eine neue Rollen-Mechanik waere neue Auth-Flaeche (out of scope).
  Ersatzpfade: `GET /api/billing/platform-costs` (plattformweit, hinter der bestehenden
  `/api/*`-Auth), die 402-Ablehnungstexte (KS-P4), DB/Logs.
- **D6** — der Spend-Monat-Schluessel faellt mit weg (war ausschliesslich das Label des
  EUR-Monatsbetrags, ohne Betrag ein bezugsloser String in einer Kunden-Oberflaeche).

## Umgesetzt (exakt gemaess Plan)

| Datei | Aenderung |
|---|---|
| `src/billing/meter.js` | `tenantQuotaView(store, tenantId)` (Argument-Zusammenstellung, EINE Quelle mit self-service-routes.js) + `planUsagePercent(quota)` (fail-closed, floor). `quotaView` selbst unveraendert. |
| `src/self-service-routes.js` | `paymentView` nutzt `tenantQuotaView` statt eigener Destrukturierung; Import `quotaView` -> `tenantQuotaView`. Antwort-Shape byte-identisch (Regressionsbeweis: `bk4-self-service-quota.test.js`/`bk5-smoke-e2e.test.js` ohne Edit gruen). |
| `src/routes/api-read.js` | `usageView` traegt nur noch `inputTokens/outputTokens/calls/planUsagePercent`. Fuenf Geldfelder ersatzlos entfallen. Route ruft `tenantQuotaView(store, tenantId)` statt `tenantBudgetSnapshot`/`reservationOf`. |
| `src/mcp-tools.js` | `costDigits`/`AGENT_STATUS_COST_DIGITS`/`chargeCurrencyLabel` geloescht (tot). `pickAgentStatus`/`AGENT_STATUS_OUTPUT` tragen `planUsagePercent` statt fuenf Geldfelder. Neuer Zeilen-Helfer `planUsageLine`. Tool-`description` ohne „cost/budget". Import `config` entfernt (nach der Kuerzung ungenutzt). |
| `src/i18n/mcp-texts.js` | `agentStatus.planUsage`/`planUsageUnknown` (de/en/fr) ersetzen `unknownMonth`/`costLifetime`/`costSpendMonth`/`reserved`. |
| `src/ui/widgets/agent-status.html` | fuenf Geld-Zeilen -> eine `data-mcp="planUsagePercent"`-Zeile. |
| `src/ui/widget-i18n.js` | fuenf Geld-Keys (de/fr) -> `"Monthly usage (%)"` (de/fr). |
| `PLAN-SECURITY.md` | Ueberholt-Notiz an P5A-ACHSENTRENNUNG, Klarstellung an KS-P4 (verbleibende `tenantBudgetSnapshot`-Aufrufer: `outbound-gates.js`, `routes/voice.js`), neuer Abschnitt `## KS-P8`. |
| `PLAN-KOSTEN-STEUERUNG.md` | `KS-P8`-Zeile in der Ausfuehrungsreihenfolge auf ERLEDIGT gesetzt. |

## Tests

- **Neu:** `test/ks-p8-percent-projection.test.js` — K1–K8, alle gruen. Vier
  Mutationsproben (M1 kein-Plan->0, M2 round-statt-floor, M3 costEur reaktiviert, M4
  exhausted-Zweig entfernt) einzeln gesetzt und verifiziert rot, danach zurueckgebaut
  (Diff gegen Backup-Kopie bestaetigt Wiederherstellung).
- **Angepasst:** `test/api-read-parity.test.js` (Mock-Store `tenantSubscription`
  ergaenzt, Assertions auf `planUsagePercent`/Feldwegfall), `test/api-state-usage-axis.test.js`
  (Whitelist auf vier Felder, Rollover-/Reserve-/Zukunfts-Tests geloescht — die
  darunterliegende Leseprojektion bleibt in `test/usage-spend-month-axis.test.js` und
  `test/ks-p5-current-period-credits.test.js` gepinnt, Coverage-Verlust: keiner),
  `test/mcp-ui.test.js` (RICH_STATE/AGENT_KEYS/Schema/Text-Assertions/Widget-Slot-Check),
  `test/mcp-tools-language.test.js` (Fixture, T6 umgebaut zum Waechter „keine Waehrung
  mehr", T9-Schleife, DE-Text-Pin), `test/mcp-tools.test.js` (nur Kommentar).
- **Ohne Edit gruen** (Regressionsbeweis der Extraktion/Entkopplung):
  `test/bk4-quota-view.test.js`, `test/bk4-self-service-quota.test.js`,
  `test/bk5-smoke-e2e.test.js`, `test/mcp-ui-widget-i18n.test.js`,
  `test/p15-mcp-tool-descriptions-en.test.js`, `test/outbound-gates.test.js`,
  `test/ks-p4-snapshot-gate-axis.test.js`, `test/deny-diagnosability.test.js`.

## Ergebnis

- `node --check` auf allen 6 geaenderten Quelldateien: sauber.
- Struktursonde `grep -rn "costEur|tenantCapEur|spendMonthCostEur|spendMonthKey|reservedEur|costDigits|chargeCurrencyLabel" src/routes/api-read.js src/mcp-tools.js src/ui src/i18n`: **keine Treffer** (Kommentar in `api-read.js` musste umformuliert werden, um den Grep sauber zu halten).
- `npm test`: 3631 Tests, **0 fail** (i18n-Katalog bereinigt: 3611/3611).
- `npm run test:gates`: 3 rot (GAP-05 Stripe-Promo-Codes, GAP-15 Rechtstext-Platzhalter x2)
  — alle drei bestehen bereits auf `master`, unveraendert durch diese Phase (thematisch
  ohne Bezug zu Kosten-/Prozent-Anzeige).
- Smoke: Server lokal gestartet (Dummy-Env + `COST_TRUING_REQUIRED_RECORD_TYPES`,
  `bootstrap-tenant`-Seed), `curl /api/state`:
  `calls,inputTokens,outputTokens,planUsagePercent null` — exakt der im Plan
  vorhergesagte Output (kein Abo im frischen Store -> `null`, D1).

## Restbefunde (nur notiert, nicht gefixt — gehoeren zu Nachbarphasen)

- `CLAUDE.md`/`ONBOARDING.md` beschreiben seit `6b57725` geloeschte Dashboard-Dateien
  (`public/index.html`/`tenant.html`). Doku-Drift, nicht KS-P8.
- `store.reservationOf` hat nach dieser Phase keinen `src/`-Aufrufer mehr (nur noch
  Tests) — bleibt (Entfernung waere Eingriff in beide Store-Backends ohne Nutzen).
- `spendMonthWindowKey` bleibt exportiert, wird aber nur noch modul-intern genutzt —
  kein toter Code (die Funktion laeuft), nur eine schmalere API-Oberflaeche.
- `/app`-Frontend (`apps/web`): `tenantQuotaView`/`planUsagePercent` stehen bereit,
  `/api/self-service/state` liefert `quota` bereits — eine kuenftige UI-Phase kann das
  ohne weitere Server-Aenderung ziehen.
