# Phase P14 — Rechtstexte (GAP-15)

- **Gate:** PASS
- **finalBranch:** `phase/i18n-p14-rechtstexte`
- **headCommit:** `9c83ca3cf79b12defe0a18b78701166369ee3711`
- **Tests:** 3094 pass / 0 fail (root, `STORE_BACKEND=json`)

## Plan (gekuerzt)

**Was P14 ist / nicht ist:** O13 (verbindlich) ist bindend: DE = verbindliche Fassung, EN = informative Uebersetzung mit Vorrangklausel; bis freigegebener Text vorliegt liefert die EN-Route 404, keinen Platzhalter. P14 formuliert **keinen** Rechtstext selbst — reine Mechanik-Phase: Content-Quelle, Routen, Sprachwahl, noindex-Regel, Build-Gate. Der gelieferte DE-Text bleibt byte-gleich zum heutigen Stand (Struktur-Umbau, keine Textaenderung). `npm test` bleibt gruen, `npm run test:gates` bleibt bei GAP-15 rot ("wartet auf Textlieferung", kein Codedefekt). `/legal/*` liefert 404, kein Platzhalter.

**Design-Entscheidungen (D1–D10):**
- D1: Text raus aus den `.astro`-Dateien, rein nach `apps/web/src/data/legal/<slug>.<lang>.json`.
- D2: Verzeichnis `src/data/legal/`, nicht `src/content/` (kein Astro-Content-Layer-Kollisionsrisiko).
- D3: **Datei-Existenz = Freigabe**, kein `status`-Feld — fehlt die EN-Datei, baut `getStaticPaths()` keine Seite -> 404 strukturell, nicht per Konvention.
- D4: **Kein Sprach-Fallback** — `findLegalDocument(..., "en")` liefert `null`, niemals die DE-Fassung (Pre-Mortem: EN-Route zeigt deutschen Text unter `lang="en"` und wird faelschlich als verbindliche Zusicherung gelesen).
- D5: Vorrangklausel (`LEGAL_TRANSLATION_NOTICE`) ist eine **Code-Konstante**, kein Uebersetzungsdatei-Feld; Validierung lehnt eigenes `note`-Feld in nicht-verbindlichen Fassungen ab.
- D6: EN-Rechtsseiten tragen `noindex`, DE nicht; `robots.txt`/`sitemap.xml` unangetastet (ein `Disallow: /legal` waere kontraproduktiv — gesperrte Pfade werden nicht gecrawlt, `noindex` also nie gelesen).
- D7: **Fail-closed beim Bauen** — fehlende DE-Fassung, unbekannter Slug, unvollstaendiges Dokument -> `throw` mit Dateipfad -> Build bricht ab.
- D8: Platzhalter-Grep bleibt Test-Gate (GAP-15), wird **nicht** zum Build-`throw` (sonst waere die Pflicht-Impressum-Seite heute unbaubar — schlechter als der Platzhalter).
- D9: `lib/legal.js` frei von `fs`/`import.meta.glob`; Verzeichnis-Lesung isoliert in `lib/legal-content.js` — laeuft so sowohl im Astro-Build als auch im reinen `node --test`.
- D10: Footer waehlt Rechtsziel nach Seitensprache mit DE-Rueckfall, EN-Href nur wenn Dokument existiert (kein toter Link moeglich).

**Neue Dateien (Plan):** `apps/web/src/lib/legal.js` (reine Logik: `BINDING_LEGAL_LANGUAGE`, `LEGAL_DOCUMENTS`, `LEGAL_TRANSLATION_NOTICE`, `indexLegalContent`, `findLegalDocument`, `requireLegalDocument`, `legalRouteEntries`, `legalFooterLinks`), `apps/web/src/lib/legal-content.js` (Vite-Glob, einzige Stelle mit Content-Verzeichnis-Zugriff), `apps/web/src/components/site/LegalDocument.astro` (gemeinsames Markup, identisch zum Bestand), `apps/web/src/data/legal/{privacy,imprint,terms}.de.json` (1:1 heutige Strings, Umzug ohne Textaenderung), `apps/web/src/pages/legal/[slug].astro` (EN-Route, baut nur was als `*.en.json` vorliegt).

**Edits an Bestandsdateien:** `impressum.astro`/`datenschutz.astro`/`agb.astro` auf `requireLegalDocument` + `LegalDocument`-Wrapper umgestellt; `Site.astro` bekommt Import von `LEGAL_CONTENT`/`legalFooterLinks`, Footer-Rechtslinks ueber `legalFooterLinks(LEGAL_CONTENT, lang)` statt Literal, neue `noindex`-Prop (Default `false`) und bedingtes `<meta name="robots" content="noindex">`.

**Tests (Plan):** R5-Korrektur an `test/gap-15-legal-pages-no-placeholder-en-routes.test.js` (Assertion 1 zielt neu auf `src/data/legal/*` + Astro-Seiten + `LegalDocument.astro` statt nur die migrierten Seiten; Assertion 2 prueft `<slug>.en.json`-Existenz statt Verzeichnis-Existenz — beide bleiben bewusst rot). Neu `test/legal-content.test.js` (13 Faelle, Repo-Root-Regressionslauf, ohne Astro-Build). Erweiterung `apps/web/test/pages.test.js` um Mengengleichheits- und noindex/Vorrangklausel-Checks.

**Blast-Radius (Plan):** kein `src/**`, keine Safety-Gates/Auth/Secrets/Endpunkte, kein `render.yaml`/`robots.txt`/`sitemap.xml`, keine neue Dependency, identisches Laufzeitverhalten heute. Deploy-Hinweis: `test/**` liegt nicht in `render.yaml`-`ignoredPaths`, ein Master-Push kann daher trotz reinem Website-Diff einen Gateway-Redeploy ausloesen — `/healthz` nach Push pruefen oder `test/**`-Aenderung in eigenem Commit fahren.

**Getragene Risiken (Plan):** GAP-15 bleibt rot (Textlieferung offen, kein Codedefekt); Vorrangklausel-Wortlaut stammt aus der Session, nicht vom Juristen; `apps/web/test/**` laeuft nicht in CI, tragende Mechanismus-Tests liegen deshalb im Root.

## Implementierungs-Zusammenfassung

Exakt nach Plan umgesetzt: DE-Rechtstexte aus den drei `.astro`-Seiten nach `apps/web/src/data/legal/*.de.json` ausgelagert (byte-identischer Output gegen master bewiesen), gemeinsame `LegalDocument`-Komponente, neue dynamische EN-Route `src/pages/legal/[slug].astro`, die nur baut was als `*.en.json` geliefert ist (heute 0 EN-Dateien -> 0 EN-Seiten -> 404 statt Platzhalter). `noindex` + fest verdrahtete Vorrangklausel fuer die EN-Fassung, Footer-Rechtslinks sprachabhaengig mit DE-Rueckfall. Reine Logik in `lib/legal.js` (fs-frei, 13 neue node-Tests), Content-Glob isoliert in `lib/legal-content.js`. GAP-15-Katalogtest per R5-Korrektur auf die echte Content-Quelle umgezielt, bleibt bewusst rot. Root-Regression: 3094 pass / 0 fail (+13 ggue. master).

**Dateien neu:** `apps/web/src/lib/legal.js`, `apps/web/src/lib/legal-content.js`, `apps/web/src/components/site/LegalDocument.astro`, `apps/web/src/pages/legal/[slug].astro`, `apps/web/src/data/legal/{imprint,privacy,terms}.de.json`, `test/legal-content.test.js`.

**Dateien geaendert:** `apps/web/src/pages/{impressum,datenschutz,agb}.astro`, `apps/web/src/layouts/Site.astro`, `apps/web/test/pages.test.js`, `test/gap-15-legal-pages-no-placeholder-en-routes.test.js`, `.gitignore`.

### Deviations

1. **`.gitignore`-Fix (ungeplant, zwingend):** `apps/web/src/data/` fiel unter das bestehende generische `data/`-Ignore-Muster (urspruenglich fuer den lokalen JSON-Store gedacht). Ohne Gegenausnahme waeren die drei DE-JSON-Content-Dateien nie ins Repo gelangt. Fix: gezielte Negation `!apps/web/src/data/` mit Begruendungskommentar, kein anderer Pfad betroffen. Von der Safety-Review verifiziert (`git check-ignore -v`: Top-Level `data/` bleibt ignoriert, nur die drei Legal-JSONs getrackt).
2. **Sandbox-Einschraenkung bei Testausfuehrung:** `npm test` / `npm run test:gates` / `apps/web npm test` liefern in dieser Sandbox durchgaengig exit 194 (npm-Wrapper und jeder `npx <pkg>`-Aufruf scheitern identisch, reproduzierbar auch auf unveraendertem master — keine Regression dieser Phase). Verifikation stattdessen direkt: `node test/i18n-catalog-run.mjs regression` (3094/0), `node test/i18n-catalog-run.mjs gates` (GAP-15 rot wie erwartet), `./node_modules/.bin/astro build` statt `npx astro build`.
3. **Gateway-Smoke-Test nicht durchfuehrbar:** Boot verlangt geseedeten Tenant/Nummer (`npm run bootstrap-tenant`), ausserhalb P14-Scope; `src/**` im Diff ohnehin unberuehrt (`git diff --stat -- src/` leer).
4. **6.4-Byte-Beweis** via `git worktree add --detach master` in Scratchpad statt auf den Branchnamen `master` (der ist im Haupt-Arbeitsbaum bereits ausgecheckt) — inhaltlich aequivalent, gleiches Ergebnis (agb/datenschutz/impressum byte-identisch).

`smokePass: false` — Ersatzweise Web-Smoke durchgefuehrt: direkter `astro`-Build zeigt korrektes Verhalten (heute 9 Seiten ohne `/legal/*`; mit temporaerer Test-EN-JSON baut zusaetzlich `/legal/imprint` mit `lang=en`, `noindex`, Vorrangklausel; Testdatei danach entfernt, keine Platzhaltermarkierung angetastet).

## Safety-Urteil

**APPROVED**, `blockers: []`. Unabhaengige Verifikation in frischem Worktree (`review-p14` auf `phase/i18n-p14-rechtstexte`, 1 Commit):

- `STORE_BACKEND=json npm test` -> 3094/3094 gruen, 0 fail. Master-Baseline im selben Setup: 3081/3081. Delta exakt +13 (die neuen `legal-content.test.js`-Tests).
- `STORE_BACKEND=pg npm test` -> 2790/2747 pass/43 fail; Master-Baseline 2777/2733 pass/44 fail — Branch hat **einen Fehlschlag weniger**. Alle 43 roten Dateien tragen dieselbe "DB unerreichbar"-Ursache (Sandbox-Grenze, keine P14-Datei betroffen).
- `npm run test:gates`: GAP-15 isoliert gefahren, **beide** Assertions bleiben rot ("0 Platzhalter-Treffer" und "EN-Fassung liegt vor" — fehlt: privacy, imprint, terms). Der umgeschriebene Gate-Test ist nicht hohl gruen geworden.
- **Flag-Off-Beweis:** apps/web-Build aus master vs. Branch — `diff -r` der `dist`-Baeume ist **leer** (byte-identischer Output), keine `/legal/`-Route entsteht, kein `noindex` auf Marketing-/DE-Seiten.
- **Lieferpfad simuliert:** Scratch-Kopie mit `imprint.en.json` ergaenzt -> `/legal/imprint` entsteht mit `noindex`, `lang="en"`, Vorrangklausel; EN-Footer schwenkt korrekt, uebrige Rechtslinks bleiben auf DE-Routen (kein toter Link).
- **Absolute Regeln:** `git diff --stat master..Branch` fuer `src/`, `scripts/`, `public/`, `render.yaml`, `.env.example`, `package.json`, `package-lock.json` ist leer — Diff beruehrt ausschliesslich `apps/web/**` und `test/**`. Safety-Gates, Offenlegungssatz, Signaturpruefung, Auth, Secrets unberuehrt. Keine neue Dependency, kein neuer Call/SMS/Geld-Endpunkt.

### Concerns (kein Blocker)

1. **GAP-15 bleibt rot** — Plan-Abnahme "GAP-15 nicht mehr in der Rot-Liste" ist damit **nicht** erfuellt, nur die Mechanik ist geliefert. Die drei DE-Rechtsseiten tragen live weiterhin woertlich den Platzhaltertext. Merge darf nicht als Entschaerfung des Abmahnrisikos gelesen werden — haengt allein an der Textlieferung (O13).
2. Der Impl-Agent hat seinen eigenen Gate-Test umgeschrieben — verifiziert: Latte steigt (schaerfere Assertions), nicht sinkt. Trotzdem bewusst vom Lead abzunicken.
3. Content-Schema traegt nur `heading` + ein Fliesstext-Absatz je Abschnitt — keine Listen, Links, Unterpunkte, kein "Stand: <Datum>"-Feld. Am Liefertag droht ein zweiter Schema-Umbau unter Zeitdruck.
4. Einziger automatisierter Beweis fuer `noindex` + Vorrangklausel liegt in `apps/web/test/pages.test.js`, das **nicht** in CI laeuft (`.github/workflows/ci.yml` faehrt nur `test/*.test.js` im Root). Am Liefertag ist niemand gezwungen, diesen Test auszufuehren.
5. EN-Rechtsseite setzt Self-Canonical auf sich selbst, kein `<link rel="alternate" hreflang="de">` auf die verbindliche Fassung — mit `noindex` funktional unkritisch, aber kein Markup-Signal.
6. `.gitignore`-Ausnahme `!apps/web/src/data/` schlaegt ein Loch in die breite `data/`-Regel — heute korrekt, aber ein spaeterer Laufzeit-Ablageort unter diesem Pfad wuerde ungewollt mitcommittet.
7. Vorbestehend, nicht von P14 verursacht: `apps/web`-Suite nicht durchgehend gruen (Bestandsfehler Site-Chrome-Marker auf `/so-funktionierts`) und flaky unter Parallelitaet (mehrere Testdateien bauen ins selbe `dist-test`).

## Clean-Code-Audit

- **S1:** keine Funde.
- **S2:** keine Funde.
- **S3:** `findLegalDocument` vs. `requireLegalDocument` — saubere Namens-Differenzierung, kein Verstoss (PASS). Kommentare durchgehend praezise, benennen Owner-Entscheidungen (O13, D4, D5, D7, Q-LANG) und Fundstellen (PASS).
- **S4:** Die drei DE-`.astro`-Seiten (`agb`, `datenschutz`, `impressum`) sind bis auf Slug/JSON-Namen strukturell identisch — **keine vermeidbare Duplizierung**: Astro-dateibasiertes Routing verlangt fuer feste Pfade je eine eigene Datei (anders als die dynamische EN-Route `[slug].astro`); die eigentliche Logik ist bereits vollstaendig in `legal.js`/`LegalDocument.astro` zentralisiert. Kein Fix noetig, nur Kenntnisnahme.

**Verdikt:** PASS. Saubere, gut getestete Migration von Inline-Platzhaltertext zu JSON-Content-Dateien mit zentraler, fail-closed validierender `legal.js` (Pflichtfelder, Vorrangklausel-Schutz D5, kein Sprach-Fallback D4, vollstaendige DE-Fassungs-Pflicht D7). `LegalDocument.astro` und `legal-content.js` sind saubere Single-Responsibility-Module. `.gitignore`-Ausnahme empirisch verifiziert (`git ls-tree` zeigt die JSON-Dateien tatsaechlich getrackt). `test/legal-content.test.js` deckt alle Funktionen inkl. Fehlerpfade ab. `node --check` auf `legal.js` bestanden. Keine S1/S2-Funde.

**Top-TODOs:** kein Blocker. Sobald der Owner echten Rechtstext liefert (terms/privacy/imprint `.en.json` + finale DE-Texte statt Platzhalter), wird GAP-15 automatisch gruen — kein Code-Handlungsbedarf. Optional/nicht dringend: die drei identischen DE-`.astro`-Dateien liessen sich ggf. weiter zusammenziehen, ist aber durch Astro-Routing-Konvention gerechtfertigt und kein Muss.

## Fix-Runden

Keine — `=== FIXES ===` war leer. Kein Blocker aus Safety- oder Clean-Code-Review, daher keine Nachbesserungsrunde noetig.
