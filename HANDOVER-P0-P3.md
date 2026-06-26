# HANDOVER — Naechste Session: P0 + P3 autonom umsetzen

**Erstellt:** 2026-06-26 · **Fuer:** frische Claude-Session, die P0 und P3 des Onboarding-Umbaus durchzieht. Umbrella-Strategie: `PLAN-ONBOARDING.md`. Detaillierte Phasen-Specs: `tasks/p0-tenant-identity-spec.md`, `tasks/p3-payment-chain-spec.md`.

## 1. Stand (was erledigt ist)

- **P1 (Dashboard) FERTIG + auf master gemerged** (commit `961bbac`, fast-forward, **NICHT gepusht**). `public/tenant.html` neu im Sundartha-Navy-Brand (Space Grotesk, HERMES/by Sundartha), reduziert auf Rufnummer + Anrufe; Settings/Kalender/Action-Items raus; Billing-Block behalten (versteckt hinter `PAYMENT_ENABLED`). Neuer Test `test/p1-dashboard-brand.test.js`. Report: `tasks/p1-report.md`. Gate war PASS (1004 Tests gruen, 0 Fix-Runden).
- **P2 (Domains)** = Jonas-Handarbeit (DNS/Render/WorkOS), nicht Teil dieser Session. Siehe PLAN-ONBOARDING §9.1.
- **Offen jetzt: P0 + P3** (beide Code, autonom machbar).

## 2. Methode (verbindlich): lean Template + Implementation-Workflow

Beide Phasen werden mit dem **`phase-impl-lean`**-Workflow umgesetzt (Plan -> Impl im Worktree -> dualer Review Safety+Clean-Code -> Self-Fix bis PASS -> Report). Lead bleibt duenn, liest den Report NICHT.

### Aufruf-Contract (WICHTIG — Stolperstein aus der letzten Session)

`args` MUSS ein **OBJEKT** sein, KEIN Freitext-String. Fehlt `args.phaseId`, bricht der Workflow fail-closed ab (kein Default-Phase-Bau). Pflichtfelder: `phaseId`, `branch`, `baseBranch`, `planDoc`, `specFile`. Der Phasen-Inhalt steht in der `specFile` (der Plan-Agent liest sie und findet den Abschnitt der Phase) — NICHT in `args` als String.

Aufruf ueber das **Workflow-Tool direkt** (in einer neuen Session existiert der alte `scriptPath` nicht mehr -> `name` nutzen):

### P0 zuerst

```
Workflow({ name: "phase-impl-lean", args: {
  phaseId: "P0",
  phaseTitle: "Tenant-Identitaet vereinheitlichen (Fix 'Kein Tenant')",
  branch: "phase/p0-tenant-identity",
  baseBranch: "master",
  planDoc: "PLAN-ONBOARDING.md",
  specFile: "tasks/p0-tenant-identity-spec.md",
  maxFixRounds: 3
}})
```

Nach Abschluss: Workflow gibt `finalBranch` + `gate` (PASS/BLOCKED) zurueck.
- **PASS** -> Lead merged `finalBranch` nach master lokal: `git merge --ff-only <finalBranch>` (oder `--no-ff` falls master weitergewandert). **NICHT pushen** (manual-push-Protokoll).
- **BLOCKED** -> `remainingBlockers` lesen, an Jonas berichten, NICHT mergen.

### Dann P3 (erst NACH P0-Merge — baut auf der kanonischen Tenant-Identitaet auf)

```
Workflow({ name: "phase-impl-lean", args: {
  phaseId: "P3",
  phaseTitle: "Payment-gated Aktivierung + Provisioning (Stripe Checkout -> Webhook -> active+KYC+Nummer)",
  branch: "phase/p3-payment-chain",
  baseBranch: "master",
  planDoc: "PLAN-ONBOARDING.md",
  specFile: "tasks/p3-payment-chain-spec.md",
  maxFixRounds: 3
}})
```

Danach gleiches Merge-Vorgehen wie P0.

## 3. Reihenfolge / Warum sequenziell

P0 **vor** P3, NICHT parallel: beide beruehren `src/server.js` (`/api/onboard`) und `src/store/state-ops.js` (Tenant-Lifecycle), und P3 (Webhook setzt active+KYC am Tenant) baut auf P0s kanonischer Identitaet auf. Parallel -> Merge-Konflikte + P3 auf falschem Tenant-Modell. Also: P0 laufen lassen -> mergen -> P3 mit `baseBranch: master` (enthaelt dann P0) laufen lassen -> mergen.

## 4. Was P0 und P3 inhaltlich sind (Kurzfassung — Details in den Spec-Files)

- **P0** = Fix "Kein Tenant fuer diese Identitaet". Heute zwei divergente Tenant-Erzeugungspfade (`upsertOnFirstLogin` PG: `t_<sub>`/suspended/idp_subject gesetzt vs `registerTenant` state-ops:573: email/ACTIVE/ohne idp_subject). Ziel: EINE kanonische Identitaet (`idp_subject`), ein Record, Web-Login == MCP loest gleich auf; MCP legt weiter keinen Tenant an (fail-closed). Details: `tasks/p0-tenant-identity-spec.md`.
- **P3** = Payment-Kette verdrahten. Heute: kein Stripe-Redirect nach Signup, Webhook setzt KEIN `kycLevel`, Flags default aus -> Signup macht nichts. Ziel: Stripe Checkout (Subscription) -> Webhook setzt atomar `status=active` + `setKycLevel(CARD)` + Provisioning (Telnyx, nach Capture), idempotent. Code hinter den Flags; kein Flag-Flip, keine Webhook-Registrierung (= Jonas/§9). Details: `tasks/p3-payment-chain-spec.md`.

## 5. Nach P0+P3 (Uebergabe an Jonas / spaetere Schritte)

- Go-live haengt an Jonas-Handarbeit + Flag-Flips: PLAN-ONBOARDING **§9.1** (DNS/Render/WorkOS/Stripe-Webhook) + **§9.2/§9.4** (Secrets in Render, `PAYMENT_ENABLED=true` per Render-MCP nach gruenem Stripe-Testmodus, `PROVISIONING_ENABLED=true` = Geld-Gate P4).
- Stripe-Webhook-Endpoint `https://app.sundartha.com/webhooks/stripe` registriert Jonas, sobald P3 deployed ist (sonst 404). `STRIPE_WEBHOOK_SECRET` liegt schon in Render.

## 6. Regeln fuer die Session

- **Manual-push-Protokoll:** committen/mergen lokal ja, **pushen nur auf explizites Jonas-Kommando**.
- **Provider = Telnyx** (Nummern). **Web-Login laeuft live.** Abo: Starter 4,99 / Business 9,99 (in Stripe). Nummer-Land per IP-Geo.
- Aufraeumen: ggf. liegen Workflow-Worktrees unter `.claude/worktrees/` (untracked) — nicht committen; bei Bedarf entfernen.
- Untracked Planungs-Dateien im Repo (Stand dieser Session): `PLAN-ONBOARDING.md`, `HANDOVER-P0-P3.md`, `tasks/p0-tenant-identity-spec.md`, `tasks/p3-payment-chain-spec.md` — bei einem spaeteren Push bewusst mit-committen oder bewusst weglassen.

## 7. Referenzen

- Strategie + Autonomie-Matrix + Handoff-Checkliste: `PLAN-ONBOARDING.md`
- Council-Synthese: `~/Larry/drafts/2026-06-25_council_unified-signup-login-flow.md`
- Sicherheits-Plan: `PLAN-SECURITY.md` · Status: `STATUS.md`
- Workflow-Regeln: `.claude/refs/workflow.md` · Clean-Code-Gate: `.claude/refs/clean-code.md`
