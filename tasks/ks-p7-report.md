# KS-P7 — Sperrliste erweitern (Phasenbericht)

Basis: `master` = `7e1fdc0`. Branch `phase/ks-p7-sperrliste`.

## Was gebaut wurde

Eine Code-Datei: `src/telephony/number-denylist.js`.

- **Klasse 1 `PREMIUM_PREFIXES`** (Sub-Ranges) bleibt, bekommt `+878` (UPT) neben `+979`.
- **Klasse 2 `HIGH_COST_COUNTRY_PREFIXES`** ist neu: ganze Laendercodes bzw. vollstaendige
  Laender-NPAs. Die zehn karibischen NANP-Vorwahlen ziehen aus Klasse 1 hierher um
  (verhaltensgleich), dazu kommen 24 neue Hochpreis-Laendercodes.
- **`DENIED_PREFIXES`** ist die exportierte Union; `deniedPrefix` laeuft einmal darueber
  (G5). Die beiden Klassen-Arrays bleiben modul-privat (G8).
- Der Modulkommentar wurde korrigiert, nicht ergaenzt: der Satz "Beifang, NICHT der
  Hauptschutz" war nach KS-P0/KS-P6 falsch (C2) und ist entfernt.

Keine Signatur geaendert, keine Aufrufstelle angefasst, kein Env-Schluessel, keine
Dependency, keine DB-Migration, keine Owner-Handlung vor dem Deploy.

## Aufnahmekriterium (Kuratierungsregel, D3)

Aufgenommen wird ein Ziel, dessen Terminierungspreis **ueber dem Worst-Case-Tarif liegt,
mit dem wir reservieren und buchen** (`VOICE_TARIFF_DEFAULT_CENTS`, Groessenordnung
30 ct/min seit KS-P0/KS-P6). Genau fuer diese Menge schuetzt die Kosten-Achse nicht mehr:
sie schaetzt mit UNSEREM Satz, nicht mit dem echten Zielpreis.

Das Kriterium ist **bewusst NICHT** an den Env-Wert gekoppelt. Eine per Env veraenderbare
Sperrmenge waere ein aufweichbares Safety-Gate (Absolute Regel 1), und das Blatt-Modul darf
`config.js` nicht importieren — das ist der ausdrueckliche Grund seiner Existenz (die
config-freie Store-Schicht konsumiert dieselbe Liste).

## Aufgenommene Ziele

Klasse 1 (neu): `+878` UPT — nicht-geografischer Weltbereich ohne gewoehnliche Teilnehmer.

Klasse 2 (24 neu): `+53` Kuba (ETECSA-Monopol, das Szenario aus TOD 1), `+509` Haiti,
`+232` Sierra Leone, `+236` Zentralafrikanische Republik, `+239` Sao Tome und Principe,
`+240` Aequatorialguinea, `+247` Ascension, `+252` Somalia, `+290` St. Helena/Tristan da
Cunha, `+291` Eritrea, `+246` Diego Garcia, `+670` Timor-Leste, `+850` Nordkorea,
`+672` Norfolk, `+674` Nauru, `+675` Papua-Neuguinea, `+677` Salomonen, `+678` Vanuatu,
`+681` Wallis und Futuna, `+682` Cookinseln, `+683` Niue, `+686` Kiribati, `+688` Tuvalu,
`+690` Tokelau.

## Bewusst NICHT aufgenommen (fuer die naechste Nachfuehrung)

- `+800` International Freephone — der Anrufer zahlt nichts, kein Kostenrisiko.
- `+679` Fidschi, `+685` Samoa, `+687` Neukaledonien, `+689` Franzoesisch-Polynesien,
  `+691` Mikronesien, `+692` Marshallinseln — Pazifik, aber unter der Schwelle; sie dienen
  im Test sogar als Positivziele gegen Ueberblockierung.
- `+371`/`+373` — historisch IRSF-belastet, heute gewoehnliche EU-/Nachbartarife; Aufnahme
  waere reine Ueberblockierung.
- `+871`–`+874` — stillgelegte Inmarsat-Ozean-Codes, waeren tote Eintraege (G9).

## Bewusst getragener Preis

Klasse 2 sperrt ganze Laender, auch gewoehnliche Mobilnummern. **Diaspora-Anrufe nach Kuba
und Haiti sind damit nicht moeglich.** Zweitwirkung: ein Tenant in einem betroffenen Land
kann keine private Summary-SMS-Nummer setzen (`normalizePrivateNumber` teilt dieselbe
Liste, `isDenied` laeuft dort VOR der Laender-Allowlist). Eine per-Tenant-Freischaltung
waere eine eigene Phase und ist hier bewusst NICHT gebaut — sie wuerde das Gate abschaltbar
machen.

Der Positivtest-Anspruch ist entsprechend nach Klasse getrennt: Klasse 1 verspricht
woertlich "eine gewoehnliche DE/UK/FR/US/ES/NANP-Nummer kommt durch"; Klasse 2 verspricht
"kein NACHBARLAND wird mitgefangen".

## Verifikation

- `node --check` auf alle vier geaenderten/neuen `.js`-Dateien: gruen.
- `node --test test/ks-p7-high-cost-denylist.test.js`: 3/3 gruen (25 Negativziele,
  22 Positivziele, Struktur-Invariante Format/Dublette/Ueberdeckung).
- `node --test test/number-gate.test.js`: 46/46 gruen — die GAP-18-Faelle (Negativ- UND
  Positivtest ueber alle zehn Karibik-NPAs) blieben in ihren Assertions unveraendert. Das
  ist der Beweis, dass der Umzug in Klasse 2 verhaltensgleich war.
- `npm test`: **3590 pass / 0 fail**. (Ein erster Lauf zeigte EINEN Fehlschlag in
  `test/telnyx-shim-route.test.js` — 401 statt 404, eine Datei, die diese Phase nicht
  beruehrt. Isoliert 4/4 gruen, im Wiederholungslauf der Vollsuite ebenfalls gruen:
  Suite-Flake unter Voll-Last, kein Befund dieser Phase.)
- Smoke gegen einen echt gespawnten Server: `+53`/`+509`/`+878` -> 403 "is blocked";
  `+4915112345678` (DE) und `+525512345678` (MX) -> 500 (alle Gates inkl. Denylist
  passiert, offline Twilio); `/healthz` 200.

### Mutationsprobe (Pflicht)

`"+53",` aus `HIGH_COST_COUNTRY_PREFIXES` entfernt:

- `test/ks-p7-high-cost-denylist.test.js` -> Negativtest ROT,
- `test/p8-private-number-country-gate.test.js` -> neuer KS-P7-Fall ROT,
- `test/number-gate.test.js` KS-P7-Gate-Fall -> ROT (403 erwartet, 500 erhalten).

Zeile wieder eingesetzt, alle drei gruen. Der Schutz haelt also wirklich etwas.

## Was NICHT deterministisch pruefbar ist

Ob die 25 gewaehlten Ziele tatsaechlich teurer als 30 ct/min terminieren, ist ein
Telefonie-Fakt aus externer Kuratierung — genau wie beim Bestand. Der Code kann ihn nicht
verifizieren. Die Kuratierungsregel oben und die Liste der bewusst ausgelassenen Kandidaten
sind die Nachvollziehbarkeit fuer die naechste Nachfuehrung.

## Reihenfolge

**KS-P7 ist Vorbedingung von KS-P3** (Anheben der Zeitgrenze). Wird die Zeitgrenze gehoben,
bevor diese Liste steht, waechst die Exposition auf genau den Zielen, gegen die die
Kosten-Achse seit KS-P0/KS-P6 nicht mehr schuetzt.

## Abweichung vom Plan

Eine, rein redaktionell: der Kommentarkopf des GAP-18-Blocks in `test/number-gate.test.js`
behauptete "PREMIUM_PREFIXES enthaelt seit GAP-18 zwoelf '+1'-Eintraege". Nach dem Umzug
stehen zehn davon in Klasse 2; der Satz waere ein C2-Verstoss (ueberholter Kommentar) —
also genau der Defekt, den diese Phase am Modulkommentar behebt. Der Kommentar ist auf
"die Denylist" umgestellt und nennt den Umzug. **Keine Assertion, kein Testname, kein
Zielwert geaendert** — die Verhaltensgleichheits-Zusage aus Plan 4.4 bleibt unberuehrt.
