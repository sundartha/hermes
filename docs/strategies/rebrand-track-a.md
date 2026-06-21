# Strategie — Rebrand Track A: „Vodafone Agent" → „Hermes" (Sundartha)

> **Status:** Phase 0 (Strategie, kein Code). Erstellt für die Engineering-Umsetzung.
> **Track A = reine Code-/Doc-Umbenennung des Produktnamens. NULL Runtime-Risiko, KEINE Live-URLs/Infra.**
> Infra/URLs/Hosting/Repo-Namen (`*.onrender.com`, `render.yaml`-Service, GitHub-Slug, Verzeichnisnamen) sind **Track B** und werden hier **nicht** angefasst.

---

## 1. Ziel & Akzeptanzkriterien

### Ziel
Der **Produktname** „Vodafone Agent" / „vodafone-agent" wird überall dort, wo er als *Produktbezeichnung* auftritt, auf **„Hermes"** (Slug `hermes`) umgestellt. Markenelemente, die auf Vodafone verweisen (Badge, Subtitle), werden auf **Sundartha** (Firma) umgestellt. Verhalten und Laufzeit bleiben **bit-identisch** — es ändern sich nur Strings, Defaults und Doku-Prosa.

### Akzeptanzkriterien (Definition of Done)
1. **`npm test` ist grün** (83 Test-Dateien), und zwar **am Ende jeder Phase** — nicht nur am Schluss.
2. **Kein Produktname-Rest:** `grep -rin "vodafone agent"` liefert **0 Treffer** in `src/`, `public/`, `scripts/`, `package.json` und in den umbenannten Doku-Dateien.
3. **Slug umgestellt:** Der MCP-Server-Name und der Paketname lauten konsistent `hermes` (nicht gemischt `Hermes`/`hermes`/Altwert).
4. **Branding umgestellt:** Badge = „✓ Powered by Sundartha", Subtitle = „Sundartha" (siehe Ersetzungstabelle).
5. **Denylist unangetastet (Beweis per Diff):** Live-URLs, `render.yaml`-Service, Repo-Slug `jonas986/vodafone-agent`, `cd vodafone-agent`-Pfade, `@vodafone.de`-Test-Fixtures und Vodafone-als-Kunde-Referenzen sind **unverändert**.
6. **Keine Verhaltensänderung:** Diff enthält ausschließlich Strings/Kommentare/Doku — keine Logik. `clean-code-reviewer`-Verdikt **SAUBER**.

---

## 2. Scope — was rein, was raus

### IN SCOPE (Track A)
- Produktname als **Prosa/Titel/Default-Wert**: „Vodafone Agent" → „Hermes".
- **Identifier/Slug** für Paket- und MCP-Server-*Name*: `vodafone-agent` → `hermes`.
- **Markenelemente** im Dashboard: Badge + Subtitle → Sundartha.
- **Doku-Produktname** in `README.md`, `ONBOARDING.md`, `CLAUDE.md`, `PLAN-SECURITY.md` (nur die *Produktnamen*-Stellen).

### OUT OF SCOPE (Denylist — NICHT anfassen)
Diese Treffer enthalten „Vodafone"/„vodafone-agent", sind aber **kein** Produktname und gehören zu Track B / sind legitime Fremd-Referenzen:

| Fundstelle | Inhalt | Warum nicht anfassen |
|---|---|---|
| `ONBOARDING.md:9-12,18,27` | `https://vodafone-agent.onrender.com`, GitHub-Clone-URL, Render-Service | Live-URLs / Infra → **Track B** |
| `README.md:58`, `README.md:101`, `README.md:99` | `cd vodafone-agent`, Pfad `/…/vodafone-agent/…`, Connector-Pfad | Verzeichnis-/Repo-Name → **Track B** |
| `render.yaml:5` | `name: vodafone-agent` | Render-Service-Name (Infra) → **Track B** |
| `docs/RUNBOOK-OPERATOR.md:12,16` | `jonas986/vodafone-agent` | GitHub-Repo-Slug (Infra) → **Track B** |
| `test/web-auth.test.js:281-464` | `admin@vodafone.de`, `attacker@vodafone.de` | **Auth-Test-Fixtures (E-Mail-Domains)** — Umbenennung würde Tests verfälschen |
| `PLAN-MULTI-TENANT-TELNYX.md:385` | „Vodafone-Silo … vertraglich erzwingt" | „Vodafone" als **Kunde/Vertragspartner**, nicht als Produkt |
| `public/index.html` / `public/tenant.html` `--vf-*` | CSS-Farbvariablen (Vodafone-Rot-Palette) | Visuelles Design (43+29 Vorkommen) → **separater Visual-Track**, siehe §8 |
| `docs/superpowers/*`, `tasks/*` | historische Plan-/Scratch-Docs | Archiv-/Verlaufsdokumente → optional, §8 |

> **Goldene Regel:** **Kein** repo-weites `sed`. Jede Änderung erfolgt gezielt pro Datei anhand der Inventur in §3 und der Ersetzungstabelle in §4 — **per String-Match, nicht per Zeilennummer** (Zeilennummern im Auftrag stimmen teils nicht, s. §3 Korrektur).

---

## 3. Vollständige Fundstellen-Inventur (verifiziert am Code)

> Korrektur ggü. Auftrag: `test/helpers.js` trägt den Produktnamen in **Zeile 123** (nicht 134). Zusätzlich existieren **4 Fundstellen, die im Auftrag fehlten** (mit ➕ markiert).

| # | Datei:Zeile | Ist | Soll | Kategorie |
|---|---|---|---|---|
| 1 | `package.json:2` | `"name": "vodafone-agent"` | `"name": "hermes"` | Slug |
| 2 | `package.json:4` | `"description": "Autonomer Telefon-Agent…"` | Produktname-frei / „Hermes …" | Prosa |
| 3 | `src/mcp-server.js:11` | `McpServer({ name: "vodafone-agent" …})` | `name: "hermes"` | Slug (MCP-Name) |
| 4 ➕ | `src/mcp-server.js:16` | `console.error("[vodafone-agent] …")` | `[hermes]` | Log-Präfix |
| 5 | `src/store/defaults.js:128` | `agentName: "Vodafone Agent"` | `agentName: "Hermes"` | Default-Wert **(test-gekoppelt!)** |
| 6 | `src/server.js:220` | `realm="Vodafone Agent"` | `realm="Hermes"` | Prosa (WWW-Authenticate) |
| 7 | `src/server.js:1056` | `McpServer({ name: "vodafone-agent" …})` | `name: "hermes"` | Slug (MCP-Name, HTTP) |
| 8 | `src/server.js:1115` | `Vodafone Agent Gateway laeuft auf …` | `Hermes Gateway …` | Banner |
| 9 ➕ | `src/mcp-tools.js:151` | `// … fuer die Vodafone-Demo` | `// … fuer die Hermes-Demo` | Kommentar |
| 10 ➕ | `scripts/check-setup.js:14` | `═══ Vodafone Agent — Setup-Check ═══` | `═══ Hermes — Setup-Check ═══` | Banner |
| 11 | `public/index.html:6` | `<title>Vodafone Agent — Dashboard</title>` | `Hermes — Dashboard` | Title |
| 12 | `public/index.html:136` | `… · Vodafone Business Demo` (Subtitle) | `… · Sundartha` | Subtitle |
| 13 | `public/index.html:145` | `<span class="badge">✓ Vodafone Verified</span>` | `✓ Powered by Sundartha` | Badge |
| 14 | `public/index.html:221` | Connector-Key `"vodafone-agent"` | `"hermes"` | MCP-Connector-Beispiel (Key) |
| 15 | `public/tenant.html:6` | `<title>Vodafone Agent — Mein Bereich</title>` | `Hermes — Mein Bereich` | Title |
| 16 | `public/tenant.html:104` | `Self-Service · Vodafone Business Demo` | `Self-Service · Sundartha` | Subtitle |
| 17 | `test/helpers.js:123` | `agentName: "Vodafone Agent"` (Seed) | `agentName: "Hermes"` | Test-Fixture **(gekoppelt mit #5)** |
| 18 | `test/tenant-erasure.test.js:56` | `assert … agentName, "Vodafone Agent"` | `"Hermes"` | Test-Assert (gekoppelt) |
| 19 | `test/i6-write-scope.test.js:35` | `assert … agentName, "Vodafone Agent"` | `"Hermes"` | Test-Assert (gekoppelt) |
| 20 | `test/store-pg-rls.test.js:163` | `assert … agent_name, "Vodafone Agent"` | `"Hermes"` | Test-Assert (gekoppelt) |
| 21 | `README.md:1,121,125,159` | Titel, „Vodafone-Demo", „Vodafone Verified", „Vodafone-Design" | Produktname/Branding → Hermes/Sundartha | Doku |
| 22 | `CLAUDE.md:5` (und ggf. :11) | `# Vodafone Agent` / Kontext „fuer Vodafone" | `# Hermes` / **:11 = Entscheidung, s. §7** | Doku |
| 23 | `ONBOARDING.md:3,46` | „Vodafone Agent", „Vodafone-Design" | Hermes (NUR Prosa, **URLs bleiben**) | Doku |
| 24 | `PLAN-SECURITY.md:1` ➕ | `# Security-Plan: Vodafone Agent` | `# Security-Plan: Hermes` | Doku |

**Test-Kopplung (kritisch):** `#5, #17, #18, #19, #20` bilden **eine logische Einheit** (der `agentName`-Wert). `tenant-erasure` zieht das Seed aus `helpers.js`; `i6-write-scope` und `store-pg-rls` prüfen den Default aus `defaults.js` (PGlite-Test läuft **immer**, kein Skip). Wer `defaults.js` ändert, ohne die Asserts mitzuziehen, macht die Suite **rot**.

**Optional/Low-Prio:** `test/helpers.js:110` Tempdir-Präfix `vodafone-agent-test-` — rein kosmetisch, keine Assertion hängt daran (kann mit #17 zusammen oder gar nicht).

**Kein Logik-Branch auf dem Literal:** Eine Suche zeigt keinen `=== "Vodafone Agent"`-Vergleich im Produktivcode — der Default-Wechsel ist daher verhaltensneutral (nur Anzeige/Seed). Store ist auf Render ephemer (Reset je Deploy) → keine Migration nötig.

---

## 4. Kanonische Ersetzungstabelle (Single Source of Truth)

Alle Phasen/Agenten nutzen **exakt** diese Zielstrings, damit bei Parallelarbeit kein Drift entsteht:

| Kontext | Alt | Neu |
|---|---|---|
| Slug / Identifier (Paketname, MCP-Server-`name`, Log-Präfix, Connector-Key) | `vodafone-agent` | `hermes` |
| Produktname (Prosa, Titel, `agentName`, Banner, Realm) | `Vodafone Agent` | `Hermes` |
| Badge | `✓ Vodafone Verified` | `✓ Powered by Sundartha` |
| Subtitle | `Vodafone Business Demo` | `Sundartha` |
| „Vodafone-Demo" (Kommentar/Prosa) | `Vodafone-Demo` | `Hermes-Demo` |
| „Vodafone-Design" (Doku-Prosa) | `Vodafone-Design` | `Hermes-Design` |

> `version`-Felder (`0.1.0`, `0.2.0`) bleiben unverändert. Umlaute/Sonderzeichen (`✓`, „"-Quotes) im Umfeld der Treffer **byte-genau** erhalten.

---

## 5. Phasenplan

Prinzip: **jede Phase klein und einzeln testbar**, am Ende jeder Phase läuft `npm test` (mind. die relevanten Tests). Der Schnitt ist so gelegt, dass **keine zwei Phasen dieselbe Datei** anfassen → maximale Parallelisierbarkeit, kein Datei-Konflikt.

| Phase | Zweck | Betroffene Dateien | Parallelisierbar | Abhängigkeit | Test-Gate |
|---|---|---|---|---|---|
| **P1** | `agentName`-Default + gekoppelte Tests (**atomar**) | `src/store/defaults.js`, `test/helpers.js`, `test/tenant-erasure.test.js`, `test/i6-write-scope.test.js`, `test/store-pg-rls.test.js` | **intern: NEIN** (atomar in einer Phase) / ggü. anderen Phasen: ja | keine | `npm test` grün (insb. die 3 Asserts + PGlite) |
| **P2** | Paket-Metadaten | `package.json` | ja | keine | `npm test` grün |
| **P3** | MCP-stdio-Server | `src/mcp-server.js` | ja | keine | `node src/mcp-server.js` startet; `npm test` grün |
| **P4** | Gateway-Strings (Realm, Banner, MCP-HTTP-Name) | `src/server.js` | ja | keine | `npm test` grün |
| **P5** | Setup-Checker Banner | `scripts/check-setup.js` | ja | keine | `npm run check` (Banner) / `npm test` grün |
| **P6** | MCP-Tools-Kommentar | `src/mcp-tools.js` | ja | keine | `npm test` grün |
| **P7** | Dashboard | `public/index.html` | ja | keine | Datei valide; `npm test` grün |
| **P8** | Tenant-Portal | `public/tenant.html` | ja | keine | Datei valide; `npm test` grün |
| **P9** | Doku | `README.md`, `CLAUDE.md`, `ONBOARDING.md`, `PLAN-SECURITY.md` | ja (pro Datei) | keine | `npm test` grün (Doku berührt keine Tests) |
| **P10** | Integrations-Gate | (nur Verifikation, kein Edit) | — | **nach allen P1–P9** | volle Suite + §9-Checkliste |

### Phasen-Details

**P1 — `agentName` (atomar, MUSS zusammen):**
Der einzige test-gekoppelte Change. Alle 5 Dateien in **einer** Phase ändern, *dann* testen. Splittet man defaults.js von den Asserts in separate Phasen mit Zwischen-`npm test`, ist der Zwischenstand rot → verletzt das Akzeptanzkriterium „grün am Ende jeder Phase". Innerhalb der Phase nicht auf mehrere parallele Agenten verteilen (Konsistenz des Werts + ein gemeinsames Test-Gate).

**P2–P8 — Code/UI-Strings:** Jede Phase = genau eine Datei, keine davon wird von Tests gepinnt → `npm test` ist vor *und* nach dem Edit grün. Beliebig parallelisierbar. **Wichtig:** P3 (`src/mcp-server.js`) und P4 (`src/server.js`) setzen *beide* den MCP-`name` auf `hermes` — verschiedene Dateien, aber **gleicher Zielwert** laut §4 (kein Drift!).

**P9 — Doku:** Pro Datei ein Agent möglich. **Nur Produktnamen** ersetzen; Denylist (§2) strikt beachten — in denselben Dateien stehen Live-URLs/Slugs/Pfade, die bleiben.

---

## 6. Parallelisierungs-Matrix

Da der Phasenschnitt **datei-disjunkt** ist, gilt:

- **Alle Phasen P1–P9 sind untereinander parallelisierbar** (keine zwei Phasen teilen sich eine Datei → Regel „gleiche Datei ⇒ nie parallel" ist by-design erfüllt).
- **Einzige Sequenz-Abhängigkeit:** P10 (Integrations-Gate) läuft **nach** P1–P9.
- **Einzige Atomaritäts-Regel:** P1 wird *innerhalb* nicht aufgeteilt.
- **Konsistenz-Kontrakt:** Jeder parallele Agent benutzt die Ersetzungstabelle §4 wörtlich (verhindert `hermes` vs. `Hermes`-Drift zwischen P3/P4).

Empfohlene Ausführung: P1 + (P2…P9 als Fan-out) gleichzeitig, danach P10. Jeder Agent: erst Bereich **claimen** (`space.sh claim "<datei>" "<claim-key>"`, auf `conflict` prüfen), dann editieren, lokal testen, am Ende `release`.

> Hinweis Umsetzung: `space.sh` war in dieser Strategie-Session nicht ausführbar (Permission denied). Vor der Code-Phase die Ausführbarkeit/Rechte klären, sonst Claims manuell mit dem Boss koordinieren.

---

## 7. Offene Entscheidungen (Boss-Sign-off vor Umsetzung)

1. **`CLAUDE.md:11` „Demo-Prototyp fuer Vodafone":** Das ist eine *Kunden-/Kontext*-Referenz, kein Produktname. Beibehalten (historischer Demo-Kontext) **oder** auf „für Sundartha/Hermes" umformulieren? *(Default-Empfehlung: umformulieren, da Produkt nun Hermes by Sundartha ist.)*
2. **Subtitle-Wortlaut:** „Sundartha" allein, oder „Sundartha Demo" / „Powered by Sundartha"? *(Default: „Sundartha".)*
3. **MCP-Connector-Pfad** im Beispiel (`<PFAD>/vodafone-agent/src/mcp-server.js`, README:101 / index.html:223): Der **Key** wird `hermes` (P2/P7). Der **Verzeichnis-Pfad** `vodafone-agent` ist der Repo-Ordner → **Track B**, bleibt. Bestätigen.
4. **„Vodafone-Demo"/„Vodafone-Design"** → `Hermes-Demo`/`Hermes-Design` ok, oder lieber `Sundartha-…`? *(Default: Hermes-…)*
5. **Visuelle Marke (außerhalb Track A):** Die CSS-Palette `--vf-*` (Vodafone-Rot, 43+29 Vorkommen) und das SVG-Logo bleiben in Track A unangetastet → das Dashboard **sieht weiterhin Vodafone-rot aus**. Eigener Visual-Rebrand-Track gewünscht? *(Empfehlung: ja, separat.)*
6. **Archiv-Docs** (`docs/superpowers/*`, `tasks/*`, `PLAN-MULTI-TENANT-*`, `BERICHT-*`): Produktname auch dort ziehen, oder als historischen Stand belassen? *(Empfehlung: belassen; optionaler Low-Prio-Pass.)*

---

## 8. Pre-Mortem — „Es ist schiefgegangen. Warum?"

| # | Fehlermodus | Auswirkung | Mitigation |
|---|---|---|---|
| R1 | **Blindes repo-weites `sed s/Vodafone/Hermes/`** | Verfälscht `@vodafone.de`-Auth-Fixtures, die „Vodafone-Silo"-Kundenreferenz und Live-URLs → rote Tests + falsche Doku | Kein globales Replace. Gezielt pro Datei anhand §3; Denylist §2; Reviewer grept Diff auf verbotene Treffer |
| R2 | **Track-A/B-Grenze überschritten** (URL/Slug/Pfad/Render-Service mit-umbenannt) | Onboarding-Anleitung zeigt tote URLs / impliziert Infra-Change, der nicht existiert; Deploy-Verwirrung | Denylist §2; DoD-Kriterium #5: Diff beweist `*.onrender.com`, `render.yaml`, Repo-Slug unverändert |
| R3 | **`defaults.js` ohne gekoppelte Asserts geändert** (oder umgekehrt) | `tenant-erasure`/`i6`/`store-pg-rls` rot; Phase endet nicht grün | P1 ist **atomar** (5 Dateien, ein Test-Gate); nicht splitten |
| R4 | **Drift zwischen parallelen Agenten** (`hermes` vs `Hermes`, Badge-Text variiert) | Inkonsistente Marke, MCP-Name uneinheitlich (P3 vs P4) | Kanonische Tabelle §4 als verbindlicher Kontrakt; Reviewer prüft Konsistenz |
| R5 | **Edit per (falscher) Zeilennummer** (Brief sagt helpers.js:134, real 123) | Falsche Stelle editiert / Treffer verfehlt | Immer per **String-Match** editieren, nicht per Zeilennummer; Inventur §3 ist string-basiert |
| R6 | **Unvollständige Umbenennung** → halb-rebrandetes Produkt | „Vodafone" leckt weiter (Palette, Logo, Demo-Kommentar) → unprofessionell | Bewusste Scope-Entscheidung §2/§7 dokumentiert (Rest-„Vodafone" = bekannt & gewollt, kein Versehen) |
| R7 | **MCP-`name`-Wechsel bricht Client** | Bestehende Connector-Configs funktionieren nicht mehr | `name` ist **Anzeige-Metadatum**, kein Routing-Key (Verbindung läuft über URL/Transport); `version` bleibt; NULL funktionale Auswirkung — vor Umsetzung kurz bestätigen |
| R8 | **Encoding-/Quote-Bruch** in HTML/MD (`✓`, „"-Quotes, Umlaute) | Kaputte Anzeige / ungültiges UTF-8 | Nur den Marken-Token ersetzen, umgebendes Markup byte-genau lassen; nach Edit HTML kurz sichten |
| R9 | **Merge-Konflikt mit laufender Feature-Arbeit** (Worktree hat offene Änderungen in `src/claude.js` + 2 Tests) | Verlust/Konflikt beim Merge | Kleine fokussierte Commits, vor Merge rebasen, Bereiche claimen; nicht in fremde offene Dateien greifen |
| R10 | **Übersehene Fundstelle** | „Vodafone"-Rest nach Abschluss | DoD-Sweep §9 (`grep -rin`) als Pflicht-Gate in P10; Reviewer wiederholt den Sweep |

---

## 9. Verifikation / DoD-Checkliste (P10)

```bash
# 1. Volle Suite grün (83 Dateien)
npm test

# 2. Kein Produktname-Rest in Code/UI/Scripts/Paket
grep -rin "vodafone agent" src/ public/ scripts/ package.json   # erwartet: 0 Treffer
grep -rn  "vodafone-agent" src/ public/ scripts/ package.json   # erwartet: nur erlaubte Pfad-/Dir-Referenzen (Track B), falls vorhanden

# 3. Denylist UNVERÄNDERT (müssen weiterhin existieren / im Diff nicht geändert sein)
grep -rn "onrender.com" ONBOARDING.md README.md          # bleibt
grep -n  "name: vodafone-agent" render.yaml              # bleibt
grep -rn "@vodafone.de" test/web-auth.test.js            # bleibt (4 Fixtures)
grep -n  "Vodafone-Silo" PLAN-MULTI-TENANT-TELNYX.md     # bleibt

# 4. Slug konsistent hermes
grep -rn '"hermes"' src/mcp-server.js src/server.js package.json public/index.html

# 5. Reviewer
#   clean-code-reviewer über den gesamten Diff → Verdikt SAUBER
```

Erst wenn 1–5 erfüllt sind und der Reviewer **SAUBER** meldet, ist Track A fertig und zum Merge anmeldbar (`code-finish.sh`).

---

## 10. Zusammenfassung für den Boss

- **24 Fundstellen** in der Inventur (§3), davon **4 nicht im Auftrag** (mcp-server.js Log, mcp-tools.js Kommentar, check-setup.js Banner, PLAN-SECURITY.md Titel) und **1 Zeilennummer-Korrektur** (helpers.js 123 statt 134).
- **10 Phasen**, datei-disjunkt geschnitten → **alle parallelisierbar** außer der atomaren `agentName`-Phase (P1) und dem abschließenden Gate (P10).
- **Hauptrisiko:** blindes Find-Replace (zerstört `@vodafone.de`-Fixtures, Kundenreferenz, Live-URLs). Gegenmittel: gezielte Edits + strikte Denylist + grep-Gate.
- **6 Entscheidungen** für den Boss (§7) — wichtigste: visuelle Vodafone-Rot-Palette bleibt in Track A bewusst erhalten (separater Visual-Track empfohlen).
