# A6 — Rebrand Track A: „Vodafone Agent" -> „Hermes" (Firma Sundartha)

> Strategie-Dokument (PURE ANALYSE, kein Code). Frisch verifiziert am Working-Tree-
> Stand vom 2026-06-21 (`grep -rni "vodafone"`, `git status`, `git diff`). Liefert
> Ziel + Akzeptanzkriterien, getrennten IST-Zustand (erledigt vs. offen),
> vollstaendige Datei-Inventur (ohne feste Zeilennummern — Symbol-/String-Bezug),
> Pre-Mortem, phasierten Plan mit Parallelisierbarkeits-Flag und Test-Strategie.
> Kein finaler Diff — der Boss gibt die Phasen frei.
>
> **Einstufung:** NORMAL, **NULL Runtime-Risiko**. Es aendern sich ausschliesslich
> Strings, Default-Werte und Doku-Prosa. Verhalten bleibt **bit-identisch**.
>
> **Scope-Grenze (hart):** Track A fasst **KEINE** Live-URLs / Infra an
> (Render-Service, GitHub-Repo-Slug, Clone-Pfade, Deploy-URLs) — das ist **Track B**.
>
> **Hinweis auf ein verirrtes Schwester-Doc:** Es existiert ein fast fertiges
> `docs/strategies/rebrand-track-a.md` (PLURAL „strategies" — falsches Verzeichnis;
> kanonisch ist `docs/strategy/` SINGULAR). Dessen `src/server.js`-Zeilennummern
> sind veraltet (es nennt :220/:1056/:1115; real sind die Stellen :173/:1051/:1110)
> und es bildet den Teil-erledigt-Zustand des Working-Tree NICHT ab. **Dieses Doc
> hier ist die autoritative Version.** Das Plural-Doc wird NICHT geloescht (Track B
> / separate Entscheidung).

---

## 1. Ziel + Akzeptanzkriterien

### Ziel

Der **Produktname** „Vodafone Agent" / Slug `vodafone-agent` wird ueberall dort,
wo er als *Produktbezeichnung* auftritt, auf **Hermes** umgestellt:

- **Slug-/Identifier** (Paketname, MCP-Server-`name`, Log-Praefix, Connector-Key)
  -> `hermes` (lowercase).
- **Produktname-Prosa / Titel / `agentName` / Banner / Realm** -> `Hermes`.
- **Vodafone-Markenelemente** (Badge „Vodafone Verified", Subtitle „Vodafone
  Business Demo") -> **Sundartha** (Firmenname).

Verhalten und Laufzeit bleiben unveraendert — es sind reine Anzeige-/Seed-/Doku-Werte.

### Akzeptanzkriterien (messbar)

1. **Kein Produktname-Rest im Code:** `grep -rin "vodafone agent"` liefert **0
   Treffer** in `src/`, `public/`, `scripts/`, `package.json` und in den
   umbenannten Doku-Dateien (`README.md`, `CLAUDE.md`, `ONBOARDING.md`,
   `PLAN-SECURITY.md`).
2. **Kein Produktname-Slug-Rest:** `grep -rn "vodafone-agent" src/ public/ scripts/
   package.json` liefert **0 Treffer** als Produkt-Identifier (verbleibende
   `vodafone-agent`-Treffer existieren nur als Pfad-/Dir-/URL-Referenzen — Track B,
   per Denylist erlaubt; die liegen nicht in diesen Pfaden, ausser dem
   Connector-Beispiel-Pfad, s. §3).
3. **`npm test` gruen** OHNE weitere Testaenderung. Die vier `agentName`-Asserts
   sind bereits angepasst (s. §2).
4. **Denylist per Diff unveraendert:** Live-URLs, `render.yaml`-Service,
   GitHub-Repo-Slug, `@vodafone.de`-Fixtures und die Vodafone-als-Kunde-Referenzen
   sind im Diff **nicht** beruehrt.
5. **Verhalten bit-identisch:** Kein Logik-Branch haengt am Literal (verifiziert,
   s. §2.3) — der Default-Wechsel ist rein kosmetisch.

---

## 2. IST-Zustand (am Working-Tree verifiziert)

Die Rebrand-Kernteile sind im Working-Tree **schon angewendet** (uncommittet,
`git status` zeigt sie als `M`). `git diff` bestaetigt z. B. fuer `package.json`:
`"name": "vodafone-agent"` -> `"name": "hermes"`.

### 2.1 Track A — ERLEDIGT (im Working-Tree)

| Datei | Stelle (Symbol/String) | IST (neu) | Kategorie |
|---|---|---|---|
| `package.json` | `name` | `"hermes"` | Slug — DONE |
| `package.json` | `description` | `"Hermes — autonomer Telefon-Assistent (MCP + echte Telefonie)"` (version `0.1.0`) | Prosa — DONE |
| `src/mcp-server.js` | `new McpServer({ name: ... })` | `name: "hermes"` | Slug (MCP-Name, stdio) — DONE |
| `src/mcp-server.js` | `console.error("[...] MCP-Server bereit ...")` | Log-Praefix `[hermes]` | Slug (Log-Praefix) — DONE |
| `src/store/defaults.js` | `agentName:` | `"Hermes"` | Default-Wert **(test-gekoppelt!)** — DONE |
| `test/helpers.js` | Seed `agentName:` | `"Hermes"` | Test-Fixture (gekoppelt) — DONE |
| `test/i6-write-scope.test.js` | `assert ... Owner-Bucket agentName` | `=== "Hermes"` | Test-Assert (gekoppelt) — DONE |
| `test/tenant-erasure.test.js` | `assert ... s.settings.agentName` | `=== "Hermes"` | Test-Assert (gekoppelt) — DONE |
| `test/store-pg-rls.test.js` | `assert ... agent_name` | `=== "Hermes"` | Test-Assert (gekoppelt) — DONE |

> **Test-Kopplung (wichtig):** Der `agentName`-Default in `src/store/defaults.js`
> ist per Seed an `test/helpers.js` und per Assert an drei Testdateien gekoppelt
> (T-Serie der Repo-Konventionen: neues Verhalten/Default braucht passenden Test).
> Diese vier Stellen wurden **gemeinsam** mit dem Default mitgezogen — deshalb ist
> kein neuer Test noetig und die Suite bleibt konsistent gruen.

> **Kosmetisch, NICHT geaendert (bewusst):** `test/helpers.js` Tempdir-Praefix
> `vodafone-agent-test-` (mkdtemp). Keine Assertion haengt daran — reiner
> Verzeichnis-Praefix. Kann optional spaeter angefasst werden; ist NICHT
> akzeptanzkritisch (`grep "vodafone agent"` matcht das nicht, da Bindestrich +
> `-test-`-Suffix).

### 2.2 Track A — OFFEN (im Working-Tree noch „Vodafone")

| Datei | Stelle (Symbol/String) | Zielwert | Kategorie |
|---|---|---|---|
| `src/server.js` | `res.set("WWW-Authenticate", 'Basic realm="Vodafone Agent"')` | `realm="Hermes"` | Prosa (Realm) — OFFEN |
| `src/server.js` | `new McpServer({ name: "vodafone-agent", ... })` (HTTP-MCP) | `name: "hermes"` | Slug (MCP-Name, HTTP) — OFFEN |
| `src/server.js` | Banner `Vodafone Agent Gateway laeuft auf http://localhost:...` | `Hermes Gateway laeuft auf ...` | Banner (Prosa) — OFFEN |
| `src/mcp-tools.js` | Kommentar `// ... fuer die Vodafone-Demo` | `... fuer die Hermes-Demo` | Kommentar — OFFEN |
| `scripts/check-setup.js` | Banner `═══ Vodafone Agent — Setup-Check ═══` | `═══ Hermes — Setup-Check ═══` | Banner — OFFEN |
| `public/index.html` | `<title>Vodafone Agent — Dashboard</title>` | `Hermes — Dashboard` | Title — OFFEN |
| `public/index.html` | Subtitle `... · Vodafone Business Demo` | `... · Sundartha` | Subtitle (Marke) — OFFEN |
| `public/index.html` | Badge `✓ Vodafone Verified` | `✓ Powered by Sundartha` (Marke) | Badge (Marke) — OFFEN |
| `public/index.html` | MCP-Connector-Beispiel-Key `"vodafone-agent"` | `"hermes"` | Slug (Connector-Key) — OFFEN |
| `public/tenant.html` | `<title>Vodafone Agent — Mein Bereich</title>` | `Hermes — Mein Bereich` | Title — OFFEN |
| `public/tenant.html` | Subtitle `Self-Service · Vodafone Business Demo` | `Self-Service · Sundartha` | Subtitle (Marke) — OFFEN |
| `README.md` | Titel `# Vodafone Agent — ...`, „Vodafone-Demo", „Vodafone Verified"-Badge-Beschreibung, „Vodafone-Design" | Hermes / Sundartha (Prosa) | Doku — OFFEN |
| `CLAUDE.md` | Ueberschrift `# Vodafone Agent`; Kontext „Demo-Prototyp fuer Vodafone" | `# Hermes` (Produkt); Kontext-Satz s. §6-Entscheidung | Doku — OFFEN |
| `ONBOARDING.md` | „Willkommen beim **Vodafone Agent**" (Prosa); „Vodafone-Design" | Hermes / Hermes-Design (NUR Prosa, **URLs bleiben**) | Doku — OFFEN |
| `PLAN-SECURITY.md` | `# Security-Plan: Vodafone Agent` | `# Security-Plan: Hermes` | Doku — OFFEN |

### 2.3 Logik-Branch-Check (verhaltensneutral bestaetigt)

`grep -rn '"Vodafone Agent"' src/` zeigt **genau eine** Fundstelle: den
WWW-Authenticate-Realm-String in `src/server.js`. `grep -rn '=== "Vodafone Agent"'
src/` liefert **0 Treffer**. -> **Kein** Code verzweigt auf dem Literal. Der
`agentName`-Default-Wechsel und alle Title/Realm/Banner-Aenderungen sind damit
**verhaltensneutral** (reine Anzeige/Seed). Der Store ist auf Render ephemer
(Reset je Deploy) — keine Datenmigration noetig.

---

## 3. Datei-Inventur (vollstaendig, KEINE festen Zeilennummern)

Alle „Vodafone"-Fundstellen aus `grep -rni "vodafone" --include='*.js' --include='*.json'
--include='*.md' --include='*.html' --include='*.css' --include='*.yaml'
--exclude-dir=node_modules .` (ohne `package-lock.json`), eingeordnet. Bezug ueber
Symbol/String, nicht Zeile (Zeilen verrotten).

### 3.1 Track A — bereits ERLEDIGT (Diff bestaetigt)

| Datei | Vorkommen | Zielwert | Kategorie |
|---|---|---|---|
| `package.json` | `name`, `description` | `hermes`, `Hermes — ...` | Track-A-erledigt |
| `src/mcp-server.js` | `McpServer({ name })`, `console.error("[...]")` | `hermes`, `[hermes]` | Track-A-erledigt |
| `src/store/defaults.js` | `agentName` | `Hermes` | Track-A-erledigt |
| `test/helpers.js` | Seed `agentName` | `Hermes` | Track-A-erledigt |
| `test/i6-write-scope.test.js` | Assert Owner-Bucket `agentName` | `Hermes` | Track-A-erledigt |
| `test/tenant-erasure.test.js` | Assert `agentName` | `Hermes` | Track-A-erledigt |
| `test/store-pg-rls.test.js` | Assert `agent_name` | `Hermes` | Track-A-erledigt |

### 3.2 Track A — noch OFFEN

| Datei | Vorkommen (String/Symbol) | Zielwert | Kategorie |
|---|---|---|---|
| `src/server.js` | Realm `Basic realm="Vodafone Agent"` | `realm="Hermes"` | Track-A-offen |
| `src/server.js` | HTTP-`McpServer({ name: "vodafone-agent" })` | `name: "hermes"` | Track-A-offen |
| `src/server.js` | Banner `Vodafone Agent Gateway laeuft auf ...` | `Hermes Gateway ...` | Track-A-offen |
| `src/mcp-tools.js` | Kommentar `... fuer die Vodafone-Demo` | `... fuer die Hermes-Demo` | Track-A-offen |
| `scripts/check-setup.js` | Banner `═══ Vodafone Agent — Setup-Check ═══` | `═══ Hermes — Setup-Check ═══` | Track-A-offen |
| `public/index.html` | `<title> ... Dashboard` | `Hermes — Dashboard` | Track-A-offen |
| `public/index.html` | Subtitle `Vodafone Business Demo` | `Sundartha` | Track-A-offen |
| `public/index.html` | Badge `✓ Vodafone Verified` | `✓ Powered by Sundartha` | Track-A-offen |
| `public/index.html` | Connector-Key `"vodafone-agent"` (im JSON-Beispiel) | `"hermes"` | Track-A-offen |
| `public/tenant.html` | `<title> ... Mein Bereich` | `Hermes — Mein Bereich` | Track-A-offen |
| `public/tenant.html` | Subtitle `Vodafone Business Demo` | `Sundartha` | Track-A-offen |
| `README.md` | Titel, „Vodafone-Demo", „Vodafone Verified", „Vodafone-Design" | Hermes / Sundartha | Track-A-offen |
| `CLAUDE.md` | `# Vodafone Agent`, „fuer Vodafone" (Kontext) | `# Hermes` / s. §6 | Track-A-offen |
| `ONBOARDING.md` | „**Vodafone Agent**" (Prosa), „Vodafone-Design" | Hermes / Hermes-Design | Track-A-offen |
| `PLAN-SECURITY.md` | `# Security-Plan: Vodafone Agent` | `# Security-Plan: Hermes` | Track-A-offen |

### 3.3 Denylist — NICHT anfassen (Beweis per Diff)

| Datei | Vorkommen | Grund (Kategorie) |
|---|---|---|
| `ONBOARDING.md` | `https://vodafone-agent.onrender.com` (mehrfach), `git clone .../jonas986/vodafone-agent.git`, `cd vodafone-agent`, `node scripts/set-webhooks.js https://vodafone-agent.onrender.com`, Render-Service `vodafone-agent` | Live-URLs / Infra / Clone-Pfade -> **Track B** |
| `README.md` | `cd vodafone-agent`, Connector-Pfad `/ABSOLUTER/PFAD/zu/vodafone-agent/src/mcp-server.js` (der **Pfad**, nicht der Key) | Verzeichnis-/Repo-Pfad -> **Track B** |
| `public/index.html` | Connector-Beispiel-**Pfad** `<PFAD>/vodafone-agent/src/mcp-server.js` | Verzeichnis-Pfad -> **Track B** (nur der **Key** `"vodafone-agent"` aendert sich, s. §3.2) |
| `render.yaml` | `name: vodafone-agent` | Render-Service-Name (Infra) -> **Track B** |
| `docs/RUNBOOK-OPERATOR.md` | `jonas986/vodafone-agent` (mehrfach) | GitHub-Repo-Slug (Infra) -> **Track B** |
| `tasks/todo.md` | `https://vodafone-agent.onrender.com/mcp` (Resource Indicator) | Live-URL -> **Track B** |
| `test/web-auth.test.js` | `admin@vodafone.de`, `attacker@vodafone.de` (4 Fixtures) | Auth-Test-Fixtures (E-Mail-Domains) — Umbenennung wuerde Tests verfaelschen -> **BLEIBT** |
| `tasks/auth-fixes/F1-plan.md` | `admin@vodafone.de`, `attacker@vodafone.de` | Test-Plan zu denselben Fixtures -> **BLEIBT** |
| `PLAN-MULTI-TENANT-TELNYX.md` | „Enterprise/Vodafone-Silo ... vertraglich erzwingt" | „Vodafone" als **Kunde/Vertragspartner**, nicht Produkt -> **BLEIBT** |
| `docs/superpowers/specs/...auth-tenant-foundation-design.md` | „Gebaut fuer Vodafone, wird aber in eine eigene Firma ueberfuehrt"; „der vodafone-agent ist heute ..." | Historischer Kontext / Kunde -> **BLEIBT** (kein Produkt-Branding-Touch) |
| `docs/superpowers/plans/...auth-tenant-foundation.md` | „Den vodafone-agent von owner-only ..." | Historischer Plan-Kontext -> **BLEIBT** |
| `tasks/crash-hotspots/analysis.md` | „Crash-Hotspot-Analyse — vodafone-agent" | Historisches Analyse-Artefakt -> **BLEIBT** (Task-Archiv) |
| `.claude/refs/clean-code.md` | „Repo-Hinweis (vodafone-agent)" | Repo-Identifikator im Konventions-Doc -> **BLEIBT** (kein Produkt-Branding; optional) |
| `.claude/workflows/*.js` | `const REPO = "/Users/antonio/.../vodafone-agent"` | Lokaler Maschinen-Pfad (Workflow-Tooling) -> **BLEIBT / Track B** |
| `public/index.html`, `public/tenant.html` | CSS-Palette `--vf-*` (Vodafone-Rot, 43 bzw. 29 Vorkommen) + SVG-Logo | Visuelles Design — **bewusst** in Track A NICHT angefasst -> separater Visual-Track (s. §4 R-Visual) |
| `docs/strategies/rebrand-track-a.md` | (das verirrte Plural-Doc selbst, voller „Vodafone"-Treffer) | Referenz-Artefakt, **NICHT loeschen, NICHT mitzaehlen** |

> **Abgrenzung Key vs. Pfad im Connector-Beispiel:** Im JSON-Beispiel (README +
> `public/index.html`) gibt es zwei Vorkommen von `vodafone-agent`: den **JSON-Key**
> (`"vodafone-agent": { ... }`) und den **Dateipfad** im `args`-Array
> (`<PFAD>/vodafone-agent/src/mcp-server.js`). Der **Key** ist ein frei waehlbarer
> Connector-Name = Produkt-Identifier -> wird `"hermes"` (Track A). Der **Pfad**
> ist der Repo-Ordner -> bleibt (Track B). Diese Trennung ist beim Edit zwingend
> einzuhalten (siehe Pre-Mortem R-SED).

---

## 4. Pre-Mortem-Risiken

Annahme: ein Jahr spaeter ist der Rebrand schiefgegangen — was war die Ursache?

| ID | Risiko | Schaden | Gegenmittel |
|---|---|---|---|
| **R-SED** | Blindes repo-weites `sed s/[Vv]odafone[ -]?[Aa]gent/Hermes/` oder `s/Vodafone/Hermes/` | Zerstoert `@vodafone.de`-Auth-Fixtures (rote Tests), die „Vodafone-Silo"-Kundenreferenz, alle Live-URLs/Clone-Pfade und den Connector-**Pfad** | **Kein** globales Replace. Gezielte Edits pro Datei anhand der Inventur §3. Vor jedem Edit den Kontext lesen (Key vs. Pfad, Produkt vs. Kunde). Reviewer grept den Diff auf verbotene Treffer (DoD-Gate §6/§7). |
| **R-MISS** | Uebersehene Fundstelle (z. B. zweites Vorkommen in derselben Datei, README hat 4) | „Vodafone"-Rest nach Abschluss -> halb-rebrandetes Produkt | DoD-Sweep (`grep -rin "vodafone agent"` + `grep -rn "vodafone-agent"` in den Track-A-Pfaden) als Pflicht-Gate; Reviewer wiederholt den Sweep. README/index.html explizit auf **alle** Vorkommen pruefen. |
| **R-KEYPATH** | Im Connector-Beispiel wird versehentlich der **Pfad** statt nur des **Keys** umbenannt (oder umgekehrt) | Entweder bleibt der Key „vodafone-agent" (R-MISS) oder der Repo-Pfad bricht (Doku verweist auf nicht existenten Ordner) | §3.3-Abgrenzung beim Edit beachten: nur den JSON-**Key** aendern, den `args`-**Pfad** stehen lassen. Diff-Review der Beispiel-Bloecke. |
| **R-TESTCOUPLE** | `agentName`-Default geaendert, aber eine der 4 gekoppelten Test-Stellen vergessen (hier bereits erledigt, gilt fuer Reviewer) | Rote Suite | §2.1-Kopplung pruefen: Default + Seed + 3 Asserts muessen denselben Wert tragen. `npm test` als Gate. |
| **R-VISUAL** | Visual-Track-Luecke: CSS `--vf-*` (Vodafone-Rot) + SVG-Logo bleiben | Dashboard sieht weiter **Vodafone-rot** aus -> wirkt unfertig/unprofessionell | **Bewusste Scope-Entscheidung** (dokumentiert hier in §3.3): Rest-Vodafone im Visual = bekannt & gewollt, kein Versehen. Empfehlung: separater Visual-Rebrand-Track. So ist „halb-rebrandet" eine erklaerte Entscheidung, kein Bug. |
| **R-INFRA** | Track-A-Eifer fasst Live-URL/Render-Service/Repo-Slug an | Deploy bricht (Render-Service-Name ist Identitaet), Onboarding-Doku falsch | Harte Scope-Grenze (§Top): Infra = Track B. Denylist §3.3 ist im Diff-Review verbindlich. |
| **R-CONTEXT** | „Vodafone als Kunde"-Referenzen (Plan-Docs, Silo) faelschlich umbenannt | Verfaelschte historische Entscheidungs-Doku, falsche Vertrags-/Kundenaussage | §3.3: diese sind Kunde, nicht Produkt — bleiben. Im Zweifel: ist „Vodafone" hier der **Anbieter des Produkts** (-> Hermes/Sundartha) oder der **Kunde/Telco** (-> bleibt)? |

---

## 5. Phasenplan

Kernteile (§2.1) sind bereits angewendet. Verbleiben vier Arbeitsphasen + ein
Gate. Reine String-/Default-Edits, keine Logik.

### Phase P1 — Rest Produktivcode (`src/server.js`, `src/mcp-tools.js`, `scripts/check-setup.js`)
- `src/server.js`: Realm `Vodafone Agent` -> `Hermes`; HTTP-`McpServer` `name`
  `vodafone-agent` -> `hermes`; Banner `Vodafone Agent Gateway` -> `Hermes Gateway`.
- `src/mcp-tools.js`: Kommentar `Vodafone-Demo` -> `Hermes-Demo`.
- `scripts/check-setup.js`: Banner `Vodafone Agent — Setup-Check` -> `Hermes — Setup-Check`.
- **Parallelisierbar: ja** — drei disjunkte Dateien, keine geteilten Symbole, kein
  Logik-Branch (R-SED/§2.3). Jede Datei kann unabhaengig editiert werden.
- Verifikation: `node --check src/server.js`, `node --check src/mcp-tools.js`,
  `node --check scripts/check-setup.js`.

### Phase P2 — Dashboard `public/*` (`public/index.html`, `public/tenant.html`)
- `public/index.html`: Title, Subtitle (`Sundartha`), Badge (`Powered by
  Sundartha`), Connector-**Key** `"hermes"` (Pfad NICHT, R-KEYPATH).
- `public/tenant.html`: Title, Subtitle (`Sundartha`).
- **Parallelisierbar: ja** (untereinander und zu P1) — statische HTML, keine
  Abhaengigkeit zu P1. CSS `--vf-*` und Logo bleiben unangetastet (R-VISUAL).
- Verifikation: manueller Smoke (Dashboard im Browser, Titel/Subtitle/Badge
  pruefen) — Optik ist nicht test-abdeckbar.

### Phase P3 — Doku-Prosa (`README.md`, `CLAUDE.md`, `ONBOARDING.md`, `PLAN-SECURITY.md`)
- Produktname-Prosa, Titel, „Vodafone-Demo"/„Vodafone-Design" -> Hermes/Sundartha.
- **URLs / Clone-Pfade / Repo-Slugs in diesen Dateien BLEIBEN** (Track B, §3.3).
- `CLAUDE.md`-Kontext-Satz „Demo-Prototyp fuer Vodafone": Entscheidung noetig
  (s. §6) — Default-Empfehlung: zu „Hermes (Firma Sundartha)" umformulieren, da das
  Produkt nun Hermes ist; der historische Kunden-Kontext kann separat erwaehnt bleiben.
- **Parallelisierbar: ja** (zu P1/P2 und untereinander) — reine Markdown-Prosa,
  keine Code-Abhaengigkeit.
- Verifikation: Diff-Review, dass nur Produktname-Prosa, keine URL beruehrt ist.

### Phase P4 — DoD-grep-Gate (Pflicht, abschliessend)
- `grep -rin "vodafone agent" src/ public/ scripts/ package.json` -> erwartet **0**.
- `grep -rin "vodafone agent" README.md CLAUDE.md ONBOARDING.md PLAN-SECURITY.md` -> erwartet **0**.
- `grep -rn "vodafone-agent" src/ public/ scripts/ package.json` -> erwartet nur den
  erlaubten Connector-**Pfad** in `public/index.html` (Track B), sonst **0**.
- `git diff` der Denylist-Dateien (`render.yaml`, `test/web-auth.test.js`,
  `PLAN-MULTI-TENANT-TELNYX.md`, `docs/RUNBOOK-OPERATOR.md`) -> **leer**.
- `npm test` -> gruen.
- **Parallelisierbar: nein** — Gate haengt von Abschluss P1+P2+P3 ab (final-check).

> **Abhaengigkeiten:** P1, P2, P3 sind **untereinander unabhaengig** und koennen
> parallel laufen (disjunkte Dateien, keine geteilten Symbole). P4 ist die
> sequenzielle Schluss-Verifikation nach P1-P3.

---

## 6. Test-Strategie

- **`npm test` muss gruen bleiben** — vor und nach jeder Phase. Reiner
  String-/Default-Refactor ohne Logikaenderung.
- **Die vier `agentName`-Asserts sind bereits angepasst** (§2.1): Default
  (`src/store/defaults.js`), Seed (`test/helpers.js`) und drei Asserts
  (`i6-write-scope`, `tenant-erasure`, `store-pg-rls`) tragen alle `Hermes`. Das ist
  die einzige test-gekoppelte Stelle des gesamten Rebrands.
- **Kein NEUER Test noetig:** Es entsteht kein neues Verhalten. Title/Realm/Banner/
  Badge/Subtitle/Kommentar sind reine Anzeige/Prosa; kein Logik-Branch haengt am
  Literal (§2.3). Die T-Serie-Pflicht („neues Verhalten braucht Test") greift nicht,
  weil kein neues Verhalten existiert.
- **Pflicht-Verifikation = DoD-grep-Gate (P4)** — das ist die belastbare
  Korrektheits-Pruefung dieses Tasks (statt eines Unit-Tests). Reviewer wiederholt
  den Sweep.
- **Manueller Smoke fuer Dashboard-Optik:** Server lokal starten (`PORT=3999
  SKIP_TWILIO_SIGNATURE_CHECK=true npm start`), `public/index.html` +
  `public/tenant.html` im Browser pruefen: Title = „Hermes — ...", Subtitle =
  „... · Sundartha", Badge = „Powered by Sundartha", Connector-Beispiel-Key =
  `"hermes"`. Optik ist per Konvention nicht test-abdeckbar -> Smoke ersetzt den Test.
- **Setup-Banner-Smoke:** `npm run check` -> Banner zeigt „Hermes — Setup-Check".

### Offene Entscheidungen fuer den Boss

1. **`CLAUDE.md`-Kontext „Demo-Prototyp fuer Vodafone":** Kunden-/Kontext-Referenz,
   kein Produktname. Beibehalten (historischer Demo-Kontext) ODER auf „fuer Hermes
   (Firma Sundartha)" umformulieren? *(Empfehlung: umformulieren — Produkt ist nun
   Hermes; Kundenbezug kann separat erwaehnt bleiben.)*
2. **Badge-Text:** `✓ Vodafone Verified` -> Vorschlag `✓ Powered by Sundartha`.
   Alternative reine Firma `✓ Sundartha`. *(Empfehlung: „Powered by Sundartha".)*
3. **„Vodafone-Demo" / „Vodafone-Design":** -> `Hermes-Demo` / `Hermes-Design`
   (Default) oder `Sundartha-...`? *(Empfehlung: Hermes-...)*
4. **Visueller Rebrand:** CSS `--vf-*` (Vodafone-Rot, 43+29 Vorkommen) + SVG-Logo
   bleiben in Track A -> Dashboard sieht weiter Vodafone-rot aus (R-VISUAL).
   Eigener Visual-Track gewuenscht? *(Empfehlung: ja, separat.)*
5. **`docs/strategies/` (Plural) Schwester-Doc:** stehen lassen (Default) oder im
   Zuge eines Doku-Aufraeumens entfernen/zusammenfuehren? *(Hier explizit NICHT
   geloescht.)*
