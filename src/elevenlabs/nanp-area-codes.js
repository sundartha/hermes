// ---- NANP-Vorwahl -> Zone des Angerufenen: eine HYPOTHESE, kein Ergebnis --------------
// Fuer +1 gibt es keine Land-Ableitung: countryForE164 liefert dort BEWUSST null (25
// NANP-Laender teilen die Vorwahl, Eigentuemer-Entscheidung E2 "nie raten"), und +1 ist
// ausgerechnet das Marktgebiet, in dem dieses Produkt telefoniert. Der einzige Anhalt ohne
// neue Datenhaltung ist die dreistellige Vorwahl (NPA) hinter der +1.
//
// EIGENTUEMER-ENTSCHEIDUNG 2026-08-15, die dieses Modul umsetzt: eine Vorwahl-Tabelle
// ALLEIN ist falsch. Was hier entsteht, ist eine HYPOTHESE - der Agent bestaetigt sie im
// Gespraech in EINEM Satz ("I have you down as Eastern time - is that right?"), bevor er
// eine absolute Uhrzeit nennt; der Angerufene weiss seine Zone, das ist die verlaesslichste
// Quelle, die es gibt. Steht gar nichts fest, nennt der Agent KEINE absolute Uhrzeit. Die
// Sprachfuehrung dazu liegt beim Aufrufer (calleeTimezoneText in outbound.js) - dieses
// Modul liefert nur den Bezeichner.
//
// UNVOLLSTAENDIGKEIT IST ABSICHT, NICHT NACHLAESSIGKEIT: aufgenommen ist NUR eine Vorwahl,
// deren Gebiet vollstaendig in EINER Zone mit EINER Sommerzeit-Regel liegt. Alles, was eine
// Zonengrenze schneidet, fehlt bewusst - dort gilt der Fallback (keine absolute Uhrzeit).
// "Meistens richtig" heisst bei Terminen: still falsche Uhrzeiten. Lieber eine kleine,
// sichere Tabelle als eine grosse, die manchmal luegt. Wer eine Vorwahl ergaenzt, prueft
// dieselbe Bedingung - im Zweifel: weglassen.
//
// ARIZONA ausdruecklich behandelt statt weggelassen: der Bundesstaat faehrt Mountain OHNE
// Sommerzeit, und genau dafuer gibt es den eigenen IANA-Bezeichner America/Phoenix - eine
// Zone ist eben keine Zeitverschiebung, deshalb traegt die Tabelle Bezeichner und keine
// Versaetze. Aufgenommen sind nur die drei Vorwahlen des Grossraums Phoenix und die von
// Tucson; 928 fehlt, weil es die Navajo Nation umfasst - das einzige Gebiet Arizonas, das
// Sommerzeit faehrt, und damit ein Gebiet mit zwei Regeln in einer Vorwahl.
//
// BEWUSST NICHT AUFGENOMMEN, jeweils weil die Vorwahl eine Zonengrenze schneidet: 208/986
// (Idaho), 906 (Michigan, Obere Halbinsel), 850 (Florida, Panhandle), 605 (South Dakota),
// 701 (North Dakota), 308 (Nebraska, Panhandle), 785/620 (Kansas), 775 (Nevada), 541/458
// (Oregon), 915 (West-Texas), 907 (Alaska), 928 (s.o.) sowie ganz Indiana, Kentucky und
// Tennessee. NICHT aufgenommen sind ausserdem Kanada und die Karibik: sie teilen die +1,
// gehoeren aber nicht zum Auftrag (US-Nummern) - fuer sie gilt derselbe Fallback.
const NANP_PREFIX = "+1";
const AREA_CODE_LENGTH = 3;

// Keine Hypothese - keine +1-Nummer oder eine Vorwahl, die nicht eindeutig ist. Benannt,
// weil der leere String hier eine Aussage ist ("wir vermuten nichts") und kein vergessener
// Default.
const KEINE_HYPOTHESE = "";

const ZONE_EASTERN = "America/New_York";
const ZONE_CENTRAL = "America/Chicago";
const ZONE_MOUNTAIN = "America/Denver";
const ZONE_ARIZONA = "America/Phoenix";
const ZONE_PACIFIC = "America/Los_Angeles";
const ZONE_HAWAII = "Pacific/Honolulu";

// Die Tabelle ist DATEN, keine Logik. Gruppiert nach Bundesstaat, weil genau der die
// Aufnahme-Bedingung traegt: "liegt dieser Staat (bzw. dieses Vorwahl-Gebiet) ganz in
// dieser Zone?" laesst sich je Zeile nachpruefen, eine flache Liste aus 250 Zahlen nicht.
const AREA_CODES_BY_ZONE = Object.freeze({
  [ZONE_EASTERN]: Object.freeze({
    NY: "212 646 332 917 718 347 929 516 631 914 845 518 315 838 607 585 716 680",
    NJ: "201 551 609 732 848 856 862 908 973",
    PA: "215 267 484 610 570 272 717 724 878 412 814",
    CT: "203 475 860 959",
    MA: "617 857 781 339 978 351 508 774 413",
    RI: "401",
    NH: "603",
    VT: "802",
    ME: "207",
    DE: "302",
    DC: "202",
    MD: "301 240 410 443 667",
    VA: "703 571 804 757 434 540 276",
    WV: "304 681",
    NC: "704 980 828 336 910 919 984 252",
    SC: "803 843 854 864",
    GA: "404 470 678 770 762 706 912 229 478",
    OH: "216 440 330 234 419 567 614 380 513 937 740",
    MI: "313 248 947 586 734 810 517 616 231 989",
    FL: "305 786 954 754 561 772 407 321 689 813 727 941 239 863 352 386 904",
  }),
  [ZONE_CENTRAL]: Object.freeze({
    IL: "312 773 872 224 847 630 331 708 815 779 217 309 618",
    WI: "414 262 608 715 534 920",
    MN: "612 651 763 952 218 320 507",
    IA: "515 319 563 641 712",
    MO: "314 636 573 660 816 417",
    AR: "501 479 870",
    LA: "504 225 337 318 985",
    MS: "601 769 662 228",
    AL: "205 659 251 256 938 334",
    TX: "214 469 972 945 817 682 713 281 832 346 210 726 512 737 361 254 940 903 430 936 979 409 806 325 432",
    OK: "405 918 539 580",
    NE: "402 531",
    KS: "913 316",
  }),
  [ZONE_MOUNTAIN]: Object.freeze({
    CO: "303 720 983 970 719",
    UT: "801 385 435",
    NM: "505 575",
    WY: "307",
    MT: "406",
  }),
  [ZONE_ARIZONA]: Object.freeze({ AZ: "602 480 623 520" }),
  [ZONE_PACIFIC]: Object.freeze({
    CA: "213 323 310 424 818 747 626 661 562 714 657 949 951 909 760 442 619 858 415 628 650 408 669 510 341 925 707 916 279 209 559 805 831 530",
    WA: "206 253 425 360 564 509",
    OR: "503 971",
    NV: "702 725",
  }),
  [ZONE_HAWAII]: Object.freeze({ HI: "808" }),
});

// Wie ein Mensch die Zone AUSSPRICHT. Ohne diese zweite Spalte muesste der
// Bestaetigungssatz einen festen Beispielnamen tragen ("I have you down as Eastern time"),
// und der stuende bei jedem Anruf ausserhalb des Ostens neben einer anderen Zone - der
// Agent liesse sich dann die FALSCHE Zone bestaetigen, also genau den Fehler, den die
// Bestaetigung verhindern soll. Arizona heisst hier ausdruecklich nicht "Mountain time":
// der Staat faehrt keine Sommerzeit und liegt den halben Jahresverlauf neben Denver.
const SPOKEN_ZONE_NAME = Object.freeze({
  [ZONE_EASTERN]: "Eastern time",
  [ZONE_CENTRAL]: "Central time",
  [ZONE_MOUNTAIN]: "Mountain time",
  [ZONE_ARIZONA]: "Arizona time",
  [ZONE_PACIFIC]: "Pacific time",
  [ZONE_HAWAII]: "Hawaii time",
});

const AREA_CODE_SEPARATOR = " ";

// Einmal beim Laden aufgeloest: die Nachschlage-Richtung der Tabelle ist Vorwahl -> Zone,
// gepflegt wird sie in der lesbaren Richtung Zone -> Vorwahlen.
const ZONE_BY_AREA_CODE = new Map(
  Object.entries(AREA_CODES_BY_ZONE).flatMap(([zone, jeStaat]) =>
    Object.values(jeStaat)
      .flatMap((vorwahlen) => vorwahlen.split(AREA_CODE_SEPARATOR))
      .map((vorwahl) => [vorwahl, zone]),
  ),
);

/**
 * Die VERMUTETE Zone des Angerufenen aus der Vorwahl seiner +1-Nummer - oder gar nichts.
 * Erwartet eine bereits normalisierte E.164-Nummer (der Server normalisiert `to`, s.
 * routes/api-calls.js). Keine +1-Nummer, unbekannte oder nicht eindeutige Vorwahl -> leer:
 * eine falsche Zone ist schlimmer als keine.
 */
export function timezoneHypothesisForNumber(e164) {
  if (typeof e164 !== "string" || !e164.startsWith(NANP_PREFIX)) return KEINE_HYPOTHESE;
  const vorwahl = e164.slice(NANP_PREFIX.length, NANP_PREFIX.length + AREA_CODE_LENGTH);
  return ZONE_BY_AREA_CODE.get(vorwahl) || KEINE_HYPOTHESE;
}

/**
 * Der gesprochene Name einer Zone dieser Tabelle - der Wortlaut, den der Agent im
 * Bestaetigungssatz benutzt. Eine Zone ausserhalb der Tabelle liefert den Bezeichner
 * selbst zurueck: lieber sperrig vorgelesen als die falsche Zone bestaetigt.
 */
export function spokenTimezoneName(zone) {
  return SPOKEN_ZONE_NAME[zone] || zone;
}
