# C-P5 — Twilio: Config, Boot-Pflicht, Env, Doku

Spezifikation fuer **eine** Phase (`phase-impl-lean`). Umbrella: `PLAN-ANBIETER-PORT.md`,
Track C, Schritt 5 (zweite Haelfte) — die erste Haelfte war C-P4 (Adapter-Ausbau).

**Basis ist NICHT `master`, sondern `phase/c-p4-adapter-raus` (`310c78a`).** C-P4 liegt
committet auf diesem Branch und wird parallel reviewt. Jede Code-Stelle in diesem Dokument
ist gegen diesen Branch erhoben (`git show phase/c-p4-adapter-raus:<pfad>`), nicht gegen
`master`. Wird C-P4 vor C-P5 gemergt, ist die Basis danach `master` — der Inhalt aendert
sich dadurch nicht.

Die Freigabe des Owners fuer die Twilio-Entfernung steht in `CLAUDE.md`, Absolute Regel 1
(Eintrag 2026-08-07, C-P3).

Vorgaenger: C-P1, C-P1b, C-P2, C-P3 (gemergt), C-P4 (committet, im Review).

---

## 1. Was faellt

Nach C-P4 gibt es **keinen Twilio-Adapter und keinen `PROVIDER.TWILIO`** mehr
(`src/store/defaults.js`: `export const PROVIDER = Object.freeze({ TELNYX: "telnyx" })`).
Was noch steht, ist die **Konfigurations- und Betriebsoberflaeche** davor: Env-Keys, eine
unbedingte Boot-Pflicht, zwei Betreiber-Skripte, eine npm-Dependency und die Setup-Doku.

### 1.1 Der Kern: die Config-Achse

| Ort | was | Beleg |
|---|---|---|
| `src/config.js` | `twilioSid: process.env.TWILIO_ACCOUNT_SID`, `twilioToken: process.env.TWILIO_AUTH_TOKEN` | `:336-337` |
| `src/config.js` | `twilioEdge: process.env.TWILIO_EDGE \|\| "frankfurt"` | `:1377` |
| `src/config.js` | die drei Schluessel in `CONFIG_NAMESPACES.telephony` | `:1517` |
| `src/config.js` | **die UNBEDINGTE Boot-Pflicht** in `assertConfig` | `:1671-1672` |
| `.env.example` | Twilio-Block + 15 weitere Prosa-Nennungen | `:25-29` u. a. |
| `render.yaml` | `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` (`sync: false`), `TWILIO_EDGE: frankfurt` | `:50`, `:52`, `:522` |
| `test/helpers.js` | `BASE_ENV`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_EDGE` | `:79-84` |
| `test/prod-env.js` | `PROD_DUMMY_SECRETS`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | `:103-104` |
| `package.json` | `"twilio": "^5.3.0"` — Laufzeit-Dependency | `:33` |

**Die entscheidende Messung:** ausserhalb von `config.js` selbst liest **keine einzige
Zeile in `src/`** diese Felder.

```
git grep -n "telephony\.twilio" phase/c-p4-adapter-raus -- src/ scripts/ test/
```

liefert genau sieben Zeilen: zwei in `assertConfig` (`config.js:1671-1672`), fuenf in
`scripts/check-setup.js` + `scripts/set-webhooks.js`. **Der Boot verlangt seit C-P4 zwei
Secrets, die kein Codepfad mehr benutzt.**

Ebenso hat die npm-Dependency `twilio` genau zwei Importeure, beide Skripte:

```
git grep -rn 'from "twilio"' phase/c-p4-adapter-raus
```

### 1.2 Zwei Betreiber-Skripte sind seit C-P4 STILL DEFEKT

> **NACHTRAG 2026-08-07, nach C-P4-fix1 (`14f0054`, gemergt in `eccbafd`):** Der
> C-P4-Review fand denselben Defekt unabhaengig und hat ihn als Blocker MINIMAL
> behoben: die Skripte lesen jetzt das String-Literal `'twilio'` statt
> `PROVIDER.TWILIO`, der ungenutzte `PROVIDER`-Import ist raus, ein Regressionstest
> liegt in `test/check-setup-script.test.js`. Der "Filter abgeschaltet"-Defekt
> unten existiert damit NICHT mehr — die Skripte finden korrekt keine
> Twilio-Nummer. UNVERAENDERT gueltig bleibt der Rest dieses Abschnitts und
> Abschnitt 2: die Skripte lesen weiterhin `config.telephony.twilioSid` (der
> Proxy-Guard-TypeError kommt, sobald die Config-Keys fallen), die toten
> `seed-owner-number ... twilio`-Empfehlungen stehen noch, und der komplette
> Twilio-Zweig der Skripte + npm-Dependency `twilio` fallen in C-P5. Zeilennummern
> unten koennen um wenige Zeilen verschoben sein — am Code messen, nicht
> uebernehmen.

Das ist ein **Befund dieser Erhebung**, kein bekannter Punkt aus der Uebergabe
(der Zustand VOR fix1, dokumentiert als Begruendung des Schnitts):

```js
// scripts/check-setup.js:13  UND  scripts/set-webhooks.js:29
findActiveNumber(store.load(), BOOTSTRAP_TENANT_ID, PROVIDER.TWILIO)?.e164 || ""
```

`PROVIDER.TWILIO` ist seit C-P4 `undefined`. `findActiveNumber`
(`src/store/views.js:52-60`) behandelt `provider === undefined` als **"Filter weglassen"**:

```js
(provider === undefined || n.provider === provider)
```

Es wirft also nicht — es liefert **die erste aktive Nummer irgendeines Anbieters** und
nennt sie "Owner-Twilio-Nummer". `npm run check` meldet damit die Telnyx-DID als
Twilio-Nummer; `set-webhooks.js` wuerde versuchen, Twilio-Webhooks auf eine Telnyx-Nummer
zu schreiben. **Stille Bedeutungsumkehr, kein Absturz** — genau die Klasse Defekt, die
C-P1 schon einmal erzeugt hat (`tasks/lessons.md`, "Eine Konstante zu flippen ist nicht
dasselbe wie eine Entscheidung zu flippen").

Ausserdem raet `check-setup.js:43` dem Betreiber zu
`npm run seed-owner-number -- <e164> twilio` — einem Kommando, das seit C-P4
fail-closed abgewiesen wird (`resolveSeedProvider("twilio")` -> `null`). Dieselbe falsche
Empfehlung steht in `set-webhooks.js:32`, `scripts/bootstrap-tenant.js:7`,
`scripts/seed-owner-number.js:8`, `scripts/prod-setup.sh:9/73`, `.env.example:39/587/601`,
`render.yaml:56/156`, `STATUS.md:46`, `docs/RUNBOOK-RESTORE.md:153`.

### 1.3 Was der Betrieb SIEHT und was nicht mehr stimmt

| Ort | Ausgabe | Status |
|---|---|---|
| `src/boot.js:669` | Boot-Banner druckt `Twilio-Webhook: <PUBLIC_URL>/voice/incoming` | falsch |
| `src/mcp-tools.js:865` | MCP-Tool-Beschreibung: *"Returns the phone number of the phone agent (the Twilio number)."* — geht an Claude-Clients | falsch |
| `src/route-policy.js:63` | Begruendung der `/voice`-Ausnahme nennt *"Twilio HMAC / Telnyx Ed25519"* | falsch seit C-P3 |
| `CLAUDE.md:7` | *"Twilio + Telnyx Voice"* | falsch |
| `CLAUDE.md:62` | *"Adapter unter `adapters/twilio/*` und `adapters/telnyx/*`"* | falsch seit C-P4 |
| `PLAN-AUTH-GATE.md:170`, `docs/RUNBOOK-AUTH-REVIEW.md:34` | *"Twilio-HMAC / Telnyx-Ed25519"* als aktive Pruefung | falsch seit C-P3 |
| `PLAN-SECURITY.md:998/1034/1042-1067` | `TWILIO_AUTH_TOKEN` im Secret-Inventar, Rotations-Anleitung, Subaccount-Checkliste | falsch |

`route-policy.js` ist nicht kosmetisch: **Absolute Regel 3** verlangt fuer jede
Auth-Ausnahme eine Begruendung, und `test/route-auth-inventory.test.js` ist ihr Faenger.
Eine Begruendung, die eine nicht existierende Pruefung nennt, entwertet den Faenger.

`CLAUDE.md` laedt in **jede** Session — eine falsche Architektur-Zeile dort ist teurer als
dieselbe Zeile irgendwo in `docs/`.

---

## 2. Die Betriebs-Skripte fallen MIT der Config — das erzwingt der Bestand

`src/config.js` haelt seit PA-20 einen Proxy-Guard (`:1477-1490`): ein Zugriff auf einen
Schluessel, der nicht in `CONFIG_NAMESPACES` steht, wirft

```
<ns>.<key> existiert nicht (verschobener/entfernter Config-Key? ...)
```

Sobald `twilioSid`/`twilioToken`/`twilioEdge` aus `CONFIG_NAMESPACES.telephony` fallen,
wirft `config.telephony.twilioSid` in `scripts/check-setup.js:38/117/118/120` und
`scripts/set-webhooks.js:36` einen `TypeError` — `npm run check` bricht mitten im Lauf ab.

`test/check-setup-script.test.js` faengt genau das (es verbietet woertlich das
Crash-Banner `Node.js v\d` und verlangt die Zeile `Ergebnis:`). **Der Test wird rot, wenn
die Skripte nicht mitgehen.** Er wurde exakt fuer diese Fehlerklasse gebaut
(Review-Blocker P5: `config.ownerNumber` war ein entfernter Key).

Daraus folgt der Schnitt, ohne dass man ihn waehlen muesste: **Config-Achse und die beiden
Skripte sind EIN Schritt.** Und weil die Skripte die einzigen Importeure des npm-Pakets
`twilio` sind, faellt die Dependency im selben Zug — sonst bliebe eine Laufzeit-Dependency
ohne Aufrufer stehen (toter Code, CLAUDE.md, hart verboten).

`START-DEMO.command:2/31` ruft `set-webhooks.js` und beschreibt es als
"Twilio-Webhooks" — es haengt am selben Faden und geht mit.

> **Hinweis zur Uebergabe:** `tasks/uebergabe-2026-08-07.md` liest `tasks/c-p4-spec.md`
> Abschnitt 3 so, dass `ONBOARDING.md`, `START-DEMO.command` und `scripts/check-setup.js`
> *"erst nach C-P5"* kaemen. Am Bestand gemessen ist das falsch: der Proxy-Guard zwingt
> die Skripte **in** C-P5. `PLAN-ANBIETER-PORT.md` Schritt 5 nennt ohnehin
> *"Adapter, Config, `.env.example`, `render.yaml`, Doku"* — `ONBOARDING.md` ist Doku.

---

## 3. Weisse Flecken — vollstaendige Klassifikation

Erhoben am 2026-08-07 gegen `phase/c-p4-adapter-raus`:

```
git grep -in twilio phase/c-p4-adapter-raus                       # 685 Treffer, repo-weit
git grep -in twilio phase/c-p4-adapter-raus -- src/ test/ scripts/ '*.md' render.yaml .env.example package.json
                                                                  # 671 davon
```

**685 Treffer, alle klassifiziert.** Die vier Regel-Eimer sind mechanisch reproduzierbar
(jede Zeile faellt in genau einen, in dieser Reihenfolge geprueft):

| # | Regel (auf der Trefferzeile) | Treffer |
|---|---|---|
| R1 | `SKIP_TWILIO_SIGNATURE_CHECK` / `skipTwilioSignatureCheck` | 63 |
| R2 | sonst: `TWILIO_ACCOUNT_SID`\|`TWILIO_AUTH_TOKEN`\|`TWILIO_EDGE`\|`twilioToken`\|`twilioEdge`\|`telephony.twilioSid` | 89 |
| R3 | sonst: `twilioSid` / `twilio_sid` (Call-Record-Feldname) | 111 |
| R4 | sonst: Prosa, Kommentare, CLI-Hilfetexte | 408 |
| — | ausserhalb der Pathspec (`.claude/workflows/` 7, `package-lock.json` 3, `START-DEMO.command` 2, `.gitignore` 1, `gitleaks.toml` 1) | 14 |

### (a) faellt in C-P5 — 197

- **R2, ohne Prozessdoku (84).** Die gesamte Config-/Env-Achse: `src/config.js` (6),
  `scripts/` (6), `.env.example` (3), `render.yaml` (3), `test/` (62), `README.md:180` +
  `PLAN-SECURITY.md` (4).
  Die 62 Test-Treffer sind ueberwiegend **ein toter Offline-Diskriminator** — s. Abschnitt 5.
- **R4 in `scripts/` (35).** `check-setup.js` (17), `set-webhooks.js` (12), CLI-Hilfetexte
  `<twilio|telnyx>` in `bootstrap-tenant.js`, `seed-owner-number.js`, `prod-setup.sh`,
  `convo-bench.mjs` (6).
- **R4 in `.env.example` (15) und `render.yaml` (3).**
- **`package.json` (1) + `package-lock.json` (3).** Dependency-Ausbau.
- **R4 in Setup-/Betreiber-Doku (40).** `README.md` (14), `ONBOARDING.md` (8),
  `PLAN-SECURITY.md` (8), `STATUS.md` (3), `CLAUDE.md:7/62/131` (3),
  `PLAN-AUTH-GATE.md:170` (1), `docs/RUNBOOK-AUTH-REVIEW.md` + `RUNBOOK-RESTORE.md` +
  `RUNBOOK-STRIPE-LIVE.md` (3).
- **R4 in `src/`+`test/`-Dateien, die C-P5 ohnehin anfasst (14).** `config.js` (6),
  `boot.js` (2), `mcp-tools.js` (1), `route-policy.js` (1), `helpers.js` (3),
  `boot-failclosed.test.js` (1).
- **`START-DEMO.command` (2).**

### (b) bleibt BEWUSST — 268

- **R1 (63): `SKIP_TWILIO_SIGNATURE_CHECK`.** Trotz des Namens der **globale
  `/voice`-Bypass** (`src/routes/voice.js:227`), kein Twilio-Schalter; `boot-guard.js`
  haengt daran (`fakeOriginateBootBlocked`). `CLAUDE.md` Absolute Regel 1, Eintrag
  2026-08-07: ein Rename ist eine **eigene Owner-Entscheidung** und **nicht C-P5**.
- **R3 (111): `twilioSid` / `twilio_sid` am Call-Record.** Ein **gespeicherter Feldname,
  den der Telnyx-TeXML-Pfad benutzt** (`src/telnyx-inbound.js:16`, `routes/voice.js:314`).
  Umbenennen waere eine Datenform-Aenderung mit Migration — ausdruecklich nicht hier
  (identische Festlegung wie `tasks/c-p4-spec.md` Abschnitt 1/3).
- **Prozess-/Historien-Doku (92).** `PLAN-ANBIETER-PORT.md` (27), `tasks/c-p4-spec.md`
  (18), `tasks/gq-welle0/*` (15), `tasks/lessons.md` (5), `tasks/uebergabe-*` (7),
  `tasks/todo.md` (3), `tasks/kosten-inventar.md` (3), `PLAN-ASSISTANT-LEAP.md` (2),
  weitere `tasks/*` (3), `CLAUDE.md:76-106` (9, der Owner-Entscheidungs-Eintrag = der
  Freigabe-Beleg, bleibt woertlich). Die Historie liegt in `git`; Prozessdateien werden
  beim Aufraeumen der Kette geloescht, nicht umgeschrieben.
- **`STATUS.md:192`** (Repo-/Render-Rename = **Track B des Rebrands**, nicht Track C).
- **`.gitignore:16` (`.twilio-recovery-code`)** — eine entfernte ignore-Zeile kann nur
  schaden, nie nuetzen.
- **`scripts/telnyx-ws-echo.mjs:19`** (*"rohe u-law base64 (wie Twilio)"*) — eine wahre
  Vergleichsaussage ueber ein Protokollformat.

### (c) spaetere Phase — 220

- **Erklaerkommentare in `src/**` und `test/**` ausserhalb der C-P5-Dateien (212).**
  -> **neue Phase C-P6 "Kommentar-Nachlese"**, mit dieser Regel:
  **wahr-und-tragend bleibt, falsch-geworden faellt.** TeXML **ist** ein
  Twilio-kompatibler Dialekt (`adapters/telnyx/voice.js:4/10/12/32`), `AnsweredBy`
  **ist** eine Twilio-Konvention (`telephony/answered-by.js:2/21`), *"Twilio dokumentiert
  15 s"* (`turn-budget.js:2`) **ist** eine Anbieter-Doku-Referenz — die tragen Wissen und
  bleiben. *"Twilio-Outbound unberuehrt"*, *"Nicht-Twilio-Routen"*, *"wie der
  Twilio-Signatur-Adapter"*, `ports.js:2` (*"einen Adapter (Twilio)"*) beschreiben Code,
  den es nicht mehr gibt, und fallen.
  **Warum nicht in C-P5:** ein Kommentar-Diff ueber 200+ Zeilen ueberdeckt in der Pruefung
  genau die wenigen Zeilen, an denen Boot und Geld haengen.
- **`.claude/workflows/phase-impl-lean.js:109`, `phase-impl.js`, `runs/*` (7).** Die
  Review-Prompts nennen *"Twilio-Signaturpruefung (/voice)"* als zu pruefendes
  Safety-Gate — seit C-P3 falsch, kann einen Falsch-Blocker erzeugen. Gehoert zum
  naechsten Edit an den Workflow-Skripten; `runs/c-p4.js` verschwindet ohnehin beim
  Aufraeumen der Kette.
- **`gitleaks.toml:29` (1).** Kommentar, der `test-twilio-auth-token` in `helpers.js`
  erwaehnt; der Pfad-Allowlist-Eintrag bleibt unabhaengig davon gueltig. Nachlese C-P6.

---

## 4. Ausdruecklich NICHT in dieser Phase

- **`SKIP_TWILIO_SIGNATURE_CHECK`** in jeder Form — Kategorie (b) oben. Weder umbenannt
  noch dokumentarisch "aufgeraeumt". `boot-guard.js` haengt daran.
- **`twilioSid` / `twilio_sid`** am Call-Record und in `src/db/schema.sql`.
- **Die Safety-Gates aus Absolute Regel 1.** C-P5 entfernt eine Boot-**Pflicht** fuer zwei
  ungenutzte Secrets — **kein Gate.** Kein Gate wird beruehrt, keines wird per Default
  umgangen.
- **Das Loeschen der Render-Env-Keys.** Owner-/Ops-Arbeit, s. Abschnitt 6. Die Phase
  liefert die Anleitung, nicht den Handgriff.
- **Der Rebrand `vodafone-agent` -> Hermes** (Repo-Verzeichnis, Render-Service, URLs) —
  Track B des Rebrands, ausdruecklich kein Teil normaler Tasks (`CLAUDE.md`).
- **Die Kommentar-Nachlese in `src/`/`test/`** — C-P6, Kategorie (c).

### Wo der Schnitt zum Plan liegt

`PLAN-ANBIETER-PORT.md` fuehrt eine Stand-Tabelle mit *"C-P4 Adapter, Config, Boot-Pflicht,
Doku"* und *"C-P5 Abnahme mit echtem Anruf"*. Die Kette wurde beim Bau feiner geschnitten.
Die Tabelle ist mit dieser Phase **nachzuziehen** (Teil des Diffs):

| Phase | Inhalt |
|---|---|
| C-P4 | Adapter, Enum, Registry, Bridge, Testsuite (Schritt 5, erste Haelfte) |
| **C-P5** | **Config, Boot-Pflicht, Env, Betriebs-Skripte, Setup-Doku (Schritt 5, zweite Haelfte)** |
| C-P6 | Kommentar-Nachlese in `src/`/`test/` (neu, s. Kategorie (c)) |
| C-P7 | Abnahme mit echtem Anruf (Plan-Schritt 6) — braucht den Owner |

Die Frage aus `PLAN-ANBIETER-PORT.md:152-155` (*"sind `TWILIO_ACCOUNT_SID` /
`TWILIO_AUTH_TOKEN` in der Render-Umgebung gesetzt?"*) ist mit dieser Phase beantwortet:
**ja, mit Sicherheit** — `assertConfig` verlangt sie unbedingt und der Live-Dienst laeuft.

---

## 5. Erwartete Aenderungen an Tests

**Behandlungsregel — dieselbe wie in C-P2 und C-P4, und sie ist der Kern der Abnahme:**
ist der **Gegenstand** des Tests die entfallende Env, faellt oder dreht er sich; ist der
Gegenstand ein **anderer**, darf die Aussage **nicht** verschwinden.

### 5.1 Tests, deren Gegenstand die Boot-Pflicht ist

- **`test/boot-failclosed.test.js` T-P2-07** (*"fehlender `TWILIO_AUTH_TOKEN` -> Boot
  verweigert"*) verliert seinen Gegenstand. **Er wird umgedreht statt geloescht:** ein
  Spawn mit `TWILIO_ACCOUNT_SID: ""`, `TWILIO_AUTH_TOKEN: ""`, `TWILIO_EDGE: ""` **bootet**
  und liefert `/healthz` 200. Das ist der deterministische Beleg, dass die Boot-Pflicht
  gefallen ist (Abschnitt 7).
  Die allgemeine Eigenschaft *"eine fehlende Pflicht-Env verweigert den Boot"* bleibt in
  derselben Datei durch T-P2-06 (`MAX_BUDGET_EUR=acht`) und den Nummer-Boot-Guard belegt —
  sie geht nicht verloren.
- **Zweiter Test, neu:** derselbe Spawn **mit** gesetzten Keys bootet ebenfalls und
  liefert 200. Das pinnt den **Uebergangszustand** (Render traegt die Keys noch), damit
  niemand ihn spaeter versehentlich zu einem Boot-Refusal macht.

### 5.2 `test/kv-m0-boot-banner-config.test.js:147`

Setzt `TWILIO_AUTH_TOKEN: "kv-m0-twilio-token-darf-nirgends-auftauchen"` und beweist, dass
**kein Secret im Boot-Banner landet** (Absolute Regel 4). Gegenstand ist die
Nicht-Leak-Eigenschaft, nicht Twilio. **Der Wert wird auf ein weiterhin existierendes
Secret umgestellt** (z. B. `TELNYX_API_KEY`), damit die Aussage erhalten bleibt. Ein
ersatzloses Streichen waere ein Abdeckungsverlust an einer Regel-4-Zusicherung.

### 5.3 Der tote Offline-Diskriminator — ~16 Dateien

Rund 60 der 62 Test-Treffer aus R2 sind **eine einzige Konstruktion**:

```js
// z.B. test/number-gate.test.js:3
// TWILIO_ACCOUNT_SID ("x") laesst den Twilio-Client synchron VOR jedem Netzzugriff
// werfen -> ein durchgelassener Call endet deterministisch als 500.
const OFFLINE = { TWILIO_ACCOUNT_SID: "x" };
```

**Diese Begruendung ist seit C-P4 falsch.** Es gibt keinen Twilio-Client mehr; kein
`src/`-Pfad liest `config.telephony.twilioSid` (Abschnitt 1.1). Der Env-Wert ist **inert** —
die Tests sind gruen, aber aus einem **anderen** Grund als dem, den ihr Kommentar nennt.

Betroffen: `number-gate`, `dial-target-normalization`, `outbound-frozen`,
`e164-trunk-zero-reject`, `profiles`, `profile-tenant-key`, `p2-onboard-retry`,
`outbound-reserve-gate`, `outbound-reserve-release-error`, `f1-p8-outbound-lang`, `audit`,
`a4-default-profile-zero`, `did-07-onboard-retry-owner-gate`, `auth-p3-bootstrap-fallback`,
`prod-config-smoke`, `prod-env.js`.

**Anforderung — und sie ist nicht verhandelbar:** der Env-Override faellt, und die
Begruendung wird durch die **gemessene** neue Ursache ersetzt. Es ist zu **messen**
(Testlauf, Response-Body/Log), warum diese Anfragen heute 500 liefern — nicht zu raten.
Eine falsche Erklaerung durch **keine** Erklaerung zu ersetzen ist kein Fortschritt: die
naechste Session weiss dann nicht, ob die 500 noch das Signal "alle Gates passiert" traegt.

**`test/prod-env.js` ist der heikelste Fall.** `PROD_DUMMY_SECRETS` liefert das
Offline-Signal fuer **Aussage 4 von GAP-33** (`prod-config-smoke.test.js`) — laut eigener
Kopfzeile *"der wichtigste Einzeltest des Katalogs"*. Wenn dessen 500-Signal auf einer
falschen Begruendung steht, beweist der wichtigste Test des Katalogs nichts Nachvollziehbares.

### 5.4 `CONFIG_REQUIRED_OK` (`test/helpers.js:831-839`)

Die gemeinsame Pflichtfeld-Fixture fuer `assertConfig`-Tests verliert `twilioSid`/
`twilioToken`. Mit-Nutzer, die die Felder lokal kopiert haben, ziehen nach:
`test/config-prod-footguns.test.js:97`, `test/single-origin-boot-guard.test.js:35-36`,
`test/telnyx-p10-config.test.js:35-36`.

### 5.5 `BASE_ENV` — die bekannte Drift-Falle, in der Gegenrichtung

`test/helpers.js` `BASE_ENV:79-84` verliert `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_EDGE`. Der Bestand hat den Praezedenzfall bereits kommentiert:

> `// KS-P3 (b): MAX_CALL_DURATION_S ist hier ENTFALLEN, weil es die Variable nicht mehr`
> `// gibt (E2/E3). Umkehrung der BASE_ENV-Drift-Lehre: eine gepinnte, aber tote Env-Zeile`
> `// taeuscht kuenftigen Lesern eine wirksame Klemme vor und schuetzt vor nichts.`

**Reihenfolge innerhalb des Commits:** `config.js` und `BASE_ENV` gehen **gemeinsam**.
Eine Zeile aus `BASE_ENV` zu entfernen, waehrend `config.js` die Variable noch liest, ist
die scharfe Richtung des Fehlers — dann fuellt `dotenv` sie aus der lokalen `.env`
(`config.js:6` ruft `dotenv.config()` bedingungslos auch im Spawn-Kind).

### 5.6 Berichtspflicht

**Im Report ist je beruehrter Testdatei zu nennen: geloescht, gedreht, gekuerzt oder
unveraendert — und warum.** Eine Datei, die nur "gruen gemacht" wurde, ist ein Befund.

---

## 6. Reihenfolge — bindender Teil dieser Spezifikation

Die falsche Reihenfolge legt den Live-Dienst still. Belegt: `assertConfig:1671-1672`
verlangt beide Keys **unbedingt**, und der Dienst laeuft — also sind sie in Render gesetzt.

| # | Schritt | wer | warum genau hier |
|---|---|---|---|
| 1 | **Code**: Boot-Pflicht + Config-Felder + `BASE_ENV` + Skripte + Dependency + Doku, `npm test` gruen | Phase | danach ignoriert der Dienst die Keys, statt sie zu verlangen |
| 2 | **Deploy** des C-P5-Stands | Owner/Ops | die Keys sind in Render noch gesetzt und **stoeren nicht** — der Uebergangszustand ist der sichere |
| 3 | **Verifikation am laufenden Dienst**: `/healthz` 200 **und** der ausgelieferte Commit ist der C-P5-Commit | Owner/Ops | ein Deploy-Stand darf **nie** aus einer Notiz gelesen werden (`git merge-base --is-ancestor` gegen den `/healthz`-Commit) |
| 4 | **ERST DANN** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_EDGE` im Render-Dashboard loeschen | Owner/Ops | vorher geloescht = **Boot-Refusal beim naechsten Neustart** = Dienst tot |
| 5 | Nach dem Loeschen erneut `/healthz` 200 | Owner/Ops | Render startet beim Env-Edit neu; das ist die Probe |

**Schritt 4 und 5 sind ausdruecklich NICHT Teil der Code-Phase.** Sie gehoeren in den
Report als Handlungsanweisung an den Owner. Der Grund fuer die Trennung ist die
Asymmetrie: **ein gesetzter, ungelesener Key ist harmlos; ein geloeschter, verlangter Key
ist ein Ausfall.**

Die Phase darf `render.yaml` aendern — der Blueprint ist Referenz, **nicht** die Wahrheit
(die Live-Services sind dashboard-managed, `test/prod-env.js:16-19`). Eine Aenderung dort
loescht **nichts** in Render.

---

## 7. Abnahme

Deterministisch, jeder Punkt mit Kommando:

1. **`npm test` gruen.** *Die Zahl gehoert in den Report, nicht geraten.* Vorher-Wert auf
   `phase/c-p4-adapter-raus` selbst messen (auf `master` waren es 4057) — die Differenz ist
   die Aussage ueber den Umfang.
2. **`node --check <datei>` auf jede geaenderte `.js`-Datei** in `src/` und `scripts/`.
3. **`npm run check` laeuft durch** (kein `TypeError`, Zeile `Ergebnis:` erscheint) —
   `test/check-setup-script.test.js` deckt es ab, aber der Handgriff gehoert einmal manuell
   gefahren, weil das Skript die Betreiber-Oberflaeche ist.
4. **Der entscheidende Smoke — Server startet OHNE jede `TWILIO_*`-Variable:**
   ```
   TWILIO_ACCOUNT_SID= TWILIO_AUTH_TOKEN= TWILIO_EDGE= \
   PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start
   curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3999/healthz    # 200
   ```
   (Leer **gesetzt**, nicht ungesetzt: `dotenv` fuellt nur ungesetzte Variablen — eine
   lokale `.env` wuerde sie sonst still nachliefern.)
   **Das ist der eigentliche Beweis, dass die Boot-Pflicht gefallen ist.** Der dauerhafte
   Beleg ist der gedrehte Spawn-Test aus 5.1 — der Handgriff ist die Gegenprobe dazu.
5. **Uebergangszustand traegt — Server startet weiterhin MIT gesetzten Keys:**
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx TWILIO_AUTH_TOKEN=x TWILIO_EDGE=frankfurt \
   PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start   # 200, keine Warnung, kein Refusal
   ```
   Render traegt die Keys noch — dieser Zustand muss halten.
6. **Boot-Banner enthaelt kein "Twilio" mehr:** `npm start` -> Ausgabe pruefen (`boot.js:669`).
7. **Gegenprobe zur Kopplung Config <-> Skripte:** `twilioSid` testweise wieder in
   `CONFIG_NAMESPACES.telephony` eintragen und einen `config.telephony.twilioSid`-Zugriff in
   `check-setup.js` stehen lassen -> zurueckbauen. Belegt, dass der Proxy-Guard die Kopplung
   wirklich haelt (Abschnitt 2) und die Skripte nicht "vorsichtshalber" mitgeaendert wurden.
8. **Kein `twilio` mehr in `node_modules` als direkte Dependency:**
   `npm ls twilio` -> `(empty)`; `package-lock.json` ist mit `npm install` **regeneriert**,
   nicht von Hand editiert.
9. **Telnyx-Sprechpfad unberuehrt:** ein Telnyx-Inbound mit gueltiger Ed25519-Signatur
   liefert weiterhin 200 + TeXML (`test/security.test.js` deckt das seit C-P3 ab).
10. **Rest-Erhebung:** `git grep -in twilio -- src/ scripts/ .env.example render.yaml package.json`
    liefert danach nur noch Treffer der Kategorien (b) und (c) — jeder verbleibende ist im
    Report **namentlich** mit seiner Kategorie zu nennen.

---

## 8. Pre-Mortem

| Ein Jahr spaeter ist es schiefgegangen. Was ist passiert? | Gegenmassnahme |
|---|---|
| *"Der Live-Dienst startete nicht mehr."* Jemand hat die Render-Keys geloescht, bevor der Code-Stand deployt war. | Abschnitt 6, Schritte 1-5 in dieser Reihenfolge; Schritt 4 ist ausdruecklich Ops-Arbeit **nach** verifiziertem Deploy. Die Asymmetrie steht dort benannt: gesetzt+ungelesen = harmlos, geloescht+verlangt = Ausfall |
| *"Die Suite war lokal rot und in CI gruen — eine `.env` leckte in die Spawn-Tests."* Eine Variable wurde aus `BASE_ENV` genommen, waehrend `config.js` sie noch las. | Abschnitt 5.5: `config.js` und `BASE_ENV` in **einem** Commit, nie getrennt (`tasks/lessons.md` / Memory `test-base-env-drift`) |
| *"Ein Doku-Verweis versprach Twilio-Support, den es nicht gibt."* Ein neuer Mitarbeiter richtete nach `ONBOARDING.md` einen Twilio-Trial ein und wunderte sich zwei Tage. | Abschnitt 1.3 + Kategorie (a): `README.md`, `ONBOARDING.md`, `.env.example`, `CLAUDE.md:7/62`, `STATUS.md`, `PLAN-SECURITY.md`, die drei Runbooks und `START-DEMO.command` sind **im Diff**, nicht "spaeter" |
| *"`render.yaml` und die Live-Config liefen auseinander."* Der Blueprint war sauber, in Render standen die Keys noch — und niemand wusste, welcher Stand gilt. | `render.yaml` ist Referenz, nicht Wahrheit (`test/prod-env.js:16-19`, dashboard-managed). Deshalb traegt Abschnitt 6 die Render-Handgriffe **ausdruecklich** als eigene Schritte in den Report, statt sie im Blueprint-Diff verschwinden zu lassen. `test/prod-config-smoke.test.js` Aussage 1/2 bleibt der automatische Divergenz-Faenger |
| *"`npm run check` war seit Monaten kaputt und niemand merkte es."* Die Config-Felder fielen, die Skripte nicht. | Abschnitt 2: der Proxy-Guard macht daraus einen `TypeError`, `test/check-setup-script.test.js` faengt ihn. Abnahme 3 faehrt den Handgriff zusaetzlich einmal von Hand |
| *"Ein Test war gruen und seine Begruendung war frei erfunden."* Der Offline-Diskriminator stand noch im Kommentar, obwohl der Twilio-Client seit einem Jahr weg war — und beim naechsten Umbau vertraute jemand darauf. | Abschnitt 5.3: die neue Ursache wird **gemessen** und eingetragen, nicht geraten. Betrifft mit `prod-env.js` den Traeger des wichtigsten Katalogtests |
| *"`SKIP_TWILIO_SIGNATURE_CHECK` wurde beim Aufraeumen mit umbenannt und der Boot-Guard fiel auf die Nase."* | Abschnitt 4 + Kategorie (b): unangetastet, per Owner-Entscheidung in `CLAUDE.md` |
| *"Wir haben `twilioSid` mit umbenannt und die Bestandsdaten passten nicht mehr."* | Kategorie (b) und Abschnitt 4: Feldname beider Anbieter, Datenform-Aenderung mit Migration, nicht hier |
| *"Der Diff hatte 400 Zeilen Kommentar-Kosmetik, und die zwei Zeilen, an denen der Boot hing, sind im Review untergegangen."* | Kategorie (c): die Kommentar-Nachlese in `src/`/`test/` ist eine **eigene Phase C-P6**, mit eigener Regel (wahr bleibt, falsch faellt) |
| *"Die Dependency war raus, aber `package-lock.json` nicht — der Build brach."* | Abnahme 8: Lock mit `npm install` regeneriert, nie von Hand editiert. (`render.yaml:22` faehrt `npm install`, der Web-Service `npm ci` gegen sein eigenes Lock) |
