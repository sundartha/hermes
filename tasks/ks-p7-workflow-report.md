# KS-P7 — Sperrliste erweitern: Detailbericht

**Status:** Gate = PASS | `finalBranch` = `phase/ks-p7-sperrliste` | HEAD-Commit = `9dff546` | Basis = `master` (`7e1fdc0`, Regel 0 verifiziert)

Ziel der Phase: teure Anrufziele werden per Denylist abgewiesen statt (nur) per Tarif gebremst. Seit KS-P0/KS-P6 (Worst-Case-Tarif 300 -> 30 ct/min) schaetzt die Kosten-Achse mit UNSEREM Satz, nicht mit dem echten Zielpreis — bei sehr teuren Zielen (z.B. Kuba/ETECSA-Monopol) schuetzt sie nicht mehr. Die Denylist wird damit vom "Beifang" zum Hauptschutz.

---

## 1. Plan (gekuerzt)

**Befund am Code vor der Umsetzung:**
- Die Liste lebt in `src/telephony/number-denylist.js` — Blatt-Modul ohne Imports, Exporte `EMERGENCY_SHORT_CODES`, `deniedPrefix(to)`, `isDenied(to)`.
- Konsumenten: `src/telephony/outbound-gates.js` (`numberGateError`, erstes Gate vor E.164-Format, Land-Gate, Stundenlimit, Ziel-Cap, Verifikation) und `src/store/state-ops.js` (`normalizePrivateNumber`, laeuft vor der Laender-Allowlist).
- Kein Env-Schluessel, keine Doku-Stelle, keine Inbound-Wirkung, keine Trunk-0-Wechselwirkung.

**Zentraler Widerspruch im Plan-Doc, den die Phase aufloest:** Verifikationszeile verlangt "gewoehnliche Mobilnummern kommen durch", Umfang nennt aber `+53` (Kuba) als fehlend — fuer Kuba existiert keine billige Sub-Range, das ganze Ziel ist teuer. Aufloesung ueber zwei benannte Klassen:

- **Klasse 1 (`PREMIUM_PREFIXES`, Sub-Ranges):** Positivzusage bleibt woertlich — eine gewoehnliche Mobilnummer kommt durch.
- **Klasse 2 (`HIGH_COST_COUNTRY_PREFIXES`, ganze Laendercodes):** Positivzusage wird zu "kein Nachbarland wird mitgefangen"; die Erreichbarkeit des Ziellandes selbst ist der bewusst getragene Preis.

**Design-Entscheidungen:**
- D1: zwei benannte, modul-private Klassen -> EINE exportierte Union `DENIED_PREFIXES`, `deniedPrefix` laeuft nur einmal darueber (G5).
- D2: die zehn karibischen NANP-Vorwahlen ziehen verhaltensgleich von Klasse 1 nach Klasse 2 um (Praefixe disjunkt, Suchergebnis unveraendert; belegt durch unveraenderte GAP-18-Bestandstests).
- D3: Aufnahmekriterium = Terminierungspreis ueber dem Worst-Case-Tarif (`VOICE_TARIFF_DEFAULT_CENTS`, ~30 ct/min). Bewusst NICHT an den Env-Wert zur Laufzeit gekoppelt — eine per Env veraenderbare Sperrmenge waere ein aufweichbares Safety-Gate (Absolute Regel 1), zudem darf das Blatt-Modul `config.js` nicht importieren. Kriterium ist reine Kuratierungsregel im Kommentar.
- D4: der ueberholte Modulkommentar ("Beifang, NICHT der Hauptschutz") wird ersetzt, nicht relativiert.
- D5: keine neue Dependency, kein Env-Schluessel, kein Laufzeit-Feed (fail-open-Risiko).
- D6: nur ein neuer Export (`DENIED_PREFIXES`); die Klassen-Arrays bleiben modul-privat.

**Neue Eintraege:** `+878` (UPT, Klasse 1) sowie 24 ganze Laendercodes in Klasse 2 — u.a. `+53` Kuba (TOD-1-Szenario), `+509` Haiti, `+232/+236/+239/+240/+247/+252/+290/+291/+246` (Afrika/Suedatlantik/Ind. Ozean), `+670` Timor-Leste, `+850` Nordkorea, `+672/+674/+675/+677/+678/+681/+682/+683/+686/+688/+690` (pazifische Mikro-Destinationen). Dazu der verhaltensgleiche Umzug der zehn karibischen NANP-NPAs (`+1809,+1829,+1849,+1876,+1268,+1284,+1473,+1649,+1664,+1767`) von Klasse 1 nach Klasse 2.

**Bewusst NICHT aufgenommen:** `+800` (International Freephone, kein Kostenrisiko), `+679` Fidschi, `+685` Samoa, `+687` Neukaledonien, `+689` Franz.-Polynesien, `+691/+692` Mikronesien/Marshall, `+371/+373` (historisch belastet, heute gewoehnlicher Tarif — waere Ueberblockierung), `+871`–`+874` (stillgelegte Inmarsat-Codes, tote Eintraege).

**Verifikationsplan:** neuer Offline-Test (3 Konzepte: Negativ mit Praefix-Zuordnung, Positiv/Nachbarlaender, Struktur-Invariante E.164/Dubletten/Ueberdeckung), je ein Fall in `test/number-gate.test.js` (Gate-Praezedenz am HTTP-Pfad) und `test/p8-private-number-country-gate.test.js` (Zweitwirkung ueber `normalizePrivateNumber`), Pflicht-Mutationsprobe (`+53` entfernen -> muss rot werden).

---

## 2. Implementierung — Zusammenfassung

**Eine Code-Datei geaendert:** `src/telephony/number-denylist.js`.
- Modulkommentar korrigiert: Aufnahmekriterium, Klassenvertrag, "Beifang"-Satz entfernt statt relativiert.
- `PREMIUM_PREFIXES` behaelt Sub-Ranges, `+878` (UPT) neu neben `+979`.
- Neues Array `HIGH_COST_COUNTRY_PREFIXES`: die zehn umgezogenen Karibik-NPAs + 24 neue Hochpreis-Laendercodes.
- Neuer Export `DENIED_PREFIXES = [...PREMIUM_PREFIXES, ...HIGH_COST_COUNTRY_PREFIXES]`; `deniedPrefix` sucht jetzt ueber diese Union statt ueber `PREMIUM_PREFIXES` allein.
- Keine Signatur geaendert, keine Aufrufstelle in `outbound-gates.js`/`state-ops.js` angefasst.

**Tests:**
- Neu `test/ks-p7-high-cost-denylist.test.js` (3 Faelle, 0 Spawns, offline): 25 handgeschriebene Negativziele mit erwartetem Treffer-Praefix, 22 Positivziele (Nachbarlaender/Startmaerkte, u.a. Trinidad bewusst NICHT gesperrt), Struktur-Invariante (E.164-Form, keine Dublette, keine Praefix-Ueberdeckung).
- `test/number-gate.test.js` +1 Fall: `+53` -> 403 `grund=denylist` trotz `ALLOWED_COUNTRY_CODES=*` (ein Spawn).
- `test/p8-private-number-country-gate.test.js` +1 Fall: `normalizePrivateNumber("+53...")` wirft wegen geteilter Liste, nicht wegen Laendergate.

**Doku:** neuer Abschnitt `## KS-P7` am Ende von `PLAN-SECURITY.md` im etablierten Blockquote-Stil (Was/Warum/Kriterium/Regel-1-Bestaetigung/getragener Preis/Regressionsschutz).

**Ergebnisse:**
- `node --check` auf allen vier geaenderten `.js`-Dateien: gruen.
- Neuer Test: 3/3 pass.
- `test/number-gate.test.js`: 46/46 (GAP-18-Faelle unveraendert gruen -> Beweis Verhaltensgleichheit des NANP-Umzugs).
- `npm test` (Regressionslauf): 3590 pass / 0 fail.
- Mutationsprobe (`+53` entfernt): 3 Faelle rot (Offline-Negativtest, `normalizePrivateNumber`-Fall, Gate-Fall 403->500); Zeile zurueckgesetzt -> wieder gruen.
- Smoke gegen echt gespawnten Server: `+53`/`+50934567890`/`+878...` -> 403 blocked; `+4915...` (DE) und `+525512345678` (MX, Nachbar von `+53`) -> 500 (offline-Twilio-Fehler, d.h. alle Gates inkl. Denylist passiert, kein Nachbarland gefangen); `/healthz` -> 200.

**Deviations (aus dem Impl-Report, unveraendert uebernommen):**
1. Redaktionelle Korrektur eines jetzt ueberholten Kommentarsatzes im GAP-18-Block von `test/number-gate.test.js` ("PREMIUM_PREFIXES enthaelt ... zwoelf +1-Eintraege" -> war nach dem Umzug falsch, C2-Verstoss). Keine Assertion/kein Testname/kein Zielwert geaendert.
2. Erster Vollauf von `npm test` zeigte einen isolierten Fehlschlag in `test/telnyx-shim-route.test.js` (401 statt 404), unbeteiligte Datei; isoliert 4/4 gruen, Wiederholungslauf der Vollsuite 3590/0 gruen — nach etabliertem Gate-Protokoll ein Suite-Flake unter Last, kein Befund dieser Phase.
3. Worktree-Setup: Symlink-Befehl aus dem Vorgehen war fehlerhaft (selbstbezueglich), durch absoluten Link auf das Haupt-`node_modules` ersetzt; gitignored, nicht committet.
4. Kein separater pglite-Lauf noetig — pg-gestuetzte Tests bringen pglite in-process mit, `npm test` deckt beide Backends in einem Lauf ab.
5. `npx eslint` lief im Worktree wegen des Symlinks nicht durch (`ERR_MODULE_NOT_FOUND`) — Umgebungsproblem, kein Codebefund; Gate ist `npm test` und der ist gruen.

---

## 3. Safety-Urteil (final)

**Verdict: FREIGABE (approved).** Alle Einzelpruefungen positiv: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended` — alle `true`, keine Blocker.

Unabhaengiger Review-Lauf in frischem Worktree (`review-ks-p7` = `phase/ks-p7-sperrliste`, Basis exakt `master`, kein stale base): `npm test` 3590/0 (deckt sich exakt mit dem Impl-Bericht; der genannte Einzel-Flake trat im Review-Lauf gar nicht auf), `npm run test:gates` 126/3 rot — alle drei roten Faelle vorbestehende, unberuehrte Produktbefunde (GAP-05, 2x GAP-15) auf bekannter Basislinie. Eigene, unabhaengig durchgefuehrte Mutationsprobe (`+675` entfernt) bestaetigt: Test wird sofort rot, nach Ruecknahme wieder gruen — der Schutz haelt tatsaechlich etwas.

Diff-Umfang bestaetigt eng: 6 Dateien, genau eine Code-Datei. Denylist-Praezedenz und Gate-Reihenfolge in `outbound-gates.js` byte-identisch unveraendert. Offenlegungssatz unberuehrt (`claude.js`/`bridge.js` nicht im Diff). Keine Route/Middleware/Auth im Diff. Keine neue Dependency, kein `eslint-disable`, kein `.skip()`/`.only()`, keine DB-Migration, keine Owner-Handlung vor Deploy.

**Concerns (keiner blockierend):**
1. **Ueberblockierungs-Risiko ist die eigentliche Kante der Phase, nicht maschinell pruefbar.** Klasse 2 sperrt 24 ganze Laender inkl. gewoehnlicher Mobilnummern (weit ueber 60 Mio. erreichbare Menschen). Das Plan-Doc nennt namentlich nur `+53, +252, +509, +675` als Luecke; die uebrigen 20 sind ueber "ergaenzend zu pruefen" gedeckt. Ob sie tatsaechlich ueber 30 ct/min terminieren, ist externes Kuratierungswissen, das der Code nicht verifizieren kann. **Empfehlung: Owner bestaetigt die Liste einmal explizit vor dem Deploy** — es gibt keine Notausnahme (kein Env-Schalter, keine per-Tenant-Freischaltung, beides bewusst).
2. Der "Abweichung vom Plan"-Abschnitt des Impl-Berichts nennt nur die redaktionelle Kommentar-Aenderung, nicht die substanzielle Abweichung: der Plan verlangt in der Verifikationszeile woertlich "nie mit ganzen Laendercodes" — gebaut wurde bewusst das Gegenteil (Klasse 2) mit umdefinierter Positivzusage. Sachlich gedeckt (derselbe Plan benennt dieselben Laendercodes als Luecke), aber an der Stelle, die genau dafuer da ist, nicht benannt.
3. C2-artiger Rest-Widerspruch im neuen Kommentar selbst: Klasse-1-Kommentar behauptet "NIE ein ganzer Laendercode", enthaelt aber `+870/+878/+881/+882/+883/+979` (vollstaendige nicht-geografische Weltbereichscodes). Durch den Zusatztext aufgeloest, aber der absolute Satz bleibt daneben stehen. Rein redaktionell.
4. Geteilte Zweitwirkung ueber `normalizePrivateNumber`: Tenants in Klasse-2-Laendern koennen keine private Summary-SMS-Nummer setzen. Korrekt dokumentiert und getestet, aber ein Onboarding-Riegel, nicht nur ein Kosten-Riegel.
5. Kein Nachfuehrungs-Mechanismus: die Liste ist jetzt Hauptschutz, ihre Pflege bleibt reine Kommentar-Zusage ohne Review-Anker oder Ueberblockierungs-Metrik. Fuer die naechste Kette vormerken.

---

## 4. Clean-Code-Audit (final)

**Verdict: PASS — keine Verstoesse gefunden.** `s1`, `s2`, `s3`, `s4` alle leer, `blocker: false`.

Begruendung: Diff eng auf `number-denylist.js` plus passende Tests/Doku begrenzt. Zwei benannte, modul-private Klassen, eine exportierte Union, `deniedPrefix` laeuft nur einmal darueber (G5 sauber). Keine neue Signatur, kein Caller gebrochen (grep bestaetigt). Kommentar korrigiert statt nur ergaenzt (C2 sauber, auch der GAP-18-Kommentarkopf im Testfile mitkorrigiert). Aufnahmekriterium als Kuratierungsregel dokumentiert, bewusst nicht an `config.js`/Env gekoppelt (Blatt-Modul-Prinzip gewahrt). Alle 52 relevanten Tests lokal gruen inkl. Struktur-Invariante und Ueberblockierungs-Schutz. Grenzfaelle abgedeckt (Land-Gate-Reihenfolge, geteilte Liste bei privater Nummer, Denylist schlaegt auch bei `*`). Bewusst getragener Preis explizit in Plan/Report dokumentiert, keine versteckte Owner-Entscheidung. `node --check` fehlerfrei.

**Offene Todos aus dem Audit:** keine — Phase kann gemergt werden.

---

## 5. Fix-Runden

Keine. Der Impl-Lauf war beim ersten Durchgang gruen (bis auf den unter Deviation 2 dokumentierten, isoliert widerlegten Suite-Flake), Safety-Review kam direkt auf FREIGABE ohne Blocker, Clean-Code-Audit kam direkt auf PASS ohne S1/S2-Befunde. Es waren keine Fix-Iterationen noetig.

---

## 6. Offene Punkte fuer den Lead / naechste Schritte

- KS-P7 ist **Vorbedingung von KS-P3** (Aufhebung der festen Zeitgrenze) — Reihenfolge im `PLAN-KOSTEN-STEUERUNG.md`-Ausfuehrungsblock beachten.
- Die `ERLEDIGT`-Markierung in `PLAN-KOSTEN-STEUERUNG.md` ist bewusst nicht gesetzt — braucht den Merge-Commit, ist Lead-Aufgabe.
- Empfehlung aus dem Safety-Review: vor dem Deploy einmalige explizite Owner-Bestaetigung der 20 nicht namentlich im Plan genannten Klasse-2-Laender (Ueberblockierungsrisiko ohne Notausnahme).
- Fuer eine spaetere Kette vormerken: Nachfuehrungs-/Review-Mechanismus fuer die Denylist (kein Auslauf-Anker, keine Ueberblockierungs-Metrik heute).
