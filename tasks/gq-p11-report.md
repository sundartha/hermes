# GQ-P11 — Diagnose-Aufbewahrung haengt nicht mehr am Modell

**Gate: PASS**
**finalBranch:** `phase/gq-p11-diagnose-aufbewahrung`
**headCommit:** `e8aa3f74aded66cb921e89417f6c0dbb06630ffc`

## Kernbefund

`diagnosticRetentionGranted` (`src/diagnostic-retention.js`) verlangte bisher ein
ausdrueckliches Opt-in (`requested === true`) durch das Client-Modell im MCP-Tool-Aufruf
`place_call`. Gemessen: 58 Calls in Produktion, kein einziger mit `diagnostic=true` — die
Diagnose-Aufbewahrung war faktisch nie scharf. Die Phase kehrt das Gate von Opt-in auf
Opt-out um: der Server markiert Anrufe an die eigene verifizierte Nummer des Tenants
(`to === ownNumber`) jetzt selbst; der MCP-/Body-Parameter `diagnostic` ist nur noch der
ausdrueckliche Widerspruch (`false` / `"false"`).

## Plan (gekuerzt)

Basis: `master`, sauberer Arbeitsbaum. Vorab-Verifikation im echten Code (nicht aus der
Spec uebernommen): `diagnosticRetentionGranted` einziger Produzent von `call.diagnostic`
(`src/routes/api-calls.js`), `keepsTranscriptForDiagnosis` einziger Konsument
(`src/telephony/call-finish.js`), `capabilityProbeLines` liefert 5 Zeilen und bekommt
`privacy` bereits als Parameter, `config.privacy.diagnosticRetentionDays` existiert
bereits (Default 7). Zusatzbefund ausserhalb der Spec: `place_call.diagnostic` ist
byte-gepinnt in `test/p15-mcp-tool-descriptions-en.test.js` (`EXPECTED_MARKERS`) — muss
mitgezogen werden, sonst rot.

Keine neuen Dateien (G17) — beide Aenderungen treffen bestehende Zustaendigkeiten:

1. **`src/diagnostic-retention.js`**: `DECLINE_VALUES = new Set([false, "false"])` +
   `callerDeclined(requested)`, ersetzt den bisherigen `requested !== true`-Guard. Bewusst
   NIE Truthiness-Pruefung — ein urlencodetes `"false"` ist sonst ein nicht-leerer String
   und wuerde die Aufbewahrung genau dann verlaengern, wenn ihr widersprochen wurde
   (Spiegel-Falle zur alten Regel). Ziel-Pruefung `to === ownNumber` unveraendert — bleibt
   die eigentliche Datenschutz-Grenze.
2. **`src/boot.js`**: sechste Boot-Sonde `diagnosticRetentionProbeLine(privacy)`, 1:1 nach
   dem Muster `evidenceProbeLine`. Grund: der Live-Wert von `DIAGNOSTIC_RETENTION_DAYS` war
   im Boot-Log bisher nicht ablesbar (`runRetention` druckt nur bei tatsaechlichem Purge).
   Ans Ende der Sondenliste (Reihenfolge „vor dem Anruf -> im Anruf -> nach dem Anruf").
3. **`src/mcp-tools.js`**: Feldbeschreibung `place_call.diagnostic` auf Opt-out-Text
   umgestellt, neue Emphase-Marker `OWN`, `NOT`, `ONLY`.
4. **`src/routes/api-calls.js`**: nur Kommentar nachgezogen, Aufruf `requested: b.diagnostic`
   byte-identisch.
5. **`PLAN-SECURITY.md`** + **`.env.example`**: Umkehrung dokumentiert (Pflicht bei
   sicherheitsrelevanten Aenderungen), inkl. Messwert (58/0) und Owner-Entscheidung O-B.
6. Tests: Bestandstests `P2b-04`/`P2b-06`/`P2b-42` auf neues SOLL umgestellt (alte Regel
   gepinnt, muss mitgehen); neu `GQ-P11-1..7` (Block A, offline), `GQ-P11-8` (HTTP-Durchstich
   bis in den Store), `AL-P16-10` (Boot-Sonde beide Zustaende); `place_call.diagnostic`-
   Emphase in `p15-mcp-tool-descriptions-en.test.js` nachgezogen.

Nicht-Ziele: kein neuer Env-Schalter, kein Tenant-Feld, keine Route, keine UI, `render.yaml`
unangetastet, `keepsTranscriptForDiagnosis`/`diagnosticRetentionEnabled`/Purge-Pfad/
`outboundGates`-Kette/Offenlegungssatz/Auth-Grenzen unberuehrt.

## Impl-Zusammenfassung

Exakt nach Plan umgesetzt. `node --check` auf allen 4 geaenderten `.js`-Dateien gruen.
Zielgerichteter Lauf (diagnostic-retention*, al-p16-boot-probes, p15-mcp-tool-descriptions-en):
49/49 gruen. Volle Regressionssuite (`npm test`, json-Backend): 3959/3959 gruen (0 fail).

**Deviations:**
- pg-Backend nicht separat durchlaufen — Phase aendert keine Store-Schicht, json-Backend-Lauf
  deckt die neue Logik vollstaendig ab.
- `npm run test:gates` haengt nach ~64 Tests fest (verwaiste Test-Server, bekannte Repo-Lehre
  "leaked-test-servers-overheat"); nach ~11 Min. gekillt, bis dahin alle Tests gruen. Bewertet
  als Environment-Flake — `test:gates` darf laut CLAUDE.md ohnehin rot sein, keine der neuen
  Tests traegt ein GAP-/PROMPT-Praefix (liegt strukturell nicht im Gates-Lauf).
- Kein manueller `npm start`-Smoke-Test (fehlende lokale `.env`, volle Prod-Konfig fuer
  isolierten Boot unverhaeltnismaessig). Ersatz: `AL-P16-8`/`AL-P16-10` fahren denselben
  Boot-Banner-Pfad ueber echten gespawnten Server (`test/helpers.js startServer`, volle
  BASE_ENV) und pinnen die neue Sondenzeile in beiden Richtungen.

## Safety-Urteil

**approved: true**, alle Kern-Flags true (testsPassIndependently, safetyGatesIntact,
disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected,
behaviorAsIntended). **Keine Blocker.**

Unabhaengig nachgerechnet im frischen Worktree: `npm test` 3979/3979 (korrigiert 3959 nach
Abzug Datei-Wrapper), exakt Spec-Basis 3970 + 9 neue Tests. `test:gates` nicht
abschliessbar — `test/auth-p9a-cache-headers.test.js` haengt unter dem gates-Namensfilter
unbegrenzt; **am merge-base 03eb925 identisch reproduziert, also vorbestehend, kein
GQ-P11-Befund**, trotzdem als eigener Befund notiert. Eigene 14-Fall-Sonde ueber
`diagnosticRetentionGranted` bestaetigt Fail-closed in jeder Konstellation. Diff gegen
`claude.js`, `bridge.js`, `outbound-gates.js`, `route-policy.js`, `auth.js`, `web-auth.js`,
`config.js`, `render.yaml`, `package.json`: 0 Zeilen.

**Verdict: PASS mit Auflagen.** Concerns (keine Blocker):
1. **Default-Aktivierung ausserhalb der Phase**: `DIAGNOSTIC_RETENTION_DAYS`-Fallback in
   `src/config.js:1295` ist `7`, bisher wirkungslos (kein Modell setzte je das Opt-in) — ab
   sofort bewahrt jedes Deployment ohne gesetzte Env-Var das Rohtranskript 7 Tage auf.
   `render.yaml:468` pinnt „0" fuer Prod, ist aber kein Beleg fuer den Live-Wert (Dashboard-
   managed). Vor-Deploy-Pflicht: neue Boot-Zeile im Live-Log lesen; steht sie auf AKTIV,
   muss die Datenschutzerklaerung den Diagnosemodus + Frist bereits nennen (Owner-
   Vorbedingung O-B).
2. **Opt-out fail-open gegenueber Schreibweisen**: `DECLINE_VALUES = {false, "false"}` —
   `"FALSE"`, `" false "`, `0`, `"no"` werden als „kein Widerspruch" gelesen. Ueber MCP
   unerreichbar (`z.boolean()`), ueber `POST /api/calls` aber erreichbar (Route liest
   `b.diagnostic` roh). Spec-konform, aber Fehlrichtung ist datenschutz-unguenstig; ein
   getrimmter/case-insensitiver Vergleich waere strikt sicherer.
3. **Verbliebene Datenschutz-Grenze steht auf selbst-deklariertem Feld**: `privateNumber`
   wird bei der Self-Service-Route nur E.164-/land-validiert, nicht per SMS verifiziert.
   PLAN-SECURITY.md formuliert die Umkehrung als Tatsache — ist aber eine Annahme.
   Entschaerfend: dasselbe Feld ist bereits Ziel der Summary-SMS, kein neues
   Vertrauensniveau. Empfehlung: Formulierung in PLAN-SECURITY.md praezisieren (kein Code).
4. **`test:gates` nicht durchlaufbar** in dieser Umgebung — vorbestehend (auch am Vorher-
   Commit reproduziert), blockiert aber den Launch-Gate-Lauf und gehoert als eigener
   offener Befund vermerkt.

## Clean-Code-Audit (S1-S4)

**s1: []  s2: []  s3: []  s4: []  blocker: false  verdict: PASS**

Kein Flag in S1-S4. Neue Fail-Closed-Logik (`DECLINE_VALUES`-Set, nie Truthiness) korrekt
gegen die gespiegelte Falle abgesichert. Zielpruefung unveraendert. Neue
`diagnosticRetentionProbeLine()` folgt 1:1 dem Repo-Muster (`evidenceProbeLine` etc.) ueber
gemeinsame Helper `probeLine`/`envState` — keine G5-Duplizierung, sondern konsistente
Konvention (G24). Alle 4 betroffenen Testdateien lokal ausgefuehrt: 49/49 gruen inkl.
Grenzfaelle (leerer `ownNumber`-String, `requested=null`, fremdes Ziel ohne `requested`,
Frist 0 ohne `requested`). Kommentare deutsch ohne Umlaute, erklaeren WHY inkl. Messwert
und Owner-Referenz O-B. Keine Magic Numbers, kein toter/auskommentierter Code, keine
abgeschalteten Sicherungen, keine Verstoesse gegen Verschachtelung/Laenge/Argumentzahl.

**passNotes:** Fail-closed-Praezision bei der Umkehrung (benannte Konstante statt
Truthiness); vollstaendige Grenzfall-Abdeckung (unit + http); Boot-Probe folgt exakt
bestehendem Pattern; PLAN-SECURITY.md/.env.example synchron mit Code inkl.
Owner-Entscheidungsreferenz und Messwert; MCP-Beschreibung + Marker-Test konsistent
nachgezogen.

## Fix-Runden

Keine — Impl lief in einem Durchgang durch beide Reviews (Safety PASS mit Auflagen,
Clean-Code PASS ohne Flags). Keine FIXES-Runde noetig.
