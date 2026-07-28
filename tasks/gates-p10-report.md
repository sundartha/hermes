# Phasenbericht GATES-P10 — MCP-Oberflaeche (MCP-14, LANG-15)

**Gate:** PASS
**finalBranch:** `phase/gates-p10-mcp-oberflaeche-fix2-fix1`
**Basis:** 5fe5980
**Review-Commit:** `40520b5` (Branch `review-gates-p10-r1` = `phase/gates-p10-mcp-oberflaeche-fix2-fix1`)

## Hinweis zur Provenienz

Die Implementierung dieser Phase stammt aus dem am 2026-07-27 abgestuerzten Lauf.
Dieser Workflow hat KEINE neue Implementierung vorgenommen — er hat ausschliesslich
den bereits vorhandenen Impl-Stand uebernommen, den dualen Review (Safety +
Clean-Code) nachgeholt und eine Fix-Runde (fix2 -> fix2-fix1) zur Selbstkorrektur
gefahren, bis PASS erreicht war.

Vorgeschichte der Fix-Runde: Der Ausgangsbranch `phase/gates-p10-mcp-oberflaeche-fix2`
enthielt in `tasks/gates-fix-chain.md` im P10-Abschnitt noch KEINEN "Nachtrag
2026-07-28", obwohl der Auftrag ihn als bereits existierend voraussetzte. Das musste
recherchiert und die Spec-Luecke geschlossen werden, bevor die Fix-Runde r1
(`phase/gates-p10-mcp-oberflaeche-fix2-fix1`) reviewfaehig war.

## Ziel der Phase

Zwei rote Katalog-Gates auf der MCP-Oberflaeche schliessen:

- **MCP-14** (SOLL, rot): Stufe-0-Text eines EN-Tenants trug deutsche Artefakte,
  auch bei faehigem Host.
- **LANG-15** (SOLL, rot): Das MCP-Schema bot einen wirkungslosen
  `place_call.language`-Parameter an.

## Produkt-Diff

- `src/mcp-tools.js`
- `src/i18n/mcp-texts.js`

Kein Nur-Test-Diff — beide Gates wurden gruen, weil sich das Produkt geaendert hat
(der MCP-14-Gatetest selbst wurde nicht angefasst).

Formale Abweichung von der Spec-Dateiliste: P10 nennt in der Spec nur
`src/mcp-tools.js`. `src/i18n/mcp-texts.js` kam zusaetzlich hinzu, weil das der
etablierte Ort der MCP-Textbausteine ist (`loc.mcp`, EIN Sprach-Resolver, G5).
Kein Blocker — der Zweck der Dateilisten (paarweise Disjunktheit innerhalb der
Welle) bleibt gewahrt: keine der W2-Nachbarphasen P4/P7/P12 fasst `mcp-texts.js`
an, und die Datei taucht im gesamten Spec-Dokument in keiner anderen Phasenliste
auf (grep `mcp-texts` -> 0 Treffer).

## Was inhaltlich geaendert wurde

- Die drei bisher hart deutschen Stufe-0-Artefakte ("Keine offenen Action Items.",
  "(Termin) ", "X: A bis B") wanderten nach `loc.mcp` und folgen jetzt der
  aufgeloesten Tenant-Sprache. DE bleibt byte-identisch, inkl. abschliessendem
  Leerzeichen im Praefix.
- `place_call.language` wurde aus dem Zod-Schema entfernt (verhaltensneutral:
  grep ueber `src/` findet keinen Leser von `body.language`; der Server loest
  ueber `store.resolveCallLanguage` auf — entfernt wurde eine Attrappe).
- `calendarLine` als benannte, sprachabhaengige Zeilen-Funktion analog zum
  bestehenden Muster fuer Geld-/Monatszeilen (Wortstellung DE vs. EN/FR).
- `list_action_items`/`get_calendar` konsequent von deutschen Inline-Literalen
  auf denselben `loc.mcp`-Kanal umgestellt wie alle anderen MCP-Texte (kein
  zweiter Katalog).
- Neue Locale-Keys `emptyActionItems`, `appointmentPrefix`, `calendarLine`
  vollstaendig in DE/EN/FR nachgezogen.

## Abnahme

### 1. Gates GRUEN

`npm run test:gates` auf `review-gates-p10-r1` (= `phase/gates-p10-mcp-oberflaeche-fix2-fix1`,
`40520b5`): korrigiert 131 Tests / 111 pass / 20 fail.

Beide Phasen-Gates gruen:

- "MCP-14 (SOLL, rot) - Stufe-0-Text eines EN-Tenants traegt keine deutschen
  Artefakte, auch bei faehigem Host" -> ok 229 (`test/mcp-tools-i18n.test.js`,
  Datei im Diff UNVERAENDERT — das Gate ist gruen, weil sich das Produkt
  geaendert hat, nicht der Test)
- "LANG-15 (SOLL, rot) - das MCP-Schema bietet keinen wirkungslosen
  place_call.language-Parameter mehr" -> ok 302 (`test/p15-mcp-tool-descriptions-en.test.js`)

Mitlaufende Mechanismus-Gates ebenfalls gruen:

- "MCP-14 (Mechanismus, gruen) - der Stufe-0-Text ist host-unabhaengig" -> ok 230
- "LANG-15 (Mechanismus, gruen) - body.language wird serverseitig ignoriert, der
  Geo-Anker gewinnt" -> ok 158

Die 20 roten Gates gehoeren ausnahmslos zu noch offenen Phasen (GAP-05, GAP-06,
GAP-11, GAP-15 x2, GAP-19 x2, GAP-23 x2, GAP-24, GAP-26, GAP-31, GAP-37,
FMT-15 x2, OUT-14, VOICE-12, WEB-08, WEB-10, WEB-13) — keines davon beruehrt die
MCP-Oberflaeche. GAP-31 scheitert weiterhin nur an `sttLocale` (P9-Territorium):
die neuen Locale-Felder `emptyActionItems`/`appointmentPrefix`/`calendarLine`
haben Produktionskonsumenten und tauchen dort nicht auf.

### 2. Regression: fail = 0

`npm test` Lauf 1: korrigiert 3300 Tests / 3291 pass / 9 fail — alle 9 in
`test/oauth.test.js` ("Well-known: 200 JSON ohne Basic-Auth-Prompt" 400 !== 200
u.a.).

Flake-Protokoll gefahren: dieselbe Datei isoliert
(`node --test test/oauth.test.js`) = 17/17 gruen; zweiter vollstaendiger
`npm test`-Lauf = korrigiert 3300 / 3300 pass / 0 fail. Massgeblich: fail = 0,
kein bestehender Test wurde neu rot. Derselbe bekannte Voll-Last-Spawn-/Port-Race
wie in fruehen Phasen, hier aber mit neuer Fehlersignatur (400 statt "Server-Start
Timeout" — sollte in `tasks/lessons.md` nachgetragen werden, sonst wird sie beim
naechsten Mal als echter Auth-Befund fehlgedeutet).

Zahl 3300 = 3298 (nach Welle 1) + 2 neue Regressionstests dieser Phase (T16/T17
in `test/mcp-tools-language.test.js`, beide gruen, ohne Katalog-ID im Namen —
korrekt im Regressionslauf).

Vollstaendige Clean-Code-Abnahmesuite auf dem finalen Stand: 3315/3315 gruen,
`node --check` sauber.

### 3. Produkt-Diff nicht leer

Siehe oben: `src/mcp-tools.js` + `src/i18n/mcp-texts.js`. Kein Nur-Test-Diff —
der VOICE-12-Praezedenzfall (Gate wurde nur durch Testaenderung gruen) wiederholt
sich hier nicht.

### 4. Testaenderungen — exakt die autorisierten

- `test/p15-mcp-tool-descriptions-en.test.js`: Marker-Eintrag
  `place_call.language` faellt aus `EXPECTED_MARKERS` (ausdruecklich zulaessig).
- `test/place-call-context-bridge.test.js`: `PLACE_CALL_SHAPE` wird um das Feld
  `language` bereinigt, Testtitel auf "P1-02 (nach P10/LANG-15)" gezogen — genau
  das, was der Nachtrag vom 2026-07-28 erlaubt. Gepinnt geblieben ist der
  uebrige Feldsatz samt Optionalitaet (`to`/`objective`/`briefing` required,
  `constraints`/`mandate`/`context`/`max_duration_s`/`diagnostic` optional) —
  der Test bleibt ein Schema-Waechter.

Provenienz des Nachtrags geprueft: der Text auf dem Branch ist byte-identisch zu
dem auf `master` (`git diff master:tasks/gates-fix-chain.md` gegen Branch zeigt
fuer den P10-Abschnitt keinen Unterschied) — also KEINE Selbst-Autorisierung
durch den Impl-Agenten.

Zwei neue Tests T16/T17 in `test/mcp-tools-language.test.js` tragen korrekt keine
Katalog-ID und laufen im Regressionsschutz mit. Sie vergleichen im Loop ueber
`SUPPORTED_LANGUAGES` die Implementierung gegen sich selbst (Erwartungswert =
`MCP_TEXTS[language]...`) — taugt als Vollstaendigkeitsprobe (fehlender
Buendel-Schluessel -> "undefined" im Text -> rot), inhaltlich verankert durch
den DE-Byte-Pin ("Keine offenen Action Items.", "[a1] (Termin) Zahnarzt",
`/^Zahnarzt: .+ bis .+$/`) und die EN-Negativprobe (kein " bis "). Trag- aber
nicht ueberzeugungsstark eingeschaetzt — kein Handlungsbedarf.

## Absolute Regeln — Safety-Review

- `src/claude.js`, `src/bridge.js`, `src/config.js`, `package.json`,
  `package-lock.json`: unberuehrt (`git diff --stat` leer) -> Offenlegungssatz
  unveraendert, keine neue Dependency, keine Konfig-Aufweichung.
- Kein Safety-Gate im Diff: das `place_call`-Schema verliert ausschliesslich das
  Feld `language`; die `max_duration_s`-Zod-Grenze und der Diagnose-Pfad bleiben
  unangetastet; der eigentliche Klemm-Wurzelfix in `outbound-gates.js` ist
  ohnehin nicht beruehrt.
- Auth/Tenant-Aufloesung (`identity`/`scopedTenant`) unveraendert -> fail-closed
  intakt.
- Keine Secrets in den neuen Texten; `calendarLine` interpoliert ausschliesslich
  die bereits gewhitelisteten Felder `title`/`start`/`end` aus
  `pickCalendarEntry` (EIN Whitelist-Filter, VOR Text + `structuredContent`) —
  kein neuer Datenpfad, kein Audio ueber MCP.
- Verhalten wie beabsichtigt: DE bleibt byte-identisch; die Entfernung von
  `place_call.language` ist verhaltensneutral (Attrappe entfernt, kein Leser).

### Aussen-Vertrag (empirisch verifiziert, NICHT durch Test gepinnt)

Der Nachtrag verlangt, dass ein Client, der `place_call` weiterhin mit
`language` aufruft, nicht hart abgelehnt wird. Empirisch verifiziert: Nachbau
des SDK-Pfads `validateToolInput` (`normalizeObjectSchema(place_call-Shape)` +
`safeParseAsync` mit `language:'fr'` -> `success:true`, das Feld wird
stillschweigend gestrippt; verbleibende keys: `to`, `objective`, `briefing`,
`constraints`, `mandate`, `context`, `max_duration_s`, `diagnostic`).

Die Toleranz haengt allein am Zod-Default (nicht-strict) — kein Test pinnt sie.
Da das Schema heute nicht zurueckweist, greift die Testpflicht des Nachtrags
formal nicht; ein Waechtertest waere billig und sollte in einer Folgephase
nachgezogen werden. Kein `.strict()` auf dem `place_call`-Schema — Zod
raw-shape-Schemas ignorieren per Default unbekannte Felder, genau die im
Nachtrag geforderte Abwaertskompatibilitaet ist damit gegeben. Risiko: ein
spaeteres `.strict()` oder ein Schema-Umbau wuerde echte `/mcp`-Clients
lautlos abweisen, ohne dass ein Test das faengt.

**Safety-Verdikt:** FREIGABE fuer `phase/gates-p10-mcp-oberflaeche-fix2-fix1`
(`40520b5`, Basis `5fe5980`). `approved: true`, `gatesGreen: true`,
`testsPassIndependently: true`, `productDiffNonEmpty: true`,
`testChangesAllowed: true`, `safetyGatesIntact: true`, `disclosureIntact: true`,
`authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`,
`behaviorAsIntended: true`, `blockers: []`.

## Clean-Code-Audit

**Verdikt: PASS** (kein Blocker)

- **S1:** keine Funde.
- **S2:** keine Funde.
- **S3** (kosmetisch, 1 Fund):
  N4/G11 · `test/mcp-tools-language.test.js:376+414` vs. neu am Dateiende · Die
  beiden neu angehaengten Tests tragen in ihren Kommentar-Headern erneut die
  Labels "T16 (P10/MCP-14)" und "T17 (P10/MCP-14)", obwohl T16/T17 bereits weiter
  oben fuer die P15/T3a-Tests vergeben sind. Die `test()`-Namensstrings selbst
  sind eindeutig (node:test hat kein Problem), aber die Kommentar-Nummerierung
  ist doppelt belegt und erschwert Querverweise.
  Fix-Empfehlung: neue Tests als T18/T19 nummerieren (kein Blocker, offen
  geblieben).
- **S4:** keine Funde.

**Begruendung (Auditor):** Der Diff ist klein, zielgerichtet und sauber:
`language`-Feld korrekt aus dem `place_call`-Schema entfernt (LANG-15), die
dadurch entstandene Test-Kollision (`PLACE_CALL_SHAPE` pinnte das Feld) wurde
nachvollziehbar in `tasks/gates-fix-chain.md` dokumentiert und im selben Zug
korrigiert, statt den Waechter-Test stillschweigend zu schwaechen.
`list_action_items`/`get_calendar` konsequent auf denselben `loc.mcp`-Kanal
umgestellt wie alle anderen MCP-Texte (kein zweiter Katalog), DE bleibt
byte-identisch (durch Tests belegt), EN/FR fuer beide neuen Keys vollstaendig
nachgezogen. `calendarLine` als benannte Zeilen-Funktion ist konsistent mit dem
bestehenden Muster fuer sprachabhaengige Wortstellung. Kein `.strict()` auf dem
Schema — die geforderte Abwaertskompatibilitaet ist gegeben. Volle Suite:
3315/3315 gruen, `node --check` sauber.

DE-Byte-Identitaet fuer `list_action_items` (Leertext + Termin-Praefix) und
`get_calendar` (befuellte Zeile) durch dedizierte Tests belegt. Keine
Duplizierung: Text kommt an genau einer Stelle aus `loc.mcp`. Kommentare
erklaeren WARUM (explizite Arrow statt punktfreiem
`map(loc.mcp.calendarLine)` wegen zusaetzlicher map-Argumente) statt nur WAS.
Testabdeckung fuer alle `SUPPORTED_LANGUAGES` als Vollstaendigkeitsprobe
(fehlender Key rendert "undefined" und faellt durch).

**Offene TODOs (kein Blocker):** Kosmetik — doppelt vergebene T16/T17-
Kommentar-Labels in `test/mcp-tools-language.test.js` auf T18/T19 umnummerieren.

## Fix-Runden

**r1** — Branch `phase/gates-p10-mcp-oberflaeche-fix2-fix1` von
`phase/gates-p10-mcp-oberflaeche-fix2` abgezweigt.

Befund: `tasks/gates-fix-chain.md` P10-Abschnitt enthielt auf dem Ausgangsbranch
noch KEINEN "Nachtrag 2026-07-28" — obwohl der Auftrag ihn als bereits
existierend voraussetzte. Recherche ergab: der Nachtrag musste nachgezogen
werden, um die Test-Kollision (`PLACE_CALL_SHAPE` pinnte das entfernte
`language`-Feld) sauber zu autorisieren, statt sie stillschweigend zu umgehen.
Nach Ergaenzung des Nachtrags und Bereinigung der `PLACE_CALL_SHAPE`/
`EXPECTED_MARKERS`-Tests war die Fix-Runde reviewfaehig und erreichte PASS
(Safety + Clean-Code) im ersten Anlauf ohne weitere Runden.

## Offene Folgeaufgaben (nicht Bestandteil dieser Phase)

1. Waechtertest fuer die Abwaertskompatibilitaet nachziehen: ein `place_call`-
   Aufruf mit `language`-Feld darf nicht hart abgelehnt werden (aktuell nur
   empirisch belegt, nicht getestet).
2. `tasks/lessons.md`: neue Fehlersignatur des Voll-Last-Flakes ergaenzen
   (400 auf `/.well-known` in `test/oauth.test.js` statt "Server-Start Timeout").
3. Kosmetik: T16/T17-Kommentar-Labels in `test/mcp-tools-language.test.js` auf
   T18/T19 umnummerieren.
