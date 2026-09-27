# T2-20 Spec: Reviewer-Zugang (Anleitung, Seed-Skript, Login-Pfad)

- Umfang: GENAU O-9. Kein anderer Punkt.
- Branch/Worktree: `phase/openai-t2-20-reviewer-access-seed`,
  `/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/bd9573f0-5514-4611-89e2-53dd73e46bd1/scratchpad/wt-t2-20`
- Basis: `1c6b7a4` (master, T2-01..T2-19 + T2-23 gemergt - nicht zuruecknehmen).
- Dokument geht an OpenAI: jede Aussage am Code, OpenAI woertlich mit URL, keine internen Kennungen,
  EN nie glatter als DE.
- **`src/` wird in dieser Phase NICHT angefasst.** Damit sind tools/list, initialize,
  server-instructions, Prompts, Offenlegungssatz und alle Gates byte-gleich master; die
  Bench-Regel greift nicht. Beweis: `git diff --stat master -- src/` ist leer.

## 1. Primaerquelle (am 2026-09-27 per curl gegen die Einzelseiten verifiziert)

Woertlich, so und nicht anders ins Dokument uebernehmen:

1. https://developers.openai.com/plugins/app-guidelines (Abschnitt "Test credentials"):
   > "When submitting a plugin with an authenticated MCP server, provide a login and password for a fully featured demo account that includes sample data. Plugins that require additional login steps, such as a new account sign-up or 2FA through an inaccessible account, will be rejected."
2. https://developers.openai.com/plugins/deploy/app-review (haeufige Ablehnungsgruende):
   > "For servers requiring authentication, our review team must be able to log into a demo account with no further configuration required."
   > "Ensure that the provided URL and credentials are correct, do not feature MFA (including requiring SMS codes, login through systems that require SMS, email or other verification schemes)."
   > "Ensure that the provided credentials can be used to log in successfully (test them outside any company networks, local area networks, or other internal networks)."
   > "Confirm that the credentials have not expired."
3. https://developers.openai.com/plugins/deploy/submission:
   > "Test account or fixture data required to reproduce it."
   > "Use test cases that reviewers can run without internal context. If your plugin requires authentication, make sure the provided demo credentials can complete each test without MFA, SMS, email confirmation, or private-network access."
   > "Reviewer credentials work without MFA, email confirmation, SMS confirmation, or private-network access."
4. https://developers.openai.com/plugins/deploy/submission-errors:
   > "Reviewer-ready demo credentials when the server uses OAuth."

Zeilenumbrueche im Zitat sind im Original Zeilenumbrueche der Markdown-Quelle; im Dokument als
EIN Absatz setzen, Wortlaut unveraendert.

Abgeleitete Soll-Liste: (S1) Login+Passwort eines voll ausgestatteten Demo-Kontos mit Beispieldaten;
(S2) keine Neuanmeldung, kein 2FA/MFA, keine SMS-/E-Mail-Bestaetigung, kein privates Netz;
(S3) ohne weitere Konfiguration nutzbar; (S4) nicht abgelaufen; (S5) Beispieldaten reproduzierbar
fuer die Testfaelle.

## 2. Ist-Zustand am Code (Worktree, Basis 1c6b7a4)

### 2.1 Login-Pfad MCP (HTTP `/mcp`, Modus `MCP_AUTH=oauth`)
1. Discovery: `src/auth.js:371-386` `registerWellKnown` liefert
   `/.well-known/oauth-protected-resource` (+ `/mcp`) mit `resource`, `authorization_servers`
   = `[OAUTH_ISSUER_URL]` (WorkOS AuthKit laut `.env.example:1147` und `docs/RUNBOOK-AS-METADATA.md`),
   `scopes_supported` = `openid email offline_access` (`src/auth.js:61`).
2. Login-Maske, Passwort, MFA, E-Mail-Bestaetigung, Sign-up: liegen beim Anbieter (AuthKit), NICHT
   im Code. **Code kann "kein MFA" nicht belegen** -> Owner-Probe (s. 7).
3. Token-Pruefung: `src/auth.js:236-300` `makeVerifyOauth`: Signatur via JWKS, `issuer`,
   `audience`, `exp` Pflicht, Pflicht-Scopes; danach `req.auth = { sub, email, claims }`.
   Kein `email_verified`-Gate auf diesem Pfad.
4. Mandant: `src/routes/_tenant.js:141-163` `requestTenant` -> `store.resolveTenant(sub)`
   (`src/store/state-ops.js:5306-5316`: sub-Index, sonst `tenant.idpSubject`). **Reiner
   Lesezugriff; der MCP-Pfad legt NIE einen Mandanten an und loest NIE Provisioning aus.**
5. Kein Mandant: `src/routes/mcp.js:209-212` + `src/mcp-no-tenant.js` -> normale Werkzeugliste,
   jeder tools/call liefert `isError` mit Text "No Hermes account is linked..." und
   `_meta["mcp/www_authenticate"]` (T2-05). Fuer den Reviewer = Sackgasse = Ablehnung.
6. Token-/Legacy-Modus ist KEIN Reviewer-Weg: ohne `req.auth` faellt `requestTenant` auf
   `operatorChannelTenant` (`_tenant.js:101,161`): entfernt = `TENANT_REJECT` -> 403
   (`routes/mcp.js:99-102`). Dokument nennt nur OAuth.
7. stdio (`src/mcp-server.js`) hat keine Auth-Schicht (autonome Entscheidung 2026-09-21) und ist
   fuer OpenAI nie erreichbar - betrifft den Reviewer nicht.

### 2.2 Wie ein Mandant entsteht (und wie NICHT)
- Einziger Kunden-Anlageweg: Browser-Login der Web-App. `src/web-auth.js:187-214` `mintSession`
  -> `accounts.upsertOnFirstLogin` (`src/web-auth.js:597-645`): ohne verifizierte E-Mail Abbruch
  (`:611-614`, `email_verified === true` in `:365`); Dedup ueber E-Mail, sonst neuer Mandant im
  Status `suspended`; `bindSub` spiegelt sub in den Resolver-Index (`:196-199`).
  Wiederholter Login derselben sub: `ON CONFLICT (sub)` -> derselbe Mandant.
- Nummernkauf: NUR nach Zahlung. `src/billing/activation.js:86-110` `activatePaidTenant`: KYC
  `card`, dann `provision(tenant)` (`:106`); aktiv erst bei geklaertem Provisioning. Login allein
  kauft KEINE Nummer. Caps `MAX_NUMBERS`/`MAX_NUMBERS_PER_TENANT` (`src/config.js:1574`)
  unangetastet.
- Operator-Weg `/api/onboard` (`src/routes/api-onboard.js`) ist Admin-only und NICHT Teil der
  Reviewer-Vorbereitung.
- Folge: Reviewer-Mandant entsteht durch EINEN Browser-Login des Owners mit den Reviewer-Zugangs-
  daten + echtes Abo. Danach bindet der MCP-OAuth-Login des Reviewers ueber dieselbe sub
  ("EINE Identitaetsquelle wie der Web-Login", `.env.example:928-933`) ohne jeden Zusatzschritt.
  Ob die sub im ChatGPT-Token wirklich gleich der Web-sub ist, belegt nur die Live-Probe (7.4).

### 2.3 Gates fuer den Reviewer-Mandanten = Gates jedes Kunden
`src/telephony/outbound-gates.js`: `kycGateError` `:421`, `allowlistError` `:438` (inaktiv ->
`abo`, `billing_hold`, sonst nur aktiver KYC-Subscriber; `profile.unrestricted`/
`profile.allowedNumbers` sind Admin-Overrides und duerfen NIE gesetzt werden), Stundenlimit
`:390-396`/`:492`, Ziel-Limit `:401-405`, Denylist/Format/Land `:515-532`, `budget_tenant` `:576`,
Notaus `outbound_frozen` `:699`. Keine Ausnahme, kein Reviewer-Modus.

### 2.4 Store-Mechanik, die das Seed-Skript beachten MUSS
- `createCall` (`state-ops.js:241`) setzt `startedAt=now`, `status:"active"`.
  - Ein aktiver Call wird vom Watchdog aufgegriffen (`src/telephony/call-lifecycle.js:148,327`)
    -> Seed-Calls MUESSEN im selben Lauf beendet werden (`endCallRecord`, `state-ops.js:673`).
  - Ein OUTBOUND-Call mit `startedAt=now` zaehlt ins Stundenlimit und Ziel-Limit
    (`countOutboundCallsSince`, `state-ops.js:1753-1766`) -> **nur INBOUND seeden.**
- `answeredAt` NICHT setzen: sonst zaehlt der Call in die Kosten-Nachtrags-Quote
  (`src/billing/cost-truing.js:463-469`) ohne Kostennachweis und kann einen Operator-Alarm
  ausloesen; ohne `answeredAt` = Bucket `NEVER_ANSWERED`, 0 Minuten.
- Ohne `costProfile` zaehlt ein Inbound-Call nicht in den Inbound-Ausfallalarm
  (`src/elevenlabs/inbound-bridge-state.js:19-24`, `src/telephony/outage-classes.js:44-48`);
  Outbound-Alarm zaehlt nur outbound (`outage-detection.js:57`).
- Retention: beendete Calls fallen nach `RETENTION_DAYS` (`src/config.js:2036`, Default 30) weg
  (`state-ops.js:5120-5134`); offene Action Items bleiben. -> Seed kurz vor Einreichung, bei
  langem Review erneut (idempotent).
- pg-Backend: `src/store/pg.js:1756-1800` `flush` schreibt in EINER Transaktion ALLE Mandanten,
  je Mandant `SET app.current_tenant` (`:1775`), und LOESCHT fehlende Zeilen
  (`flushCalls` -> `deleteMissingCallsKeepActive` `:2171,2696`; `flushActionItems` -> `deleteMissing`
  `:2283`). Konsequenzen:
  (a) laeuft der Dienst waehrend des Seeds, loescht sein naechster Flush die Seed-Zeilen;
  (b) der Flush des Skripts schreibt seinen Schnappschuss ALLER Mandanten zurueck und
      ueberschreibt, was der Dienst dazwischen geschrieben hat (Calls, Usage/Budget-Zaehler!).
  -> **Gegen pg nur bei GESTOPPTEM Dienst**, danach Start. "Neustart danach" reicht NICHT.
- `list_calls` liest `GET /api/state` (`src/routes/api-read.js:63-80`, tenant-gescoped ueber
  `exportTenantData`), Handler `src/mcp-tools.js:2002-2021` (`pickCall` `:748-758`: id, direction,
  counterparty, status, startedAt, summary maskiert). `list_action_items`
  `src/mcp-tools.js:2059-2072` (offene Items, Text). `check_inbox` braucht `inboxEntryAt`
  (`state-ops.js:835`) - wird NICHT geseedet (s. 5).

## 3. Schritte

### Schritt 1 - Seed-Kern `scripts/lib/reviewer-demo-seed.mjs` (neu)
- Was: reine Logik, keine Env, kein Store-Import. Exportiert
  - `REVIEWER_SEED_CALLS` (eingefroren): 3 INBOUND-Datensaetze `{ from, summary, actionItems[] }`,
    Englisch, fiktive Nummern aus dem NANP-Fiktivbereich `+1 202 555 0100..0199`
    (z.B. `+12025550142`), keine Namen realer Personen, keine Restricted Data (keine Karten-,
    Konto-, Gesundheits-, Ausweisdaten), keine E-Mail-Adressen. Insgesamt 2-4 Action Items.
  - `planReviewerSeed(store, tenantId)` -> Liste der FEHLENDEN Datensaetze.
    Idempotenzschluessel Call: (tenantId, direction `inbound`, `from`, `summary`) gegen
    `store.exportTenantData(tenantId).calls`; Item: offener Eintrag mit gleichem Text im
    Mandanten-Scope.
  - `applyReviewerSeed(store, tenantId)` -> `{ callsCreated, itemsCreated }`. Schreibt
    AUSSCHLIESSLICH ueber `store.createCall({ direction:"inbound", from, to: <aktive Nummer des
    Mandanten oder null>, tenantId })`, `store.recordProviderCallResult(id, { summary,
    objectiveAchieved: null })`, `store.endCallRecord(id, "completed")`,
    `store.addActionItem(id, text, "todo")`. KEIN `markAnswered`, kein `costProfile`, kein
    Transkript, kein anderer Setter.
  - Verweigert (wirft, schreibt nichts): leere/fehlende tenantId, `BOOTSTRAP_TENANT_ID`,
    `!store.tenantExists(tenantId)`. Legt NIE einen Mandanten an.
- Datei: `scripts/lib/reviewer-demo-seed.mjs` (neu). Funktionen <= 40 Zeilen, keine Magic Numbers.
- IDs: O-9. Pfade: keiner der Transportpfade; Store json UND pg.
- Beweis: (b) Test Schritt 3/4.

### Schritt 2 - CLI `scripts/seed-reviewer-demo.mjs` (neu)
- Was:
  - Ohne `--apply`: Trockenlauf. Druckt die geplanten Datensaetze aus `REVIEWER_SEED_CALLS` und
    "Trockenlauf - nichts geschrieben", Exit 0. **Importiert `src/store.js` NICHT** (Store nur per
    dynamischem `import()` im Apply-Zweig) - sonst liefe unter pg `init()` samt DDL.
  - `--apply` ohne `--tenant <id>`: Nutzungshinweis, Exit 1, kein Store-Import.
  - `--apply` mit `STORE_BACKEND=pg` ohne `--dienst-gestoppt`: Abbruch Exit 1 VOR dem Store-Import,
    Meldung erklaert 2.4 (a)/(b). Das Backend ueber `config.store.storeBackend` lesen (Env
    zentral in `src/config.js`); `src/config.js` importiert den Store nicht (geprueft: Importe
    `src/config.js:1-29`), der config-Import ist also erlaubt, der Store-Import nicht.
  - `--apply --tenant <id>`: Store laden, `applyReviewerSeed`, `await store.save()`, Ausgabe nur
    Zaehler ("angelegt: X Anrufe, Y Action Items" bzw. "nichts zu tun"), nie tenantId/Nummern/
    Summaries in stdout. Nur-Lese-Warnung, wenn `!store.tenantActiveSubscriber(id, KYC_OUTBOUND_MIN)`
    ("Outbound bleibt gesperrt, bis Abo und Verifikation echt bestehen") - KEIN Schreiben dazu.
  - Kopfkommentar: Zweck, Verbote (nie Abo/KYC/Status/Profil/Nummer/Budget), pg-Ablauf
    (Dienst stoppen -> Skript -> Dienst starten), Idempotenz, Retention-Hinweis.
- Datei: `scripts/seed-reviewer-demo.mjs` (neu). Muster: `scripts/seed-owner-number.js`.
- IDs: O-9. Pfade: Store json/pg.
- Beweis: (b) Test Schritt 3 inkl. Import-Spion (`test/_import-spion-store.mjs`) mit
  Positiv-Kontrolle.

### Schritt 3 - Test `test/openai-t2-20-reviewer-seed.test.js` (neu, json/Temp-DATA_DIR, Spawn)
Kindprozesse IMMER mit `{ ...BASE_ENV, DATA_DIR }` (Lehre BASE_ENV-Drift). Kein pglite in dieser
Datei. Testnamen ohne Katalog-/ABNAHME-Praefix.
1. Ohne Argumente: Exit 0, stdout enthaelt "Trockenlauf", `store.json` byte-gleich; Import-Spion-
   Marke fehlt. Positiv-Kontrolle: `--apply --tenant <T>` zeigt die Marke.
2. `--tenant T` ohne `--apply`: byte-gleich, Marke fehlt.
3. `--apply` ohne `--tenant`: Exit 1, byte-gleich.
4. `--apply --tenant <unbekannt>` und `--apply --tenant <BOOTSTRAP_TENANT_ID>`: Exit 1, byte-gleich.
5. `STORE_BACKEND=pg DATABASE_URL=postgres://127.0.0.1:1/unerreichbar --apply --tenant T` ohne
   `--dienst-gestoppt`: Exit 1, Marke fehlt (kein Verbindungsversuch).
6. `--apply --tenant T` (Seed: Nicht-Owner-Mandant T, `idpSubject` gesetzt, aktive Nummer,
   Abo-/KYC-Felder beliebig): Diff vorher/nachher:
   - ALLE Top-Level-Schluessel ausser `calls`, `actionItems` deep-equal (deckt tenants, profiles,
     numbers, subscription, kyc, budget, usage, settings ab - staerker als "kein Abo-/KYC-Feld").
   - Genau 3 neue Calls, alle `tenantId===T`, `direction==="inbound"`, `status==="completed"`,
     `answeredAt===null`, `endedAt` gesetzt, `summary` = Seed-Text, kein `costProfile`.
   - Neue Action Items genau die Seed-Texte, `done===false`, an den neuen Calls.
   - Positiv-Kontrolle des Diff-Pruefers: ein absichtlich veraenderter Profil-Schluessel wird
     vom Diff-Helfer als Abweichung gemeldet.
7. Zweiter `--apply`-Lauf: `store.json` deep-equal zum Stand nach Lauf 1, stdout "nichts zu tun".
8. Draht (HTTP `/mcp`, OAuth): `startIdp()` + `startServer({ env: { MCP_AUTH:"oauth",
   OAUTH_ISSUER_URL: idp.issuer, MULTI_TENANT:"true" }, dataDir })` auf dem Stand nach Lauf 1;
   Token fuer sub von T; Aufruf ueber `externalIp()` (nicht localhost):
   - `tools/call list_calls` -> `structuredContent.calls` enthaelt die 3 Seed-Eintraege
     (direction `inbound`, status `completed`, summary = Seed-Text).
   - `tools/call list_action_items` -> Text enthaelt jeden Seed-Item-Text.
   - Danach Store: Zahl der Mandanten und Nummern unveraendert (kein Onboarding, kein Kauf).
9. Draht negativ: Token mit unbekannter sub -> `isError`, `_meta["mcp/www_authenticate"]`
   vorhanden; Mandanten-Zahl unveraendert (MCP-Login legt keinen Mandanten an).
- IDs: O-9. Pfade: HTTP /mcp OAuth; json-Store.
- Beweis: (b) dieser Test gruen, isoliert wiederholt.

### Schritt 4 - Test `test/openai-t2-20-reviewer-seed-pg.test.js` (neu, PGlite, kein Spawn)
- `makePgTestStore()` (`test/pg-helpers.js`), Mandant T + Owner anlegen, `applyReviewerSeed`,
  `save()`, neu oeffnen mit `makePgStore(runner)` + `init()`: Calls/Items fuer T vorhanden
  (RLS-Pfad ueber `app.current_tenant`), Tenant-Zeile/Abo/KYC unveraendert, zweiter Apply ->
  `{0,0}`, Owner-Mandant ohne Seed-Zeilen.
- IDs: O-9. Pfade: pg-Store.
- Beweis: (b) Test gruen.

### Schritt 5 - Dokument `docs/OPENAI-REVIEWER-ACCESS.md` (neu, Opus schreibt)
Aufbau (EN-Teil fuer OpenAI vollstaendig und eigenstaendig; DE-Teil inhaltsgleich; kein Satz,
keine Einschraenkung fehlt in einer Fassung):
1. What OpenAI requires - die Zitate aus Abschnitt 1, woertlich, je mit URL.
2. Credentials - nur Platzhalter: `<REVIEWER_EMAIL>`, `<REVIEWER_PASSWORD>`,
   `<MCP_SERVER_URL>`, `<TEST_TARGET_NUMBER>`; "the values are entered in the submission form".
3. Login path, step by step, je Schritt Code-Stelle (2.1): Connector-URL -> Protected Resource
   Metadata -> Sign-in beim Authorization Server -> Token -> Konto verbunden. Was Hermes selbst
   NICHT steuert (MFA, E-Mail-Bestaetigung, Sign-up-Maske liegen beim Authorization Server) - als
   Betreiber-Zusage formulieren, nicht als Code-Tatsache.
4. What happens on first connection: Konto existiert bereits und ist mit Abo+Verifikation aktiv;
   der Connector-Login legt kein Konto an, kauft keine Nummer (Code-Stellen 2.1.4, 2.2); ohne
   verknuepftes Konto kaeme die Meldung aus 2.1.5 - beim Reviewer-Konto nicht erwartet.
5. Sample data: Liste der Seed-Anrufe/Items (Texte = `REVIEWER_SEED_CALLS`), welche Werkzeuge sie
   zeigen (`list_calls`, `list_action_items`); Hinweis, dass die Anrufer-Nummern fiktiv sind und
   nicht angerufen werden sollen.
6. Same safeguards as every customer: Gates aus 2.3 in Klartext (ohne Produktionswerte, ohne
   Zahlen fuer Limits), keine Ausnahme fuer das Reviewer-Konto; Anrufe nur mit Bestaetigung in
   der Karte (nur wenn am Handler belegt - prepare_call/place_call-Handler lesen, sonst weglassen).
7. Test calls: nur an `<TEST_TARGET_NUMBER>`; KEINE Behauptung, dass der Code andere Ziele
   verhindert (tut er nicht; es gelten nur die normalen Gates).
8. Expiry: Beispieldaten folgen der normalen Aufbewahrung; der Betreiber frischt sie vor und
   waehrend des Reviews auf. Keine konkrete Tageszahl nennen (Produktionswert).
9. Anker-Block (maschinenlesbar, Muster `docs/OPENAI-POLICY-ABGLEICH.md:871 ff.`).
Verboten im Text: interne Kennungen (T-, O-, N-, H-, OW-, T2-, Phasen-/P-/E-Nummern), echte
E-Mail-Adressen, Mandanten-IDs, Nummern ausser Platzhaltern und dem fiktiven 555-01xx-Bereich,
Env-Werte.
- IDs: O-9. Pfade: HTTP /mcp OAuth (einziger Reviewer-Pfad; stdio/Token ausdruecklich nicht).
- Beweis: (b) Test Schritt 6.

### Schritt 6 - Test `test/openai-t2-20-reviewer-doku.test.js` (neu)
1. Anker-Block: an jeder `datei:zeile` steht der Anker-Text; jede `datei:zeile` im Fliesstext
   steht im Block und umgekehrt (Muster `test/openai-policy-abgleich-doku.test.js`).
2. Hygiene: `interneKennungen(text)` (`test/mcp-vertrag-pruefung.js:616`) leer; zusaetzlich kein
   `\bPhase\b`, kein `\b[PE]\d+[a-z]?\b`; keine E-Mail-Adresse ausser Platzhaltern; keine
   E.164 ausser `+1202555 01xx`; keine Secret-Muster (`sk_`, `whsec_`, `user_[A-Za-z0-9]{10,}`,
   `org_`). Positiv-Kontrolle je Muster an einem Negativ-String.
3. Jedes Zitat (`> "...`) nennt eine `https://developers.openai.com/`-URL; die vier Soll-Zitate aus
   Abschnitt 1 stehen woertlich im EN-Teil.
4. Beispieldaten-Abschnitt = `REVIEWER_SEED_CALLS` (Import aus `scripts/lib`), EN und DE.
5. Jeder im Dokument genannte Werkzeugname steht im ECHTEN tools/list ueber HTTP `/mcp`
   (Server-Spawn, Legacy-Token, Consult an) - nie am Registrierungsobjekt.
6. EN/DE-Paritaet: dieselben Platzhalter, dieselbe Zahl Schritte im Login-Pfad, jede Warnung
   (Test-Ziel, fiktive Nummern, Ablauf) in beiden Teilen (Stichwortliste je Sprache).
- IDs: O-9. Pfade: HTTP /mcp (tools/list). Beweis: (b).

### Schritt 7 - `PLAN-SECURITY.md` nachziehen
- Eintrag: Reviewer-Konto ist ein regulaerer Kunde (echtes Abo+KYC, keine Gate-Ausnahme, nicht in
  `OWNER_SELF_CALL_TENANT_IDS`, kein `profile.unrestricted`/`allowedNumbers`); Seed-Skript schreibt
  nur Inbound-Calls/Items, verweigert Owner-Mandant und unbekannte Mandanten, Trockenlauf-Default,
  pg nur bei gestopptem Dienst (Begruendung 2.4). Keine Produktionswerte.
- Beweis: (a) Abschnitt vorhanden; `grep -n "seed-reviewer-demo" PLAN-SECURITY.md` liefert Treffer.

### Schritt 8 - Abschluss-Nachweise
- `git diff --stat master -- src/` leer (tools/list/initialize/Gates byte-gleich).
- `git diff --stat master -- eslint-legacy-exceptions.json eslint-suppressions.json` leer.
- `npx eslint scripts/seed-reviewer-demo.mjs scripts/lib/reviewer-demo-seed.mjs test/openai-t2-20-*.test.js` -> 0 Befunde.
- `node --check` fuer beide Skripte.
- `npm test -- -- --test-concurrency=4 > <logs>/npm-test.log 2>&1`; nur `# pass`/`# fail`
  lesen; rot erst zaehlen, wenn isoliert rot.
- Keine neue Env-Variable (kein Vier-Orte-Schritt noetig). Server/Testserver mit `ps` pruefen.

## 4. Tests: was bricht, was beweist
- Brechen: keiner erwartet (kein `src/`-Eingriff). Scripts-Scanner `test/iel-b10-geheimnisse.test.js:1012`
  filtert `iel-geheimnisse*` - neue Dateien nicht betroffen.
- Neu: Schritte 3, 4, 6.

## 5. Nicht bauen
- Kein Reviewer-Modus, keine Gate-Ausnahme, kein Setzen von Abo/KYC/Status/Profil/Budget/Nummer
  (Regel 1; Owner richtet echtes Abo+KYC ein).
- Kein neuer Endpunkt (CLI reicht; Regel 3).
- Keine Mandanten-/Account-Anlage im Skript, kein Provisioning-Anstoss (Pre-Mortem b).
- Keine Outbound-Seed-Calls (verbrauchen Stunden-/Ziel-Limit, 2.4).
- Kein `check_inbox`-Seed (`inboxEntryAt` ist kein Seed-Store-Weg des Plans; ggf. T2-21-Entscheidung).
- Keine Transkripte im Seed (Datenminimierung, werden nicht gebraucht).
- Keine Beschraenkung des Reviewer-Kontos auf ein Testziel im Code (waere ein neuer Gate-
  Mechanismus ausserhalb O-9; Entscheidung Betreiber).
- Keine AuthKit-Konfiguration (Anbieter/Owner), keine stdio-/Token-Modus-Aenderung.
- Keine Aenderung an `src/`, Prompts, Offenlegung, Werkzeugtexten, server-instructions.
- Keine Owner-Runbook-Datei zusaetzlich (Ablauf steht im Skriptkopf + owner_punkte).

## 6. Pre-Mortem (ein Jahr spaeter war es ein Fehler)
1. Seed wurde "praktisch" erweitert und schaltet einen Mandanten ohne Zahlung frei -> Test 3.6
   prueft deep-equal ALLER Nicht-Call/Item-Schluessel; Kern kennt nur vier Store-Funktionen.
2. Skript lief gegen pg bei laufendem Dienst -> Seed-Zeilen weg (Reviewer sieht leere Liste =
   Ablehnung) oder, schlimmer, Dienst-Schreibungen aller Mandanten (Usage/Budget-Zaehler)
   mit altem Schnappschuss ueberschrieben -> Kostendecke faktisch zurueckgesetzt. Gegenmittel:
   `--dienst-gestoppt` Pflicht bei pg, Abbruch vor Store-Import, Test 3.5; Skriptkopf.
3. Trockenlauf importierte den Store -> unter pg DDL gegen Produktion. Gegenmittel: dynamischer
   Import nur im Apply-Zweig; Import-Spion-Test mit Positiv-Kontrolle.
4. Seed-Calls blieben `active` -> Watchdog "beendet" sie ueber den Provider, Abrechnung/Alarm.
   Gegenmittel: sofort `endCallRecord`, Test prueft `completed`.
5. Outbound-Seeds fraßen das Stundenlimit -> Reviewer-Testanruf 429 -> Ablehnung. Gegenmittel:
   nur inbound.
6. `answeredAt` gesetzt -> Kosten-Nachtrags-Quote faellt, Operator-Alarm. Gegenmittel: nie setzen.
7. Reviewer-Login legt neuen Mandanten an + kauft Nummer -> am Code widerlegt (MCP-Pfad rein
   lesend, Kauf nur nach Zahlung); Test 3.9. Rest-Risiko: Reviewer registriert sich auf der
   Website mit anderer E-Mail -> suspendierter Mandant ohne Nummer, keine Kosten.
8. sub im ChatGPT-Token != Web-sub (anderer AuthKit-Client/Umgebung) -> "No Hermes account linked"
   -> Ablehnung. Gegenmittel: Live-Probe in ChatGPT vor Einreichung (Owner 7.4).
9. AuthKit verlangt doch E-Mail-Code/MFA oder Sign-up -> Ablehnung. Dokument behauptet es nicht
   als Code-Tatsache; Owner-Probe von aussen (7.1).
10. Beispieldaten nach Retention verschwunden / Abo abgelaufen -> "credentials expired". Gegenmittel:
    Owner frischt vor Einreichung auf, Abo laeuft durch; Dokument nennt es.
11. Reviewer ruft echte Dritte an oder die fiktiven Seed-Nummern -> normale Gates greifen,
    Offenlegung bleibt; Dokument nennt nur `<TEST_TARGET_NUMBER>`; kein Code-Versprechen.
12. Reviewer-Mandant in `OWNER_SELF_CALL_TENANT_IDS` gepinnt -> Anruf ohne vollen
    Offenlegungssatz. Gegenmittel: Owner-Punkt ausdruecklich "nicht pinnen", PLAN-SECURITY.
13. Zugangsdaten/IDs/Adressen im Repo oder Log -> nur Platzhalter, Skript loggt nur Zaehler,
    Hygiene-Test.
14. Dokument behauptet mehr als der Code (z.B. "no MFA", "calls only to test number") -> Anker-
    Test, Formulierung als Betreiber-Zusage; EN/DE-Paritaetstest.

## 7. Owner-Punkte (nur OWNER-REGEL; Kette hat keinen Produktionszugriff)
1. AuthKit-Nutzer fuer Reviewer anlegen (Anbieter-Einstellung): E-Mail als verifiziert, Passwort,
   KEIN MFA; Anmeldung im privaten Fenster ausserhalb des Firmennetzes pruefen. Erwartet: Login
   ohne Code-/SMS-/E-Mail-Schritt.
2. Einmal im Browser in der Web-App mit diesen Daten anmelden (legt genau einen Mandanten an),
   echtes Abo abschliessen (echte Zahlung). Erwartet: genau eine Nummer, Status aktiv. Mandant NICHT
   in `OWNER_SELF_CALL_TENANT_IDS` (Render-Dashboard), kein Admin-Override.
3. Seed gegen Produktion: Dienst stoppen (Render) -> lokal
   `STORE_BACKEND=pg DATABASE_URL=... node scripts/seed-reviewer-demo.mjs --tenant <ID> --apply --dienst-gestoppt`
   -> Dienst starten. Erwartet: "angelegt: 3 Anrufe, ..."; zweiter Lauf "nichts zu tun".
   Kurz vor Einreichung und bei langem Review wiederholen.
4. Live-Probe ChatGPT Developer Mode mit den Reviewer-Daten: verbinden, `list_calls`,
   `list_action_items`. Erwartet: Beispieldaten sichtbar, kein Zusatzschritt.
5. Sichere Testziel-Nummer festlegen (UNKNOWN im Code; Vorschlag Plan: eigene DID mit
   Inbound-Agent) und im Formular eintragen.
6. Deploy/Push des Merges; Deploy-Vorbedingung: keine (kein `src/`-Eingriff).

## 8. Widersprueche / Abweichungen
1. `tasks/openai-audit/00-openai-anforderungen.md:104` ordnet das Zitat "Plugins that require
   additional login steps ..." der Seite `/plugins/deploy/app-review` zu. Am 2026-09-27 steht es
   dort NICHT (curl: 0 Treffer), sondern auf `https://developers.openai.com/plugins/app-guidelines`
   (Abschnitt "Test credentials"). Dokument zitiert mit der richtigen URL.
2. Plan-Abnahme "Store-Diff enthaelt KEIN Abo-/KYC-/Verifikationsfeld" ist zu schwach: auch
   `profile.unrestricted`/`profile.allowedNumbers` (`outbound-gates.js:438-462`) heben das
   Outbound-Gate auf. Spec verschaerft auf deep-equal aller Nicht-Call/Item-Schluessel.
3. Plan-Ziel "legt Beispiel-Anrufe an" ohne Richtung: `createCall` setzt `startedAt=now` und
   `active`; Outbound-Seeds verbrauchen Stunden-/Ziel-Limit, aktive Seeds greift der Watchdog.
   Spec: nur inbound, sofort beendet, ohne `answeredAt`.
4. Lead-Pre-Mortem (d) "nach DB-Schreiben braucht der Dienst einen Neustart" reicht nicht: der
   pg-Flush loescht fehlende Zeilen und schreibt ALLE Mandanten (`pg.js:1756-1800,2171,2283`).
   Richtig ist: Dienst VOR dem Seed stoppen, danach starten.
5. Plan/OW-L nennt nicht, wie der Reviewer-Mandant an den AuthKit-Nutzer gebunden wird: das
   geschieht nur ueber einen Browser-Login in der Web-App mit verifizierter E-Mail
   (`web-auth.js:187-199,597-645`), nicht ueber den MCP-Login. In Owner-Punkt 2 aufgenommen.
6. OW-L "sichere Testziel-Nummer (Vorschlag eigene DID)" ist am Code nicht als sicher belegt:
   kein Gate unterscheidet Testziele. UNKNOWN, Owner-Entscheidung; Dokument verspricht keine
   Code-Beschraenkung.
7. Plan-Abschnitt nennt genau O-9 - deckungsgleich mit der gepinnten Liste.
