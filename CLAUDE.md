# Hermes

Autonomer Telefon-KI-Agent: Telnyx und ElevenLabs für die Telefonie, Claude als Gesprächs-Gehirn, MCP-Server.
Multi-Tenant, JSON- oder Postgres-Store, OAuth/OIDC-Auth.
Nimmt echte Anrufe an und löst echte Anrufe und SMS aus (Kosten!), speichert Gesprächs-Transkripte.
Der Dienst läuft öffentlich erreichbar (Render) und telefoniert mit echten Menschen; Sicherheits- und Kosten-Gates haben Vorrang vor Features.
Naming: **Hermes** ist Produkt und Agent, **Sundartha** die Firma (`sundartha.com`). Repo-Verzeichnis, Render-Service und einige Env-Namen heißen noch `vodafone-agent`; der Umzug ist nicht Teil normaler Aufgaben.

## Arbeitsweg (Standardweg)

Jede Änderung läuft so, ohne Ausnahme und ohne Sonderweg:

1. **Issue** mit Absicht und Warum, Abnahmekriterien und Nicht-Zielen; Absicht und Warum stehen wörtlich vorn in Plan und Brief an den Bau-Agenten. Die Abnahmekriterien sind der Vertrag für Bau und Urteil und nennen nur testbares Verhalten, das aus der Absicht folgt; Doku-Texte, die kein Code unter `src/` liest, laufen im selben PR mit, werden gelesen statt getestet und verweisen auf die Quelle eines Werts, statt ihn abzuschreiben, auch in `.env.example`.
2. **Plan** im Issue nach dem Skill `planung`: betroffene Dateien und Tests per Befehl ermitteln, nicht schätzen (`node tools/pruefen.mjs betroffen <Datei> …`). Große Änderungen bekommen Design und eine Gegenprüfung und werden in Häppchen von 100–300 geänderten Zeilen geschnitten; jedes Häppchen ist ein eigener PR.
3. **Bau** durch den Agenten `bau` in einem eigenen Worktree (`git worktree add .claude/worktrees/<name> -b <branch> <master>`); im Haupt-Checkout wird nicht geschrieben. Erst der Abnahmetest, der rot ist, dann der Code. Code unter `src/` schreibt nur der Bau-Agent.
4. **Vor dem Push** ist alles committet. `paket-push` führt `npm run pruefen` selbst aus und pusht nur bei Grün; der Agent startet es nicht selbst, sondern behebt bei Rot die gemeldete Ursache und ruft `paket-push` erneut auf. Der Befehl fährt nur einen schnellen Teilsatz für das Häppchen: Lint mit den Hermes-Regeln, eingefrorene Bestände, Typen, Architektur (neue Verstöße gegenüber master), Bedrohungskatalog, Testschutz und die direkt betroffenen Tests mit 2 Prozessen. Semgrep, alle Tests und Mutation laufen nur in der CI. Einzelne Schritte: `node tools/pruefen.mjs <schritt>`.
5. **PR** mit `Closes #<Issue>`. Pflicht-Checks: CI (Prüfungen, Semgrep, Tests, Rotprobe, Mutation), Testschutz, Freigabe-Prüfung.
6. **Urteil** durch den Agenten `pruefer` in einer frischen Sitzung, erst nach grüner CI. Er blockiert nur bei MUSS-Befunden; alles andere wird ein Folge-Issue. PASS heißt Approve auf dem aktuellen Stand.
7. **Merge** über die Merge-Queue.

Ein Rücklauf ist jede rote CI und jedes FAIL-Urteil am PR; gezählt wird nur von der Kette, auf GitHub am PR, also auch über Neustarts hinweg. Nach zwei Rückläufen wird nicht weiter nachgebessert, sondern bewertet: Liegt es an der Größe des Häppchens, wird neu geschnitten; liegt es woanders (Prüfwerkzeug, Test, Plan, Umgebung), hält das Paket an und nennt die Ursache in einem Satz im Issue. Beide Wege sind gleichwertig.
Lokal laufen nur Lint, Typen und einzelne Testdateien (`npm test -- <datei>`), keine Suiten; `npm run pruefen` läuft im Push über `paket-push`; die Sperre gegen lokale schwere Läufe wird nicht umgangen.

## Absolute Regeln

Alles, was Calls, SMS, Auth oder Budget-Gates beruehrt, gilt automatisch als nicht-trivial.
1. **SAFETY-GATES**: die per-Tenant-Verifikation als Outbound-Permit (Abo+KYC) und der globale
   Kill-Switch `OUTBOUND_FROZEN`, Denylist/Land-Gate/Stundenlimit, **die
   pro-Tenant-Kostendecke**, Max-Gespraechsdauer und die Provider-Signaturpruefung (Telnyx
   Ed25519, fail-closed) duerfen NIEMALS entfernt, aufgeweicht oder per Default umgangen werden.
   Neue Endpunkte, die Calls/SMS ausloesen koennen, brauchen dieselben Gates.
   (`ALLOWED_NUMBERS` ist seit dem outbound-p3-Cutover wirkungslos — der
   Key wird nicht mehr gelesen, s. `.env.example` und `src/config.js`.
   Die statische Allowlist ist NICHT das Gate, das hier geschuetzt wird.)
   `SKIP_TWILIO_SIGNATURE_CHECK` bleibt trotz des Namens: der Schalter ist der **globale**
   `/voice`-Bypass (`routes/voice.js`), kein Twilio-Schalter, und `boot-guard.js` haengt daran.
   Ein Rename ist eine eigene Entscheidung.
   **Owner-Entscheidung 2026-07-30 (E10): `MAX_BUDGET_EUR` ist KEIN geschuetztes Gate mehr.**
   Die pro-Tenant-Kostendecke sperrt weiterhin BEIDE Richtungen, Inbound eingeschlossen.
   Ohne dieses Gate kann eingehender Verkehr die Tenant-Decke unbegrenzt ueberziehen.
   Nicht ohne ausdrueckliche Owner-Entscheidung anfassen.
2. **OFFENLEGUNG**: Der Offenlegungssatz bei Outbound-Calls (Wortlaut aus `LOCALES.<lang>.disclosure`, vor dem ElevenLabs-Anrufstart geprueft in `src/elevenlabs/convai.js`) bleibt
   fest verdrahtet als allererster Satz — kein KI-Ermessen, kein Setting, das ihn abschaltet.
   **Owner-Entscheidung 2026-08-20 (OC): der Offenlegungssatz entfaellt bei einem Anruf an die eigene
   hinterlegte Nummer des anrufenden Tenants — und NUR dort; die KI-Kennzeichnung entfaellt dabei NICHT.**
   Die Ausnahme ist ENG und fail-closed.
   Nimmt dort jemand anderes ab, muss der erste Satz trotzdem sagen, dass eine KI spricht.
   **Pflicht-Rueckfall im Anrufmoment:** stellt sich im Gespraech heraus, dass am Apparat
   nicht der Auftraggeber ist, spricht der Agent SOFORT den vollstaendigen Offenlegungssatz
   (Wortlaut aus `LOCALES.<lang>.disclosure`) und fuehrt das Gespraech im Dritt-Modus weiter.
   **Was NICHT erlaubt ist und nie erlaubt wird:** kein Client-Flag und kein MCP-Parameter entscheidet
   darueber (der Aufrufer nennt nur `to`, den Rest entscheidet der Server); kein KI-Ermessen ueber das
   Praedikat (das Praedikat ist rein, das Modell sieht nur das Ergebnis); kein Setting, das die
   Offenlegung fuer Dritte abschaltet; keine zweite Stelle, die dieselbe Frage noch einmal beantwortet.
   **Preis, bewusst akzeptiert:** die hinterlegte eigene Nummer ist heute Format- und
   land-validiert, aber NICHT eigentums-verifiziert (`normalizePrivateNumber`,
   `src/store/state-ops.js:2127-2136`), und sie ist ueber `POST /api/self-service/private-number`
   von JEDEM eingeloggten Tenant setzbar (`src/self-service-routes.js:401`, nur `webAuthMw`).
   Wer eine fremde Nummer hinterlegt, erreichte damit einen
   KI-Anruf ohne den vollen Offenlegungssatz an einen Dritten.
   Deshalb ist die Ausnahme zusaetzlich an eine ausdrueckliche Tenant-Allowlist gebunden:
   ein nicht gepinnter Account kann sie nicht ausloesen, egal was er eintraegt.
   Die Besitz-Verifikation ist als Launch-Blocker in Issue #605 eingetragen.
   Wird der Eintrag dort geschlossen, ohne dass die Verifikation
   gebaut ist, ist DIESE Ausnahme zurueckzunehmen — nicht der Eintrag.
3. **AUTH FAIL-CLOSED**: Neue Endpunkte sind **standardmaessig** hinter einer authentifizierten
   Identitaet — Browser-Session (`webAuthMw`, fuer Betreiber-Routen zusaetzlich `adminMw`)
   oder, fuer den In-Process-MCP-Pfad, `internalOnly` (`isTrustedLocalCaller`).
   Jede Ausnahme (wie `/voice`, `/mcp`, `/healthz`, `/api/plans`) braucht eine eigene
   Absicherung, eine Begruendung im Feld `reason` **und** einen Eintrag in der Oeffentlich-Liste
   (`src/route-policy.js`); ohne beides schlaegt `test/route-auth-inventory.test.js` fehl.
   Credential-Vergleiche timing-sicher (`safeEqual`).
4. **SECRETS**: Nur ueber `.env` (lokal) bzw. Render-Dashboard.
   Niemals committen, niemals loggen, niemals in API-Responses oder MCP-Tool-Ausgaben leaken.
5. **AUDIO**: Audio laeuft NIEMALS durch MCP — nur Transkripte/Status.


## Was die Pflicht-Checks prüfen und warum

- **Lint** (`eslint.config.js`, eigene Regeln unter `tools/eslint-rules/`): keine Kommentare, keine echten Wartezeiten in Tests, keine Speicher-Attrappen, Fristen bei Anfragen, Funktionslänge. Neue Verstöße lassen sich nicht einfrieren: `eslint-suppressions.json`, die Bestandslisten unter `tools/basis/` und die Altlast in `tools/bausteine.json` schrumpfen nur.
- **Typen** (`tsc --noEmit`) und **Syntax** (`node --check`).
- **Architektur** (`tools/bausteine.json` mit Schichten und Eingängen je Baustein, `.dependency-cruiser.cjs`, Bereiche in `tools/bereiche.json`): Importe zwischen Bausteinen nur über deren Eingänge und nur zu tieferen Schichten, jede Datei unter `src/` in genau einem Baustein, die Blöcke in den `CLAUDE.md` der Ordner passend zur Karte (`npm run hinweise`), Telefonie nur über die Ports, Speicher nur über die Fassade, keine Ordnerzyklen, Tests nur über die öffentlichen Eingänge; für die Regeln aus `.dependency-cruiser.cjs` zählen nur neue Verstöße gegenüber master.
- **Semgrep** (Regelsätze `p/javascript`, `p/typescript`, `p/nodejsscan`, `p/expressjs`) auf den geänderten Dateien, **gitleaks**, **npm audit**, das Mindestalter neuer Paketversionen und der **Bedrohungskatalog** (`tools/katalog-pruefen.mjs`): Jede Zeile in `docs/sicherheitsgrenzen.md` hat einen Negativtest `SG-<nr> …`, und jede Route, jeder Webhook und jedes MCP-Werkzeug steht in der Angriffsfläche.
- **Tests**: die ganze Suite unter `test/` in sechs Teilen und die Web-Tests unter `apps/web/test/`. **Rotprobe**: Neue Testdateien eines PRs, der `src/` ändert, müssen auf master rot sein.
- **Testschutz**: Bestehende Dateien unter `test/` (Tests, Helfer, Fixtures) werden nur ergänzt, nie geändert oder gelöscht. Ändert ein PR absichtlich Verhalten, setzt Antonio oder Jonas (bzw. das Urteil in ihrem Auftrag) das Label `verhalten-geaendert`.
- **Freigabe-Prüfung**: Approve auf dem aktuellen Stand, und Änderungen unter `src/` kommen nur aus PRs der App `sundartha-agent`.
- **Mutation** (`node tools/pruefen.mjs mutation`, höchstens 4 Mutanten je Teil, bis 20 Teile): Stryker mutiert nur die geänderten Zeilen unter `src/`. Jeder Mutant läuft nur gegen die Testdateien, die seine Zeile laut Abdeckung (`NODE_V8_COVERAGE`, je Testdatei einmal je PR ohne Mutanten gemessen) tatsächlich ausführen, in der Rangfolge der erreichenden Tests; seine Frist ist 25 Minuten innerhalb der 45 Minuten je Teil (der Job selbst hat 60). Zeilen, die im selben Diff wortgleich aus einer anderen Stelle unter `src/` verschoben werden (`git diff --color-moved`), gelten nicht als geändert; eine verschobene und zugleich geänderte Zeile wird mutiert. Eine Testdatei ohne Abdeckung (rot ohne Mutant, keine Ausgabe) und eingebettete Browser-Skripte bleiben ungefiltert. Der Mutant gilt auch im Kindprozess, und ein Test zählt nur, wenn er ohne den Mutanten grün ist. Rot, wenn ein Mutant nicht getötet wird und der PR-Text unter „## Überlebende Mutanten“ nicht begründet, warum er äquivalent ist; nur „überlebt“ ist begründbar.
- **Wachstumsbremse**: Die Zahl der Dateien unter `tools/`, `.github/workflows/` und `.claude/hooks/` darf die Obergrenze in `ci.yml` nicht überschreiten, und die Obergrenze sinkt nur.

## Befehle

```
Start:        npm start              (Gateway + Dashboard + MCP-HTTP)
MCP (stdio):  npm run mcp
Setup-Check:  npm run check
Vor dem Push: läuft in paket-push (npm run pruefen), vom Bau-Agenten nicht selbst gestartet
Ein Test:     npm test -- test/<datei>.test.js
Launch-Gates: npm run test:gates     (i18n-Launch-Testkatalog, darf rot sein)
Neue Datei:   nur mit `npm run neu -- <route|fachdatei|test> <baustein oder bereich> <name>`
Lokal testen: PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start  + curl
```

Ein Test muss rot werden, wenn sich für einen Kunden oder Angerufenen etwas falsch verhält,
und er darf nicht rot werden, wenn nur Code umgebaut, umbenannt oder Text umformuliert wird.
Erlaubt sind Verhaltenstests über den echten Eingang (MCP-Werkzeug, HTTP-Route, Anbieter-Webhook),
reine Fachlogik als Tabelle von Eingabe und erwartetem Ergebnis, ein Vertragstest für die
Werkzeugliste und je Fehlerbehebung ein Test, der den Fehler vorher reproduziert.

Erfundene Schlüssel, Tokens und Geheimnisse in Tests kommen nur aus `test/gemeinsam/erfundene-geheimnisse.js` (die einzige Datei, die gitleaks erlaubt); neue Werte werden dort ergänzt.

## Keine Umgehung von Prüfungen

Code, Tests oder Konfiguration so zu schreiben, dass eine Prüfung einen Verstoß oder ein Muster nicht mehr erkennt, statt die Ursache zu beheben, ist eine Lockerung dieser Prüfung und braucht Antonios eigene, belegte Freigabe; ein Agent gibt sie nie frei, auch nicht in seinem Auftrag. Das gilt für jeden Agenten und jede Anweisung an einen Agenten. Hältst du eine Prüfung im Einzelfall für falsch, hältst du an und meldest es im Issue, statt sie auszutricksen. Prüfungen, Werkzeuge und Workflows kommen nur dazu, wenn dafür eine andere Datei wegfällt.

## Referenzen

- `README.md` — Setup, Engines, bewusste Vereinfachungen
- `.env.example` — alle Env-Variablen; Env-Variablen immer in `src/config.js` zentralisieren und in `.env.example` dokumentieren, für Render zusätzlich `render.yaml`
- Eingaben von außen (Körper, Abfrage, Pfad-Parameter, Webhook-Nutzlast) nur mit Schema über `src/utils/eingabe-pruefen.js` prüfen (`pruefeKoerper`, `pruefeAbfrage`; Schemas in `src/routes/_validation.js` oder neben der Route), nie von Hand mit `typeof`; die Regel `hermes/eingabe-nur-mit-schema` in `eslint.config.js` meldet die Handprüfung.
- `docs/sicherheitsgrenzen.md` — Sicherheitsgrenzen, gegen die Plan und Urteil prüfen
- Vor Website-Arbeit `docs/RUNBOOK-LAB-LIVE.md` lesen.
