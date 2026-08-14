# Newsletter-Zusatzempfaenger mit Double-Opt-in — Plan (Stand 2026-08-14, feat/newsletter-recipients)

Jeder Punkt traegt erwartetes Ergebnis + Verifikationsmethode (workflow.md Regel 7).

## Architektur-Entscheidungen (vor Implementierung fixiert)

1. **Datenmodell additiv am Tenant-Record**: `newsletterRecipients` (Array) + `newsletterConfirmMailLog`
   (Array ISO-Timestamps, Tageslimit-Zaehler) NEBEN dem unangetasteten Boolean-Pfad
   (`newsletterConsent`). Persistenz als JSONB-Spalten (Muster `consults` auf `call`), NICHT als
   eigene Tabelle - Cap 5 haelt die Arrays klein, kein Query-Bedarf ueber Tenant-Grenzen ausser
   dem Token-Lookup (linearer Scan ueber `tenantsOf(s)`, Muster `findTenantByCustomer`).
2. **Confirm-Token: Hash-only, Einmalverwendung.** 32-Byte-Zufallswert, NUR `sha256(token)` als
   `tokenHash` gespeichert, Ablauf 48h, nach Erfolg geleert - Muster PKCE-Verifier/Passwort-Reset:
   der Klartext wird nach dem einen Mail-Versand nie wieder gebraucht.
3. **Unsub-Token: bewusste Abweichung vom Feldnamen `unsubTokenHash` im Auftrag.** Der Abmelde-Link
   muss in JEDER kuenftigen Summary-Mail identisch reproduzierbar sein (Owner-Auftrag) - ein Hash
   ist irreversibel, das verbietet Hash-only-Speicherung strukturell. Gespeichert wird der
   Klartext-Token (`unsubToken`) direkt am Recipient-Eintrag, verglichen ueber `safeEqual` -
   EXAKT das Muster von `call.streamToken` (state-ops.js Zeile 185, plaintext + safeEqual, kein
   Passwort-Aequivalent). Blast-Radius bei DB-Leak: einzige Wirkung ist ein Opt-out fuer eine
   Adresse, keine PII-Preisgabe ueber das hinaus, was DB-Zugriff ohnehin zeigt. Wird im Code
   dokumentiert.
4. **Tageslimit als eigenes Log, NICHT ueber den Billing-Usage-Ledger.** `usageEvents` ist eine
   Kosten-Achse (costCents Pflichtfeld, von `dailySmsCount`/dem Budget-Gate gelesen); das
   Confirm-Mail-Tageslimit ist reiner Missbrauchsschutz ohne Kostenbezug. Eigenes, am Add-Write
   selbst geprunte Array (`newsletterConfirmMailLog`, Fenster 24h) haelt es einfach und
   backend-agnostisch (json.js braucht keine Sonderbehandlung).
5. **Gate-Reihenfolge in `planAddNewsletterRecipient`** (state lesend, keine Mutation): Format ->
   Duplikat (Konto-Adresse + bestehende Liste) -> Cap (5) -> Tageslimit (10/Tag). Route mutiert
   NUR bei `ok:true`.
6. **`planSummaryMail` liefert `targets[]` statt `to`.** Konto-Adresse (Boolean-Consent) und
   CONFIRMED-Zusatzempfaenger sind ORTHOGONALE Achsen (Auftrag: additiv, Boolean bleibt
   unangetastet) - ein Tenant kann Consent=false UND bestaetigte Zusatzempfaenger haben. Bricht
   den bestehenden Rueckgabevertrag (interne, nicht oeffentliche Funktion) -> bestehende Tests
   `f2-mail-summary-plan.test.js`/`f2-mail-summary-finish-call.test.js` werden mitgezogen, nicht
   nur ergaenzt. Marker `summaryMailSentAt` wird gesetzt, wenn **mindestens ein** Empfaenger
   erfolgreich zugestellt wurde (Konto-Pfad bei nur einem Ziel dadurch byte-identisch zum
   Bestand); Fehlschlaege einzelner Ziele werden geloggt, kein Retry (Auftrag, bewusste
   Vereinfachung).

## Umsetzungsschritte

- [x] Bestand verifiziert: state-ops.js:2289-2325 (Boolean-Consent), mail-summary.js,
      call-finish.js, self-service-routes.js, route-policy.js, config.js (mail/publicUrl),
      i18n/locales.js, schema.sql, json.js/pg.js Wrapper-Muster gelesen.
- [x] `src/newsletter-recipients.js` (neu): Konstanten (MAX=5, DAILY_CAP=10, TOKEN_TTL=48h),
      `normalizeEmail`/`isValidEmailFormat`, Token-Erzeugung, `planAddNewsletterRecipient`,
      URL-Builder, `renderNewsletterPage` (stilneutrales HTML).
      Verifikation: `node --check` gruen; `newsletter-recipients-model.test.js` 15/15 gruen.
- [x] `state-ops.js`: `tenantNewsletterRecipients`, `dailyNewsletterConfirmMailCount`,
      `addNewsletterRecipient`, `removeNewsletterRecipient`, `confirmedNewsletterRecipients`,
      `confirmNewsletterRecipientByToken`, `unsubscribeNewsletterRecipientByToken`
      (safeEqual-Scan ueber `tenantsOf(s)`).
      Verifikation: `newsletter-recipients-confirm-unsub.test.js` 10/10 gruen.
- [x] `json.js` + `pg.js` (TENANT_COLUMNS, rowToTenant, flushTenants, makePgStore-Wrapper) +
      `db/schema.sql` (2 neue JSONB-Spalten, ALTER + Kommentar) + `store.js` (Re-Exports).
      Verifikation: `newsletter-recipients-pg-roundtrip.test.js` 4/4 gruen (pglite hydrate->
      flush->hydrate); `newsletter-recipients-facade.test.js` 1/1 gruen.
- [x] `i18n/locales.js`: `postCall.unsubscribeLinkLabel` (DE/FR/EN) + neuer `newsletter`-Block
      (Bestaetigungsmail-Text + 4 Seiten-Texte) je Sprache.
      Verifikation: `node --check` gruen, ueber f2-mail-summary-* und die Route-Tests
      indirekt abgedeckt (Abmelde-Link-Regex, HTML-Body-Regex).
- [x] `mail-summary.js`: `planSummaryMail` auf `targets[]` umgebaut (Konto-Adresse + CONFIRMED-
      Empfaenger, orthogonal). `call-finish.js`: Sende-Schleife pro Ziel (Zusatzadresse mit
      Abmelde-Link-Footer), EIN `markSummaryMailSent` bei >=1 Erfolg.
      Verifikation: `f2-mail-summary-plan.test.js` 12/12 + `f2-mail-summary-finish-call.test.js`
      12/12 gruen (angepasst + erweitert, inkl. Teilfehler-fail-soft-Test).
- [x] `self-service-routes.js`: POST/DELETE `/api/self-service/newsletter-recipients` (webAuthMw),
      GET `/newsletter/confirm` + GET `/newsletter/unsubscribe` (oeffentlich, kein mw), State-Route
      additiv `newsletterRecipients: [{email,status,createdAt}]`.
      Verifikation: `self-service-newsletter-recipients.test.js` 12/12 gruen (pglite,
      Muster self-service-newsletter-consent.test.js) - reales HTTP ueber node:http gegen
      die echten Route-Handler, inkl. Add/Cap/Duplikat/Remove/Confirm/Unsubscribe/Audit.
- [x] `route-policy.js`: PUBLIC_ROUTES-Eintraege fuer beide neuen oeffentlichen Routen mit
      Begruendung. `scripts/probe-auth.sh`: Erwartungstabelle nachgezogen (2 neue Zeilen,
      Status 400 bei fehlendem Token) - sonst faellt `probe-auth-table.test.js`.
      Verifikation: `test/route-auth-inventory.test.js` 9/9 + `test/probe-auth-table.test.js`
      9/9 gruen (Fingerprint + Probe-Tabelle nachgezogen).
- [x] Volle Root-Suite (10 Dateien-Chunks a 57 Dateien, Hintergrundlauf per Cap nicht moeglich
      -> sequentielle Chunk-Laeufe mit Log). 4307 Tests total, 16 "not ok" - JEDER einzeln
      nachgeprueft: 2 echte Befunde (Fingerprint-Liste + Probe-Tabelle, oben gefixt), alle
      uebrigen 14 SIGKILL unter Last, isoliert alle gruen; store-pg.test.js/plan-cap-
      derivation.test.js/bk2-checkout-return-plan.test.js/i9-self-service.test.js/
      web-auth-pg.test.js SIGKILLen auch isoliert in diesem Sandbox, aber NACHWEISLICH
      IDENTISCH auf unveraendertem master (git stash push -u, Test wiederholt) - Sandbox-
      Ressourcengrenze (3.8 GB RAM), keine Regression. 0 echte Fails nach Fix.
- [x] Smoke: `node src/server.js` mit `STORE_BACKEND=json` bootet zwar (nach Seed via
      `bootstrap-tenant`), mountet Self-Service (und damit `/newsletter/*`) aber NICHT -
      der Web-Login-Block braucht `STORE_BACKEND=pg` + OIDC-Config (Bestandsverhalten,
      betrifft auch die bestehende `/api/self-service/newsletter-consent`-Route identisch,
      keine Regression). Der aequivalente, sogar staerkere Nachweis (echtes HTTP ueber
      node:http gegen die echten Handler) laeuft ueber
      `self-service-newsletter-recipients.test.js` (pglite) - dort verifiziert: add ->
      pending im State, confirm mit falschem Token -> 400 + neutrale HTML-Seite, kein
      Zustandswechsel.

## Bewusste Vereinfachungen (im Bericht zu nennen)

- Kein Retry-Sweep fuer fehlgeschlagene Bestaetigungs-Mails (anders als Kuendigungsbestaetigung) -
  nicht im Auftrag verlangt, Tageslimit deckt Missbrauch, ein erneuter Add-Versuch nach Entfernen
  ist der Recovery-Pfad.
- Tageslimit-Log ohne separaten Sweep/Retention-Job - selbstprunend bei jedem Add-Write
  (Fenster 24h), waechst nur bei aktiver Nutzung.
