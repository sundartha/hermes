# Bericht: Phase AUTH-P9a — Cache-Header fuer die statische Auslieferung

**Gate: PASS**
**finalBranch:** `phase/auth-p9a-cache-header`
**Commit:** `af2aa954827b7d04c4c5e9bbaf9bca74bedc4c5d` (Basis `master@b111927`)

---

## 1. Die Aenderung

Genau eine Produktionsdatei geaendert: `src/app.js`, Funktion `registerStaticServing`.

`express.static(config.server.webDistDir, { extensions: ["html"] })` bekommt eine
`setHeaders`-Option. Neu eingefuehrt (zwischen `registerPathRedirects` und
`registerStaticServing`):

- `ASTRO_ASSET_DIR = "_astro"`
- `HTML_SUFFIX = ".html"`
- `IMMUTABLE_MAX_AGE_SECONDS = 31_536_000` (ein Jahr, RFC-9111-Obergrenze)
- `IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"`
- `HTML_CACHE_CONTROL = "no-cache"`
- reine Entscheidungsfunktion `cacheControlForStaticFile(filePath, astroDirPrefix)`:
  1. endet `filePath` auf `.html` -> `no-cache` (Regel steht bewusst VOR der `_astro`-Regel)
  2. beginnt `filePath` mit dem exakten Praefix `<webDistDir>/_astro` + `path.sep` -> `immutable`
  3. sonst `null` -> der serve-static-Default (`public, max-age=0`) bleibt unangetastet

`astroDirPrefix` wird einmal beim Mount aus `config.server.webDistDir` (bereits absolut,
`path.resolve` in `config.js`) gebaut, nicht pro Request neu berechnet.

Neue Testdatei: `test/auth-p9a-cache-headers.test.js` (5 Tests, AUTH-P9A-1..5).

**Explizit nicht angefasst:** `src/middleware.js` (no-store fuer `/api/`),
`express.static(config.server.publicDir)`, der SPA-Fallback `app.get("/app/*")`
(`res.sendFile`, ausserhalb von `express.static`), das Legacy-Checkout-Paar
(`setup-checkout`/`checkout-return`), keine `.md`/`.env.example`/`render.yaml`-Edits, keine
neue Dependency, kein Flag.

---

## 2. Beleg fuer die Astro-Pfade

Nicht neu gebaut (kein Grund dafuer — `apps/web/dist` ist gitignored, bereits am lokalen Build
in Plan-Abschnitt 0 vermessen). Stattdessen `apps/web/astro.config.mjs` gelesen: `build.assets`
wird dort nicht gesetzt, also gilt Astros Default-Asset-Verzeichnis `_astro/`. Der
Produktionscode baut den Praefix laufzeit-dynamisch aus `config.server.webDistDir +
ASTRO_ASSET_DIR` — kein geratener Pfad. Die Test-Fixture bildet das gemessene Muster nach:
`_astro/chunk.AbC12345.js` (Hash im Namen), `_astrophysik/hinweis.js` (Falle: enthaelt
`_astro` als Teilstring, ist aber ein anderes Verzeichnis), `assets/hero.js`
(Gegenprobe, wie `apps/web/public/*` — nicht fingerprintet).

---

## 3. Tests inkl. Gegenprobe

`test/auth-p9a-cache-headers.test.js`, ein Server fuer die ganze Datei, Spawn gegen Temp-
`WEB_DIST_DIR`:

| Test | Request | Assertion | Zweck |
| --- | --- | --- | --- |
| AUTH-P9A-1 | `GET /_astro/chunk.AbC12345.js` | `cache-control === "public, max-age=31536000, immutable"` | Kernbehauptung: fingerprintet -> immutable |
| AUTH-P9A-2 | `GET /app/` und `GET /` | je `cache-control === "no-cache"` | HTML -> no-cache |
| AUTH-P9A-3 | `GET /assets/hero.js` | `doesNotMatch(/immutable/)` UND `=== "public, max-age=0"` | **Gegenprobe**: nicht fingerprintet bekommt weder immutable noch einen sonst veraenderten Default |
| AUTH-P9A-4 | `GET /_astrophysik/hinweis.js` | `doesNotMatch(/immutable/)` | **Gegenprobe**: Praefix exakt, nicht "enthaelt _astro" |
| AUTH-P9A-5 | `GET /api/plans` | `cache-control === "no-store"` | middleware.js unberuehrt |

Ergebnis: `npm test` 3806 pass / 0 fail (unabhaengig vom Reviewer im Frisch-Worktree
nachgefahren: 3786/3786 nach Abzug der 20 Datei-Wrapper, Dauer 95,4 s). `node --check src/app.js`
gruen.

Zusaetzliche, vom Impl-Autor unabhaengige Gegenprobe des Safety-Reviewers (eigener
Scratchpad-Spawn-Test, eigenes Temp-`WEB_DIST_DIR`, fuenf eigene Fallen):

```
/_astro.txt                     -> public, max-age=0
/vendor/_astro-shim.js          -> public, max-age=0
/_astroX/a.js                   -> public, max-age=0
/_astro/seite.html              -> no-cache        (HTML-Regel gewinnt trotz _astro-Pfad)
/_astro/chunk.Zz999999.css      -> public, max-age=31536000, immutable
/_astro/tief/chunk.Qq111111.js  -> immutable        (auch verschachtelt)
```
`/api/plans`, `/api/state`, `/api/gibtsnicht` (404) tragen weiterhin `no-store`.

Katalog-Einordnung geprueft: `AUTH-P9A-…` matcht `package.json config.i18nCatalogPattern`
nicht -> die Tests laufen im Regressionslauf (`npm test`), nicht im Gates-Lauf. Kein
Bestandstest kollidiert (`grep -rni "cache-control" test/` traf nur die unberuehrten
`test/headers.test.js`-Faelle).

---

## 4. Mutationsprobe (Rot-vor-Fix, danach zurueckgenommen)

| # | Mutation | Ergebnis |
| --- | --- | --- |
| M1 | `setHeaders`-Option komplett aus `express.static` entfernt | AUTH-P9A-1 und AUTH-P9A-2 rot (`public, max-age=0` statt `immutable`/`no-cache`); AUTH-P9A-3/4/5 blieben gruen — erwartungsgemaess, da diese Tests Abwesenheit behaupten |
| M2 | `filePath.startsWith(astroDirPrefix)` -> `filePath.includes(ASTRO_ASSET_DIR)` | NUR AUTH-P9A-4 rot (`/_astrophysik/hinweis.js` bekam faelschlich `immutable`) — Beweis fuer den exakten Praefix-Match |
| M3 | HTML-Zeile in `cacheControlForStaticFile` entfernt | NUR AUTH-P9A-2 rot |

Alle drei Mutationen nach Beobachtung zurueckgenommen; `node --check` + volle `npm test`
danach erneut gruen (3806/3806).

---

## 5. Safety-Urteil

**PASS**, unabhaengig nachgerechnet in frischem Worktree (Branch `review-auth-p9a` von
`phase/auth-p9a-cache-header`). Kernaussagen:

- Der teuerste Fehlerfall — ein faelschlich immutable ausgeliefertes Asset, das einen
  Rollback im Browser des Nutzers ueberlebt — ist strukturell ausgeschlossen: echter
  Verzeichnis-Praefix-Match (`path.join(webDistDir, "_astro") + path.sep`), keine
  Teilstring-Pruefung; HTML-Regel steht bewusst vor der `_astro`-Regel.
- Die Header-Vorrangbehauptung wurde nicht geglaubt, sondern in `send@0.19.2 index.js:854`
  selbst geprueft: `setHeaders` feuert vor dem eigenen Cache-Control-Default, der nur greift,
  wenn der Header noch leer ist.
- `git diff` auf `src/middleware.js`, `src/wiring/`, `src/route-policy.js`,
  `src/routes/api-billing.js` ist leer; `express.static(publicDir)` unangetastet; Legacy-
  Checkout-Paar unveraendert; keine neue Env-Variable, kein Flag, keine Dependency
  (`package.json`, `package-lock.json`, `.env.example`, `render.yaml` alle 0 Zeilen Diff).
- Genau 2 geaenderte Dateien, genau 1 Commit.

**Concerns (keine Blocker):**
1. Der SPA-Fallback `app.get("/app/*")` (`res.sendFile`) umgeht `setHeaders` und liefert
   `public, max-age=0` statt `no-cache` fuer Deep-Links wie `/app/dashboard`. Frische-
   technisch gleichwertig (erzwingt ebenfalls Revalidierung bei jeder Nutzung), aber
   inkonsistent zur erklaerten HTML-Regel und ungetestet.
2. Auf einem case-insensitiven Dateisystem wuerde `/_ASTRO/x.js` den Praefix-Match verfehlen
   -> `public, max-age=0`. Fail-safe-Richtung (zu wenig statt zu viel Cache), kein Risiko.
3. Wirksamkeit in Produktion setzt voraus, dass `WEB_DIST_DIR` auf dem Live-Gateway gesetzt
   ist (Single-Origin). Ist die Marketing-Site dort weiterhin ein separater Render-Static-
   Service, greift dieser Pfad in Produktion nicht — ausserhalb des Phasen-Scopes, aber vor
   dem Wirksamkeits-Nachweis am Live-Deploy zu pruefen.

---

## 6. Clean-Code-Audit

**PASS.** S1/S2 (Blocker): keine. S4: keine.

**S3 (nicht blockierend):**
- P14 (Tests) — `test/auth-p9a-cache-headers.test.js:59-66`: AUTH-P9A-2 prueft in einem Test
  zwei unabhaengige Routen (`/app/` und `/`) statt zwei separate Tests; ein Fehlschlag auf der
  zweiten Route wuerde die erste Pruefung im Testoutput verschlucken. Optionaler Fix: in zwei
  Tests aufteilen ("App-Shell traegt no-cache" / "Marketing-Index traegt no-cache").

Positiv gepruefte Punkte: `IMMUTABLE_MAX_AGE_SECONDS` benannt statt Magic Number (G25);
`cacheControlForStaticFile` reine, seiteneffektfreie Entscheidungsfunktion (G19/G30, P5
Command-Query); `astroDirPrefix` einmal beim Mount gebildet, nicht pro Request (G5); 5 Tests
decken Normalfall, HTML, zwei Gegenproben und Nicht-Beruehrung von `/api/*` ab (T5/G3).
Kommentar-Behauptungen im Diff gegengeprueft: `config.server.webDistDir` ist ueber
`path.resolve` absolut (`config.js:1250`), `/api/*`-`no-store`-Header existiert unveraendert
(`middleware.js:26`).

---

## 7. Fix-Runden

Keine. Impl, Safety und Clean-Code kamen jeweils direkt auf PASS/keine Blocker; die einzige
offene Notiz ist der optionale S3-Stilpunkt zur Testgranularitaet (nicht umgesetzt, da nicht
blockierend).

---

## 8. Nach-Deploy-Pruefung

**WICHTIG — EHRLICHKEITSREGEL:** Die Cache-Wirkung dieser Phase ist bislang ausschliesslich
lokal (Spawn-Tests gegen ein Temp-`WEB_DIST_DIR`) und in Mutationsproben belegt. **Ob die
Header auf der echten Live-URL ankommen, ist erst nach dem Deploy messbar** — dieser Bericht
enthaelt keine Live-Messung, weil der Commit zum Zeitpunkt der Berichtserstellung noch nicht
deployed ist. Nach dem Deploy sind folgende Proben zu fahren:

```
curl -I https://<live-domain>/app/
  -> erwartet: cache-control: no-cache

curl -I https://<live-domain>/_astro/<echter-chunk-name>.js
  -> erwartet: cache-control: public, max-age=31536000, immutable
```

Der `<echter-chunk-name>` muss aus dem tatsaechlich deployten Build gelesen werden (z.B. aus
dem `<script>`/`<link>`-Tag von `GET /app/`) — nicht geraten, da der Hash sich mit jedem Build
aendert. Wie im Safety-Concern #3 vermerkt: die Wirksamkeit dieser Aenderung setzt voraus,
dass die statische Auslieferung tatsaechlich ueber dieses Gateway (`config.server.webDistDir`
via `express.static` in `src/app.js`) laeuft und nicht ueber einen separaten Render-Static-
Service — das ist ebenfalls erst am Live-Deploy pruefbar, nicht am Code.

**Warum der strikte Praefix-Match wichtig ist:** ein faelschlich als `immutable` ausgeliefertes
Asset ueberlebt einen Rollback — Browser und Zwischen-Caches liefern es bis zum Ablauf von
`max-age` (ein Jahr) aus dem Cache, unabhaengig davon, was der Server danach zurueckgibt. Genau
deshalb ist der Match in dieser Phase ein exakter Verzeichnis-Praefix
(`path.join(webDistDir, "_astro") + path.sep`) und keine Teilstring-Pruefung, und genau deshalb
steht die HTML-Regel vor der `_astro`-Regel: eine `.html` unter `_astro/` (hypothetisch, aktuell
nicht der Fall) wuerde trotzdem `no-cache` bekommen statt `immutable`.

---

## 9. Was diese Phase NICHT belegt

- **Keine Live-Messung.** Die curl-Proben aus Abschnitt 8 sind noch nicht gefahren; alle
  Belege in diesem Bericht stammen aus lokalen Spawn-Tests gegen ein Temp-Verzeichnis, nicht
  von der echten Auslieferungskette.
- **Nicht belegt, dass die Marketing-Site auf Produktion tatsaechlich ueber dieses Gateway
  ausgeliefert wird.** Falls `hermes-web` weiterhin ein separater Render-Static-Service ist,
  greift dieser Code dort nicht — das war schon vor dieser Phase offen und wird hier nicht
  geklaert.
- **Der SPA-Fallback (`/app/*` via `res.sendFile`) ist nicht Teil dieser Aenderung** und traegt
  weiterhin `public, max-age=0` statt `no-cache`. Kein Sicherheitsrisiko (siehe Safety-Concern
  1), aber auch kein Beleg, dass alle App-Shell-Auslieferungswege einheitlich sind.
- **Diese Phase haette den Vorfall vom 2026-07-28 allein nicht verhindert.** Ein bereits
  geoeffneter Browser-Tab haelt alte Chunk-Namen im DOM, unabhaengig vom Cache-Header einer
  neuen Anfrage. Die Wurzel jenes Vorfalls war das Basic-Gate vor dem 404-Handler (behoben mit
  P7); diese Phase behebt eine zweite, unabhaengig davon falsche Sache (`max-age=0` auf
  fingerprinteten Assets).
- **Case-Insensitive-Dateisysteme** (z.B. lokal auf macOS) sind nicht Teil der Produktions-
  Zielplattform (Render/Linux) und wurden nur als Randnotiz geprueft, nicht als Testfall
  abgedeckt.
- **Kein Vergleich mit alternativen Cache-Strategien** (z.B. `stale-while-revalidate`,
  ETag-basierte Validierung fuer HTML) wurde angestellt — Spec-Scope war exakt eine Aenderung.
