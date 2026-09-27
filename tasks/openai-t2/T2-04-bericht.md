# T2-04 - Auth/Origin: `PUBLIC_URL` in Produktion Pflicht - Abschlussbericht

Branch: `phase/openai-t2-04-public-url`, Commit `e487317` (unveraendert). Scope: **nur T-32**.

## 0. Was diese Phase NICHT erfuellt

- **Kein Deploy erfolgt und kann nicht erfolgen aus dieser Kette.** Die Boot-Pflicht ist scharf
  geschaltet (kein Feature-Flag, keine Uebergangsfrist) - ob `PUBLIC_URL` im Render-Dashboard
  tatsaechlich gesetzt ist, ist von hier aus nicht pruefbar (kein Produktionszugriff in dieser
  Session). Solange das nicht verifiziert ist, ist ein Merge dieser Phase mit anschliessendem
  Deploy ein **scharfer Dienstausfall**, kein theoretisches Risiko - siehe Abschnitt 5.
- Der Plan nennt als Datei `src/boot-guard.js` (:889-985) samt Boot-Guard-Test. Gebaut wurde
  stattdessen in `src/config.js` (`PRODUCTION_FOOTGUNS`), `boot-guard.js` bleibt unangetastet. Der
  Code selbst begruendet das (`boot-guard.js:952-954`: "dafuer gibt es schon einen Eigentuemer,
  assertConfig, config.js"). Ich uebernehme diese Zuordnung, kann sie aber nicht als vom Plan
  vorgesehen bestaetigen - s. Abschnitt 3, Widerspruch W1.
- Das im Plan formulierte Abnahmekriterium "mit `PUBLIC_URL` -> lauscht, PRM.resource =
  `PUBLIC_URL/mcp`" ist **im Produktionsprofil selbst nicht herstellbar** (Bestands-Footgun
  `STORE_BACKEND !== 'pg'` verweigert den Boot mangels echtem Postgres im Testkontext, dokumentiert
  in `test/boot-prod-footguns.test.js` bei T-P0-5-14). Ersatz gebaut: Positivseite als Unit
  (`productionFootguns(...) === []`, T2-04-02/05) plus der bereits bestehende PRM-Beleg ausserhalb
  des Produktionsprofils (`test/oauth.test.js`). Kein Duplikat des bestehenden PRM-Tests gebaut.
- Keine Aenderung an `.env.example`/`render.yaml`/`docs/RUNBOOK-TELNYX-ASSISTANT.md` macht die
  Regel selbst wirksam - sie ist reine Doku-Nachfuehrung. Wirksam ist ausschliesslich der neue
  Footgun in `src/config.js`.
- Kein neuer Commit in dieser Session (der Bau-Commit war schon vorhanden und ist unveraendert
  Bestandteil dieses Branches).

## 1. Was erfuellt ist, ID fuer ID

### T-32 - "MCP-Server-Origin ist nach Publikation unveraenderlich; Aenderung erfordert ein neues Plugin"

Umsetzung: neues abgeleitetes Config-Blatt `server.publicUrlExplicit` (Boolean, `.trim()`-geschuetzt
gegen einen aus dem Dashboard kopierten Zeilenumbruch) haelt fest, ob `PUBLIC_URL` ausdruecklich
gesetzt ist statt aus `RENDER_EXTERNAL_URL` geerbt:

- `src/config.js:1500-1506` - Definition `publicUrlExplicit = Boolean((process.env.PUBLIC_URL ||
  "").trim())`.
- `src/config.js:2303` - in `CONFIG_NAMESPACES.server` aufgenommen (Namespace-Test musste
  Zaehlungen nachziehen, s. Abweichung unten).
- `src/config.js:~2466-2481` - neuer Eintrag in `PRODUCTION_FOOTGUNS`: `trifftZu: (cfg) =>
  !cfg.server.publicUrlExplicit`, Meldung nennt `PUBLIC_URL`, die Sollform (`https://<host>[:<port>]`,
  ohne Pfad/Query/Slash) und den Grund (Origin-Wechsel nach Publikation verlangt neues Plugin) -
  ohne Wert-Echo (Muster wie beim Bestands-`allowlistFindings`).
- Wirkweg: `assertConfig()` (`src/boot.js`, laut Lead-Notiz Zeile 515) ruft `productionFootguns`
  auf und beendet den Prozess bei jedem Treffer mit `exit 1` - der neue Eintrag reiht sich in
  denselben, bereits bestehenden fail-closed-Mechanismus ein, es gibt keinen zweiten Pfad.
- Test-Beweise (alle gruen, Log:
  `/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/bd9573f0-5514-4611-89e2-53dd73e46bd1/scratchpad/logs-t2-04/t2-04-tests.log`):
  - `T2-04-01` (`test/config-prod-footguns.test.js`): Produktion + `publicUrlExplicit=false` ->
    genau ein Befund, nennt `PUBLIC_URL` + Sollform, kein Wert-Echo.
  - `T2-04-02`: Produktion + `publicUrlExplicit=true` -> kein Footgun.
  - `T2-04-03`: Nicht-Produktion + `publicUrlExplicit=false` -> kein Footgun (der Rueckfall
    `RENDER_EXTERNAL_URL` ist zugleich der Produktionsdiskriminator, `config.js:204-206`, kann also
    ausserhalb Produktion per Definition nicht als stiller Rueckfall auftreten - s. Widerspruch W2).
  - `T2-04-04` (`test/boot-prod-footguns.test.js`, echter Kindprozess-Boot): Hosting-Profil ohne
    `PUBLIC_URL` -> Exit-Code `!= 0`, Ausgabe enthaelt `PUBLIC_URL`.
  - `T2-04-05`: Hosting-Profil MIT gesetztem `PUBLIC_URL` -> der neue Footgun feuert NICHT
    (Spezifitaets-Gegenprobe; der Boot scheitert dort trotzdem am Bestands-Footgun
    `STORE_BACKEND`, das ist beabsichtigt und in T-P0-5-14 dokumentiert, kein T2-04-Defekt).

Alle 5 Tests liefen isoliert in dieser Session (`node --test`, `NODE_ENV=test`,
`--test-concurrency=4`): 51 pass / 0 fail ueber die 5 betroffenen Testdateien zusammen.

## 2. Beruehrte Pfade und Vollstaendigkeit

| Pfad | Beruehrt? | Befund |
|---|---|---|
| Produktionsprofil (`detectProduction()===true`), `PUBLIC_URL` fehlt | Ja | Boot verweigert, exit 1, Meldung nennt `PUBLIC_URL` (T2-04-01, T2-04-04) |
| Produktionsprofil, `PUBLIC_URL` gesetzt | Ja | Kein Footgun aus dieser Regel (T2-04-02, T2-04-05) |
| Nicht-Produktion, `PUBLIC_URL` fehlt | Ja | Unveraendert - Rueckfall auf `RENDER_EXTERNAL_URL` bleibt, kein Footgun (T2-04-03) |
| `CONFIG_NAMESPACES`/Config-Introspektion | Ja | Neues Blatt `server.publicUrlExplicit` gepinnt, Zaehl-Tests nachgezogen |
| Andere Footgun-Fixturen im Repo (T2-03, Single-Origin) | Ja | Zwei Testdateien brauchten eigene lokale Ergaenzung um `publicUrlExplicit`, sonst TypeError bzw. falscher Footgun-Treffer (s. Abweichungen) |
| Der Punkt ist NICHT auf allen Pfaden erfuellt: | - | Der einzige echte End-to-End-Positivbeweis "Boot laeuft MIT `PUBLIC_URL` bis /mcp lauscht" fehlt im Produktionsprofil selbst (Widerspruch W3) - ersetzt durch Unit + bestehenden PRM-Test ausserhalb des Profils, s. Abschnitt 0. |

## 3. Widersprueche Plan/Code (fuer den Merge-Entscheider)

- **W1 (Datei-Zuordnung):** Plan nennt `src/boot-guard.js`, gebaut wurde in `src/config.js`. Der
  Code selbst weist die Zustaendigkeit ausdruecklich `config.js` zu; ich kann diese Selbstauskunft
  nicht gegen eine Plan-Absicht pruefen, die anders lautet.
- **W2 (Pre-Mortem-Praemisse teilweise gegenstandslos):** "Ausserhalb Produktion bleibt der
  Rueckfall" ist trivial wahr, weil der Rueckfallwert selbst der Produktionsdiskriminator ist -
  es gibt dafuer keinen Code-Bedarf, nur die Gegenprobe.
- **W3 (Abnahmekriterium nicht wortgetreu herstellbar):** s. Abschnitt 0 und 2 - der Plan-Wortlaut
  "mit `PUBLIC_URL` -> lauscht, PRM.resource = `PUBLIC_URL/mcp`" wurde durch Unit + Bestandstest
  ersetzt, nicht woertlich erfuellt.
- **W4 (Doku lief Code voraus):** `.env.example` und `render.yaml` behaupteten die Regel schon vor
  diesem Bau, ohne dass sie durchgesetzt wurde. `docs/RUNBOOK-TELNYX-ASSISTANT.md:24` behauptete
  bislang gegenlaeufig `RENDER_EXTERNAL_URL` als Quelle - im Diff korrigiert.

## 4. Was ein fremder Pruefer nachmessen sollte (neutral)

- Ist der neue Footgun-Eintrag in `src/config.js` (Abschnitt `PRODUCTION_FOOTGUNS`) tatsaechlich an
  `productionFootguns()` angeschlossen, und ruft `assertConfig()` diese Funktion im Boot-Pfad auf
  (nicht nur in einem Test-Mock)? Woran siehst du das - Aufrufkette in `src/boot.js` bzw. dem
  Server-Einstiegspunkt nachverfolgen.
- Liefert `productionFootguns({...SAFE_PROD, server:{...,publicUrlExplicit:false}}, true)`
  isoliert ausgefuehrt tatsaechlich genau einen Treffer, der `PUBLIC_URL` im Text traegt und keinen
  Wert echot? (`test/config-prod-footguns.test.js`, T2-04-01)
- Startet ein echter Kindprozess im Hosting-Profil ohne `PUBLIC_URL` tatsaechlich NICHT (Exit-Code
  ungleich 0, `/healthz` nicht erreichbar)? (`test/boot-prod-footguns.test.js`, T2-04-04) - und
  bootet derselbe Kindprozess MIT gesetztem `PUBLIC_URL` bis zu genau dem Punkt, an dem NUR noch
  der unabhaengige `STORE_BACKEND`-Footgun greift (T2-04-05)?
- Stimmen die in `test/config-namespaces.test.js` gepinnten Zahlen (Namespace `server`: 9->10
  Blaetter, Gesamt 199->200 Keys/185->186 primitive Blaetter) mit der tatsaechlichen Struktur von
  `CONFIG_NAMESPACES` ueberein, oder wurden sie nur hochgezaehlt, ohne dass `publicUrlExplicit`
  wirklich neu und einzig ist?
- Sind `test/openai-t2-03-auth-hints.test.js` und `test/single-origin-auth.test.js` nach der
  Ergaenzung ihrer lokalen SAFE_PROD-Fixturen weiterhin inhaltlich fuer ihren eigenen Zweck
  aussagekraeftig (T2-03/Single-Origin), oder wurde dort nur ein Feld ergaenzt, ohne die
  urspruengliche Pruefung zu verwaessern?
- Ist die gestrichene eslint-Suppression (`eslint-suppressions.json`, `no-magic-numbers` in
  `config-prod-footguns.test.js`) tatsaechlich ueberfluessig geworden, weil die Anzahl der
  Footguns jetzt als benannte Konstante steht - oder wurde eine Absicherung stillschweigend
  entfernt, ohne dass der Grund zutrifft?
- Trifft der neue Footgun NUR im Produktionsprofil und NUR bei fehlendem `PUBLIC_URL` - kein
  Fehlalarm bei gesetztem Wert, keine Wirkung ausserhalb Produktion (T2-04-03)?

## 5. Owner-Punkte und Restrisiko

- **OW-G (Deploy-Vorbedingung, zwingend vor JEDEM Deploy dieser Kette):** Render-Dashboard ->
  Gateway-Service -> Environment -> Schluessel `PUBLIC_URL` pruefen. Erwartet: gesetzt, `https://`,
  ohne Pfad/Query/Fragment, ohne Slash am Ende, exakt der Origin der OpenAI-Einreichung
  (Marken-Host) - **nicht** der `*.onrender.com`-Hosting-Host. Fehlt der Wert oder weicht er ab:
  Wert setzen und ERST DANACH deployen. Lesende Alternative ohne Dashboard-Zugriff: `GET
  https://<Marken-Host>/.well-known/oauth-protected-resource` - Feld `resource` muss
  `<Marken-Host>/mcp` zeigen; zeigt es den Hosting-Host, ist `PUBLIC_URL` nicht gesetzt und der
  Deploy ist zu blockieren.
- **OW-Deploy:** Merge/Push/Deploy macht ausschliesslich der Owner; diese Kette hat nichts
  gepusht oder gemergt. Startet der Dienst nach einem Deploy trotz fehlendem Wert nicht: einziger
  Ausweg ist ein Render-Rollback auf den vorherigen Deploy, da der Riegel nur im neuen Commit
  steckt.

**Restrisiko:** Diese Phase macht aus einem bisher stillen, unsichtbaren Fehlverhalten (Origin
haengt am volatilen Hosting-Host, kein OpenAI-App-tauglicher stabiler Origin) einen scharfen,
lauten Boot-Abbruch. Das ist die richtige Richtung fuer die Einreichung, aber der Preis ist real:
der einzige bislang produktiv getragene Fall war genau der stille Rueckfall auf
`RENDER_EXTERNAL_URL`. Ist `PUBLIC_URL` im Dashboard nicht gesetzt und wird trotzdem gemergt und
deployt, faellt der gesamte Dienst aus - kein `app.listen`, kein `/voice`, kein `/mcp`, keine
eingehenden Anrufe. Das Review hat diesen Punkt als "wichtig" markiert und gefordert, dass OW-G
als harte Vorbedingung in diesem Bericht steht - das ist hiermit erfuellt; eine repo-weite
Deploy-Checkliste, die der Owner routinemaessig abarbeitet, existiert nach diesem Review-Fund
weiterhin nicht (nicht Teil dieser Phase, T-32 betrifft nur `PUBLIC_URL`).

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- Urteil des Laufs: PASS (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: e487317; Tests (volle Suite, pass/fail): 6302/1
- Review-Urteile zuletzt: {"safety":"PASS","cleancode":"PASS"}
- Tabelle ID | erfuellt | Beleg | Luecke:
  | ID | erfuellt | Beleg | Luecke |
  |---|---|---|---|
  | T-32 | ja | src/config.js:1506 publicUrlExplicit + :2475 Footgun; Lauf: Hosting ohne/leeres PUBLIC_URL -> exit 1 "Boot wird verweigert" + Befund, mit PUBLIC_URL Befund weg (probe-t32.log); Tests T2-04-01..05 gruen. Live-Rest: Render-Dashboard-Wert. | Nur Live-Rest: ob PUBLIC_URL im Render-Dashboard gesetzt ist und auf die oeffentliche /mcp-Origin zeigt - lokal nicht messbar. |
- Isoliert rot: []
- Offene Blocker:
  - safety/wichtig PLAN-SECURITY.md:5634: Die Deploy-Vorbedingung OW-G (PUBLIC_URL muss im Render-Dashboard stehen) existiert im Diff nur an zwei Orten, die vor einem Deploy niemand zwingend liest: einem Absatz am Ende einer ~5.600-Zeilen-Datei (PLAN-SECURITY.md:5634) und einem Kommentar in render.yaml:733 - also ausgerechnet in der Datei, die laut eigener Lehre NICHT die Produktionswahrheit ist. Eine Deploy-/Release-Checkliste, die der Owner vor dem Deploy abarbeitet, gibt es im Repo nicht (docs/RELEASE-GATE-killer-test.md deckt nur RLS/pgBouncer ab, docs/RUNBOOK-* keinen allgemeinen Deploy). Ob OW-G in den owner_punkte des Phasenberichts landet, ist am Diff nicht pruefbar (Berichte liegen bewusst nicht im Diff) - UNKNOWN.
