# Kickoff: Inbound-Paritaet abschliessen — Messmaschine raus, Rollout, alte Technik loeschen

## 1. Auftrag (Owner, 2026-09-17)

Drei Dinge, in dieser Reihenfolge:

1. **Die Messmaschine ("Ohrzeuge") restlos entfernen.** Owner: "Ich habe keine Lust auf totes
   Gewicht." Sie wurde gebaut, hat genau einen unbrauchbaren Lauf gemacht und ist durch den
   direkten Owner-Testanruf ersetzt.
2. **Eingehende Anrufe fuer ALLE Kunden freischalten** (heute laeuft nur der Owner-Tenant).
3. **Die alte Anruftechnik (Budget-Engine) loeschen.** Ziel ist ein schlanker Bestand: ein System
   statt zwei.

Leitsatz des Owners fuer die ganze Arbeit: **lean, sauber, kein Apparat um des Apparats willen.**

## 2. Arbeitsweise (verbindlich)

- Lean Lead: orchestrieren, entscheiden, nie selbst Code/Diffs lesen. Umsetzung ueber
  `.claude/workflows/runs/inbound-paritaet-lean.js` (PHASES pro Lauf neu pinnen, alte Eintraege
  vorher ENTFERNEN — sonst baut der Lauf eine bereits gemergte Phase noch einmal).
- **Vor jedem Messaufbau die Frage: reicht ein Anruf?** Der Owner testet selbst und ist erreichbar.
  Eine gebaute Messmaschine hat in dieser Kette mehr Zeit gekostet als hundert Testanrufe
  (Memory `einfachster-messweg-zuerst`).
- Keine Annahmen: messen oder Owner fragen. Pre-Mortem vor jeder nicht-trivialen Entscheidung.
- Scheitert etwas an Classifier/Push/Deploy: sofort stoppen, ein Satz an den Owner, keine
  Ersatzarbeit.

## 3. Stand (gemessen, 2026-09-17)

- master = upstream/master = `29482f1`. Live-Deploy `648f690` (der Docs-Commit danach aendert
  keinen Code). Banner: `Inbound-EL: an, 1 Tenants, scope=allowlist`, `aktive DIDs …1188`,
  `Inbound-Owner-Ton: AKTIV`.
- Volle Testbank zuletzt gruen: 6085/6085 (`npm test -- --test-concurrency=2`, sauberer Worktree).
  Ein einzelner roter Lauf war ein Parallelitaets-Ausreisser; isoliert gruen.
- **Owner-Testanruf am 2026-09-17 bestanden.** Owner: "funktioniert alles". Keine Roboteransage
  mehr, kein Klingeln, Ton und Eroeffnung abgenommen. Outbound und Inbound klingen gleich gut.

### Was live wirkt (alles hinter eigenen Schaltern)

| Schalter | Wert | Wirkung |
|---|---|---|
| `ELEVENLABS_INBOUND_ENABLED` | true | Inbound laeuft ueber den EL-Agenten |
| `ELEVENLABS_INBOUND_SCOPE` | allowlist | nur gepinnte Tenants |
| `ELEVENLABS_INBOUND_TENANT_IDS` | Owner-Tenant | heute genau einer |
| `INBOUND_OWNER_GREETING_ENABLED` | true | Owner-Ton bei Anruf von der hinterlegten Nummer |
| `INBOUND_OWNER_GREETING_TENANT_IDS` | Owner-Tenant | fail-closed, Default leer |
| `ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED` | true | Ton in der Wartezeit bis EL |

### Gemergte Phasen dieser Kette

IEP-P1 (Messmaschine — wird jetzt wieder entfernt), IEP-P1b (Scharfstellen, entfaellt mit),
IEP-P2 (Sofortannahme statt `answerOnBridge`, Begruessungslaut am Dial), IEP-P6 (Eroeffnung im
Owner-Wortlaut + Owner-Erkennung), IEP-P2b (gerechneter Laut — vom Owner verworfen), IEP-P2c
(Laut aus ElevenLabs-Soundeffekt, abgenommen).

## 4. Owner-Entscheidungen, die bindend bleiben

1. **Eroeffnung** (ersetzt den alten O1-Dreisatz):
   - Fremde: "Hallo, hier ist der KI-Assistent von \<Name>. Das Gespraech wird transkribiert und
     zusammengefasst. Wie kann ich helfen?"
   - Erkannter Owner: "Hallo \<Vorname>, hier ist dein KI-Assistent. Das Gespraech wird
     transkribiert und zusammengefasst. Wie kann ich helfen?"
   - Kein "Hinweis:", kein "Sie sprechen mit einer KI", keine Sie-Form.
2. **Owner-Erkennung inbound** aendert AUSSCHLIESSLICH die Anrede. Keine Daten, keine Werkzeuge,
   keine Rechte. Die Anrufernummer ist faelschbar; jede Datenfreigabe daran ist ein Blocker.
   KI-Kennzeichnung bleibt in jedem Fall im ersten Satz.
3. **Rufnummern sind kein Thema.** Kein Nummernwechsel, kein Nummernkauf, keine +49-DID — auch
   nicht als Option. Dieselbe US-Nummer klingt ausgehend einwandfrei.
4. **Zusammenfassungs-SMS bleibt AUS** (Owner 2026-09-17: "das will ich erstmal sowieso nicht
   haben"). Sie steht fuer den Owner-Tenant in der Prod-DB auf false und bleibt so. Fuer den
   Rollout gilt: keine SMS-Welle ausloesen.
5. **Begruessungslaut** ist abgenommen (`public/brand/hermes-begruessungslaut.wav`, Quelle
   `scripts/quellen/hermes-begruessungslaut-quelle.mp3`, ElevenLabs-Soundeffekt, 8 kHz mono,
   Spitze -20 dBFS). Nicht ohne neue Owner-Abnahme aendern.

## 5. Die drei Arbeitspakete

### A. Messmaschine restlos entfernen (zuerst, weil sie sonst jede spaetere Aenderung mitschleppt)

Zu entfernen, inklusive Tests, Zaehler, Belegen und allem, was nur dafuer existiert:
`scripts/iel-mess-ohrzeuge.mjs`, `scripts/iel-mess-audio.mjs` (pruefen: wird es noch von
`render-begruessungslaut.mjs` gebraucht? dann nur den Ohrzeugen-Teil), die Fall-Gruppe `ohrzeuge`
samt Fall `OZ-vorher` in `scripts/iel-mess.mjs` und `scripts/iel-mess.cases.json`, die drei
`test/iep-p1-ohrzeuge-*.test.js`, `tasks/iel-ohrzeuge-zaehler.json`,
`tasks/iel-ohrzeuge-vorlauf.json`, `tasks/iel-ohrzeuge-sprechspur.mp3` (untrackt).
Der Helfer `test/_iel-messbaum.mjs` wurde aus `test/iel-b11-nachdeploy.test.js` extrahiert — der
Bestandstest muss danach unveraendert gruen bleiben.

**Nicht mitreissen:** die Bestandsgruppen `m1` und `nachdeploy` mit ihren Zaehlern, und
`scripts/render-begruessungslaut.mjs` (der Umwandler fuer den abgenommenen Laut bleibt).
Abnahme: volle Bank gruen, `node scripts/iel-mess.mjs status` laeuft ohne die Gruppe,
kein toter Code, kein verwaister Import.

### B. Inbound fuer alle Kunden freischalten

Vorbereitet liegt das Rollout-Werkzeug aus IEX-A9..A11 (Scope-Schalter `allowlist` ->
`registrierte_dids`, Registrierungs-Beleg, `el-nummern-registrierung.mjs setzen`). Runbook:
`tasks/iex-spec-a.md` §7 b.
Zu klaeren VOR dem Umlegen, jeweils am lebenden System belegt:
- Sind alle aktiven Kunden-DIDs bei ElevenLabs registriert (Beleg, nicht Vermutung)?
- Greift der Fehlersatz sauber fuer eine Nummer ohne Registrierung?
- Kosten: Inbound-Minutensatz = Outbound-Satz (Owner-Entscheidung O10), Buchung auf die
  pro-Tenant-Decke laeuft weiter (das Gate sperrt BEIDE Richtungen — CLAUDE.md Regel 1).
- Owner-Ton bleibt auf den Owner-Tenant gepinnt; fuer fremde Tenants gilt der Fremd-Wortlaut.
Abnahme: Boot-Banner zeigt den neuen Scope und die Zahl der Tenants; ein Testanruf auf eine
zweite Kunden-DID (Owner fragen, ob und welche) klingt wie beim Owner.

### C. Alte Anruftechnik (Budget-Engine) loeschen

Spec Teil B (D1-D6) in `tasks/iex-r2-loeschung-rollout.md` bzw. `tasks/iex-spec-a.md`. In kleinen
Phasen, jede einzeln rueckrollbar. Erst NACH B, weil die Budget-Engine bis dahin der Weg fuer
nicht umgestellte Tenants ist.
Achtung: `SKIP_TWILIO_SIGNATURE_CHECK` bleibt trotz Namens der globale `/voice`-Bypass, an dem
`boot-guard.js` haengt — nicht im Zuge der Loeschung mit entfernen.

## 6. Betriebswissen (sonst wiederholt man Fehler)

- **Prod-DB-Schreibzugriff wird vom Classifier blockiert** ("Modify Shared Resources"). Der Owner
  fuehrt solche Befehle per `!` aus. Lesen geht (`psql "$(cat ~/.config/hermes/db-url)"`,
  `BEGIN READ ONLY`, bei RLS `SET LOCAL app.current_tenant='<tenant>'`).
- **Render deployt UPSTREAM** (`git push upstream master`), `origin` macht nichts live. Vor dem
  Push immer `git fetch upstream` + merge: Jonas pusht aktiv auf `upstream/master` (apps/web).
  Ein Deploy nimmt IMMER den Zweigkopf — fremde Web-Commits gehen dabei mit live, das hat der
  Owner am 2026-09-17 einmalig freigegeben, nicht dauerhaft.
- **Deploy dauert ~6 min**; erst danach wirkt ein Env-Flip. Belegen ueber Boot-Banner
  (`mcp__render__list_logs`, Service `srv-d8m0fhflk1mc73bno570`, Workspace
  `tea-d8m0b9jeo5us73cvasg0`), nie ueber Vermutung. Schalter: `node scripts/iel-geheimnisse.mjs
  schalter --an|--aus --ausfuehren` + `mcp__render__trigger_deploy`.
- **Lint-Pre-Commit prueft den ganzen Arbeitsbaum** inklusive fremder untrackter Ordner
  ("Claude outputs/", docs/architektur/) -> committen aus einem sauberen Worktree, dorthin
  `node_modules` verlinken, nie `--no-verify`, nie `git add -A`.
- **Volle Testbank nur einmal, vom Lead, `--test-concurrency=2`.** Rot zaehlt nur, wenn isoliert rot.
- **Der Telnyx-MCP** braucht einen gueltigen V2-Key im Header; laeuft er auf 401, hilft
  `scripts/`-fremd das Skript im Scratchpad-Verlauf (Owner traegt den Key selbst ein).
  Nur Endpunkte mit operation "read" benutzen.
- **Hermes-MCP-Connector**: der Eintrag in Claude Code zeigte auf einen geloeschten Connector
  (404 "Server not found"). Richtige URL ist `https://app.sundartha.com/mcp` (POST dorthin
  antwortet 401 = korrekt). Neu verbinden macht der Owner in claude.ai.

## 7. Was NICHT offen ist

Ton, Eroeffnung, Owner-Erkennung, Sofortannahme und die Roboteransage sind erledigt und vom Owner
abgenommen. Nicht erneut aufrollen. Die Strategie mit den urspruenglich geplanten Phasen P3/P4/P5/P7
(Beleg-Werkzeug, Kontext/Werkzeuge inbound, Abnahmeprobe) steht in `tasks/iep-strategie.md` — sie
sind durch den bestandenen Testanruf UEBERHOLT und nur noch Nachschlagewerk, kein Auftrag.
