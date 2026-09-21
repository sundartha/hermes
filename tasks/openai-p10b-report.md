# OpenAI-P10b — Abschlussbericht: Randpunkte II (HTTP-Oberflaeche des Hauptservers)

Branch: `phase/openai-p10b-http` | Basis: `master` @ `76a6072`
Commit lt. Auftrag: `b563cb1` | tatsaechlicher Branch-HEAD zum Zeitpunkt dieses Berichts: `e37954a`
(ein Folgecommit, ausschliesslich zwei falsche `datei:zeile`-Verweise in Kommentaren
korrigiert — kein Verhaltensunterschied, s. Abschnitt 6).
Verfasst von: Report-Agent (liest nur, kein Code geaendert).

---

## 1. Was NICHT erfuellt ist (zuerst, ungeschoent)

- **HSTS `preload` bleibt AUS.** Bewusst nicht gebaut — Owner-Entscheidung, als
  unwiderruflich eingestuft (`src/middleware.js:29-41`, unveraendert).
- **`commit` bleibt unauthentifiziert auf `/healthz` lesbar.** Akzeptiertes Risiko, kein
  Fix: `scripts/probe-auth.sh` (Ziel-Pin W7) braucht ihn ungeschuetzt; Begruendung stuetzt
  sich auf eine Messung, dass beide GitHub-Repos privat sind — das ist eine Fremdbedingung,
  keine Code-Garantie. Faellt die Privatheit eines Repos, ist der Eintrag laut
  PLAN-SECURITY.md neu zu bewerten; das ist derzeit nicht automatisiert ueberwacht.
- **`x-powered-by: Express`** wurde gemessen (live vorhanden), aber ausdruecklich NICHT
  abgeschaltet — nur als Folgepunkt in `PLAN-SECURITY.md` notiert.
- **`POST sundartha.com/mcp` -> 200 mit 0 Byte** und **Tool-Mengen-Varianz (I-4,
  9/10/12 Werkzeuge je nach Tenant)** — beides Teil des urspruenglichen Kickoff-I-Bündels,
  in dieser Phase ausdruecklich NICHT bearbeitet (laut Spec Infra- bzw. Owner-Punkt, nicht
  P10b-Scope).
- **Ob `kontakt@sundartha.com` Sicherheitsmeldungen tatsaechlich bearbeitet: UNKNOWN.**
  Die Adresse ist als Impressums-Rollenadresse belegt, aber niemand hat verifiziert, dass
  das Postfach ueberwacht wird.
- **Wichtigster offener Befund (aus der Review-Historie, Runde 2+3, nie behoben):**
  Die inhaltliche Nachfuehrung von `docs/RUNBOOK-LIVE-WERTE.md` (Zeilen 13-21) existiert
  NUR in der Arbeitskopie des `wt-p10b`-Worktrees. Die Datei ist auf `master` **und** im
  Worktree gleichermassen untracked (`git status` zeigt `??` an beiden Orten) — ein Merge
  des Branches nimmt die Aenderung NICHT mit, weil untrackte Dateien nicht Teil eines
  Branches/einer Commit-Historie sind. Ich habe das selbst nachgestellt: `diff` zwischen
  der Kopie im Haupt-Repo und der Kopie im Worktree zeigt den alten Satz "derselbe Hash,
  den `/healthz` ausliefert" bzw. "Preimage-Rechnung gegen `configHash` aus `GET
  /healthz`" im Haupt-Repo — beide Saetze sind nach diesem Merge falsch, denn `/healthz`
  liefert `configHash` seit dieser Phase nicht mehr. Gleichzeitig verweisen VIER neue
  Code-/Doku-Stellen (`src/app.js`, `src/config-fingerprint.js`,
  `src/routes/api-deploy-info.js`, `PLAN-SECURITY.md`) auf "`docs/RUNBOOK-LIVE-WERTE.md`
  F-c" als Beleg fuer den Preimage-Befund — nach einem Merge ohne diese Datei zeigt jeder
  dieser Verweise ins Leere fuer jeden, der nur aus git klont.
  **Konsequenz fuer den Merge-Entscheider:** vor oder beim Mergen entweder (a) die
  aktualisierte Fassung von `RUNBOOK-LIVE-WERTE.md` separat pruefen (Live-Werte/PII!) und
  bewusst einchecken, oder (b) sie liegen lassen — dann bleibt die Merge-Tatsache, dass die
  vier Code-Verweise auf eine im Repo nicht vorhandene Quelle zeigen, ein bekannter,
  akzeptierter Zustand (er bestand laut Fakten schon VOR dieser Phase auf `master`, ist
  also kein neu eingefuehrter Schaden, aber diese Phase VERGROESSERT die Zahl der
  Verweise darauf von 0 auf 4).
- **Schritt 8 (Gesamtlauf) lief zum Abgabezeitpunkt der uebergebenen Fakten noch** — s.
  Abschnitt 6 fuer meine eigene Nachpruefung, die diesen Punkt nachtraeglich schliesst,
  aber mit einer Einschraenkung (kein Commit-Hash im Log nachweisbar).

---

## 2. Was diese Phase erfuellt — ID fuer ID mit Beweisstelle

### Kickoff I — `/healthz`-Preisgabe (`configHash` unauthentifiziert lesbar)

**Erfuellt, per Aufspaltung.** `configHash` verlaesst die oeffentliche Antwort;
`commit` bleibt (siehe Abschnitt 1, akzeptiertes Risiko).

- Entfernt: `src/app.js:182` — `app.get("/healthz", (_req, res) => res.json({ ok: true,
  commit: config.server.deployedCommit }));` (kein `configHash` mehr im Objekt).
- Ersatz: `src/routes/api-deploy-info.js` (neue Datei) — `makeDeployInfoRoutes({ config,
  operatorAuth })`, registriert `GET /api/admin/deploy-info` ausschliesslich ueber
  `operatorRoutes(...)` (webAuthMw + adminMw), Antwort `{ commit, configHash }`.
  Gemountet in `src/app.js:476`.
- Zweite Quelle (unveraendert): Boot-Log `[boot] configHash=...`, `src/boot.js:39`
  (Zeile im Diff, Funktionskoerper `logBootBanner`).
- Test: `test/openai-p10b-healthz.test.js` — `"P10b: /healthz bleibt 200 und gibt keinen
  configHash mehr preis"` (grün, selbst nachgefahren, s. Abschnitt 6) und `"P10b:
  deploy-info liefert genau {commit, configHash} hinter Admin-Sitzung"` (grün).
  Zusaetzlich umgebaut: `test/gap-36-healthz-fingerprint.test.js` (3 Faelle),
  `test/openai-e7-challenge.test.js` (E7-T8), `test/security.test.js` (Kommentar) — alle
  grün nachgefahren.

### Absolute Regel 3 (Auth fail-closed) fuer die neue Route

**Erfuellt.** `GET /api/admin/deploy-info` ist NICHT per rohem `router.get` oder
Wrapper-Arrow registriert (das haette die Auth-Kette im Express-Stack als
`"<anonymous>"` unsichtbar gemacht), sondern ausschliesslich ueber `operatorRoutes(...)`
— dasselbe DI-Muster wie `makeOnboardRoutes`/`makeBillingRoutes`. Ohne
Admin-Sitzungs-Infra (kein `SESSION_SECRET`/pg) wird die Route GAR NICHT gemountet (404
statt offen).

- Beleg Fail-closed: `test/openai-p10b-healthz.test.js` — `"P10b: ohne
  Admin-Sitzungs-Infra ist deploy-info nicht gemountet (404)"`, grün nachgefahren.
- Beleg Auth-Kette am Produktionsgraph: `test/route-auth-inventory.test.js`,
  `ROUTE_FINGERPRINT` traegt `"GET /api/admin/deploy-info"` (neuer Eintrag),
  `OPERATOR_ROUTE_KEYS` ebenso; `"AUTH-P6-7: die Betreiber-Routen tragen
  webAuthGateMiddleware UND adminOnlyMiddleware"` (Titel korrigiert, Zahl "sieben"
  entfernt — die Route ist jetzt die achte) prueft `handlerNames.includes(
  "adminOnlyMiddleware")` fuer genau diesen Key; grün nachgefahren.
- Beleg Probe-Tabelle: `scripts/probe-auth.sh` — neue Zeile `sitzung|GET|
  /api/admin/deploy-info|401|webauth|...`; `test/probe-auth-table.test.js` prueft die
  Zuordnung, grün nachgefahren.
- KEIN Eintrag in `src/route-policy.js` `PUBLIC_ROUTES` fuer diese Route — korrekt, sie
  ist Klasse AUTH, nicht PUBLIC (spec-explizit, sonst Falsch-Einordnung).

### Kickoff I / I-2b — `/.well-known/security.txt` (RFC 9116)

**Erfuellt.** Route `src/app.js:198` — `app.get(SECURITY_TXT_PATH, (_req, res) =>
res.type("text/plain").send(SECURITY_TXT_BODY));`. Konstanten `src/app.js:81` (Pfad),
`:86` (Kontakt `mailto:kontakt@sundartha.com`), `:90` (`SECURITY_TXT_EXPIRES =
"2027-09-01T00:00:00.000Z"`, RFC 9116 §2.5.5-konform: < 1 Jahr in der Zukunft ab
Erstellung, fest kodiert statt pro Request berechnet).

- `PUBLIC_ROUTES`-Eintrag mit Begruendung: `src/route-policy.js:108-111`.
- Fingerprint-Eintrag: `test/route-auth-inventory.test.js` `ROUTE_FINGERPRINT`.
- Probe-Zeile: `scripts/probe-auth.sh` (`oeffentlich|GET|/.well-known/security.txt|200|...`).
- Drei neue Tests, alle grün nachgefahren:
  `"P10b: security.txt liefert 200 text/plain mit Contact und Expires"` (prueft auch,
  dass die globalen Security-Header — `referrer-policy: no-referrer`,
  `x-content-type-options: nosniff` — auf der neuen Route greifen);
  `"P10b: security.txt-Kontakt ist die im Impressum veroeffentlichte Adresse"` (Drift-Test
  gegen `apps/web/src/data/legal/imprint.de.json`, rein lesend, kein Schreibzugriff auf
  `apps/web`);
  `"P10b: POST auf security.txt wird nicht bedient"`.
- Kein `Canonical:`-Feld (bewusst, verhindert Host-Verdrahtung/Rebrand-Falle).

### Kickoff I — Referrer-Policy am Hauptserver

**Bereits erfuellt, gegenstandslos — kein Codeschritt noetig.** `Referrer-Policy:
no-referrer` steht bereits seit vorheriger Phase in `src/middleware.js:47` (global,
erste Middleware) und ist laut Plan live auf `/healthz` UND
`/.well-known/oauth-protected-resource` gemessen worden (Messungen M2/M3 im Spec,
Zeitpunkt 2026-09-21 ~15:11 UTC — von mir NICHT erneut nachgemessen, nur der Code
`src/middleware.js:47` gelesen und bestaetigt, dass er unveraendert ist).

### N-1 / X-1 — Kommentar-Wahrheit ueber Required- vs. optional-Annotation-Felder

**Erfuellt.** `src/mcp-tools.js:612-613` (alter Text: "die MCP-Spec fuehrt zwei davon als
optional") korrigiert auf: "die MCP-Spec fuehrt ALLE Annotation-Felder als optional (SDK
`ToolAnnotationsSchema`, jedes Feld `.optional()`)". `grep -n "zwei davon als optional"
src/mcp-tools.js` liefert 0 Treffer (von mir nachgefahren).

### N-4 — openWorldHint-Regel-Wortlaut

**Erfuellt.** Punkt 2 des Kommentarblocks (`src/mcp-tools.js`, direkt nach Punkt 1) ist
durch die O1-O3-Dreiteilung aus `docs/OPENAI-TOOL-INVENTORY.md` ersetzt und verweist auf
diese Datei als verbindliche Fassung statt den Regeltext zu duplizieren (`grep -n "O2"
src/mcp-tools.js` und `grep -n "OPENAI-TOOL-INVENTORY" src/mcp-tools.js` liefern je
mindestens einen Treffer im Kommentar, von mir nachgefahren). `answer_consult` wird nicht
mehr faelschlich unter "wirkt auf die echte Leitung" gefuehrt — die zweite,
kickoff-unabhaengige Unstimmigkeit, die die Spec selbst gefunden hat.
`git diff master -- src/mcp-tools.js` zeigt fuer diesen Hunk ausschliesslich
Kommentarzeilen (jede geaenderte Zeile beginnt nach Whitespace mit `//`) — `TOOL_ANNOTATIONS`
(jetzt `src/mcp-tools.js:653`) ist byte-identisch, bestaetigt durch
`test/openai-p10a-tool-inventar.test.js` (3 Faelle, grün nachgefahren — vergleicht Hints
am echten `tools/list`-Draht: HTTP legacy, HTTP OAuth, stdio).

### Zeilenverweise in `docs/OPENAI-TOOL-INVENTORY.md` / `docs/OPENAI-AUTH-ABWEICHUNGEN.md`

**Erfuellt.** Sechs Stichproben von mir selbst nachgefahren (Datei, Zeile, erwarteter
Inhalt, tatsaechlicher Inhalt):

| Verweis im Inventar | Zeile im Code | Inhalt |
|---|---|---|
| `place_call` registriert | `src/mcp-tools.js:919` | `uiTool(` (Aufrufstelle unmittelbar vor der `place_call`-Definition) |
| `consultAllowed`-Bedingung | `src/mcp-tools.js:1117` | `uiTool(` (await_call_event, "consult"-Zweig) |
| `answer_consult` registriert | `src/mcp-tools.js:1146` | `uiTool(` |
| `get_call_status` registriert | `src/mcp-tools.js:1254` | `uiTool(` |
| `wrapHandler` | `src/mcp-tools.js:885` | `const wrapHandler =` |
| `TOOL_ANNOTATIONS` | `src/mcp-tools.js:653` | `const TOOL_ANNOTATIONS = {` |

Alle sechs Treffer stimmen mit den im Inventar genannten Zeilennummern ueberein.
`docs/OPENAI-AUTH-ABWEICHUNGEN.md` verweist an zwei Stellen auf `wrapHandler` und wurde
korrekt von `:880-897` auf `:885-902` verschoben (git diff geprueft — nur Zahlenaenderung,
kein Textinhalt).

### PLAN-SECURITY.md — Eintrag "OpenAI-P10b"

**Erfuellt.** Abschnitt `## OpenAI-P10b — HTTP-Oberflaeche des Hauptservers
(2026-09-21)` bei `PLAN-SECURITY.md:5259`, enthaelt alle sechs geforderten Punkte
(Befund/Massnahme configHash, akzeptiertes Risiko commit, security.txt +
Erneuerungspflicht, HSTS preload aus, x-powered-by beobachtet, Render-Health-Check
unberuehrt) — von mir vollstaendig gelesen, alle sechs vorhanden.

### Schritt 7 — Doku-Stellen des alten Hash-Wegs

**Erfuellt fuer getrackte Dateien**, mit der in Abschnitt 1 genannten Einschraenkung fuer
die untrackte `docs/RUNBOOK-LIVE-WERTE.md`. `docs/RUNBOOK-OUTBOUND.md:171` und
`docs/RUNBOOK-RESTORE.md` wurden bewusst NICHT geaendert (sie nennen bereits korrekt nur
`commit`, nicht `configHash`, als `/healthz`-Feld) — von mir stichprobenartig bestaetigt
(`docs/RUNBOOK-OUTBOUND.md:171` nennt tatsaechlich nur `commit`).

---

## 3. Beruehrte Pfade — ist der Punkt auf ALLEN erfuellt?

Diese Phase ist reine HTTP-REST-Oberflaeche des Hauptservers. Sie beruehrt **keinen**
MCP-Pfad (weder `/mcp` HTTP legacy noch OAuth noch stdio noch einen
ChatGPT-/mcp-nativ-Adapter) mit Verhaltensaenderung:

- `/healthz`, `/.well-known/security.txt`, `/api/admin/deploy-info` sind allesamt
  eigenstaendige HTTP-Routen ausserhalb des `/mcp`-Transports — es gibt hier keine
  "mehreren Pfade", ueber die der Punkt unterschiedlich ausfallen koennte. Ein Client, der
  MCP spricht, sieht diese drei Routen gar nicht.
- Die einzige Aenderung, die einen MCP-gemeinsamen Ort beruehrt, ist der
  Kommentar in `src/mcp-tools.js:612-624` — dieses Modul wird sowohl von der HTTP-Route
  `/mcp` als auch vom stdio-Transport (`src/mcp-server.js`) genutzt. Weil es sich
  ausschliesslich um Kommentarzeilen handelt (verifiziert, s.o.), ist der Punkt auf BEIDEN
  Pfaden gleichermassen erfuellt, weil auf beiden nichts Funktionales geaendert wurde —
  `test/openai-p10a-tool-inventar.test.js` deckt HTTP legacy, HTTP OAuth UND stdio ab und
  ist auf allen dreien grün.
- `apps/web` / `sundartha.com` sind laut Scope-Vorgabe der Phase nicht beruehrt —
  bestaetigt (`git diff master --stat -- apps/web` liefert leer, von mir selbst
  ausgefuehrt).

---

## 4. Was ein fremder Pruefer nachmessen sollte (neutral formuliert)

Alle folgenden Befehle liefen bei mir im Worktree `wt-p10b` (HEAD `e37954a`,
`node_modules` als Symlink auf die Hauptarbeitskopie). Sie sind neutral formuliert — die
Ergebnis-Spalte ist mein eigenes Messergebnis, kein "Soll".

| # | Befehl / Stelle | Frage | Mein Ergebnis |
|---|---|---|---|
| 1 | `NODE_ENV=test node --test test/openai-p10b-healthz.test.js test/route-auth-inventory.test.js test/probe-auth-table.test.js test/gap-36-healthz-fingerprint.test.js test/openai-e7-challenge.test.js test/security.test.js test/openai-p10a-tool-inventar.test.js` | Sind alle beruehrten Testdateien isoliert gruen? | `tests 65 / pass 65 / fail 0` |
| 2 | `grep -n "deploy-info" src/route-policy.js` | Steht `/api/admin/deploy-info` in `PUBLIC_ROUTES`? | 0 Treffer (korrekt — Klasse AUTH) |
| 3 | `sed -n '182p' src/app.js` | Liefert `/healthz` noch `configHash`? | `res.json({ ok: true, commit: ... })` — kein `configHash`-Key im Objektliteral |
| 4 | `sed -n '81,90p' src/app.js` | Existieren die security.txt-Konstanten mit fest kodiertem `Expires`? | ja, `SECURITY_TXT_EXPIRES = "2027-09-01T00:00:00.000Z"` als String-Literal, kein `new Date()`/`Date.now()` in der Naehe |
| 5 | `diff "docs/RUNBOOK-LIVE-WERTE.md"` zwischen Haupt-Repo-Arbeitskopie und `wt-p10b`-Arbeitskopie | Ist die Doku-Nachfuehrung Teil eines Commits, der mitgemergt wird? | NEIN — beide Kopien sind untracked, unterscheiden sich inhaltlich, keine davon ist in der Commit-Historie des Branches |
| 6 | `git diff master --stat -- .env.example render.yaml src/config.js test/helpers.js` | Wurde eine neue Env-Variable eingefuehrt (Vier-Orte-Regel)? | leer — keine |
| 7 | `git diff master --stat -- apps/web` | Wurde die Marketing-Website beruehrt? | leer |
| 8 | `node --check` auf jede geaenderte `src/`-Datei | Ist die Syntax valide? | keine Fehlerausgabe bei allen sechs Dateien |
| 9 | `bash -n scripts/probe-auth.sh` | Ist das Skript syntaktisch valide? | keine Fehlerausgabe |
| 10 | Im gesamten Auftrag: `grep -rn "OpenAI-P10b" PLAN-SECURITY.md` | Existiert der Pflicht-Eintrag? | ja, `PLAN-SECURITY.md:5259`, sechs Unterpunkte vollstaendig |

---

## 5. Eigene Nachpruefung ueber den Auftrag hinaus: Gesamtlauf (Schritt 8)

Die uebergebenen Fakten sagen, der volle `npm test`-Lauf sei beim erzwungenen Abgabezeitpunkt
noch gelaufen (Subtest ~1568 von >6000, keine Fehlschlaege bis dahin, Prozess PID 70100 lief
sauber weiter). Ich habe im geteilten Scratchpad dieses Workflow-Laufs
(`scratchpad/p10b-out/`) zwei Log-Dateien vorgefunden:

- `p10b-voll.txt` (780 KB, Stand 18:35) — das ist der bei Abgabe noch laufende,
  unvollstaendige Lauf aus den Fakten; endet bei Subtest 2325, kein `# fail`-Summary.
- `review-voll.txt` (1,7 MB, Stand 19:24, also NACH dem Abgabezeitpunkt) — ein
  vollstaendiger Lauf von genau dem Kommando, das `npm test` startet
  (`NODE_ENV=test node test/testbaenke-run.mjs regression -- --test-concurrency=4`,
  Kopfzeile der Datei), der bis zum Ende durchlief: `# tests 6248 / # suites 80 / # pass
  6248 / # fail 0`, danach die harnesseigene Korrektur (20 Datei-Wrapper ohne echten Test
  abgezogen) auf `tests 6228 / pass 6228 / fail 0`. Ich habe geprueft, dass die sechs neuen
  P10b-Tests darin enthalten sind (Subtest-IDs 3791-3796, alle `ok`) und dass die Zahl
  6248 = vermutliche Master-Baseline 6242 + 6 neue P10b-Faelle plausibel zusammenpasst
  (die Spec-Schaetzung "6243" war eine Planzeit-Schaetzung, keine gemessene Baseline).

**Einschraenkung, ehrlich benannt:** Ich kann aus dem Log selbst nicht zweifelsfrei
ableiten, auf welchem exakten Commit dieser Lauf stattfand (kein Commit-Hash im Log-Kopf).
Pfad (`p10b-out`), Dateinamen der enthaltenen P10b-Tests und der zeitliche Zusammenhang
mit diesem Workflow machen es sehr wahrscheinlich, dass es sich um den `wt-p10b`-Worktree
handelt (vermutlich aus einer Review-Runde erzeugt) — einen unabhaengigen, zweiten Beleg
(z. B. ein Commit-Hash-Print am Lauf-Anfang) gibt es dafuer nicht. Ich werte das als
starkes, aber nicht hundertprozentig wasserdichtes Indiz, dass Schritt 8 inzwischen
gruen abgeschlossen wurde — der Lead sollte das nicht als vollwertigen Ersatz fuer einen
selbst ausgeloesten, sauber attribuierten Gesamtlauf werten, wenn er darauf eine
Merge-Entscheidung stuetzen will.

---

## 6. Abweichungen von der Spec (aus den Fakten uebernommen, von mir nicht widerlegt)

- Branch-Name exakt wie vorgegeben, kein Kollisions-Fallback.
- `AUTH-P6-8`-Testtitel/Assertion-Text zusaetzlich zum explizit genannten `AUTH-P6-7`
  korrigiert (Zahl "sieben" entfernt) — von mir am Code bestaetigt (beide Tests tragen
  jetzt "die Betreiber-Routen" ohne Zahl).
- `src/config.js:80` und `:1506` NICHT geaendert — von mir bestaetigt: beide Kommentare
  beschreiben `deployedCommit`/`commit`, nicht `configHash`; sie sind weiterhin sachlich
  korrekt.
- `node_modules`-Symlink im Worktree — reine lokale Testumgebungs-Massnahme, kein Commit.
- Schritt 7 (Doku-Grep) wie vorgesehen ausgefuehrt, `RUNBOOK-OUTBOUND.md`/
  `RUNBOOK-RESTORE.md` unveraendert gelassen, weil bereits korrekt — von mir stichprobenartig
  bestaetigt.
- Zusaetzlicher Fix-Commit `e37954a` (Review-Runde 2) korrigiert zwei falsche
  `datei:zeile`-Verweise in Kommentaren (`config-fingerprint.js:25-36` -> `:33-44` in
  `PLAN-SECURITY.md`; `route-policy.js:24-27` -> `:31-35` im Kopfkommentar von
  `api-deploy-info.js`) — reine Kommentarkorrektur, kein Verhalten geaendert, von mir am
  Diff nachvollzogen.

---

## 7. Testzahlen — Zusammenfassung

- Von mir selbst isoliert nachgefahren (alle sieben beruehrten Testdateien in einem
  Lauf): **65 grün / 0 rot**. Das weicht von der im Auftrag genannten Zahl "63 gruen / 0
  rot" leicht ab (Einzelaufschluesselung bei mir: `openai-p10b-healthz.test.js` 6,
  `route-auth-inventory.test.js` 9, `probe-auth-table.test.js` 10 -> Gruppe 1 = 25 statt
  der im Auftrag genannten 23; Gruppe 2 unveraendert 34; Gruppe 3 unveraendert 6). Die
  Differenz aendert nichts an der Kernaussage (0 Fehlschlaege), ist aber eine
  Ungenauigkeit in den urspruenglich uebergebenen Zahlen, die ich hier richtigstelle.
- Gesamtlauf: kein von mir selbst ausgeloester vollstaendiger Lauf (Laufzeit >7 Minuten,
  aus Zeitgruenden nicht wiederholt); stattdessen Sekundaerbeleg aus Abschnitt 5
  (`review-voll.txt`: 6248/6248/0, korrigiert 6228/6228/0) mit der dort genannten
  Einschraenkung.

---

## 8. Restrisiko (ein Absatz)

Das inhaltliche Risiko dieser Phase selbst ist klein und gut abgesichert: `/healthz`
bleibt 200 mit unveraendertem Body-Grundgeruest (Render-Health-Check betroffen-neutral,
live gemessen vor der Umsetzung), die neue Admin-Route ist fail-closed nach demselben
Muster wie bestehende Betreiber-Routen und durch zwei unabhaengige Tests gegen "offen
statt 404" abgesichert, und die security.txt-Route ist rein statisch ohne Eingabepfad.
Das eigentliche Restrisiko liegt ausserhalb des Diffs: die untrackte
`docs/RUNBOOK-LIVE-WERTE.md` divergiert zwischen Haupt-Repo und Worktree, und vier neue
Code-/Doku-Verweise zeigen nach einem Merge auf eine im Repo nicht vorhandene Quelle —
das ist kein Sicherheitsloch, aber ein Nachvollziehbarkeits-Loch, das genau in dem
Moment auffaellt, in dem jemand den Preimage-Befund nachpruefen will (Sicherheitsaudit,
naechste Phase, oder OpenAI selbst). Zweitens: der volle Regressionslauf wurde im
originalen Auftrag nicht bis zum Ende beobachtet; mein Sekundaerbeleg (Abschnitt 5) macht
ein verstecktes Fehlschlagen sehr unwahrscheinlich, ersetzt aber keinen sauber
attribuierten, selbst ausgeloesten Lauf. Beides ist vor einem Merge in wenigen Minuten
auf Null zu bringen (Datei einchecken bzw. Grep-Beleg statt Vollindiz), ist aber aktuell
nicht Null.
