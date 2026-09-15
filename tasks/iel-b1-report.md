# Detailbericht: Phase IEL-B1 — Schalter, Tenant-Allowlist, Zugangs-Env, Golden-Test

**Gate: PASS**
**finalBranch: `phase/iel-b1-schalter`**
**headCommit: `dea103e5e5f047d9172da6ab267f6d4e031281e5`**

## Scope

Fundament fuer den kuenftigen EL-Inbound-Sprechpfad (kommt erst ab IEL-B8): Schalter,
Tenant-Allowlist, Zugangs-Env (SIP-Digest + Init-Webhook-Token), ein reines
Entscheidungs-Praedikat, ein fataler Boot-Riegel gegen einen halb konfigurierten
Zugang, PII-freie Banner-/Sondenzeilen und ein Golden-Master-Test fuer das
unveraenderte Inbound-TeXML. **Kein Sprechpfad-Anschluss** — `src/routes/voice.js`
bleibt unberuehrt, das neue Praedikat hat in dieser Phase noch keinen
Produktions-Aufrufer.

## Plan (gekuerzt)

Basis: master `794011a`.

- **Neues Modul `src/elevenlabs/inbound-path-decision.js`** (rein, config-frei,
  kein IO/Log/try-catch):
  - `SIP_PASSWORD_MIN_LENGTH = 32`, `INIT_WEBHOOK_TOKEN_MIN_LENGTH = 32`,
    `DID_ENDUNG_ZIFFERN = 4`.
  - `inboundElAccessDefects({sipUser, sipPassword, initWebhookToken})` — die EINE
    Quelle von "Zugang vollstaendig", von Praedikat UND Boot-Riegel genutzt.
  - `inboundElPathFor({config, tenantId})` — striktes Boolean: Schalter `=== true`,
    Tenant explizit gepinnt (leere Allowlist = niemand), Zugang vollstaendig.
  - `inboundElPinnedTenantCount`, `inboundElAllowlistProbeLine` (nur Anzahl +
    letzte 4 DID-Ziffern, nie Tenant-ID oder volle Nummer).
  - `tenantIstGepinnt` bewusst als eigene 3-Zeilen-Kopie der Logik aus
    `callee-is-owner.js` (Domaenen-Trennung, G13 vor G5, im Code begruendet).
- **`src/config.js`**: Block `elevenLabsInbound` um `tenantIds` (csvEnv),
  `sipUser`, `sipPassword` (SECRET), `initWebhookToken` (SECRET) erweitert, alle
  `.trim()`, Default leer. `CONFIG_NAMESPACES` bleibt unveraendert (bestehendes
  Blatt).
- **`.env.example`** / **`render.yaml`**: vier neue Keys dokumentiert, Muster
  `OWNER_SELF_CALL_TENANT_IDS` (`sync: false`, Leer-Default = niemand).
- **`src/boot-guard.js`**: neuer fataler Befund `elInboundAccessFindings` —
  Schalter an, aber Zugang unvollstaendig → `FATAL`. Meldung nennt nur
  Schluesselname + Mangelart (`fehlt`/`zu kurz`), nie Wert oder Laenge.
- **`src/boot.js`**: `assertElInboundAccess` neu im Gate-Bundle (INV-5 gewahrt:
  vor `rearmActiveCallTimers`), Banner-Zeilen `inboundElBannerLine` (Zustand +
  Tenant-Anzahl) und `inboundElAllowlistProbeLine` (aus dem geladenen Store).
- **Tests**: `test/iel-b1-schalter.test.js` (Praedikat-Tabelle inkl. Grenzfall
  31/32, Boot-Riegel-Spawns mit Sentinel-Werten ohne Leak, Config-Parsing im
  Kindprozess, Env-Kohaerenz mit Positiv-Kontrolle, Sondenzeile, Banner,
  Zwei-Server-Spawn-Verdrahtung); `test/iel-incoming-golden.test.js` +
  Fixture `test/fixtures/iel-incoming-budget-golden.xml` (GOLDEN-1: Schalter aus
  — byte-identisch zum unveraenderten master-Stand; GOLDEN-2: Schalter an,
  Tenant NICHT gepinnt — bleibt Budget-Pfad, Anker fuer IEL-B8).
- Zwei Commits vorgeschrieben: Commit 1 nur Golden-Fixture auf unveraendertem
  master-Diff, Commit 2 alle src-Aenderungen + restliche Tests. Anpassungen an
  `test/ie3-inbound-el-kostenprofil.test.js` (IE3-6 braucht jetzt vollstaendigen
  Test-Zugang) und `test/ie6-s1-assistant-entfernt.test.js` (Normalisierer auf
  `normalizeIncomingTexml` in `helpers.js` gezogen, G5).
- NICHT-Scope: `src/routes/voice.js`, `src/callee-is-owner.js`,
  `PLAN-SECURITY.md` (Eintraege gehoeren laut Spec zu B6/B8/B9/B10).

## Impl-Zusammenfassung

- **headCommit**: `dea103e5e5f047d9172da6ab267f6d4e031281e5`
- **nodeCheckPass**: true — **testsPass**: true (5573 pass / 0 fail)
- **committed**: true, zwei Commits (169ac7a: Golden-Fixture auf unveraendertem
  master-Diff; dea103e: restliche src-/Test-Aenderungen)
- **filesCreated**: `src/elevenlabs/inbound-path-decision.js`,
  `test/iel-b1-schalter.test.js`, `test/iel-incoming-golden.test.js`,
  `test/fixtures/iel-incoming-budget-golden.xml`
- **filesEdited**: `src/config.js`, `src/boot.js`, `src/boot-guard.js`,
  `.env.example`, `render.yaml`, `test/helpers.js`,
  `test/ie3-inbound-el-kostenprofil.test.js`,
  `test/ie6-s1-assistant-entfernt.test.js`
- **testsAddedOrChanged**: `test/iel-b1-schalter.test.js` (28 neue Faelle),
  `test/iel-incoming-golden.test.js` (GOLDEN-1+GOLDEN-2), IE3-6 angepasst,
  IE6-S1-3 refactored auf `normalizeIncomingTexml`
- **smokePass**: true — `/healthz` 200, `/voice/incoming` 200 mit unveraendertem
  Offenlegungssatz, Banner zeigt `Inbound-EL: aus, 0 Tenants` und
  `Inbound-EL-Allowlist: 0 Tenants, keine aktive DID`

### Deviations

1. **Ausfuehrungs-Mechanik, keine inhaltliche Abweichung**: Um die
   Golden-Master-Fixture nachweislich auf unveraendertem master-Stand
   aufzunehmen, wurden die src-Aenderungen per `git stash push -u` beiseitegelegt,
   die Fixture aufgenommen und verglichen, danach per `git stash apply <sha>`
   (nicht `pop`) wiederhergestellt und der Stash-Eintrag explizit gedroppt
   (deckt sich mit der Memory-Regel zu geteilten Stash-Stacks in Worktrees).
2. `grep -E "^# (pass|fail)"` traf im lokalen Terminal-Output nicht (node:test
   nutzt hier den `spec`-Reporter statt TAP); pass/fail-Zahlen stattdessen aus
   dem TAP-kompatiblen Wrapper-Output (`test/testbaenke-run.mjs`) gelesen
   (5573 pass, 0 fail).

## Safety-Urteil

**approved: true** — testsPassIndependently, safetyGatesIntact, disclosureIntact,
authFailClosedIntact, noSecretsLeaked, behaviorAsIntended, scopeRespected: alle
true. **Keine Blocker.**

Unabhaengiger Test in frischem Worktree (Branch `review-iel-b1` von
`phase/iel-b1-schalter`, Merge-Base = master `794011a`): `node --check` auf allen
vier geaenderten src-Dateien OK; volle Testlaeufe der betroffenen Dateien
74/74 pass; Golden-Master vor UND nach der Aenderung byte-identisch geprueft
(Gegenprobe auf Commit 169ac7a).

**Verdict**: IEL-B1 haelt sich an den Scope der Spec. Kein neuer Endpunkt, keine
neue Dependency. Kein Secret wird geloggt oder in Antworten ausgegeben —
`configFingerprint` liest die neuen Felder nicht, Banner/Sonde zeigen nur
Anzahl/letzte 4 Ziffern. Das Praedikat wird noch nirgends verwendet — das
Inbound-TeXML bleibt am Anruf nachweislich byte-identisch.

### Concerns (keine Blocker)

- **Deploy-Reihenfolge**: der neue fatale Boot-Riegel beendet den Prozess mit
  exit 1, wenn `ELEVENLABS_INBOUND_ENABLED=true` ohne vollstaendigen Zugang
  gesetzt ist. Render-Env ist Dashboard-managed — vor dem Deploy von B1 muss
  belegt sein, dass der Live-Wert von `ELEVENLABS_INBOUND_ENABLED` nicht `true`
  ist (nicht selbst gelesen; `render.yaml` steht auf `false`).
- `test/ie6-s1-assistant-entfernt.test.js` steht nicht in der Dateiliste der
  Spec — reiner Normalisierer-Extract (G5), kein Verhaltensunterschied.
  Kleine Abweichung, kein Blocker.
- Irrefuehrende Testnamen in `test/iel-b1-schalter.test.js` (IEL-B1-3a/3c) —
  Code-Qualitaet, keine Sicherheitsfrage.
- `PLAN-SECURITY.md` nicht aktualisiert, obwohl zwei neue Geheimnis-Env
  hinzukommen; Spec ordnet die Eintraege B9 zu — fuer B1 vertretbar.
- GOLDEN-2 ist in B1 zwangslaeufig gruen (kein Verbraucher existiert noch);
  echter Regressionsanker entsteht erst ab IEL-B8.

## Clean-Code-Audit (s1-s4)

**Verdict: PASS mit einer dokumentierten S2-Anmerkung, kein Blocker.**

- **s1 (Blocker)**: keine.
- **s2**: `tenantIstGepinnt` in `inbound-path-decision.js` dupliziert
  byte-fuer-byte die 3-Zeilen-Logik `tenantDarfAusloesen` aus
  `callee-is-owner.js` — im Code bewusst begruendet (G13 vor G5,
  Domaenen-Trennung), kein uebersehener Fund, aber weiterhin Duplizierung nach
  Katalog. Vorschlag: eine dritte, fachfremde Datei (`src/tenant-allowlist.js`)
  mit `tenantIsPinned(tenantId, allowlist)`, die weder das Offenlegungs- noch
  das EL-Inbound-Modul kennt.
- **s3**: Kommentar bei `DID_ENDUNG_PRAEFIX` behauptet "Quelltext bleibt ASCII",
  enthaelt aber das literale UTF-8-Zeichen U+2026 — Kommentar widerspricht dem
  Code direkt daneben. `inboundElAccessDefects` mischt Ternary (sipUser) mit
  `laengenMangel`-Helper (Passwort/Token) fuer strukturell gleichartige
  Listeneintraege — Formkonsistenz-Verbesserung vorgeschlagen.
- **s4**: `inboundElPathFor` hat ausserhalb von Tests keinen Aufrufer (formal
  F4/P15 — toter Code), aber im Kopfkommentar ausdruecklich als Zwischenschritt
  einer geplanten Phasenkette deklariert und durch 10 Tabellentests + Grenzwert
  abgesichert. Notiz ohne Handlungsdruck; verwaist, falls B8 nicht zeitnah
  gemergt wird.

**passNotes**: Fail-closed konsequent durchgehalten (leere Allowlist = niemand,
unvollstaendiger Zugang bei aktivem Schalter = Boot-Refusal, Grenzwert 31 vs.
32 explizit getestet). Neues Verhalten lueckenlos testbegleitet, G5 aktiv
gelebt (`EL_INBOUND_ACCESS_BOOT_ENV`, `normalizeIncomingTexml`,
Mindestlaengen-Konstanten je eine Quelle). Magic Numbers sauber benannt
(`SIP_PASSWORD_MIN_LENGTH`, `INIT_WEBHOOK_TOKEN_MIN_LENGTH`,
`DID_ENDUNG_ZIFFERN`).

## Security-Review (final)

**approved: true, keine Blocker.** Keine neue/geaenderte Route,
`routes/voice.js`/`route-policy.js`/Auth-Middleware/die sieben
Inbound-Sicherungen unberuehrt. Fail-closed erfuellt (strikt `enabled === true`,
leere Allowlist = niemand, Array-Pruefung, Mindestlaenge 32 aus einer Quelle).
Secrets: `config.js` trimmt, Boot-Riegel nennt nur Schluesselname + Mangelart,
`configFingerprint` liest die neuen Achsen nicht, `render.yaml`/`BASE_ENV`
konsistent leer/`sync:false`. Banner/Sonde PII-frei getestet (Fremd-Tenant,
SUSPENDED/RELEASED, keine volle Nummer im Log). Golden Master GOLDEN-1/GOLDEN-2
selbst nachgestellt, gruen. Volle `npm test`-Suite vom Security-Reviewer nicht
selbst gelaufen (unabhaengig vom Safety-Review, das sie lief).

### Concerns (keine Blocker)

- IEL-B1-15 prueft im Log-Output fehlendes `sipUser`/`sipPassword`, aber nicht
  `ELEVENLABS_INIT_WEBHOOK_TOKEN` — heute kein Leser vorhanden, symmetrische
  Absicherung waere sauberer.
- `inboundElAllowlistProbeLine` loggt letzte 4 DID-Ziffern gepinnter Tenants —
  von Spec E13 gedeckt, waechst bei breiter Freischaltung linear; vor Skalierung
  neu bewerten.
- Schalter an + leere Allowlist erzeugt keinen Boot-Befund (fail-closed korrekt,
  aber nur in der Banner-Zeile sichtbar) — WARN waere Diagnose-Komfort.
- `sipUser` nur auf nicht-leer geprueft, keine Zeichen-Validierung — in B1
  unkritisch (noch kein Rendering), Escaping/Validierung ist Aufgabe von B8.
- GOLDEN-2 ist heute trivial gruen mangels Pfad-Verbraucher; Schutzwirkung
  entsteht erst mit B8.

## Fix-Runden

Keine — die Phase durchlief Safety-, Clean-Code- und Security-Review jeweils
im ersten Anlauf mit `approved: true` / `PASS`, ohne Blocker und ohne
nachgelagerte Fix-Runde. Alle oben aufgefuehrten Concerns sind unverbindliche
Notizen fuer Folge-Phasen (insbesondere IEL-B8/B9/B10), nicht offene
Blocker dieser Phase.
