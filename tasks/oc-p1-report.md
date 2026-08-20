# Phasenbericht OC-P1 — Owner-Call-Praedikat, Persistenz, Schalter + Tenant-Allowlist

Gate: **PASS**
finalBranch: `phase/oc-p1-praedikat`
headCommit: `a1de84897df380833192111e21ea424affaf859c`

## 1. Ziel der Phase

OC-P1 baut ausschliesslich das Praedikat "ruft dieser Tenant seine EIGENE hinterlegte
Nummer an" — inkl. Persistenz auf dem Anruf-Datensatz (json + pg), Schalter
`OWNER_SELF_CALL_ENABLED` und Tenant-Allowlist `OWNER_SELF_CALL_TENANT_IDS`. Kein
gesprochener Satz aendert sich in dieser Phase; die Wirkung auf die Offenlegung
(Art. 50 AI Act, Absolute Regel 2) folgt erst in OC-P2/P3. Diff auf alle Sprach-/
Prompt-Dateien (`src/claude.js`, `src/bridge.js`, `src/elevenlabs/*`, `src/i18n/*`,
`src/routes/voice.js`, `src/telnyx-call-control-ingest.js`, `elevenlabs/*`) ist leer.

## 2. Die Fail-Closed-Wahrheitstabelle des Praedikats (vollstaendig)

`ownerSelfCallGranted` ist eine Konjunktion aus vier unabhaengigen Zutaten. Jede
fehlende/abweichende Zutat ergibt `false` — false heisst immer "Offenlegung bleibt".

```
K1  enabled === true                                    (globaler Schalter)
K2  tenantId ist nicht-leerer String                     (Identitaet vorhanden)
K3  Array.isArray(allowedTenantIds) && .includes(tenantId)  (Tenant-Allowlist)
K4  calleeIsOwner({to, ownNumber})
      = to nicht-leerer String
     && ownNumber nicht-leerer String
     && to === ownNumber                                 (strikte E.164-Gleichheit)
```

### Tabelle A — `calleeIsOwner` (nackter Nummern-Vergleich)

| # | `to` | `ownNumber` | Ergebnis | verletzte Konjunktion | beweisender Test |
|---|---|---|---|---|---|
| A1 | `"+491737252163"` | `"+491737252163"` | **true** | — | `OC-P1-01` |
| A2 | `"+491737252163"` | `null` | false | K4 (ownNumber kein String) | `OC-P1-02` |
| A3 | `"+491737252163"` | `undefined` | false | K4 | `OC-P1-03` |
| A4 | `"+491737252163"` | `""` | false | K4 (leer) | `OC-P1-04` |
| A5 | `null`/`undefined`/`""` | `"+491737252163"` | false | K4 (to kein String/leer) | `OC-P1-05` |
| A6 | `null` | `null` | false | K4 (beide) | `OC-P1-06` |
| A7 | `"491737252163"` (ohne `+`) | `"+491737252163"` | false | K4 (Ungleichheit) | `OC-P1-07` |
| A8 | `"01737252163"` (national) | `"+491737252163"` | false | K4 (Ungleichheit) | `OC-P1-08` |
| A9 | `"+441737252163"` (gleiche letzten 8, anderer LC) | `"+491737252163"` | false | K4 | `OC-P1-09` |
| A10 | `"+491737252164"` (ein Zeichen anders) | `"+491737252163"` | false | K4 | `OC-P1-10` |
| A11 | `" +491737252163"` / `"...163 "` | `"+491737252163"` | false | K4 (kein Trim) | `OC-P1-11` |
| A12 | `491737252163` (Number) / `{}` | `"+491737252163"` | false | K4 (kein String) | `OC-P1-12` |
| A13 | `"+491737252163"` | `491737252163` (Number) | false | K4 (kein String) | `OC-P1-13` |

### Tabelle A2 — `ownerSelfCallGranted` (vollstaendige Bedingung)

`OWN = "+491737252163"`, `FOREIGN = "+491729999001"`, `T = "owner"`, `OTHER = "t_fremd"`.

| # | `enabled` | `allowedTenantIds` | `tenantId` | `to` | Ergebnis | verletzt | Test-ID |
|---|---|---|---|---|---|---|---|
| B1 | `true` | `[T]` | `T` | `OWN` | **true** | — | `OC-P1-20` |
| B2 | `false` | `[T]` | `T` | `OWN` | false | K1 | `OC-P1-21` |
| B3 | `undefined` (Var fehlt) | `[T]` | `T` | `OWN` | false | K1 | `OC-P1-22` |
| B4 | `"true"` (String) | `[T]` | `T` | `OWN` | false | K1 (nicht `=== true`) | `OC-P1-23` |
| B5 | `1` (truthy Zahl) | `[T]` | `T` | `OWN` | false | K1 | `OC-P1-24` |
| B6 | `true` | `[]` (leer) | `T` | `OWN` | false | K3 (leer = niemand) | `OC-P1-25` |
| B7 | `true` | `[OTHER]` | `T` | `OWN` | false | K3 | `OC-P1-26` |
| B8 | `true` | `undefined` (fehlt) | `T` | `OWN` | false | K3 | `OC-P1-27` |
| B9 | `true` | `"owner"` (kein Array) | `T` | `OWN` | false | K3 (`Array.isArray`) | `OC-P1-28` |
| B10 | `true` | `null` | `T` | `OWN` | false | K3 | `OC-P1-29` |
| B11 | `true` | `[T]` | `null` | `OWN` | false | K2 | `OC-P1-30` |
| B12 | `true` | `[T]` | `""` | `OWN` | false | K2 | `OC-P1-31` |
| B13 | `true` | `[T]` | `undefined` | `OWN` | false | K2 | `OC-P1-32` |
| B14 | `true` | `[T]` | `T` | `FOREIGN` | false | K4 | `OC-P1-33` |
| B15 | `true` | `[T]` | `T` | `""`/`null` | false | K4 | `OC-P1-34` |
| B16 | `true` | `[T]` | `T` | `OWN`, aber `ownNumber=null` | false | K4 | `OC-P1-35` |

**Ausfallart "Normalisierung wirft":** strukturell nicht erreichbar. `normalizePrivateNumber`
(`state-ops.js:2127`) wirft beim SCHREIBEN, vor jeder Mutation — ein ungueltiger Wert
kommt nie an den Tenant-Record. `ownerSelfCallGranted`/`calleeIsOwner` selbst enthalten
keinen Aufruf, der werfen kann (nur `typeof`, `===`, `Array.isArray`,
`Array.prototype.includes`). Der einzige Restfall — `ownNumber` im Store nicht gesetzt —
ist B16 und ergibt `false`. Bewusst kein `try/catch` im Modul, damit niemand spaeter
eines einbaut, das im Fehlerfall versehentlich `true` liefern koennte.

### Tabelle B — dieselben vier Konjunktionen am Anruf-Datensatz (`state-ops.createCall`)

| # | Schalter | Allowlist | Ziel | `call.calleeIsOwner` | Test-ID |
|---|---|---|---|---|---|
| C1 | aus | `[T]` | eigene Nummer | `false` | `OC-P1-40` |
| C2 | an | `[T]` | fremde Nummer | `false` | `OC-P1-41` |
| C3 | an | `[]` | eigene Nummer | `false` | `OC-P1-42` |
| C4 | an | `[T]` | eigene Nummer | `true` | `OC-P1-43` |

In jedem Fall zusaetzlich gepinnt: `typeof call.calleeIsOwner === "boolean"` — nie
`undefined`/`null`/ein truthy Rohwert.

## 3. Abnahmepunkte der Spec (einzeln, Urteil + Kommando)

| # | Abnahme | Urteil | Kommando | Ergebnis |
|---|---|---|---|---|
| 1 | Syntax | PASS | `node --check src/callee-is-owner.js && node --check src/diagnostic-retention.js && node --check src/routes/api-calls.js && node --check src/store/state-ops.js && node --check src/store/pg.js && node --check src/config.js && node --check src/store/json.js` | keine Ausgabe, Exit 0 |
| 2 | Neue Einheitstests | PASS | `NODE_ENV=test LLM_PROVIDER=anthropic node --test test/callee-is-owner.test.js` | `tests 33 / pass 33 / fail 0` (>= 22 gefordert) |
| 2b | Store+HTTP-Tests | PASS | `node --test test/callee-is-owner-store.test.js test/oc-p1-owner-call-http.test.js` | `pass 8` / `pass 10`, je `fail 0` |
| 3 | Volle Regressionsbank | PASS | `LLM_PROVIDER=anthropic npm test` | `korrigiert: tests 4960 / pass 4960 / fail 0` (Ausgangsstand 4909 + 51 neue) |
| 4 | Kein Testkatalog-Leck | PASS | `LLM_PROVIDER=anthropic npm run test:gates` | `korrigiert: tests 129 / pass 126 / fail 3` — exakt Ausgangsstand, unveraendert |
| 5 | Schalter+Allowlist E2E ohne echten Anruf | PASS | echter `npm start` mit `FAKE_ORIGINATE=true`, `ELEVENLABS_OUTBOUND_ENABLED=false`, `TELNYX_AI_ASSISTANT_ENABLED=false`, `OWNER_SELF_CALL_ENABLED`/`_TENANT_IDS` variiert, private Nummer ueber die Anwendung gesetzt (nie `psql`) | eigene Nummer -> `calleeIsOwner:true`; fremdes Ziel -> `false`; leere Allowlist -> `false`; Nummer erscheint in keiner Response |
| 6 | Nichts Gesprochenes bewegt | PASS | `git diff --stat master -- src/claude.js src/bridge.js src/elevenlabs src/i18n src/routes/voice.js src/telnyx-call-control-ingest.js elevenlabs/` | leer |
| 7 | Env-Variablen an 4 Pflichtstellen | PASS | `grep -c OWNER_SELF_CALL_ENABLED .env.example render.yaml test/helpers.js src/config.js` + Analogie fuer TENANT_IDS + Laufzeitsonde | jede Datei >= 1; ohne Env: `false true 0`; mit Env `"  a , ,b "`: `true ["a","b"]` (Split/Trim/Leer-Verwurf an genau einer Stelle) |
| 8 | Datei-Umfang | PASS (Abweichung dokumentiert, F2) | `git diff --stat master HEAD` | 15 Dateien (14 wie im Plan vorausgesehen [Spec sagte "rund 13"] + `test/config-namespaces.test.js` als F1-Nachzug) |

## 4. Sabotage-Gegenprobe — woertlich

**Aus dem IMPL-Report (`failClosedProof`):**

> Sabotage in `src/callee-is-owner.js#tenantDarfAusloesen`: `if (allowedTenantIds.length === 0) return true;` eingefuegt (die klassische fail-open-Attrappe "leere Liste heisst alle"). Befehl: `NODE_ENV=test LLM_PROVIDER=anthropic node --test test/callee-is-owner.test.js test/oc-p1-owner-call-http.test.js`. Ausgabe VOR Wiederherstellung: `tests 43 / pass 39 / fail 4` — rot: OC-P1-25 (Allowlist LEER -> false erwartet), OC-P1-42 (Datensatz-Block, Allowlist leer), OC-P1-63 (HTTP-Route, Allowlist leer), OC-P1-69 (Block F, diagnostic vs calleeIsOwner Divergenz). Sabotage-Zeile entfernt (git-identisch zum committeten Stand wiederhergestellt, per `git status --porcelain` leer bestaetigt). Ausgabe NACH Wiederherstellung: `tests 43 / pass 43 / fail 0`. Zusaetzlich zwischenzeitlich am final committeten Code-Stand ein zweites Mal wiederholt (identisches Ergebnis) als letzter Beleg vor Abschluss.

**Zusaetzlich vom unabhaengigen Safety-Review dreimal selbst ausgefuehrt** (drei verschiedene Sabotagen, jeweils rot gesehen, dann `git checkout` wiederhergestellt):

> S1 "mach den Vergleich robuster" (nur Ziffern, letzte 8) -> 6 rot (OC-P1-07/08/09/11/12/13).
> S2 "leere/fehlende Allowlist = alle" -> 7 rot, inkl. HTTP-Ebene (OC-P1-25/27/28/29/42/63/69).
> S3 "enabled truthy statt === true" -> 2 rot (OC-P1-23/24).

**Und vom Clean-Code-Audit** eine vierte, eigene Sabotage:

> Eigene ausgefuehrte Sabotage-Gegenprobe: calleeIsOwner() auf "return true" mutiert -> mehrere Tests aus test/callee-is-owner.test.js schlagen sofort fehl (assert.strictEqual actual:true expected:false).

Insgesamt vier unabhaengige, tatsaechlich ausgefuehrte Sabotagen (Ziel-Vergleich lockern,
Allowlist als "alle" lesen, Schalter per Truthiness statt strikter Gleichheit, Praedikat
komplett auf `true` fixieren) — jede wurde rot gefangen, jede wurde danach sauber
zurueckgenommen.

## 5. Implementierungs-Zusammenfassung

Neues reines Praedikat-Modul `src/callee-is-owner.js` (kein Store/config/IO, zwei
Exporte: `calleeIsOwner` fuer den nackten Nummern-Vergleich, `ownerSelfCallGranted`
fuer die vollstaendige Bedingung aus Schalter/Allowlist/Ziel — G5-Muster: ein
Vergleich, zwei benannte Zugaenge). `diagnostic-retention.js` auf dieses Modul
umgestellt (delegiert an `calleeIsOwner`, haengt bewusst NICHT am Schalter/an der
Allowlist, damit ein Flag-Flip die Diagnose-Retention nicht still lahmlegt — belegt
durch `OC-P1-69`, das beide Werte am selben Anruf-Datensatz auseinandergehen zeigt).
`routes/api-calls.js` liest die eigene Nummer einmal (`store.tenantPrivateNumber`)
und speist sie in beide Auswertungen. Persistenz des neuen Booleans `calleeIsOwner`
ueber beide Backends: json (`CALL_FIELD_DEFAULTS`-Eintrag, F2) und pg (Schema-Spalte
`callee_is_owner BOOLEAN NOT NULL DEFAULT FALSE`, Mapper, Bind als angehaengtes `$55`,
set-once — NICHT im `ON CONFLICT DO UPDATE SET`). Zwei neue Env-Variablen
`OWNER_SELF_CALL_ENABLED` (Default aus) und `OWNER_SELF_CALL_TENANT_IDS` (Default
leer = niemand) vollstaendig verdrahtet: `.env.example`, `render.yaml` (`sync:false`),
`test/helpers.js` `BASE_ENV`, `src/config.js` (Wertbildung + `CONFIG_NAMESPACES.voice`).
51 neue Tests in drei neuen Dateien plus Ledger-Nachzug in `test/config-namespaces.test.js`.

### Deviations (aus dem IMPL-Report, woertlich uebernommen)

1. **F1 (Spec-Widerspruch, im Plan vorgesehen):** `tasks/oc-p1-spec.md` Invariante 3
   ("kein bestehender Test wird veraendert") und Abnahme 3 ("npm test faellt 0")
   widersprechen sich fuer `test/config-namespaces.test.js`, weil zwei neue
   `voice`-Keys dessen fest gepinnte Key-Zahlen zwingend rot machen. Aufloesung
   gemaess Plan-Vorschlag: nur die drei Ledger-Konstanten (`voice`-Count,
   `EXPECTED_TOTAL_KEYS`, `EXPECTED_PRIMITIVE_LEAVES`) plus ein Testname-String
   nachgezogen, je mit Kommentarzeile im etablierten Muster. Keine Zusicherung,
   kein Testverhalten geaendert.
2. **F2 (json-Backend-Luecke, im Plan vorgesehen):** `src/store/json.js#CALL_FIELD_DEFAULTS`
   um `calleeIsOwner: false` ergaenzt — notwendig fuer den Spec-Test "Bestandszeile
   ohne Feld liest false" auf dem json-Backend. Macht die beruehrte Dateizahl 14
   statt der von der Spec genannten "rund 13".
3. **Nicht im Plan vorgesehen, waehrend der Umsetzung entdeckt:** `src/routes/api-calls.js`
   traegt einen Altlast-Pin in `eslint-legacy-exceptions.json` (max-lines-per-function).
   Die urspruengliche, dem Plan woertlich folgende Inline-Implementierung haette diesen
   Pin erhoehen muessen und damit `test/check-staged-suppressions.test.js`
   ("Altlast-Ratsche") rot gemacht. Geloest ohne `eslint-legacy-exceptions.json`
   anzufassen: die komplette OC-P1/P2b-Auswertung in eine neue Modul-Funktion
   `resolveCallPrivacyFlags` vor `makeCallRoutes` ausgelagert, Zeilenzahl empirisch
   auf exakt 0 Delta kalibriert. `eslint-legacy-exceptions.json` im finalen Commit
   byte-identisch zu master. Ein verworfener Zwischenstand wurde per
   `git commit --amend` vollstaendig zurueckgenommen.
4. **Kleinere Praezisierung (Spec 2.2/F4):** Kommentar an
   `src/diagnostic-retention.js:44` ("eigene verifizierte Nummer") auf "eigene
   hinterlegte Nummer" korrigiert (Format-/Land-validiert, NICHT Besitz-verifiziert).
   Zwei weitere Stellen mit derselben Falschaussage (`state-ops.js:328`,
   `schema.sql:269`) bewusst NICHT angefasst (SCOPE) — als Befund fuer einen
   spaeteren Phasenbericht vermerkt.

## 6. Safety-Urteil

**FREIGABE (approved: true).** Aus dem Safety-Review woertlich zentrale Punkte:

- `testsPassIndependently`, `testCountNotShrunk`, `failClosedProofRepeated`,
  `predicateFailClosed`, `noDisclosureEffectYet`, `existingReadersUnchanged`,
  `envVarsFourPlaces`, `routeAuthIntact`, `safetyGatesIntact`, `noSecretsLeaked`,
  `scopeRespected` — alle `true`.
- Eigene 47 konstruierte Fail-closed-Gegenbeispiele (0049-Form, Leerzeichen,
  Bindestriche, Prototype-Objekte, Substring-Fallen bei der Allowlist etc.) —
  ausnahmslos `false`. Aktiv nach einem `true`-Pfad ohne vollstaendige Konjunktion
  gesucht, keinen gefunden.
- Eigene HTTP-Sonden: Body-Flags `calleeIsOwner:true`/`callee_is_owner:true` und
  eine Body-`tenantId` werden vom Server ignoriert — Ergebnis bleibt serverseitig
  bestimmt.
- `route-auth-inventory.test.js` isoliert 9/9 gruen, Diff auf `route-policy.js`,
  `server.js`, `self-service-routes.js` leer — kein neuer ungeschuetzter Endpunkt.
- Concerns (keine Blocker): der gemeldete Spec-Widerspruch (Invariante vs.
  Abnahme 3, siehe F1); eine Coverage-Luecke (Body-Flag-Ignorieren ist heute wahr,
  aber ungepinnt — Empfehlung fuer OC-P2); ein kosmetischer Ueberschuss im
  Modulkopf-Kommentar ("KEIN WURF" vs. TypeError bei Aufruf ohne Argument,
  unerreichbar da beide Aufrufstellen Objektliterale reichen); theoretische
  Prototype-Pollution auf `Array.prototype.includes` (kein realistischer
  Angriffspfad); `OC-P1-60b` (nationale Schreibweise -> true) ist bewusst so,
  weil `normalize_target` vor dem Vergleich aufloest; `calleeIsOwner` erscheint
  ueber `publicCall` in `GET /api/state`/MCP — Spec-konform (2.4), die private
  Nummer selbst leakt nicht (`OC-P1-65`).

## 7. Clean-Code-Audit (S1-S4)

**Verdict: PASS**, `blocker: false`. S1 = [], S2 = [], S3 = [], S4 = [] — keine
Befunde in irgendeiner Kategorie.

- **G5 (eine Quelle, zwei Zugaenge):** `calleeIsOwner()` ist der einzige
  Nummern-Vergleich; `diagnostic-retention.js` importiert ihn statt einer eigenen
  Kopie (sogar eine bestehende Duplizierung wurde dabei aufgeloest).
  `ownerSelfCallGranted()` komponiert die volle Bedingung; `routes/api-calls.js`
  setzt sie nicht selbst zusammen.
- **G25/G35 (Config zentralisiert):** beide neuen Env-Keys werden ausschliesslich
  in `src/config.js` gelesen (grep bestaetigt); `csvEnv()` split/trim einmal
  zentral, das Praedikat vergleicht nur noch strikt.
- **Store-Paritaet:** Tests fuer beide Backends inkl. set-once-Test (`OC-P1-57`)
  und Bestandszeilen-Default (`OC-P1-56`).
- **Eigene, ausgefuehrte Sabotage-Gegenprobe** des Audits (`calleeIsOwner` auf
  `return true` mutiert) — sofortiger Testfehlschlag, danach zurueckgesetzt.
- Fail-closed konsequent: Default aus, leere Allowlist = niemand, strikte
  `=== true`/String-Pruefungen, kein Trim/Praefix/Case-Toleranz im Praedikat
  (mit eigenem Testblock A explizit gegen kuenftige "robuster machen"-Refactorings
  verriegelt). Set-once-Speicherung sauber. Kommentare deutsch ohne Umlaute, kein
  auskommentierter Code, keine neuen eslint-disable/Suppressions.
- `topTodos` (nicht blockierend): OC-P2 haengt den Offenlegungssatz noch nicht an
  (plan-konform); vor Launch sicherstellen, dass `OWNER_SELF_CALL_TENANT_IDS` in
  Produktion leer bleibt bzw. nur den eigenen Account enthaelt (Betriebs-, keine
  Code-Angelegenheit).

## 8. Fix-Runden

**Keine.** Das `FIXES`-Feld des Kettenstands ist leer — die Implementierung ist im
ersten Durchlauf durch beide Reviews (Safety + Clean-Code) gegangen, ohne dass ein
Fix-Zyklus noetig war. Die einzige waehrend der Umsetzung aufgetretene Kollision
(Altlast-Ratsche `eslint-legacy-exceptions.json`, siehe Deviation 3) wurde vom
Impl-Agenten selbst durch Refactoring geloest, bevor der Stand zur Review ging —
kein separater Fix-Commit noetig, ein verworfener Zwischenstand wurde per
`git commit --amend` bereinigt.
