# P-011 Fragerunden

## Runde 1

1. Absicht (Entwurf): „Ein Anruf an eine kanadische Nummer, deren Vorwahl ganz in einer Zeitzone liegt, die Hermes schon kennt (Eastern, Central, Mountain, Pacific), bekommt dieselbe bestätigungspflichtige Zeitzonen-Vermutung wie eine US-Nummer, damit der Anrufagent Termine nicht ohne Zone aushandeln muss. Für US-Nummern, für Nummern ohne bekannte Vorwahl und für Vorwahlen über mehrere Zonen bleibt alles byte-gleich. Keine Abkürzung über neue Zonen (Atlantic, Neufundland, Saskatchewan) oder über die Land-Ableitung für +1. Im Zweifel bekommt eine Vorwahl keine Vermutung: keine Zone ist besser als eine falsche.“ Empfehlung: ja, weil sie Umfang, Bleibt-Grenze und die Wahlregel im Zweifel in einem Text nennt.
2. Kanadische Vorwahlen tragen die vorhandenen Zonen-Kennungen (`America/New_York`, `America/Chicago`, `America/Denver`, `America/Los_Angeles`), nicht `America/Toronto` usw. Der Agent liest dann für Toronto „probably in the America/New_York time zone“ und fragt „I have you down as Eastern time - is that right?“. Empfehlung: ja, weil die Regeln seit 2007 gleich sind, `spokenTimezoneName` unverändert bleibt und neue Kennungen ohne neuen gesprochenen Namen „I have you down as America/Toronto“ ergäben (Rückfall `|| zone`, `src/elevenlabs/nanp-area-codes.js:94`).
3. Liste der Vorwahlen (Quelle: Wikipedia „Telephone numbers in Canada“, gelesen 25.10.2026; CNAC hat nur Kartenbilder): Eastern ON 416 647 437 942 905 289 365 742 613 343 753 519 226 548 382 705 249 683, QC 514 438 263 450 579 354 819 873 468; Central MB 204 431 584; Mountain AB 403 587 780 825 368; Pacific BC 604. Ausgelassen, weil die Vorwahl Gebiete in einer zweiten Zone deckt: 807 (Nordwest-Ontario Central), 418 581 367 (Magdalenen-Inseln/Blanc-Sablon Atlantic), 250 778 236 672 257 (Ost-/Nordost-BC Mountain), 867 (Territorien). Empfehlung: ja, weil das der Regel der US-Liste folgt (gemischte Vorwahlen wie 850, 915, 906 fehlen dort auch).
4. Restfehler der Liste hinnehmen: 403 und 819 haben einzelne Nummernblöcke regionaler Anbieter in den Territorien (andere Zone). Empfehlung: ja, weil die Vermutung im Gespräch immer bestätigt wird, bevor eine Uhrzeit fällt (`src/elevenlabs/outbound.js:257-258`), und 403/819 sonst Calgary und West-Quebec verlören.
5. Szenarien über `POST /api/calls`, sichtbar in `callee_timezone` des Anrufstarts am Anbieter: S1 Toronto `+14165550147` → Eastern, S2 Winnipeg `+12045550147` → Central, S3 Calgary `+14035550147` → Mountain, S4 Vancouver `+16045550147` → Pacific. Kein Tabellentest über alle 36 Vorwahlen. Empfehlung: ja, weil eine Vorwahl je Zone jede neue Zonenzuordnung über den echten Eingang belegt und Tests keine internen Module neu importieren sollen.
6. Bleibt-Szenarien: B1 US `+12125550147` → `callee_timezone` byte-gleich zu heute; B2 `+15555550147` (unbekannt) → Satz „You do not know which time zone …“ byte-gleich; B3 ausgelassene kanadische Vorwahlen `+18075550147`, `+14185550147`, `+12505550147`, `+13065550147`, `+19025550147`, `+18675550147` → derselbe Satz byte-gleich. Empfehlung: ja, weil B3 verhindert, dass der Bau die gemischten Vorwahlen oder die Nicht-Ziel-Zonen still mitnimmt.
7. Es entsteht kein Design Doc (Kopf „Design Doc: nein“, `design.md` nur mit „Ausgangslage und Annahmen“). Empfehlung: ja, weil es eine Datentabelle in einer Datei erweitert, es nur einen ernsthaften Weg gibt und sich die Änderung mit einem Revert zurücknehmen lässt.

### Antworten Runde 1
Betreuung (25.10.2026, im Auftrag von Antonio): „Runde 1 wie empfohlen (1–7 ja).“
1. ja (Absicht wie Entwurf)
2. ja
3. ja
4. ja; Zusatz: den Grund (Vermutung wird vor jeder Uhrzeit bestätigt, `src/elevenlabs/outbound.js:257-258`) und die zwei Vorwahlen 403 und 819 wörtlich in Pitch und Sicherheitsprüfung.
5. ja
6. ja
7. ja (kein Design Doc)

## Runde 2 (Premortem, Vorschläge „hingenommen“)

1. PM4 hinnehmen, mit berichtigter Begründung: Für einen Yukon-Block in 403 fängt die Bestätigung den Fehler nicht ab, weil Yukon ganzjährig UTC-7 als „Mountain Standard Time“ führt, auf „I have you down as Mountain time - is that right?“ also mit Ja antwortet, der Agent im Sommer aber nach `America/Denver` (UTC-6) rechnet. Falle-Text: „Die Bestätigung fängt den Fall nicht ab, wenn der Zonenname passt. Hingenommen, weil es nur einzelne Nummernblöcke sind und 403 sonst Calgary verlöre.“ Empfehlung: ja, weil kein Eingang einen Nummernblock innerhalb einer Vorwahl unterscheidet und der Fehler auf einzelne Blöcke regionaler Anbieter begrenzt ist.
2. PM5 hinnehmen, mit Ergänzung der Falle: der Restfehler gilt ebenso für die Überlagerungen 873 und 468 (zu 819) sowie 587, 825 und 368 (zu 403 und 780). Empfehlung: ja, weil die Entscheidung zu 403/819 sonst für dieselben Gebiete nicht dokumentiert wäre und eine spätere Korrektur sie übersähe.
3. PM6 hinnehmen, mit Eintrag unter „Kann warten“: Wechsel auf `America/Toronto`, `America/Winnipeg`, `America/Edmonton`, `America/Vancouver` mit gesprochenen Namen, sobald sich deren Regeln von den US-Zonen unterscheiden (etwa durch ganzjährige Sommerzeit nur auf einer Seite). Empfehlung: ja, weil heute die Regeln gleich sind und die tzdata-Abweichung erst mit einer Gesetzesänderung entsteht.
4. PM7 hinnehmen: Der Agent kann einem Angerufenen in Toronto einen Termin als „10 a.m. New York time“ wiederholen, weil der Satz die Kennung `America/New_York` nennt. Empfehlung: ja, weil das bei US-Nummern außerhalb New Yorks heute genauso gilt und den Satz zu ändern eine eigene Änderung an `src/elevenlabs/outbound.js` wäre (Absicht: Satz byte-gleich).

### Antworten Runde 2
Betreuung (25.10.2026, im Auftrag von Antonio):
1. nein (PM4 nicht hinnehmen): „wo die Bestätigung den Fehler nicht abfängt, ist ‚Zone unbekannt‘ (heutiges Verhalten, Agent bleibt vage) sicherer als eine bestätigte falsche Zone. Also 403 und die Überlagerungen, die 403 mitbedienen (587, 825, 368), nicht aufnehmen; 780 nur, wenn es selbst keine Territorien-Blöcke hat (belegen, sonst auch raus). S3 auf eine aufgenommene Mountain-Vorwahl umstellen, die weggelassenen in B3.“ Umgesetzt: 780 belegt nur Alberta (Wikipedia „Area code 780“, gelesen 25.10.2026), S3 auf `+17805550147` (Edmonton), B3 um 403, 587, 825, 368 auf 23 Vorwahlen, Liste 36 → 32.
2. ja für 819 mit 873/468.
3. ja.
4. ja.

## Vorher-Rot
- S1: heute `callee_timezone` = Satz „You do not know which time zone …“ statt „probably in the America/New_York time zone“, `timezoneHypothesisForNumber("+14165550147")` = `""` (`src/elevenlabs/nanp-area-codes.js:87-91`, `src/elevenlabs/outbound.js:262-266`), nachgestellt 25.10. 06:06 am master 9294854.
- S2: heute `""` für `+12045550147`, gleicher Weg, nachgestellt 06:06.
- S3: heute `""` für `+17805550147`, gleicher Weg, nachgestellt 06:07 (Teil der 55 geprüften Vorwahlen; S3 nach Runde 2 von 403 auf 780 umgestellt).
- S4: heute `""` für `+16045550147`, gleicher Weg, nachgestellt 06:06.
- S5: heute `""` für alle 32 Vorwahlen der Liste (Wegwerf-Versuch 25.10.2026 06:07 am master 9294854, 55 kanadische Vorwahlen geprüft, keine belegt), also Satz „You do not know which time zone …“ statt der Vermutung.

## Freigabe
Betreuung im Auftrag von Antonio, 25.10.2026 (master c8a7d61): Freigabeliste 1–3, 5–10 wie empfohlen; 3 hingenommen (zone1970.tab ordnet Zonen Regionen zu, nicht Vorwahlen); 4 kein fehlender Angriffsweg; 11 vertraulich an Antonio, nicht in diesem Paket; 12 Deckel 1200000 Token. Issue #2032.
