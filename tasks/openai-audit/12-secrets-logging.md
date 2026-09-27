# Audit D12: Secrets und Logging

Dimension: D12 | Quelle: Code auf Branch master

## Kurzfassung

Secrets laufen ausschliesslich ueber `process.env` -> zentralisiert in `src/config.js`,
mit Kommentaren "SECRET - nie loggen/leaken" an jeder Stelle. `.env.example` enthaelt
keine echten Werte, nur Platzhalter/Format-Kommentare. Volltext-Suche ueber die
gesamte lokale Git-Historie (2578 Commits) nach gaengigen Secret-Mustern (Anthropic,
Stripe, AWS, private Keys, Slack) fand nichts; nie wurde eine `.env`-Datei committet.
Logging ist diszipliniert whitelist-basiert (`src/metrics.js`), MCP-Tool-Antworten
laufen durch explizite Feld-Whitelists (`pickAgentStatus` etc.), nirgends wird
`err.stack` an einen Client gereicht. Groesste Luecken: kein Env-basiertes Log-Level
(Prod=Dev in der Verbosity), Secrets-Rotation ist ein manuelles Runbook ohne
technische Durchsetzung, und der Telnyx-Scoped-Key/Least-Privilege-Checklistenpunkt
in `PLAN-SECURITY.md` ist als offen (`[ ]`) markiert, nicht umgesetzt.

## Pruefpunkte

### PP-D12-01 Keine Secrets im Quellcode/Fixtures/Frontend

- Status: PASS
- Evidenz: `grep -rn` ueber `src/`, `apps/`, `public/`, `render.yaml` nach
  API-Key-/Token-Mustern lieferte nur Variablennamen-Referenzen
  (`src/config.js:673` `telnyxApiKey: process.env.TELNYX_API_KEY`,
  `src/config.js:909` `stripeSecretKey: process.env.STRIPE_SECRET_KEY`,
  `src/config.js:1989` `oidcClientSecret: process.env.OIDC_CLIENT_SECRET`,
  `src/config.js:2001` `workosManagementApiKey: process.env.WORKOS_MANAGEMENT_API_KEY`),
  keine eingebetteten Werte.
- Risiko: keins identifiziert.
- Empfehlung: keine.
- Prioritaet/Kategorie: n/a / n/a

### PP-D12-02 `.env.example` traegt keine echten Zugangsdaten

- Status: PASS
- Evidenz: `.env.example:2` `ANTHROPIC_API_KEY=sk-ant-...` (Platzhalter-Prosa),
  `.env.example:500` `STRIPE_SECRET_KEY=` (leer), `.env.example:113`
  `TELNYX_SIP_TRUNK_PASSWORD=  # SECRET (nie committen)`. Alle als SECRET markierten
  Keys stehen leer oder mit Platzhaltertext, nie mit einem plausiblen echten Wert.
- Risiko: keins identifiziert.
- Empfehlung: keine.
- Prioritaet/Kategorie: n/a / n/a

### PP-D12-03 Secret in lokal vorhandener Git-Historie

- Status: PARTIAL (positiv getestet, aber Testabdeckung ist inhaerent unvollstaendig)
- Evidenz: Geprueft: (a) `git log --all --diff-filter=A --name-only` auf alle Commits
  -> keine `.env`-artige Datei (ausser `.env.example`) wurde je hinzugefuegt.
  (b) `git log --all -p` (volle Historie, 2578 Commits) gegrept auf
  `sk-ant-api03-...`, `sk_live_...`, `sk_test_...` (>=20 Zeichen), `AKIA[0-9A-Z]{16}`,
  PEM-Private-Key-Header, Slack-`xox*`-Token -> 0 Treffer.
  NICHT geprueft: generische/kurze Secrets ohne erkennbares Praefix (z.B. rohe
  `openssl rand -hex 32`-Werte fuer `SESSION_SECRET`/`MCP_AUTH_TOKEN` sehen wie
  beliebiger Hex-String aus und sind mit einem Muster-Grep nicht von Zufallsdaten
  unterscheidbar), Telnyx-API-Keys (kein bekanntes festes Praefix-Format extrahiert),
  WorkOS-Secrets, Bilddateien/Screenshots im Repo (`Claude outputs/`, `tasks/`) auf
  eingebettete Zugangsdaten, sowie geloeschte/nie gemergte Branches, die evtl. per
  `git fsck --unreachable` noch als lose Objekte im lokalen `.git` liegen (nicht
  durchsucht).
- Risiko: ein kurzes, generisches Secret (z.B. ein versehentlich committeter und
  spaeter entfernter `MCP_AUTH_TOKEN`) waere mit den oben genutzten Mustern nicht
  gefunden worden.
- Empfehlung: vor Public-Submission einen dedizierten Secret-Scanner (z.B.
  gitleaks/trufflehog) einmalig ueber die volle lokale Historie laufen lassen, der
  auch entropie-basiert sucht statt nur musterbasiert.
- Prioritaet/Kategorie: P1 / C

### PP-D12-04 Secrets ausschliesslich ueber Umgebungsvariablen, zentralisiert

- Status: PASS
- Evidenz: `src/config.js` liest alle sicherheitsrelevanten Werte ausschliesslich aus
  `process.env.*` (z.B. Zeilen 502, 673, 909, 1984, 1988, 1989, 2001); Boot-Guards
  erzwingen Pflichtfelder (`src/config.js:2401` `{ fehlt: () => !config.llm.anthropicApiKey,
  name: "ANTHROPIC_API_KEY" }`, `src/config.js:2430` analog fuer
  `STRIPE_SECRET_KEY (weil PAYMENT_ENABLED=true)`). Kein Secret ist hartkodiert oder
  kommt aus einer Config-Datei im Repo.
- Risiko: keins identifiziert (Architektur passend fuer Skalierung).
- Empfehlung: keine.
- Prioritaet/Kategorie: n/a / n/a

### PP-D12-05 Trennung Dev/Prod fuer Secrets

- Status: PARTIAL
- Evidenz: `render.yaml` nutzt fuer sensible Keys durchgehend `sync: false` (49
  Fundstellen), d.h. der Wert wird im Render-Dashboard pro Service manuell gepflegt
  und nicht aus dem Blueprint uebernommen — das ermoeglicht getrennte Werte pro
  Environment. `PLAN-SECURITY.md:1109` empfiehlt fuer den Telnyx-Key ausdruecklich
  "Pro Umgebung (Staging/Prod) eigener Key", ist aber als offener Checklistenpunkt
  (`- [ ] Scoped API Key ... Pro Umgebung ... eigener Key`, `PLAN-SECURITY.md:1109`)
  markiert, nicht als erledigt.
- Risiko: ohne durchgesetzte Trennung kann ein kompromittierter Test-/Staging-Zugang
  denselben Blast-Radius wie Prod haben (z.B. ein gemeinsam genutzter
  `TELNYX_API_KEY`).
- Empfehlung: den offenen Checklistenpunkt in `PLAN-SECURITY.md` (Scoped Key +
  Umgebungstrennung) vor Public-Launch abschliessen oder als bewusst akzeptiertes
  Risiko mit Owner-Entscheidung dokumentieren.
- Prioritaet/Kategorie: P1 / C

### PP-D12-06 Secret-Rotation

- Status: PARTIAL
- Evidenz: `PLAN-SECURITY.md:1117-1143` dokumentiert ein vollstaendiges,
  nachvollziehbares 5-Schritt-Rotationsverfahren je Secret-Typ inkl.
  Besonderheiten (`STRIPE_SECRET_KEY` Roll-Key, `SESSION_SECRET` invalidiert
  Sessions, etc.) und eine empfohlene Kadenz (vierteljaehrlich). Es handelt sich
  aber um ein manuelles Runbook, keinen technisch erzwungenen Mechanismus (kein
  Secret-Alter-Tracking, kein automatischer Reminder, kein Boot-Warnhinweis bei
  ueberfaelliger Rotation).
- Risiko: ohne technische Durchsetzung bleibt Rotation von Team-Disziplin abhaengig;
  bei einem Ein-Personen-/kleinen Team ist "vierteljaehrlich" nicht ueberpruefbar.
- Empfehlung: fuer Public-Launch kein Blocker (kein OpenAI-Requirement), aber als
  Hardening-Punkt vormerken (z.B. Secret-Alter in einem Betriebs-Dashboard oder
  Kalender-Reminder).
- Prioritaet/Kategorie: P2 / C

### PP-D12-07 Secrets koennen nicht in MCP-Antworten/API-Responses gelangen

- Status: PASS
- Evidenz: MCP-Tool-Ausgaben laufen durch explizite Feld-Whitelists statt
  Passthrough, z.B. `src/mcp-tools.js:361-373` `pickAgentStatus()` (Kommentar Zeile
  360: "Kein Secret/internes Feld passiert hier"), `src/mcp-tools.js:391-393`
  `pickMyNumber()`, `src/mcp-tools.js:401-411` `pickCall()`. Der generische
  Error-Handler gibt nie `err.message`/`err.stack`/Env an den Client
  (`src/app.js:598-599`, Kommentar: "generische 500, NIE err.message/stack/Env an
  den Client"). `grep` nach `process.env`/`config.` mit key/secret/token-Bezug in
  `src/mcp-tools.js` ergab keinen Treffer.
- Risiko: keins identifiziert fuer den geprueften Code-Pfad. Nicht ueberprueft:
  Laufzeitverhalten bei unerwarteten Exceptions in tief verschachtelten
  Provider-Adaptern (Telnyx/ElevenLabs/Stripe) — dort wird in mehreren Stellen
  `err.message` in Logs geschrieben (server-seitig, s. PP-D12-09), theoretisch
  koennte ein Provider-SDK ausnahmsweise ein Secret in `err.message` einbetten;
  das wurde nicht am Code jedes Adapters verifiziert.
- Empfehlung: keine akute; bei neuen Provider-Adaptern die bestehende
  Whitelist-Disziplin fortsetzen.
- Prioritaet/Kategorie: P2 / C

### PP-D12-08 Timing-sichere Credential-Vergleiche

- Status: PASS
- Evidenz: `src/util.js:5-8` `safeEqual()` nutzt `crypto.timingSafeEqual`.
  Verwendungsstellen: `src/auth.js:101` (MCP-Legacy-Bearer-Token),
  `src/web-auth.js:63` (Signatur-Cookie), plus dokumentierte Nutzung fuer
  ElevenLabs-Tool-Token (`src/route-policy.js:129`) und
  Newsletter-Confirm/Unsubscribe-Token (`src/route-policy.js:196/205`).
- Risiko: keins identifiziert.
- Empfehlung: keine.
- Prioritaet/Kategorie: n/a / n/a

### PP-D12-09 Logging: keine Tokens/Auth-Header/vollstaendigen Payloads

- Status: PASS
- Evidenz: Stichprobenweite `grep` ueber `console.log/error/warn` in `src/` (284
  Fundstellen) mit Filter auf token/secret/auth/bearer/password/apikey ergab
  ausschliesslich Meta-Logs (`src/web-auth.js:612` "Login abgelehnt: Email nicht
  verifiziert", `src/config.js:2516` Warnung ueber `MCP_AUTH=off`,
  `src/telephony/outbound-gates.js:941` explizit kommentiert "secret-frei"). Kein
  Fund von Header-Dumps, `Authorization`-Werten oder Request-Bodies im Log.
- Risiko: keins identifiziert im Stichprobenumfang; volle Zeilenpruefung aller 284
  Log-Aufrufe wurde nicht einzeln durchgefuehrt (s. offene Fragen).
- Empfehlung: keine akute.
- Prioritaet/Kategorie: P2 / C

### PP-D12-10 Logging: keine Transkripte/Telefonnummern/PII

- Status: PASS
- Evidenz: `src/metrics.js` ist explizit als "PII-FREI" dokumentiert (Zeile 1-4) und
  arbeitet mit Feld-Whitelists pro Metrik (`LLM_OPTIONAL_FIELDS`, Zeile 22-28: nur
  Tokenzahlen + callId, nie Modelltext); `logCallDenied()` (Zeile 104-107) und
  `logSenderFallback()` (Zeile 112-115) sind per Code-Kommentar ausdruecklich auf
  "NIE eine Rufnummer" beschraenkt. `src/diagnostic-retention.js` regelt separat,
  ob ein Roh-Transkript ueberhaupt ueber die Summary hinaus in der DB verbleibt
  (Opt-out-Modell, fail-closed Purge nach Summary). Betriebs-Logs (`console.log` in
  `src/routes/`, `src/telephony/`) tragen durchgehend `callId`/`grund`/Status-Codes,
  keine Nummern/Transkript-Fragmente in den geprueften Stellen.
- Risiko: nicht jede der 284 Log-Zeilen wurde einzeln verifiziert (s. offene
  Fragen); die Selbstauskunft im Code ("PII-frei", "secret-frei") ist Kommentar,
  keine automatisierte Durchsetzung (kein Lint-Regel/Test, der eine neue
  PII-tragende `console.log`-Zeile verhindert).
- Empfehlung: einen Grep-basierten Test/Lint-Guard erwaegen, der neue
  `console.log`-Aufrufe mit verdaechtigen Variablennamen (`transcript`, `phone`,
  `email`, `req.body`) markiert — als Regressionsschutz gegen zukuenftige
  Log-Zeilen, nicht als aktueller Befund.
- Prioritaet/Kategorie: P2 / C

### PP-D12-11 Redaction-Mechanismen vorhanden

- Status: PARTIAL
- Evidenz: kein generischer `redact()`/`mask()`/`sanitize()`-Helfer fuer Log-Ausgaben
  gefunden (`grep -rniE "redact|mask\(|sanitiz"` traf nur auf
  Domain-Funktionen wie `sanitizeLookupQuery`, `sanitizeConsultQuestion`,
  `sanitizeProfile` — das sind Input-Validierungs-/Egress-Filter fuer
  Fachdaten, keine Log-Redaction). Der tatsaechliche Schutz gegen PII im Log ist
  Architektur-Whitelisting an der Quelle (metrics.js, s. PP-D12-10), nicht
  nachtraegliche Maskierung.
- Risiko: Whitelisting-an-der-Quelle ist robuster als Redaction-nach-dem-Fakt, aber
  ohne einen Fallback-Redactor gibt es keine zweite Verteidigungslinie, falls eine
  neue Log-Zeile versehentlich ein Feld direkt durchreicht statt es zu whitelisten.
- Empfehlung: architektonisch bereits gut (Whitelist > Blacklist); keine Aenderung
  zwingend, aber dokumentieren, dass "kein Redactor" eine bewusste Entscheidung ist,
  keine Luecke.
- Prioritaet/Kategorie: P2 / C

### PP-D12-12 Log-Level Produktion vs. Debug-Logging

- Status: FAIL
- Evidenz: kein zentraler `LOG_LEVEL`/`NODE_ENV`-gesteuerter Log-Level-Schalter in
  `src/config.js` gefunden (`grep -n "logLevel\|LOG_LEVEL\|NODE_ENV" src/config.js`
  ergab nur einen `NODE_ENV`-Treffer bei `src/config.js:29`, unabhaengig vom
  Logging). Alle `console.log/warn/error`-Aufrufe im Code laufen unconditional
  (ausser den durch `config.metrics.metricsEnabled` gated Metrik-Logs in
  `src/metrics.js`). Es gibt also keinen Unterschied in der Log-Verbosity zwischen
  lokaler Entwicklung und Produktion — was in Prod laeuft, ist exakt das, was lokal
  laeuft.
- Risiko: kein "versehentlich an gebliebenes Debug-Logging", weil es kein separates
  Debug-Log-Level gibt — das ist in der Sache PASS (keine Verbosity-Ueberraschung),
  aber es bedeutet auch: sollte irgendwo Debug-Code mit einem `console.log(req.body)`
  o.ae. eingefuegt werden, gibt es keinen Produktions-Schalter, der ihn abschaltet.
  Die einzige Kontrolle ist Code-Review-Disziplin.
- Empfehlung: kein OpenAI-Requirement; als Hardening pruefen, ob ein
  Env-gesteuertes Log-Level (mit Default "info" in Prod) sinnvoll waere, das
  potenzielle kuenftige `debug()`-Aufrufe in Prod stumm schaltet.
- Prioritaet/Kategorie: P2 / C

### PP-D12-13 Log-Aufbewahrungsdauer

- Status: PARTIAL
- Evidenz: `src/config.js:1939` `retentionDays: numEnv("RETENTION_DAYS", ...,
  { fallback: 30 })` regelt die Aufbewahrung von Call-Records/Transkripten/
  Notifications in der eigenen Datenbank (DSGVO-Loeschung), NICHT die Aufbewahrung
  von stdout/stderr-Logs bei Render. `render.yaml` enthaelt keinen Parameter fuer
  Render-eigene Log-Retention (Render verwaltet Plattform-Logs ausserhalb des
  Blueprints, plan-abhaengig). `src/diagnostic-retention.js` regelt zusaetzlich eine
  KUeRZERE Sonderfrist (`DIAGNOSTIC_RETENTION_DAYS`, Default 7) fuer Roh-Transkripte
  von Testanrufen. Diese drei Mechanismen betreffen die STORE-Daten, nicht die
  Render-Plattformlogs selbst.
- Risiko: unklar, wie lange Render die stdout/stderr-Ausgabe des Dienstes
  vorhaelt/wem sie zugaenglich ist — das ist eine Render-Konto-Einstellung, nicht
  im Repo abgebildet und daher hier nicht verifizierbar.
- Empfehlung: Render-Log-Retention-Einstellung im Dashboard pruefen und, falls
  relevant fuer Compliance, in `PLAN-SECURITY.md` dokumentieren (analog zum
  bestehenden Muster fuer `RETENTION_DAYS`).
- Prioritaet/Kategorie: P2 / C

## Offene Fragen (nicht am Repo entscheidbar)

- Render-Dashboard-Werte fuer alle `sync: false`-Variablen (Staging vs. Prod
  getrennt oder gemeinsam?) — das Repo zeigt nur das Blueprint-Muster, nicht die
  tatsaechlich gesetzten Werte.
- Ob der Telnyx-API-Key aktuell ein Scoped Key mit Spend-Limit ist oder ein
  Account-weiter Vollzugriffs-Key — `PLAN-SECURITY.md` fuehrt das als offenen
  Checklistenpunkt, der Ist-Zustand im Telnyx-Portal ist von hier nicht einsehbar.
  (Andere Sitzungsdaten in `MEMORY.md`, z.B. "Telnyx-Scoped-Key mit Spend-Limit
  aktiv", deuten auf spaetere Umsetzung hin, sind aber keine Code-Evidenz.)
- Tatsaechliche Render-Plattform-Log-Retention (Tage/Zugriffsberechtigte) —
  Konto-/Plan-Einstellung, nicht im Repo.
- Ob es ein privates, nicht-repo-gebundenes Rotations-Log gibt (laut
  `PLAN-SECURITY.md:1126` soll es eines geben) und ob die vierteljaehrliche Kadenz
  tatsaechlich eingehalten wird — reine Prozessfrage, nicht am Code pruefbar.
- Ob generische/kurze Secrets (Hex-Strings ohne Praefix) je in der Historie
  committet wurden — mit den verfuegbaren Mustern nicht zuverlaessig pruefbar
  (s. PP-D12-03), ein dedizierter Entropie-Scanner wurde nicht ausgefuehrt.

## Randbefund (ausserhalb dieser Dimension)

`PLAN-SECURITY.md:1109` listet die Telnyx-Least-Privilege-Haertung (Scoped Key,
Umgebungstrennung, Spend-Limits) als unerledigte Checkliste — das beruehrt eher
D-Provider-Sicherheit/Kostenschutz als Secrets-Hygiene im engen Sinn, gehoert aber
vor Public-Launch geschlossen oder bewusst zurueckgestellt.
