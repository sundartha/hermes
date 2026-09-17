# Spec: Paket B - Inbound fuer alle Kunden freischalten

Auftrag und Rahmen: `tasks/kickoff-iep-abschluss.md` §5 B. Runbook: `tasks/iex-spec-a.md` §7 (b).
Diese Datei traegt die autoritative Definition der Bauphase IEX-B1; der Rollout selbst (b1-b7)
ist Lead-Arbeit am lebenden System, kein Workflow.

## Leitentscheidung

Der Rollout ist **nicht** nur ein Schalter. Owner-Entscheidung 13 (tasks/todo.md) hat den
Vorschlag F10 aus `tasks/iep-strategie.md:1101` uebernommen:

> (a) Betreiber-Alarm fuer gescheiterte Inbound-Uebergaben - **ja, als kleine eigene Phase vor
> dem Rollout**; (b) Benachrichtigung, wenn jemand in der Wartephase auflegt - **nein**.
> *Folge:* ohne Entscheidung bleibt der Rollout gesperrt, unabhaengig vom Owner-Test.

Der Grund steht in `tasks/iex-spec-a.md` §9 F3: der Ausfall-Melder kennt heute nur Outbound
(am Code belegt, `src/telephony/outage-detection.js` zaehlt `direction !== "outbound"` weg).
Nach dem Rollout haengt der eingehende Verkehr ALLER Tenants am EL-Pfad — ein Totalausfall
faellt dann niemandem auf, weil O3 jede Tenant-/Owner-Benachrichtigung verbietet und im Log
nur sucht, wer schon weiss, dass etwas kaputt ist.

## Stand am lebenden System (gemessen 2026-09-17/18, Lead)

Boot-Banner des letzten Deploys (2026-09-17T17:29Z): `Inbound-EL: an, 1 Tenants, scope=allowlist`.

Drei aktive DIDs in der Prod-DB (`number.status='active'`, je Tenant mit
`SET LOCAL app.current_tenant` gelesen):

| Tenant | Name | DID | `el_inbound_trunk_belegt_at` |
|---|---|---|---|
| `owner` | Plattform-Tenant | +18643028341 | — |
| `t_user_01KX600834GCJFV9GTZQKWZMTH` | Owner-Tenant, Business-Abo | +17067101188 | 2026-09-15, Fingerabdruck vorhanden |
| `t_user_01KZRNWDJA5MW3C206CK5992W6` | Fremd-Tenant, Business-Abo (Name im Dashboard) | +15804504874 | — |

Damit ist die Frage aus dem Kickoff ("sind alle aktiven Kunden-DIDs bei ElevenLabs
registriert?") **beantwortet: nein** — eine von drei. Die beiden anderen bekommen ihre
Registrierung im Rollout-Schritt b3.

## Owner-Entscheidungen zu Paket B (2026-09-17)

17. **Voller Rollout auf alle drei aktiven DIDs**, einschliesslich der Kundennummer des
    Fremd-Tenants `t_user_01KZRNWDJA5MW3C206CK5992W6`. Danach laeuft jede kuenftige
    registrierte DID automatisch ueber den EL-Pfad. (Die Teil-Varianten "nur unsere zwei"
    und "erst den Kunden fragen" sind
    ausdruecklich verworfen — sie haetten einen Fremdkunden auf der Budget-Engine
    zurueckgelassen und damit Paket C blockiert.)
18. **Zweiter Bestaetigungsanruf (Runbook b6, Messung M-B.d) auf +18643028341**, die DID des
    `owner`-Tenants. Kein Testanruf an die Kundennummer.
19. Unveraendert bindend aus dem Kickoff: keine SMS-Welle beim Rollout (Entscheidung 15),
    kein Nummernwechsel/Nummernkauf (Entscheidung 3).

## Vorbedingungen des Runbooks (b), Stand 2026-09-18

`tasks/iex-spec-a.md` §7 (b) nennt vier Vorbedingungen. Drei sind erledigt, eine ist diese Phase:

| Vorbedingung | Stand | Beleg |
|---|---|---|
| (a) GRUEN inkl. M-U1 | **erfuellt** | Owner-Testanruf 2026-09-17 bestanden ("funktioniert alles"), Offenlegung vollstaendig gehoert |
| M-S3 positiv ODER IEX-A4b live | **erfuellt, ohne zusaetzlichen Testanruf** | IEP-P2 hat die Sofortannahme fest verdrahtet: `EL_DIAL_ANSWER_ON_BRIDGE = false` in `src/elevenlabs/inbound-rueckfall.js`. Das ist genau die Wirkung, die IEX-A4b haette herstellen sollen; der Messanruf a7a entfaellt damit |
| IEX-A12 gemergt | **durch Ersatz erfuellt** | IEX-A12 ("Inbound-Satz = Outbound-Satz") wurde nie als solche gebaut; an ihre Stelle trat IEP-P6 (Eroeffnung im Owner-Wortlaut, Owner-Entscheidung 9), gemergt und am Testanruf abgenommen. Der aeltere O1-Wortlaut ist ueberholt |
| §9 F3 und F4 entschieden | **entschieden** | Owner-Entscheidung 13 = F10 aus `iep-strategie.md`: F3 ja (diese Phase IEX-B1), F4 nein |

Damit ist IEX-B1 die **einzige verbliebene Bauarbeit** vor dem Rollout.

---

## Phase IEX-B1 - Betreiber-Alarm fuer gescheiterte Inbound-Uebergaben

### Ziel

Ein systematischer Ausfall des EL-Inbound-Pfads loest denselben Betreiber-Alarm aus wie ein
Outbound-Ausfall — mit eigener Klasse, eigenem Marker und Schwellen, die zum Inbound-Verkehr
passen. Ohne diese Phase bleibt der Rollout gesperrt.

### Datenfluss (Bestand, am Code belegt)

- `src/telephony/outage-detection.js` ist die EINE Erkennungsregel: rein, IO-frei,
  zeit-injiziert. `outageWindow()` baut das Zeitfenster, `beurteileAusfall()` faellt das
  Urteil (K0 Erstbefund / K1 kleines Volumen / K2 Anteil bei Skala), `alarmZeile()` ist der
  PII-freie Body-Vertrag. Der Versand ist bewusst getrennt
  (`src/telephony/outage-report.js`).
- `openOutageAlert(state, code)` (`src/store/state-ops.js:2952`) sucht den offenen Marker
  **je `code`**. Eine zweite Klasse bekommt damit ohne Schema-Aenderung einen eigenen
  Marker; die Tabelle `outage_alert` bleibt unveraendert.
- Der Zustand einer eingehenden EL-Bruecke steht in `bridgeStateOf(call)`
  (`src/elevenlabs/inbound-bridge-state.js`): `KEIN_EL_INBOUND`, `WARTET`, `GEBUNDEN`,
  `RUECKFALL`. Der Rueckfall-Marker wird an genau einer Stelle gesetzt
  (`vermerkeUebergabeGescheitert`, `src/elevenlabs/inbound-uebergabe-gescheitert.js`),
  zusammen mit dem Fehlergrund `el_uebergabe_gescheitert`.

### Der Kernpunkt dieser Phase (nicht uebersehen)

**Die Outbound-Definition von "Erfolg" ist fuer Inbound falsch und wuerde einen blinden
Alarm bauen.** `outageWindow()` zaehlt heute `call.answeredAt` als Erfolgsbeleg. Seit IEP-P2
(Sofortannahme, kein `answerOnBridge`) ist das Anrufer-Bein ab dem TeXML beantwortet — jeder
eingehende Anruf traegt `answeredAt`, auch der, dessen Uebergabe danach scheiterte. Wer
`outageWindow` unveraendert auf Inbound loslaesst, bekommt eine Regel, die NIE ausloest und
dabei gruen aussieht.

Fuer Inbound gilt stattdessen:

| Groesse | Beleg |
|---|---|
| Nenner (`versuche`) | eingehende Anrufe auf dem EL-Kostenprofil, im Fenster beendet |
| `erfolge` | `bridgeStateOf(call) === GEBUNDEN` — die Uebergabe hat stattgefunden |
| `fehler` | `bridgeStateOf(call) === RUECKFALL` — unsere eigene Stelle hat das Scheitern vermerkt |

`WARTET` am Ende ist **kein Fehler-Beleg**: `tasks/iex-spec-a.md` §9 F4 haelt fest, dass
"Anrufer legt in der Wartephase auf" mit persistierten Feldern nicht von einem gescheiterten
Dial zu trennen ist. Owner-Entscheidung F10b sagt dazu "nicht benachrichtigen". Ein normales
Auflegen darf keinen Betreiber-Alarm erzeugen — sonst verlernt der Betreiber, hinzusehen, und
der echte Ausfall geht im Rauschen unter. Wie `WARTET` in den Zahlen sichtbar bleibt, ohne
die Alarm-Bedingung zu treiben, entscheidest du im Plan und begruendest es.

### Scope

1. Die Richtungs- und Erfolgsdefinition wird zum **Parameter der einen Regel**, nicht zu einer
   zweiten Kopie. `outageWindow()` darf verallgemeinert werden; `beurteileAusfall()`,
   `meldeErlaubt()`, die Entprellung und `alarmZeile()` bleiben geteilt (G5: keine zweite
   getippte Fristlogik, keine zweite Body-Formulierung). Der Outbound-Pfad bleibt dabei
   **verhaltensgleich** — sein Urteil aendert sich fuer keine Eingabe.
2. Eine eigene Alarm-Klasse (`code`) fuer den Inbound-EL-Ausfall, damit Marker, Entprellung
   und Erholung nicht mit dem Outbound-Alarm kollidieren.
3. Eigene Schwellen in `src/config.js`, in `.env.example` dokumentiert, mit demselben
   Rollback-Hebel wie Outbound (`windowMs === 0` schaltet die Regel ab). Werte begruendet
   am erwarteten Inbound-Volumen, nicht abgeschrieben.
4. Auswertung und Versand haengen am bestehenden Betreiber-Meldeweg
   (`src/telephony/outage-report.js`). Wo die Auswertung ausgeloest wird, entscheidest du am
   Bestand (dort, wo der Outbound-Ausfall heute ausgewertet wird).
5. Tests.

### NICHT-Scope

- Jede Tenant- oder Owner-Benachrichtigung (O3 verbietet sie; Entscheidung 15 verbietet
  zusaetzlich jede SMS-Welle).
- Der Rollout selbst (b1-b7), Registrierungen, Scope-Flip, Deploy, Env-Aenderungen.
- Aenderungen am Outbound-Ausfall-Verhalten, an Schwellen oder am Meldeweg des Outbound-Alarms.
- Die Wartephasen-Benachrichtigung aus F4/F10b (ausdrueckliches "nein").
- `EL_MIN_CONVERSATION_MS` und andere Turn-Parameter.

### Invarianten (pruefbar)

- I1: Der Outbound-Ausfall-Pfad ist verhaltensgleich. Die Bestandstests zu
  `outage-detection`/`outage-report` bleiben **ohne Anpassung** gruen. Muss ein Bestandstest
  angefasst werden, ist die Verallgemeinerung falsch geschnitten — im Plan begruenden oder
  anders schneiden.
- I2: Der Alarm-Body bleibt PII-frei: keine E.164, kein Tenant-Bezeichner, keine Call-ID,
  kein Anbieter-Rohtext. `alarmZeile()` bleibt die einzige Formulierung.
- I3: Kein Tenant und kein Owner bekommt aus dieser Phase eine Nachricht, SMS oder Mail.
- I4: `windowMs === 0` schaltet die neue Regel vollstaendig ab (Rueckweg ohne Deploy von Code).
- I5: Die Tabelle `outage_alert` bekommt keine neue Spalte.
- I6: `node --check` auf jede geaenderte Datei; `npm test -- --test-concurrency=4` gruen.

### Testpflicht

- Ein Test, der **den blinden Alarm verhindert**: ein Fenster aus lauter gescheiterten
  Uebergaben, bei denen `answeredAt` gesetzt ist, muss ALARM ergeben. Genau dieser Fall
  waere mit der Outbound-Erfolgsdefinition stumm geblieben — er ist der Kern der Phase.
- Ein Test, der zeigt, dass normales Auflegen in der Wartephase KEINEN Alarm erzeugt.
- Ein Test, dass eine gesunde Inbound-Reihe (alles `GEBUNDEN`) kein Urteil ALARM ergibt und
  eine offene Klasse als erholt geschlossen wird.
- Ein Test, dass Outbound- und Inbound-Klasse getrennte Marker fuehren (ein offener
  Outbound-Alarm entprellt den Inbound-Alarm nicht und umgekehrt).
- Ein Test fuer den Abschalt-Hebel (`windowMs === 0`).

### Abnahmekriterium (deterministisch)

1. `npm test -- --test-concurrency=4` gruen, Exit 0.
2. Die Bestandstests zu `outage-detection`/`outage-report` sind im Diff **unveraendert**.
3. `git diff --stat <BASE>..HEAD` beruehrt keine Datei ausserhalb von
   `src/telephony/`, `src/config.js`, `.env.example`, `test/` (Ausnahmen im Plan begruendet).

### Risiko / Pre-Mortem (ein Jahr spaeter gescheitert)

- **R1 — der Alarm hat nie ausgeloest**, weil "Erfolg" fuer Inbound als `answeredAt`
  definiert wurde und seit der Sofortannahme jeder Anruf beantwortet ist. Ein halbes Jahr
  lang stand ein gruenes Waechter-Modul neben einem toten Inbound-Pfad. Gegenmittel: der
  Kernpunkt oben + der erste Pflichttest. **Groesstes Risiko dieser Phase.**
- **R2 — der Alarm hat so oft ausgeloest, dass niemand mehr hinsah**, weil jedes Auflegen in
  der Wartephase als Fehler zaehlte. Gegenmittel: `WARTET` ist kein Fehler-Beleg + zweiter
  Pflichttest.
- **R3 — der Alarm hat eine Kundennummer oder Transkript-Bruchstuecke nach draussen
  getragen.** Gegenmittel: I2, geteilter Body-Vertrag.
- **R4 — der neue Alarm hat den Outbound-Alarm verstummen lassen**, weil beide sich einen
  offenen Marker teilten und die Entprellung des einen den anderen unterdrueckte.
  Gegenmittel: eigene Klasse + Trennungs-Test.
- **R5 — die Verallgemeinerung hat den Outbound-Ausfall subtil verschoben** (andere
  Eimer-Bildung, anderer Nenner) und wurde erst beim naechsten echten Ausfall bemerkt.
  Gegenmittel: I1 (Bestandstests unveraendert gruen).

### Offene Review-Concerns

- Die Schwellen sind eine Schaetzung ohne Inbound-Verkehrsdaten (heute laeuft genau ein
  Tenant ueber EL). Im Plan benennen, welche Annahme dahintersteht und wo sie nachgezogen
  wird, wenn nach dem Rollout echte Zahlen vorliegen.
- Beruehrt die Phase den Auswerte-Ausloeser des Outbound-Alarms, ist zu belegen, dass dessen
  Taktung unveraendert bleibt.
