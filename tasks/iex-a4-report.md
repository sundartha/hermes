# Phase IEX-A4: Freizeichen statt Stille (answerOnBridge)

**Gate: PASS**
**finalBranch:** `phase/iex-a4-answer-on-bridge`
**headCommit:** `23b45dd6ec32abe65c14a3c92114c2336bb4e14a`
**Basis:** `phase/iex-a3-ein-satz-eroeffnung` (0ee69e5)

## Plan (gekuerzt)

Die Uebergabe an den EL-Agenten (`elUebergabeDirektiven` -> `sendElUebergabe` -> `renderDialSip`)
soll `<Dial answerOnBridge="true">` als erstes Attribut tragen: der Anrufer hoert bis zur
SIP-Annahme sein Netz-Freizeichen statt Stille.

Kernentscheidungen:
- `dialSip` (Builder, `src/telephony/directives.js`) nimmt `answerOnBridge` als reines,
  ungefiltertes Datenfeld auf (wie die uebrigen Felder).
- Die einzige Regel sitzt im Renderer (`renderDialSip`,
  `src/telephony/adapters/telnyx/render.js`, neuer Helper `answerOnBridgeAttr`): nur ein
  striktes `=== true` erzeugt das Attribut, als erstes am `<Dial>`, nie am `<Sip>`. Fehlend,
  `false` oder anderer Typ rendert byte-gleich zum Bestand (sichere Fail-Richtung).
- Neue Konstante `EL_DIAL_ANSWER_ON_BRIDGE = true` in `src/elevenlabs/inbound-rueckfall.js`
  (kein Env/Config-Schalter, bewusst laut Spec-Scope), mit Kommentar: Telnyx-Doku-Zitat,
  offene Pflichtmessung M-S3 (haengt der Fehlersatz nach nie beantwortetem, gescheitertem Dial
  noch dran?), Rueckweg IEX-A4b (Konstante auf `false`), und der Preis: `answeredAt` liegt vor
  der Traeger-Annahme, ein Auflegen waehrend des Freizeichens bucht trotzdem mindestens eine
  Minute auf die Tenant-Decke (konservativ, Regel 1 bleibt intakt).
- Veralteter Kommentar zu `EL_DIAL_RING_TIMEOUT_S` (C2) wird nachgezogen: die bisherige Aussage
  "endet ueber dial_ende im Fehlersatz" ist mit `answerOnBridge` unbelegt.
- Pflicht-Abweichung von der Spec-Dateiliste (begruendet im Plan): `test/iel-b8-weiche.test.js`
  musste mit angefasst werden, weil zwei wortliche Dial-Snapshots (IEL-B8-4, IEL-B8-12) sonst rot
  werden — dabei Duplizierung durch gemeinsamen Helper `dialOeffnung` vermieden. Ebenso
  `PLAN-SECURITY.md` Abschnitt IEL-B8 (CLAUDE.md-Pflicht bei sicherheitsrelevanten Aenderungen):
  Einleitung, Rotation-Zeile, zwei neue Restrisiken (M-S3 offen, Buchungs-Vorlauf).
- Invarianten: Budget-Pfad/Golden unberuehrt (kein Dial dort), Outbound unberuehrt (`dialSip`
  hat keinen Outbound-Aufrufer), Safety-Gates/Signaturpruefung/Offenlegung unangetastet.

## Impl-Zusammenfassung

Wie geplant umgesetzt auf `phase/iex-a4-answer-on-bridge`:

- `src/telephony/directives.js`: `dialSip` nimmt `answerOnBridge` optional und ungefiltert auf.
- `src/telephony/adapters/telnyx/render.js`: neuer Helper `answerOnBridgeAttr` direkt ueber
  `renderDialSip`; Attribut nur bei striktem `true`, per Spread als erstes Attribut in
  `attrString`.
- `src/elevenlabs/inbound-rueckfall.js`: Konstante `EL_DIAL_ANSWER_ON_BRIDGE = true` eingefuehrt
  und in `elUebergabeDirektiven` verwendet; Kopfkommentar zu `EL_DIAL_RING_TIMEOUT_S` (C2)
  aktualisiert.
- Tests: neue Datei `test/iex-a4-answer-on-bridge.test.js` (IEX-A4-1/-2, offline, rein);
  `test/iel-dial-render.test.js` um IEX-A4-3 (exaktes Literal) und IEX-A4-4 (byte-gleich bei
  fehlend/`false`/`"true"`/`1`/`null`) erweitert; `test/iel-b8-weiche.test.js` auf gemeinsamen
  Helper `dialOeffnung` umgestellt (IEL-B8-4, IEL-B8-12 bleiben inhaltlich bestehen, jetzt mit
  `answerOnBridge`).
- `PLAN-SECURITY.md` Abschnitt IEL-B8 nachgezogen (Einleitung, Rotation-Zeile, zwei neue
  Restrisiken).

Verifikation: `node --check` auf allen 6 geaenderten `.js`-Dateien gruen; gezielte Tests
21/0 und 41/0; `npm test -- --test-concurrency=4` im zweiten vollen Lauf 5870/0 gruen (erster
Lauf hatte einen isolierten Flake in `test/outbound-per-target-cap.test.js`, unrelated zu dieser
Phase, zweifach isoliert gruen). Golden-Datei und `scripts/` unveraendert, `ringTone` 0 Treffer,
`answerOnBridge` in genau den 3 geplanten `src`-Dateien. Smoke-Test lokal: `/voice/incoming`
liefert `<Dial answerOnBridge="true" callerId="..." timeout="10" timeLimit="1800"><Sip
...>...</Sip></Dial><Redirect .../>`, kein Say/Play/Gather, kein Passwort im Server-Log.

### Deviations

1. `rg -c EL_DIAL_ANSWER_ON_BRIDGE src` findet 4 statt der im Plan erwarteten 3 Zeilen — der
   Plan-Kommentar in `elUebergabeDirektiven` (Abschnitt 3.3c) nennt die Konstante zusaetzlich
   namentlich, was der Plan bei seiner eigenen Zaehlung uebersehen hatte. Das eigentliche
   Kriterium ("Konstante kommt nur in dieser einen Datei vor") ist erfuellt.
2. `test/iel-b8-weiche.test.js` und `PLAN-SECURITY.md` wurden geaendert, obwohl sie nicht in der
   Spec-Dateiliste stehen — beides ist im Plan selbst als Pflicht-Abweichung begruendet
   (Abschnitte 0.3 und 3.6); der `PLAN-SECURITY.md`-Edit ist reine Doku.
3. Erster voller `npm test`-Lauf hatte 1 Fehlschlag in `test/outbound-per-target-cap.test.js`
   (Flake unter Parallel-Last, unrelated zur Phase), isoliert zweimal gruen; zweiter voller Lauf
   vollstaendig gruen (5870/0). Differenz der Gesamt-Testzahl zwischen den Laeufen (5868 vs.
   5870) wurde nicht weiter untersucht.

## Safety-Urteil

**Verdict: PASS with concerns** (approved=true, keine Blocker).

Alle Kernchecks bestanden: Tests unabhaengig reproduziert, Safety-Gates intakt, Offenlegung
intakt, Auth fail-closed intakt, keine Secret-Leaks, Scope eingehalten, Verhalten wie
beabsichtigt.

Concerns (alle spec-bekannt/gegated, keine Blocker):
- **M-S3 unbelegt:** mit `answerOnBridge=true` kann ein nie beantwortetes, gescheitertes Dial
  (Digest-Drift, Rotationsfenster, EL 404/5xx, Ring-Timeout) in Freizeichen -> Leitungsende ohne
  Fehlersatz enden, falls Telnyx den `<Redirect>` nach unbeantwortetem Dial nicht ausfuehrt. Nur
  im Runbook (a7a/a8) als Rollout-Vorbedingung gegated, nicht im Code erzwingbar — nichts
  verhindert code-seitig, `ELEVENLABS_INBOUND_SCOPE` auszuweiten, waehrend die Konstante `true`
  bleibt.
- **Buchungs-Vorlauf:** `answeredAt` liegt vor der Traeger-Annahme; Auflegen waehrend des
  Freizeichens bucht per `Math.ceil` mindestens eine Minute auf die Tenant-Decke, obwohl bei
  Telnyx keine Kosten entstehen. Decke sperrt beide Richtungen -> kostenlose
  Verfuegbarkeits-Attacke auf einen Tenant moeglich. Konservative Richtung (Regel 1 bleibt
  intakt), dokumentiert, M-A1/F2/F4 offen.
- **Offenlegungs-Anschnitt ungemessen:** Erst-Annahme des PSTN-Beins erst beim SIP-200 —
  Anfangssilben der `first_message` (KI-Kennzeichnung) koennten beim Media-Aufbau abgeschnitten
  werden. Nur durch Owner-Testanruf M-U1 pruefbar, kein Code-Test kann das belegen.
- Telnyx-Dial-Doku bestaetigt Attributname/Default/Wirkbereich, klaert aber NICHT explizit, was
  nach einem Dial ohne Annahme mit dem `action`-Attribut (Redirect) passiert — M-S3 bleibt
  dokumentarisch offen.
- Diff beruehrt zwei Dateien ausserhalb der Spec-Liste (`PLAN-SECURITY.md`,
  `test/iel-b8-weiche.test.js|) — beides begruendet, kein Scope-Creep (kein neuer Endpunkt, keine
  Dependency, keine Env-Variable).

## Clean-Code-Audit (S1-S4)

- **S1 (Blocker-Kategorie):** keine Befunde.
- **S2 (Blocker-Kategorie):** keine Befunde.
- **S3:**
  - G25/P1 — `EL_DIAL_ANSWER_ON_BRIDGE`: PASS (nicht FLAG). Bewusstes Vermeiden eines nackten
    Boolean-Literals durch benannte Konstante mit ausfuehrlichem Risiko-Kommentar (M-S3,
    Runbook a7a) — genau der Katalog-Wunsch.
  - G20/N7 — `answerOnBridgeAttr`: PASS. Name beschreibt exakt das Verhalten (Attribut-Objekt
    nur bei explizitem `true`).
- **S4:**
  - G34/G30 — `render.js`: PASS. `answerOnBridgeAttr` trennt die Typ-Entscheidung sauber von
    `renderDialSip`; Spread an erster Stelle haelt die vertragliche Attribut-Reihenfolge ein.
  - F1 — `dialSip`: PASS. Weiterhin ein Objekt-Parameter, Erweiterung zaehlt nicht als
    zusaetzliches Positionsargument.

**Verdict: PASS.** Sehr kleiner, praeziser Diff mit vollstaendiger Testabdeckung (52/52 gruen
inkl. 4 neuer IEX-A4-Tests), byte-genauer Bestandsform bei Nicht-`true` (IEX-A4-4). Restrisiko
(answerOnBridge=true ohne separaten Rollout-Schalter, M-S3 offen, Buchungs-Vorlauf) ist im
Code-Kommentar UND in `PLAN-SECURITY.md` ehrlich als offene, akzeptierte Unsicherheit
festgehalten — Produkt-/Rollout-Risiko, kein Clean-Code-Verstoss.

Top-TODOs (aus dem Audit, keine Code-Aenderung): Messung M-S3 vor Rollout auf weitere/alle DIDs
durchfuehren; Rueckweg IEX-A4b (Konstante auf `false`) bei negativem Befund nicht vergessen.

## Fix-Runden

Keine. Der Workflow lief ohne Fix-Runde durch (kein FIXES-Abschnitt, Gate direkt PASS).

## Security-Review (final, separat vom Safety-Urteil)

**Verdict: PASS**, approved=true, keine Blocker.

- Keine neue/geaenderte Route, kein `route-policy.js`-Eintrag noetig.
- Renderer erzeugt das Attribut nur bei striktem `true`; `attrString` escaped alles.
- Einziger Aufrufer ist `elUebergabeDirektiven` (EL-Weg gepinnter Tenants); nicht gepinnte
  Tenants bleiben byte-gleich (belegt durch IEX-A4-4).
- `timeLimit`, 30-s-Frist, Cap und Signaturkette unveraendert.
- Hinweis: der Security-Review-Worktree-HEAD (4e155d1) war nicht identisch mit dem finalen
  Branch-Stand (23b45dd) — bewertet wurde nur der statische Diff, Tests wurden dort nicht selbst
  ausgefuehrt (die unabhaengige Testausfuehrung erfolgte im Safety-Review, siehe oben).
- Dieselben drei Restrisiken wie im Safety-Urteil (M-S3, Buchungs-Vorlauf/Decken-Missbrauch,
  Offenlegungs-Anschnitt) werden genannt, alle spec-konform als Rollout-Vorbedingungen gegated.
