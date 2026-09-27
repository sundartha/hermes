# T2-04 — Auth/Origin: `PUBLIC_URL` in Produktion Pflicht (Spec fuer den Bau-Agenten)

Umfang: **genau T-32**. Basis-Commit: `c0438bd` (master). Branch/Worktree:
`phase/openai-t2-04-public-url` -> `<scratchpad>/wt-t2-04`.
Diese Datei ist ungetrackt und bleibt im Haupt-Arbeitsbaum. Nicht adden, nicht committen,
nicht in den Worktree kopieren.

## 0. Anforderung (Quelle)

`tasks/openai-audit/00-openai-anforderungen.md:65` (T-32, Klasse A,
https://developers.openai.com/plugins/deploy/app-review):
"To change the origin, create a new plugin, then complete its scan, submission, review, and
publication flow." -> Der Origin (`scheme`, `hostname`, `port`) des MCP-Servers ist nach der
Publikation **unveraenderlich**.

Daraus folgt der Befund des Plans: heute faellt der angekuendigte Origin **still** auf den
Hosting-Host zurueck, wenn `PUBLIC_URL` fehlt (`src/config.js:1499`). Ein solcher Rueckfall
friert im schlimmsten Fall den falschen Origin ein — und ein Umzug danach kostet ein neues
Plugin.

## 1. Ist-Stand, am Code gemessen (nicht aus dem Plan uebernommen)

| Stelle | Was dort wirklich steht |
|---|---|
| `src/config.js:1499` | `publicUrl: stripTrailingSlash(process.env.PUBLIC_URL \|\| process.env.RENDER_EXTERNAL_URL \|\| "")` — der stille Rueckfall, genau wie im Plan behauptet. |
| `src/config.js:204-206` | `detectProduction() { return !!process.env.RENDER_EXTERNAL_URL; }` — **die Rueckfall-Quelle IST der Produktionsdiskriminator.** |
| `src/config.js:2528-2531` | `REQUIRED_CONFIG`-Eintrag: `!config.server.publicUrl \|\| includes("CHANGE-ME")` -> Boot-Refusal, Name `PUBLIC_URL`. In Produktion greift er nie, weil der Rueckfall den Wert fuellt. |
| `src/config.js:2417-2467` | `PRODUCTION_FOOTGUNS` + `productionFootguns(cfg, isProduction)`: Tabelle, jeder Treffer fatal, `if (!isProduction) return []`, reine Funktion (cfg injizierbar). |
| `src/config.js:2654-2673` | `assertConfig()` faltet `missing` + `productionFootguns` zusammen; `reportFatalConfig` (`:2613-2618`) gibt `[Konfiguration fatal] Boot wird verweigert:` + Zeilen aus. `src/boot.js:515` macht daraus exit(1). |
| `src/config.js:2296` | `CONFIG_NAMESPACES.server = ["port","publicUrl","isProduction","deployedCommit", ...]` — jedes neue Blatt muss hier eingetragen werden, sonst wirft der Proxy-Guard beim Zugriff. |
| `src/boot-guard.js:952-954` | Kommentar: *"publicUrl LEER liefert bewusst [] - dafuer gibt es schon einen Eigentuemer (assertConfig, config.js). Zwei Riegel auf dieselbe Aussage waeren zwei Orte, die auseinanderlaufen koennen."* |
| `src/boot-guard.js:1004-1014` | `angekuendigterOriginFindings({publicUrl, oauthAudience, allowedOrigins, isProduction})` bekommt nur den **bereits zusammengefallenen** Wert — die Herkunft (`PUBLIC_URL` vs. `RENDER_EXTERNAL_URL`) ist dort strukturell nicht sichtbar. |
| `src/mcp-server.js:1-30` | stdio ruft `assertConfig()` **nicht** auf (kein Import von `boot.js`). |
| `test/helpers.js:131,596` | `BASE_ENV.PUBLIC_URL = "https://agent.test"`, `BASE_ENV.RENDER_EXTERNAL_URL = ""` -> alle Spawn-Tests setzen `PUBLIC_URL` ausdruecklich. |

**Wichtigste Folge (Plan-Korrektur):** weil `RENDER_EXTERNAL_URL` zugleich der
Produktionsdiskriminator ist, tritt der stille Rueckfall **ausschliesslich in Produktion** auf.
Ausserhalb Produktion ist die Rueckfall-Quelle per Definition leer; "ausserhalb Produktion
bleibt der Rueckfall" ist also von selbst erfuellt und braucht keinen Code.

## 2. Entscheidung: wo der Riegel gebaut wird

**In `src/config.js`, als neuer Eintrag in `PRODUCTION_FOOTGUNS`, auf einem neuen,
abgeleiteten config-Blatt `server.publicUrlExplicit`.**

Begruendung:
- `productionFootguns` ist die vorhandene Naht fuer "in Produktion fatal, lokal unveraendert"
  (`if (!isProduction) return []` — der Nicht-Produktions-Fall braucht damit keine eigene
  Bedingung), haengt schon an `assertConfig` -> exit(1), und hat beide Testebenen
  (`test/config-prod-footguns.test.js` unit, `test/boot-prod-footguns.test.js` Kindprozess).
- Der Riegel ist **rein additiv**: kein ausgelieferter Wert aendert sich, nur die
  Boot-Entscheidung. Audience, PRM-`resource`, Herkunftswache und Webhook-Ziele bleiben
  byte-identisch.
- `boot-guard.js` bleibt unberuehrt (s. Widerspruch W1): es kann die Herkunft des Wertes gar
  nicht sehen, und sein Kommentar weist die Aussage ausdruecklich `config.js` zu.
- Das neue Blatt wird **rein** gelesen (`cfg.server.publicUrlExplicit`), nicht per
  `process.env` im Praedikat. Grund: `config.js:35` laedt `dotenv` aus der Repo-`.env`; ein
  Praedikat, das die rohe Env liest, waere in den In-Prozess-Unit-Tests maschinenabhaengig
  (Lehre "Test BASE_ENV-Drift"). Der `DEV_LOGIN_ENABLED`-Eintrag (`:2459-2466`) liest die rohe
  Env nur, weil er eine Neutralisierung umgehen muss — dieser Grund fehlt hier.

Ausdruecklich **nicht** gewaehlt: Zeile 1499 auf
`process.env.PUBLIC_URL || (detectProduction() ? "" : process.env.RENDER_EXTERNAL_URL)` umbauen.
In allen erreichbaren Zustaenden gleichwertig (s.o.), aber es aendert einen ausgelieferten
Wert statt nur die Boot-Entscheidung und traefe auch Pfade ohne `assertConfig` (stdio,
`scripts/`).

## 3. Schritte (einzeln pruefbar)

### Schritt 1 — abgeleitetes Blatt `server.publicUrlExplicit`
- **Was:** direkt bei `publicUrl` ein zweites Blatt anlegen:
  `publicUrlExplicit: Boolean((process.env.PUBLIC_URL || "").trim())`, mit Kommentar (deutsch,
  ohne Umlaute): abgeleitete Tatsache wie `isProduction`/`deployedCommit`, kein Betreiber-Knopf;
  `.trim()`, weil ein aus dem Dashboard kopierter Zeilenumbruch sonst als "gesetzt" zaehlte
  (Muster `openaiAppsChallengeToken`, `:1509-1515`).
- **Datei:** `src/config.js:1499` (neue Zeile direkt danach) **und** `src/config.js:2296`
  (`CONFIG_NAMESPACES.server` um `"publicUrlExplicit"` ergaenzen).
- **IDs:** T-32. **Pfade:** prozessweit (HTTP `/mcp`, `/voice`, REST); stdio unberuehrt (s. Schritt 8).
- **Beweis:** (a) Code an genannter Stelle; (b) gruener Unit-Test aus Schritt 4c
  (`config.server.publicUrlExplicit` ist ueber den Namespace lesbar — ohne Eintrag in
  `CONFIG_NAMESPACES` wirft der Proxy-Guard `TypeError`, s. `test/config-shape.test.js:14-20`).

### Schritt 2 — Footgun-Eintrag
- **Was:** neuer Eintrag in `PRODUCTION_FOOTGUNS`, eingefuegt **zwischen** dem
  `OAUTH_AUDIENCE`-Eintrag (endet `src/config.js:2458`) und dem `DEV_LOGIN_ENABLED`-Eintrag
  (beginnt `:2459`):
  - `trifftZu: (cfg) => !cfg.server.publicUrlExplicit`
  - `befund:` muss **den Variablennamen und die Sollform** nennen, z.B. sinngemaess:
    `"PUBLIC_URL fehlt - der angekuendigte Origin faellt sonst still auf den Hosting-Host zurueck. Pflichtform: https://<host>[:<port>], ohne Pfad/Query/Slash am Ende, und exakt der Origin der OpenAI-Einreichung (nicht der Hosting-Host): ein Origin-Wechsel nach der Publikation verlangt ein neues Plugin."`
  - Kommentar darueber: warum fatal (T-32, Origin unveraenderlich), warum das Praedikat auf
    `publicUrlExplicit` und nicht auf `publicUrl` liest (der Rueckfall fuellt `publicUrl`).
  - **Kein Echo des Wertes** in die Meldung (Muster `allowlistFindings`, `boot-guard.js:988-1001`).
- **Datei:** `src/config.js:2458/2459`.
- **IDs:** T-32. **Pfade:** alle HTTP-Pfade des Serverprozesses, beide Auth-Modi
  (`MCP_AUTH=oauth` wie Token/Legacy) — der Riegel sitzt vor `app.listen` und ist von
  `MCP_AUTH` unabhaengig.
- **Beweis:** gruener Kindprozess-Test aus Schritt 5 (Exit != 0 + Meldung), nicht das
  Tabellenobjekt selbst.

### Schritt 3 — Bestandstest nachziehen (bricht sonst)
- **Was:** in `test/config-prod-footguns.test.js:19-24` die Basis `SAFE_PROD` um
  `server: { publicUrl: "https://agent.test", publicUrlExplicit: true }` ergaenzen.
- **Warum:** ohne das ist `publicUrlExplicit` in `SAFE_PROD` `undefined` -> der neue Footgun
  feuert in jedem Fall -> **brechen** mindestens: `T-P0-5-02` (`deepEqual(..., [])`),
  `T-P0-5-03/04/05` (`errors.length === 1`), `T-P0-5-06`, `T-P0-5-15/16`, `T-P0-5-17`,
  `T-P0-1-AC1-02`. Das ist gewollt fail-closed: ein vergessenes Feld faellt auf.
- **Datei:** `test/config-prod-footguns.test.js:19-24`.
- **Beweis:** die genannten Tests wieder gruen im Gesamtlauf (Schritt 10).

### Schritt 4 — neue Unit-Tests (reine Funktion)
- **Datei:** `test/config-prod-footguns.test.js` (ans Ende, Nummernschema `T2-04-*`).
- **Faelle:**
  - (a) Produktion + `publicUrlExplicit: false` -> genau **ein** neuer Befund, `match(/PUBLIC_URL/)`
    und `match(/<Fragment der Sollform>/)`; Gegenprobe `doesNotMatch` auf den Wert
    `agent.test` (kein Wert-Echo).
  - (b) Produktion + `publicUrlExplicit: true` -> `deepEqual([], ...)`.
  - (c) `isProduction === false` + `publicUrlExplicit: false` -> `deepEqual([], ...)`
    (Beleg: ausserhalb Produktion aendert sich nichts).
- **Beweis:** gruene Tests im Gesamtlauf.

### Schritt 5 — Kindprozess-Abnahme (Boot verweigert)
- **Datei:** `test/boot-prod-footguns.test.js` (Muster `T-P0-5-10..13`, `PROD_SAFE` aus
  `:13`).
- **Faelle:**
  - (a) `env: { ...PROD_SAFE, PUBLIC_URL: "" }` -> `code === 1`,
    `match(/\[boot\] Start abgebrochen/)`, `match(/PUBLIC_URL/)`,
    `match(/<Fragment der Sollform>/)`, `doesNotMatch(/Gateway laeuft/)`.
    (`PROD_SAFE` setzt `RENDER_EXTERNAL_URL` -> Produktionsprofil; `BASE_ENV.PUBLIC_URL` wird
    durch `""` ueberschrieben -> `publicUrl` erbt den Hosting-Host, `REQUIRED_CONFIG` greift
    also gerade nicht — genau der Fall, den T2-04 schliesst.)
  - (b) **Spezifitaets-Gegenprobe:** `env: { ...PROD_SAFE }` (also `PUBLIC_URL` gesetzt) ->
    der Boot scheitert weiterhin am Bestands-Footgun `STORE_BACKEND` (kein echtes Postgres im
    Test), aber `doesNotMatch(output, /<eindeutiges Fragment des neuen Befunds>/)`.
    **Nicht** auf `/PUBLIC_URL/` pruefen — dieser Name kommt auch im `OAUTH_AUDIENCE`-Befund vor.
- **Beweis:** gruene Tests; Ausgabe des Laufs vollstaendig in die Logdatei.

### Schritt 6 — `.env.example` nachziehen
- **Was:** im Block `.env.example:944-951` zwei Saetze ergaenzen: (1) fehlt `PUBLIC_URL` im
  Hosting, **verweigert der Boot** (bisher stand dort nur "MUSS ausdruecklich gesetzt sein" —
  eine Behauptung ohne Riegel); (2) T-32: der Origin ist nach der Publikation der
  OpenAI-Einreichung unveraenderlich, eine Aenderung verlangt ein neues Plugin.
- **Beweis:** Code-/Textstelle.

### Schritt 7 — `render.yaml` nachziehen
- **Was:** im Kommentarblock `render.yaml:724-734` ergaenzen: fehlt der Wert **im Dashboard**
  (Dashboard ist die Wahrheit, nicht diese Datei), startet der Dienst nach dem Deploy nicht.
  Der `value:`-Eintrag bleibt unveraendert.
- **Beweis:** Textstelle.

### Schritt 8 — stale Doku-Aussage korrigieren
- **Was:** `docs/RUNBOOK-TELNYX-ASSISTANT.md:24` sagt heute, `PUBLIC_URL` komme aus
  "Render-Env (`RENDER_EXTERNAL_URL`)". Das ist ab T2-04 in Produktion falsch -> auf
  "Render-Dashboard-Var `PUBLIC_URL` (Boot-Pflicht in Produktion) / lokale `.env`" aendern.
- **Beweis:** Textstelle.

### Schritt 9 — `PLAN-SECURITY.md`
- **Was:** neue Sektion am Ende (Stil der Nachbarn, z.B. `## OpenAI-T2-04 — PUBLIC_URL ist in
  Produktion Boot-Pflicht (2026-09-22)`), mit: Scope, Entscheidung (Footgun statt boot-guard,
  Begruendung), was sich NICHT aendert (kein ausgelieferter Wert), Deploy-Vorbedingung OW-G,
  Restrisiko. Querverweis auf die Bestandssektion `E5/E8 — Der angekuendigte Origin ist eine
  geprueft konsistente Angabe` (`PLAN-SECURITY.md:4771`).
- **Keine Produktionswerte** (kein konkreter Host, keine Secrets).
- **Beweis:** Textstelle.

### Schritt 10 — Pruefen
- `node --check src/config.js`
- `cd <worktree> && npm test -- -- --test-concurrency=4 > <logs>/npm-test.log 2>&1` — Ausgabe
  **nie** abschneiden; nur `# pass` / `# fail` und `not ok`-Zeilen lesen (der Exit-Code luegt).
  Jeder rote Test zaehlt erst, wenn er **isoliert** erneut rot ist:
  `NODE_ENV=test node --test --test-name-pattern="<name>" test/<datei>.test.js`.
- `npm run test:gates` und `npm run test:abnahme` duerfen rot sein (Katalog-Baenke), muessen
  aber gegenueber dem Basis-Commit unveraendert sein — bei Aenderung begruenden.
- Danach `ps` pruefen und uebrig gebliebene Testserver beenden (`pgrep` ist in dieser Sandbox blind).

### Vier-Orte-Regel (neue Env-Variable)
**Entfaellt:** T2-04 fuehrt **keine** neue Env-Variable ein. `PUBLIC_URL` existiert bereits in
`src/config.js`, `.env.example:951` und `render.yaml:733`. `publicUrlExplicit` ist ein
abgeleitetes config-Blatt, kein Betreiber-Knopf — es gehoert nur nach `src/config.js` (Wert +
`CONFIG_NAMESPACES`), nicht in `.env.example`/`render.yaml`. `test/helpers.js` braucht **keine**
Aenderung, weil `BASE_ENV.PUBLIC_URL` bereits gesetzt ist (`:131`).

## 4. Was NICHT gebaut wird

1. **Kein Eingriff in `src/boot-guard.js` / `angekuendigterOriginFindings`** — der Plan nennt die
   Datei, der Code weist die Aussage aber ausdruecklich `config.js` zu (`boot-guard.js:952-954`),
   und dort ist die Herkunft des Wertes nicht sichtbar. Zwei Riegel auf dieselbe Aussage waeren
   zwei Orte, die auseinanderlaufen.
2. **Kein Umbau von `src/config.js:1499`** (bedingter Rueckfall) — aendert einen ausgelieferten
   Wert statt nur der Boot-Entscheidung, trifft auch Pfade ohne `assertConfig`; in erreichbaren
   Zustaenden ohnehin gleichwertig.
3. **Kein Code fuer "ausserhalb Produktion bleibt der Rueckfall"** — gegenstandslos, s. Abschnitt 1
   (die Rueckfall-Quelle ist der Produktionsdiskriminator). Nur als Unit-Test-Gegenprobe (4c)
   festgehalten.
4. **Kein stdio-Riegel** — `src/mcp-server.js` ruft `assertConfig()` nicht auf; dieser Prozess
   laeuft nie auf Render (dort startet `src/server.js`), und `detectProduction()` ist dort
   mangels `RENDER_EXTERNAL_URL` immer `false`. Ein Riegel waere in jedem erreichbaren Zustand
   wirkungslos. Begruendung gehoert als Kommentarzeile an den Footgun-Eintrag.
5. **Keine Aenderung an Audience/PRM/Herkunftswache/Scopes** — T-16/T-12 sind T2-23 (gemergt,
   `c0438bd`), nicht zuruecknehmen.
6. **Keine `apps/web`-Aenderung** (Labor-Regel `docs/RUNBOOK-LAB-LIVE.md`).
7. **Keine Messung an der Live-Instanz, kein Dashboard-Zugriff** (Owner-Regel).
8. **Keine Beruehrung der Safety-Gates** (Kostendecke, `OUTBOUND_FROZEN`, Signaturpruefung,
   Offenlegungssatz).

## 5. Pre-Mortem (ein Jahr spaeter war T2-04 ein Fehler)

1. **Der Deploy hat die Produktion stillgelegt.** `PUBLIC_URL` stand nicht im Render-Dashboard
   (nur in `render.yaml`, und die ist nachweislich nicht die Produktionswahrheit — Lehre
   "Live != render.yaml"). Nach dem Deploy: kein `app.listen`, **kein Inbound** — eingehende
   Anrufe laufen ins Leere, kein Transkript, kein Geldpfad; MCP tot.
   *Entschaerfung:* Deploy-Vorbedingung **OW-G** (Abschnitt 6) **vor** dem Deploy; die
   Boot-Meldung nennt Variable **und** Sollform; Rollback = vorheriger Deploy (Render "Rollback"),
   weil der Riegel nur im neuen Commit steckt.
2. **Der falsche Origin wurde eingefroren.** Um den Boot zu erzwingen, hat jemand den
   Hosting-Host (`*.onrender.com`) als `PUBLIC_URL` eingetragen. Nach der Publikation ist der
   Origin unveraenderlich (T-32) — der Marken-Host braucht ein **neues Plugin**, samt Scan,
   Einreichung, Review.
   *Entschaerfung:* der Befundtext sagt ausdruecklich "der Origin der Einreichung, nicht der
   Hosting-Host"; `.env.example` und `PLAN-SECURITY.md` halten die Unveraenderlichkeit fest.
3. **Die Suite wurde maschinenabhaengig.** Ein Praedikat, das `process.env.PUBLIC_URL` roh liest,
   ist in In-Prozess-Unit-Tests von der lokalen `.env` abhaengig (`config.js:35` laedt dotenv) —
   gruen beim Autor, rot im naechsten Worktree ohne `.env`.
   *Entschaerfung:* Praedikat liest ausschliesslich `cfg.server.publicUrlExplicit`;
   `productionFootguns` bleibt eine reine Funktion.
4. **Ein Wert ist ins Log geleakt.** Der Befund echot den konfigurierten Origin.
   *Entschaerfung:* Meldung nennt nur den Variablennamen und die Sollform; Unit-Test 4a prueft
   `doesNotMatch` auf den Wert.
5. **Zwei Riegel liefen auseinander.** Haette T2-04 zusaetzlich in `boot-guard.js` gebaut, gaebe
   es zwei Meldungen zu derselben Aussage; eine wurde spaeter geaendert, die andere nicht.
   *Entschaerfung:* genau ein Ort (Punkt 1 in Abschnitt 4).
6. **Gegenprobe zur Gegenrichtung:** nicht zu bauen haette bedeutet, dass ein Render-seitiger
   Domain-/Service-Namenswechsel Audience, Allowlist, PRM-`resource` und alle Webhook-Ziele
   gleichzeitig still verschiebt — Clients koennen sich danach nie wieder autorisieren, und
   niemand merkt es. Deshalb wird gebaut, mit Vorbedingung.

Keine neue Anruf-/SMS-Ausloesung, keine Aenderung an Kostendecke oder Offenlegung: der Riegel
ist eine Boot-Entscheidung und aendert keinen ausgelieferten Wert.

## 6. Owner-Punkte (Owner-Regel: Werte im Dashboard, Deploy)

**OW-G — `PUBLIC_URL` im Render-Dashboard pruefen, VOR dem Deploy (Deploy-Vorbedingung).**
- Anleitung: Render-Dashboard -> Service des Gateways -> Environment -> Schluessel `PUBLIC_URL`.
- Erwartet: gesetzt, `https://`, **ohne** Pfad/Query/Fragment und ohne Slash am Ende, exakt der
  Origin der OpenAI-Einreichung (Marken-Host), **nicht** der `*.onrender.com`-Host.
- Lesende Alternative ohne Dashboard: `GET https://<Marken-Host>/.well-known/oauth-protected-resource`
  -> `resource` ist `<Marken-Host>/mcp`. Zeigt die Antwort den Hosting-Host, ist `PUBLIC_URL`
  **nicht** gesetzt -> Deploy erst nach dem Setzen.
- Ergebnis bei Fehlschlag: Wert im Dashboard setzen, dann deployen. Wird trotzdem deployt und
  der Dienst startet nicht: Render-Rollback auf den vorherigen Deploy.

**OW-Deploy** — Merge/Push/Deploy macht ausschliesslich der Owner (die Kette pusht nie).

## 7. Widersprueche (Plan vs. Code)

- **W1 — Datei-Liste.** Plan: "Dateien: `src/config.js`, `src/boot-guard.js` (:889-985),
  Boot-Guard-Test". Der Code in `src/boot-guard.js:952-954` weist die Aussage "publicUrl leer"
  ausdruecklich `config.js` zu, und `angekuendigterOriginFindings` bekommt nur den bereits
  zusammengefallenen Wert (`:1004-1014`) — die Herkunft ist dort nicht entscheidbar. Gebaut wird
  deshalb in `src/config.js` (Footgun-Tabelle); `boot-guard.js` bleibt unveraendert. Die
  Zeilenangabe :889-985 des Plans stimmt inhaltlich (dort liegt der Origin-Block).
- **W2 — "Ausserhalb Produktion bleibt der Rueckfall" ist gegenstandslos.** Der Rueckfallwert
  `RENDER_EXTERNAL_URL` ist zugleich der Produktionsdiskriminator (`config.js:204-206`); der
  stille Rueckfall kann **nur** in Produktion auftreten. Ausserhalb aendert T2-04 per
  Konstruktion nichts (Unit-Test 4c haelt es fest).
- **W3 — Abnahmekriterium "mit `PUBLIC_URL` -> lauscht, PRM.resource = `PUBLIC_URL/mcp`" ist im
  Produktionsprofil nicht herstellbar.** Im Produktionsprofil verweigert der Bestands-Footgun
  `STORE_BACKEND !== "pg"` (`config.js:2439`) den Boot, weil im Test kein echtes Postgres
  existiert — exakt die Begruendung, die `test/boot-prod-footguns.test.js:45-49` fuer T-P0-5-14
  bereits festhaelt. Ersatz: Positivseite per Unit (4b, `productionFootguns(...) === []`) plus
  den **bestehenden** PRM-Beleg ueber die echte Route ausserhalb des Produktionsprofils
  (`test/oauth.test.js:40-45`: `doc.resource === AUDIENCE`, `AUDIENCE = BASE_ENV.PUBLIC_URL + "/mcp"`,
  `test/helpers.js:1275`). Kein Duplikat bauen.
- **W4 — Doku lief dem Code voraus.** `.env.example:947-950` ("In Produktion MUSS er
  ausdruecklich gesetzt sein, nicht aus `RENDER_EXTERNAL_URL` geerbt") und `render.yaml:727-729`
  behaupten die Regel heute schon, ohne dass Code sie erzwingt. Beleg dafuer, dass Doku hier kein
  Nachweis ist; T2-04 macht die Behauptung wahr. Gegenlaeufig: `docs/RUNBOOK-TELNYX-ASSISTANT.md:24`
  nennt `RENDER_EXTERNAL_URL` als Quelle (Schritt 8).
- **W5 — IDs.** Der Plan-Abschnitt nennt genau `T-32`; das deckt sich mit der gepinnten Liste.
  Kein Konflikt.
- **UNKNOWN:** ob `PUBLIC_URL` im Render-Dashboard tatsaechlich gesetzt ist, ist von hier aus
  nicht pruefbar (Owner-Regel, kein Produktionszugriff) — deshalb OW-G als Deploy-Vorbedingung.
