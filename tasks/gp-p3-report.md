# Phase GP-P3 — Wiederanlauf nach Kartenwechsel + Versuchsdeckel

**Gate: PASS** · finalBranch: `gp/p3` · headCommit: `f4d5ff4`

## 1. Kontext

GP-P3 verdrahtet einen automatischen Wiederanlauf des Nummern-Provisionings, wenn
ein Mandant nach einem gescheiterten Kauf (Status `failed`) eine neue Karte
hinterlegt — gedeckelt durch einen Versuchszaehler, damit der Wiederanlauf nicht
zum Kostenvektor wird (jede neue `numberId` traegt frische Idempotenz-Schluessel
und `occupiesCapacity` zaehlt `failed` nicht zur Cap).

## 2. Plan (gekuerzt)

Basis: `master` (`891bd96`).

**Kern-Entwurfsentscheidungen:**
- **E1** — Der Versuchszaehler ist die Anzahl der terminal `failed`-Nummern-Datensaetze
  des Mandanten (`failedNumberCount`). Kein neues Tenant-Feld, keine DDL, kein
  Backfill — Nummern werden nie gepruned, der Ledger ist durabel.
- **E2** — Terminaler Zustand nutzt das bestehende, bereits persistierte Feld
  `numberProvisionSkipReason`, neuer Wert `needs_manual_reconcile` (Konstante
  `NEEDS_MANUAL_RECONCILE_REASON` in `defaults.js` als EINE Quelle statt drei
  getippter Literale). `requestNumber` raeumt den Marker bei Erfolg automatisch ab.
- **E3** — Der Deckel gilt NUR am neuen automatischen Anstoss, nicht am
  Admin-Retry (`POST /api/onboard/retry`) und nicht am Webhook-Aktivierungspfad —
  sonst gaebe es fuer `needs_manual_reconcile` keinen Ausweg.
- **E4** — Verdrahtet wird NUR `GET /api/self-service/billing/return`
  (Karten-Zweig). Der `internalOnly`-Pfad `GET /api/billing/checkout-return`
  bleibt unberuehrt.
- **E5** — Fail-soft: der Wiederanlauf darf die bereits persistierte Kartenbindung
  nie kippen (`retriggerProvisioningAfterCardBind` wirft nie).
- **E6** — `PROVISIONING_RETRY_MAX_ATTEMPTS=0` heisst "automatischer Wiederanlauf
  komplett AUS" (eigener erster Zweig), nicht "sofort erschoepft".
- **E7** — Frontend-Aktion als eigene reine Funktion `numberPlaceholderAction(data)`,
  kein Formwechsel der Bestandsfunktion `numberPlaceholderText`.

**Pre-Mortem (vorab entschaerft):** Wiederanlauf-Schleife → Deckel im selben
Commit vor jedem Anstoss geprueft, hold-unfaehige Methode loest gar keinen Anstoss
aus. Geldbewegung ohne Abo-Gate → `tenantActiveSubscriber(..., KYC_OUTBOUND_MIN)`
im Entscheidungskern. Regression im Normalfall (erste Kartenbindung) → eigener
Positiv-Kontroll-Test, Antwort byte-identisch. Deckel sperrt den Betreiber mit aus
→ E3 plus bestehender `clearNumberProvisionSkip`-Rueckweg.

**Neue Datei:** `src/billing/provision-retry.js` — reiner Entscheidungskern
`resolveCardRebindRetry(state, {tenantId, maxAttempts, kycMinLevel})` (kein IO)
plus unreiner, nie werfender Wrapper `retriggerProvisioningAfterCardBind(...)`.
Fail-closed-Reihenfolge: `DISABLED` (maxAttempts<=0) → `NOT_FAILED` →
`NO_ACTIVE_SUBSCRIPTION` → `PAYMENT_METHOD_UNSUITABLE` → `ATTEMPTS_EXHAUSTED` →
`RETRY`.

**Edits:** `defaults.js` (Enum-Konstante), `provision-outcome.js` /
`provision-trigger.js` (Literal entduplizieren), `state-ops.js`
(`failedNumberCount`, `markTenantNeedsManualReconcile`), `config.js`
(`provisioningRetryMaxAttempts`, Default 3, min 0), `self-service-routes.js`
(Verdrahtung im Karten-Rueckkehr-Zweig), `.env.example`, `render.yaml`,
`apps/web/src/lib/api.js` (`numberPlaceholderAction`,
`BILLING_SETUP_CHECKOUT_PATH`), `AgentChip.astro` (Knopf, textContent/.hidden,
kein Inline-Script), `shell.css` (Selektor angehaengt, keine Duplikate).

**Tests (Plan):** 8 neue Faelle in `test/gp-p3-wiederanlauf-kartenwechsel.test.js`
(Retry, Deckel-erschoepft, kein Abo, Positiv-Kontrolle "erste Kartenbindung",
hold-unfaehige Methode, werfender Anstoss/fail-soft, `maxAttempts=0`,
Idempotenz), plus `apps/web/test/api.test.js`-Fall, `config-namespaces.test.js`-
Buchfuehrung, `test/helpers.js` `BASE_ENV`-Eintrag.

**Bewusst nicht gebaut:** kein zeitgesteuerter Sweep (GP-P4), kein zweiter
Kaufpfad, keine Aenderung an `MAX_NUMBERS`/`MAX_NUMBERS_PER_TENANT`/
`occupiesCapacity`/`disclosureSentence`/Hold-Kern, kein Deckel am Admin-Retry,
kein Wiederanlauf am `internalOnly`-Pfad, kein Backfill, kein neuer Endpunkt.

## 3. Implementierung — Zusammenfassung

- headCommit `f4d5ff4`, Branch `gp/p3`, Basis `master` `f570696`.
- `node --check` auf allen 7 Kern-Dateien gruen, `npm test`-relevante Laeufe
  261 pass / 0 fail (Teil-Suiten, siehe unten).
- Kern wie geplant umgesetzt: reiner Entscheidungskern + fail-soft-Wrapper,
  Versuchszaehler = bestehender `failed`-Ledger, Geld-/Abo-Gate im
  Entscheidungskern selbst (nicht dupliziert), Enum statt Literale.
- Verdrahtung ausschliesslich in `GET /api/self-service/billing/return`,
  Karten-Zweig; keine neue Route, keine Auth-Aenderung, `route-policy.js`
  unberuehrt.
- Belege: `grep payment_method_types` in `src/` + `apps/web/src/` = 0 Treffer;
  keine `link`-Denylist (6 Treffer in `src/billing/` sind unveraenderte
  Bestandskommentare); `git diff master` fuer `src/store/pg.js`,
  `src/db/schema.sql`, `src/telephony/`, `src/routes/api-onboard.js` = leer.
  Keine neue npm-Dependency, kein echter Stripe-/Telnyx-Aufruf im Test
  (Fakes + injizierte Ports).
- Smoke: Server auf PORT=3987 sauber gebootet, `/healthz` ok;
  `config.provisioning.provisioningRetryMaxAttempts` liest die Env korrekt;
  `astro build` gruen, gebaute `/app/index.html` traegt den neuen
  `#agent-number-action`-Knopf (hidden).

### Deviations (Plan → Impl)

1. **Erzwungen durch `scripts/check-staged-suppressions.js`:** Der geplante
   Inline-Edit in `makeSelfServiceRoutes` haette die Zeilenzahl der Funktion
   veraendert und damit den vorgemerkten `max-lines-per-function`-Suppression-Eintrag
   destabilisiert (Hook lehnt das ab, `eslint-legacy-exceptions.json`-Eintraege
   sind Bau-Agenten verboten). Loesung: Nachlauf als eigene
   Modul-Ebene-Funktion `finishCardOnlyReturn({store, provision, config, audit,
   req, tenant})` in derselben Datei; im Router-Koerper ersetzt EINE Zeile die
   bisherige `audit()`-Zeile. Verhalten/Antwort identisch zum Plan.
2. **Klein, gleiche Ursache:** Die zwei neuen `state-ops.js`-Funktionen nehmen
   `state`/`number` statt der Datei-Kurzform `s`/`n`, weil `state-ops.js` einen
   exakten `eslint-legacy-exceptions.json`-Pin traegt, den die Kurznamen um 3
   `id-length`-Befunde angehoben haetten.
3. **Ergaenzung:** Fall 1 prueft zusaetzlich, dass das Audit-Detail
   `wiederanlauf=retry` traegt (kein Bestandstest pinnt dieses Detail).
4. **Test-Harness-Detail:** `makePgStore` liefert kein `withStoreLock`
   (Fassaden-Funktion aus `src/store.js`); Harness reicht sie nach — etabliertes
   Bestandsmuster. Seed-Tenant muss `t_<sub>` heissen (Request-Tenant kommt aus
   dem IdP-Subject).
5. **Nicht gefahren (Anweisung):** volle Suite `npm test` — der Lead faehrt sie
   einmal am Ende.
6. **Vorbestand, nicht verursacht:** `npm --prefix apps/web test` war vor GP-P3
   bereits teilweise rot (npx/astro-Sandbox-Eigenheit + 3 vorbestehende,
   byte-identische Faelle in `subscribe.test.js`). Die beiden von GP-P3
   beruehrten Web-Testdateien (`api`/`render`) sind gruen.
7. **Hinweis:** ein testweise gesetzter `node_modules`-Symlink auf den absoluten
   Repo-Pfad (fuer prettier/eslint) wurde vor dem Commit wieder entfernt, nicht
   committet.

## 4. Safety-Urteil

**approved: true** · testsPassIndependently: true · safetyGatesIntact: true ·
disclosureIntact: true · authFailClosedIntact: true · noSecretsLeaked: true ·
scopeRespected: true · behaviorAsIntended: true

Unabhaengig nachgefahren: 19 Dateien, 4 Laeufe, alle Exit 0 — Summe 241 pass /
0 fail (Backend + Frontend), zusaetzlich `node --check` auf den 4 Kern-Dateien.

**Kern-Begruendung (Verdikt PASS):**
- **Safety-Gates**: intakt und erweitert, nicht aufgeweicht — kein bestehendes
  Gate im Diff beruehrt (18 geaenderte Dateien, keine davon `telephony/`,
  `outbound-gates`, `route-policy`, `claude.js`, `bridge.js`). Die neu
  geldbewegende Route traegt das Gate selbst, dieselbe Gate-Funktion und
  KYC-Schwelle wie der bestehende Admin-Retry. Kein zweiter Kaufpfad — nur das
  injizierte `triggerTenantProvisioning`. Reload derselben `session_id`
  verbrennt keinen zweiten Versuch (Statuswechsel auf `requested` greift zuerst,
  Test belegt das gegen den echten Store).
- **Offenlegung**: unberuehrt — `claude.js`/`bridge.js` nicht im Diff,
  `disclosureSentence` kommt im Diff nicht vor.
- **Auth fail-closed**: kein neuer Endpunkt, kein neue Ausnahme; bestehende
  `webAuthPendingMw` + `requirePaymentEnabled` + `customerMatches`-Riegel
  unveraendert; `route-auth-inventory.test.js` gruen.
- **Secrets**: sauber, einzige neue Logzeile ist `err.message` ohne PII.
- **Scope**: eingehalten, keine neue Dependency, kein `payment_method_types`,
  keine `link`-Denylist, kein Signalwechsel an `invoiceTotal===0`.
- **Verhalten wie spezifiziert**: alle 4 Abnahmekriterien mechanisch gepinnt,
  plus 3 zusaetzliche Faelle fuer die Pre-Mortem-Risiken.

**Concerns (keine Blocker):**
1. Geht per Default scharf live (`PROVISIONING_RETRY_MAX_ATTEMPTS=3` in
   `render.yaml`) — kein Dark-Launch; Rollback-Hebel ist der Wert `0`
   (Test gepinnt).
2. `numberPlaceholderAction()` liefert ein `href`-Feld, das
   `AgentChip.astro` nicht konsumiert (Knopf geht ueber
   `startBillingSetupCheckout()`).
3. Nach `ATTEMPTS_EXHAUSTED` bleibt `numberStatusFor === 'failed'` — der Knopf
   bleibt sichtbar, weitere Klicks binden zwar eine Karte, stossen aber nichts
   mehr an, ohne sichtbares Feedback (fail-closed, aber Sackgasse fuer den
   Kunden; `needs_manual_reconcile` ist heute nur forensisch, kein UI-Signal).
4. Audit-Eintrag `self_service_card_saved` traegt jetzt immer
   ` wiederanlauf=<outcome>`, auch im unberuehrten Fall — additive
   Observability, HTTP-Antwort byte-identisch.
5. `resolveCardRebindRetry()` waere theoretisch unbegrenzt bei
   `maxAttempts=undefined/NaN` — in Produktion unerreichbar (`numEnv` liefert
   immer eine Zahl, Key ist in `CONFIG_NAMESPACES.provisioning` gepinnt).
6. Leichte Scope-Ausweitung: Literal-zu-Konstante-Vereinheitlichung in
   `provision-outcome.js`/`provision-trigger.js` — verhaltens-erhaltend, durch
   Tests abgedeckt, aber von der Phase nicht verlangt.

## 5. Clean-Code-Audit (s1–s4)

- **s1 (Blocker):** keine Funde.
- **s2 (Blocker):** keine Funde.
- **s3 (Hinweis, nicht blockierend):**
  - `apps/web/src/lib/api.js:numberPlaceholderAction` — das zurueckgegebene
    `href`-Feld (`BILLING_SETUP_CHECKOUT_PATH`) wird nirgends konsumiert;
    `AgentChip.astro` liest nur `.label` und ruft im Klick-Handler direkt
    `startBillingSetupCheckout()`. Nur der eigene Test prueft `href` (zirkulaer
    gegen dieselbe Konstante). Fix-Vorschlag: `href` entfernen oder als
    echtes `<a href>` verdrahten.
- **s4 (Blocker):** keine Funde.

**Verdikt Clean-Code: PASS.** Reiner Entscheidungskern, nachweislich nie
werfender fail-soft-Wrapper, kein zweiter Versuchszaehler (G5-konform),
Geld-/Abo-Gate im Entscheidungskern statt am Aufrufer dupliziert, Enum statt
String-Literale ueber drei Dateien vereinheitlicht, Test-Helper dedupliziert
(`lang-helper.js`). Alle drei Owner-Blocker-Muster (`payment_method_types`,
`link`-Denylist, `invoiceTotal===0`-Signalwechsel) nicht im Diff.

**Top-TODOs (nicht blockierend):**
1. Totes `href`-Feld in `numberPlaceholderAction` entfernen oder verdrahten.
2. Bei Gelegenheit pruefen, ob `PROVISIONING_RETRY_MAX_ATTEMPTS` einen
   sinnvollen Obergrenzen-Bound in `numEnv()` verdient (aktuell nur `min:0`).

## 6. Fix-Runden

Keine — beide Reviews (Safety + Clean-Code) kamen im ersten Durchlauf zu
`PASS` ohne Blocker. Die notierten Concerns/s3-Funde sind Hinweise fuer
spaetere Phasen (u.a. GP-P4), nicht Teil dieser Phase.
