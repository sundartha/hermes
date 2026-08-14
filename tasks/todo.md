# Call-Summary per E-Mail nach Newsletter-Einwilligung — Plan (Stand 2026-08-14)

Regel: jeder Punkt traegt sein **erwartetes Ergebnis** und seine **Verifikationsmethode**
(`.claude/refs/workflow.md`, Regel 7).

## Architektur-Entscheidungen (vor Implementierung fixiert)

1. **Zwei SmtpMailer-Instanzen.** `callFinish` wird synchron am Modul-Top von `server.js`
   verdrahtet; der pg-gated `wireWebLogin`-Block (Mailer fuer die Kuendigungsbestaetigung)
   laeuft asynchron erst spaeter (guardedBoot, `app.js`). `makeSmtpMailer` haengt NUR an
   `config.mail` (kein pg) und ist laut eigenem Modul-Kopf zustandslos (jeder Aufrufer bekommt
   seinen EIGENEN Transporter). Eine zweite, frueh konstruierte Instanz in `server.js`
   (`config.mail.smtpHost ? makeSmtpMailer(config) : null`) loest die Ordering-Kollision ohne
   Restructuring des Boot-Grafen.
2. **`accounts` fuer `accountByTenant` per spaet gebundener Zelle.** `accounts` haengt am
   pg-Portal-Runner (asynchron, NUR im guardedBoot-Block verfuegbar) - eine frueh konstruierte
   zweite Instanz waere unmoeglich, ohne die INV-11-Fail-open-Garantie zu brechen (ein Portal-
   Fehler darf die Telefonie nie toeten). Muster `operatorAuth` in `app.js`: `const accountsRef
   = { current: null }` in `server.js`, durchgereicht bis `wireWebLogin`, das NACH dem Bau von
   `accounts` `accountsRef.current = accounts` setzt. `finishCall` liest `accountsRef.current`
   bei JEDEM Call-Ende frisch - bleibt der pg-Block aus, bleibt es fail-closed `null`.
3. **KEINE Tenant-Zeitzone im Mail-Text.** `test/p8-timezone-no-gate.test.js` fuehrt
   `telephony/call-finish.js` explizit in `FORBIDDEN_FILES` (LAW-07: kein Anrufzeit-Gate).
   Die Mail zeigt den Zeitpunkt daher OHNE `timeZone`-Option (Laufzeit-Default), keine
   `store.tenantTimezone`-Lesung in diesem Modul.

## Umsetzungsschritte

- [ ] `summaryMailSentAt`-Marker (Spiegel `summarySmsSentAt`): state-ops.js, json.js, pg.js
      (rowToCall + flushCalls INSERT/UPDATE), db/schema.sql (Spalte + ALTER), store.js
      (Fassade), store/views.js (aus publicCall gestrippt).
      **Ergebnis:** `node --check` auf allen vier je gruen; bestehende Store-Roundtrip-Tests
      bleiben gruen. **Verifikation:** `npm test` (siehe unten, gesamt).
- [ ] `src/mail-summary.js` (neu): `planSummaryMail({ store, call, mailer, accounts })`,
      Gates (a)-(e) wie im Auftrag, async (accountByTenant ist IO).
      **Ergebnis:** alle 6 Faelle (5 Gates + Positivfall) deterministisch.
      **Verifikation:** `test/f2-mail-summary-plan.test.js` (neu), gruen.
- [ ] `src/telephony/call-finish.js`: `mailer`/`accountsRef` als neue optionale Deps
      (Default `null`/`{current:null}` - bestehende Aufrufer ohne diese Keys bleiben gueltig),
      Mail-Block nach dem SMS-Block, Text-Bau lokal (Muster SMS-Body), `markSummaryMailSent`
      bei Erfolg, `audit("mail_summary_skipped", ...)` bei Reason, fail-soft try/catch.
      **Ergebnis:** Versand genau einmal, Fehler stoert Billing/Termination nicht, Skip-Audit
      PII-frei. **Verifikation:** neue Tests + `finishcall-billing-once`,
      `call-termination-order` bleiben unveraendert gruen.
- [ ] `src/i18n/locales.js`: 2 neue postCall-Keys (Zeitpunkt-/Dauer-Label) in de/fr/en.
      **Verifikation:** `npm test` (i18n-Bestandstests bleiben gruen, keine neuen Drift-Treffer).
- [ ] `src/server.js`: zweite `mailer`-Instanz + `accountsRef`-Zelle vor `makeCallFinish`,
      beides injiziert; `accountsRef` zusaetzlich in `deps` fuer `buildApp`.
- [ ] `src/app.js`: `accountsRef` aus deps destrukturiert, an `wireWebLogin` durchgereicht.
- [ ] `src/wiring/web-login.js`: `accountsRef`-Parameter, nach `makeAccounts(...)` gesetzt.
- [ ] `src/self-service-routes.js`: `/api/self-service/state`-Handler async, additives Feld
      `accountEmail` (fail-closed `null` ohne `accounts`).
      **Verifikation:** neuer Test + bestehende self-service-state-Tests bleiben gruen (kein
      Full-Body-`deepEqual` betroffen, gruppenweise per Grep verifiziert).
- [ ] `apps/web/src/lib/subscribe.js`: `accountEmailFrom(data)` (Muster `newsletterConsentFrom`).
      `apps/web/src/components/app/NewsletterIsland.astro`: E-Mail-Feld aus `accountEmail`
      vorbefuellen (Platzhalter wenn `null`).
      **Verifikation:** `npm --prefix apps/web test` gruen + neuer Test in `subscribe.test.js`.
- [ ] `.env.example`: Halbsatz an der SMTP-Sektion (Mailer traegt auch die Call-Summary-Mail).
- [ ] Tests: `test/f2-mail-summary-plan.test.js`, Integration in call-finish (Versand einmal,
      fail-soft, Skip-Audit), `test/f2-self-service-state-account-email.test.js`,
      `apps/web/test/subscribe.test.js`-Erweiterung.

## Gesamt-Verifikation (Pflicht vor Fertigmeldung)

- `node --check` auf jede geaenderte src-Datei.
- `npm test` im Root, vollstaendig gruen (Hintergrundprozess + Log, falls Timeout).
- Gezielt: `finishcall-billing-once`, `call-termination-order`, `f2-sms-summary-plan`,
  `self-service-newsletter-consent`, `312k-p5-cancellation-mail`, `f2-mail-summary-plan`.
- `npm --prefix apps/web test` gruen.
- Smoke: Server lokal starten (kein SMTP konfiguriert), Call-Lebenszyklus/Test-Harness zeigt
  sauberen `mail_summary_skipped reason=no_mailer`-Audit-Pfad ohne Exception.
