# BK-Chain Handover — PLAN-BUCHUNG-PRICING.md

Stand: 27.06.2026 · Branch `master` (lokal, **nicht gepusht** — Manual-Push-Protokoll).

## Erledigt (Session 1: 4-Phasen-Limit)

| Phase | Gate | Tests | finalBranch (merged) | Report |
|---|---|---|---|---|
| BK0 Plan-Katalog SSoT | PASS | 1046 | phase/bk0-plan-catalog | tasks/bk0-report.md |
| BK1 Pricing-Kacheln Dashboard | PASS | 1054 | phase/bk1-pricing-view-fix2 | tasks/bk1-report.md |
| BK2 Checkout-Verkettung | PASS | 1062 | phase/bk2-checkout-wire | tasks/bk2-report.md |
| BK3 Auto-Provisioning | PASS | 1067 | phase/bk3-auto-provision | tasks/bk3-report.md |

Alle vier per `phase-impl-lean.js` (Worktree + dualer Review Safety/Clean-Code + Self-Fix bis PASS), `--no-ff` nach master gemerged, `npm test` nach jedem Merge grün (zuletzt **1067/1067**). Plan-Doc `PLAN-BUCHUNG-PRICING.md` liegt committet auf master.

Kernergebnis: Backend-SSoT `src/plans.js` (starter 499 / business 999 Cents EUR) + Marketing-Spiegel `apps/web/src/lib/plans.js` (drift-getestet), `GET /api/plans` (public, pre-Auth, keine PII), katalog-getriebene Pricing-Kacheln in `public/tenant.html`, Checkout-Glue (Plan trägt durch Karten-Umweg, return→subscribe→activate), Webhook→Provisioning mit Audit bei Cap-Block (idempotent, Dry-Run).

## Offen (Session 2 — neue Session starten)

| Phase | Branch | Setzt voraus |
|---|---|---|
| BK4 Dashboard Nummer+Plan+Kontingent | phase/bk4-dashboard-quota | BK3 ✅ |
| BK5 Test-Mode Smoke E2E + Report | phase/bk5-smoke | BK4 |

## Exakter Folge-Session-Prompt

> Repo `~/Larry/deliverables/vodafone-agent`, master, 1067 Tests grün. PLAN-BUCHUNG-PRICING.md BK0–BK3 sind merged (siehe tasks/bk-chain-handover.md). Setze BK4 und BK5 um — je ein `phase-impl-lean.js`-Lauf (baseBranch master, planDoc PLAN-BUCHUNG-PRICING.md, maxFixRounds 2), bei PASS finalBranch `--no-ff` nach master mergen, node_modules-symlink-Falle prüfen, `npm test` verifizieren. Danach ist die Kette komplett.

```
Workflow({ scriptPath: ".claude/workflows/phase-impl-lean.js", args: {
  phaseId: "BK4", phaseTitle: "Dashboard: Rufnummer + Plan + Kontingent",
  branch: "phase/bk4-dashboard-quota", baseBranch: "master",
  planDoc: "PLAN-BUCHUNG-PRICING.md", maxFixRounds: 2 }})
```
dann analog BK5 / `phase/bk5-smoke`.

## Hinweise

- **Push:** alle Merges + Plan-Doc nur lokal. Push erst auf explizites "Push" (S239). Remote = `Antonio20045/vodafone-agent` (Plan nennt `jonas986/...` — vor Push klären welches Remote).
- **node_modules-Falle:** nach jedem Merge geprüft, blieb reale Dir. Falls Tests je wegen broken symlink failen: `rm node_modules && npm install`.
- **§7 Owner-Decisions:** mit Empfehlungen umgesetzt (EUR 4,99/9,99 · Minuten-Kontingent · hosted Checkout · Provisioning erst bei Webhook-active · nur Anzeige). Ganze Kette Test-Mode/Dry-Run, kein echtes Geld. Go-Live = separater Owner-Schritt (§8).
