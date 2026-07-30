// Gesperrte Nummernbereiche (Telefonie-Fakt, kein Env, nicht abschaltbar). Blatt-Modul
// OHNE Imports: dieselbe Liste bindet die Outbound-Gate-Kette (telephony/outbound-gates.js)
// UND das Ziel-Gate der privaten Summary-SMS-Nummer (store/state-ops.js
// normalizePrivateNumber) - EINE Quelle (G5). Der Umzug aus outbound-gates.js war noetig,
// weil die config-freie Store-Schicht outbound-gates.js (das config.js importiert) nicht
// importieren darf. Reine Verschiebung, keine Logik-/Listenaenderung.

// Hardcoded (kein Env, nicht abschaltbar): Notruf-Kurzwahlen exakt (sonst wuerde "112" auch
// legitime Nummern als Prefix treffen), Premium-/Service-Prefixe per startsWith. Eng gefasst,
// damit normale Mobilnummern (+4915...) durchkommen.
export const EMERGENCY_SHORT_CODES = ["110", "112", "911", "999"];
// Globale IRSF-/Hochpreis-Blockliste, seit KS-P7 in ZWEI benannten Klassen.
//
// Sie ist NICHT mehr Beifang. Solange der Worst-Case-Tarif bei 300 ct/min stand, bremste
// die Kosten-Achse teure Ziele selbst; seit KS-P0/KS-P6 (30 ct/min) tut sie das nicht mehr,
// weil sie mit UNSEREM Satz schaetzt und nicht mit dem echten Zielpreis. Damit ist diese
// Liste der Hauptschutz gegen teure Ziele - der frueher hier stehende Satz "Beifang, NICHT
// der Hauptschutz" ist ueberholt und deshalb entfernt.
//
// Aufnahmekriterium beider Klassen: der Terminierungspreis des Ziels liegt ueber dem
// Worst-Case-Tarif, mit dem wir reservieren und buchen (VOICE_TARIFF_DEFAULT_CENTS,
// Groessenordnung 30 ct/min). Das Kriterium ist BEWUSST eine Kuratierungsregel und KEINE
// Laufzeitkopplung an den Env-Wert: eine per Env veraenderbare Sperrmenge waere ein
// aufweichbares Gate (Absolute Regel 1), und dieses Blatt-Modul darf config.js nicht
// importieren (s. Kopf). Periodisch gegen eine gepflegte IRSF-Quelle nachfuehren.
//
// KLASSE 1 - PREMIUM_PREFIXES: strikt SUB-Ranges innerhalb eines sonst normal bepreisten
// Ziels (Premium/Service/Satellit/IPRN/UPT). NIE ein ganzer Laendercode: eine gewoehnliche
// US-/ES-/DE-Mobilnummer MUSS durchkommen - genau das pinnen die Positivtests.
const PREMIUM_PREFIXES = [
  // Satellit (Inmarsat / globale Mobil-Satellit) - sehr hohe Minutenpreise, IRSF-Liebling
  "+870",
  "+881",
  "+882",
  "+883",
  // IPRN (International Premium Rate Numbers) + UPT (Universal Personal Telecom, +878):
  // nicht-geografische Weltbereiche ohne gewoehnliche Teilnehmer - reine IRSF-Vehikel.
  "+979",
  "+878",
  // DE Premium/Service: 0900 (Premium, kurz + lang), 0137 (Televoting), 0180 (Shared-Cost),
  // 0118 (Auskunft), 0700 (persoenliche Rufnummer, Restschuld)
  "+49900",
  "+490900",
  "+49137",
  "+49180",
  "+49118",
  "+49700",
  // UK Premium/Service: 118 (Directory Enquiries), 070 (Personal/Follow-me), 09 (Premium),
  // 084x/087x (Service)
  "+44118",
  "+4470",
  "+449",
  "+44843",
  "+44844",
  "+44845",
  "+44870",
  "+44871",
  // FR Premium/Service: 118 (Auskunft), 089x (audiotel/SVA Premium), 081x/082x (Service)
  "+33118",
  "+33899",
  "+33892",
  "+33810",
  "+33820",
  // NANP-Sub-Ranges (GAP-18). Erst mit ALLOWED_COUNTRY_CODES="*" (Live-Zustand seit
  // 2026-07-18, Boot-Banner) sind sie ueberhaupt erreichbar - die Liste enthielt bis P2
  // KEINEN einzigen "+1"-Eintrag. Strikt NPA-genau (Laendercode + 3 Ziffern), NIE "+1"
  // selbst: eine gewoehnliche US-/CA-Nummer MUSS durchkommen (Positivtest pinnt das).
  // US/CA Pay-Per-Call und Premium:
  "+1900",
  "+1976",
];

// KLASSE 2 - HIGH_COST_COUNTRY_PREFIXES: GANZE Laendercodes bzw. vollstaendige Laender-NPAs.
// Hier existiert keine feinere Grenze - entweder ist das ganze Ziel teurer als unser
// Worst-Case-Tarif, oder der Betrug laeuft ueber seine regulaeren Teilnehmernummern.
// Preis dieser Entscheidung, bewusst getragen (Owner 2026-07-29, Plan KS-P7): KEIN Outbound
// in diese Laender, auch nicht zu einer gewoehnlichen Mobilnummer. Genau deshalb steht die
// Klasse getrennt - nur an ihr kostet die Sperre Erreichbarkeit, und der Positivtest lautet
// hier "kein NACHBARLAND wird mitgefangen", nicht "das Land kommt durch".
const HIGH_COST_COUNTRY_PREFIXES = [
  // Karibische NANP-Vorwahlen mit dokumentierter One-Ring-/Premium-Rueckruf-Historie
  // (IRSF) - unveraendert aus Klasse 1 hierher verschoben (gleiche Wirkung, richtige Klasse).
  "+1809", "+1829", "+1849",  // Dominikanische Republik
  "+1876",                    // Jamaika
  "+1268", "+1284", "+1473", "+1649", "+1664", "+1767",
  // Amerika/Karibik: Monopol-Terminierung weit ueber dem Worst-Case-Tarif.
  "+53",   // Kuba (ETECSA-Monopol) - das Szenario aus TOD 1
  "+509",  // Haiti
  // Afrika + Suedatlantik: Monopol-/Satelliten-Versorgung, persistentes IRSF-Spitzenfeld.
  "+232",  // Sierra Leone
  "+236",  // Zentralafrikanische Republik
  "+239",  // Sao Tome und Principe
  "+240",  // Aequatorialguinea
  "+247",  // Ascension
  "+252",  // Somalia
  "+290",  // St. Helena / Tristan da Cunha
  "+291",  // Eritrea
  // Indischer Ozean / Asien.
  "+246",  // Diego Garcia
  "+670",  // Timor-Leste
  "+850",  // Nordkorea
  // Pazifische Mikro-Destinationen: Insel-/Satelliten-Versorgung, IRSF-Klassiker.
  "+672",  // Norfolk / australische Aussengebiete
  "+674",  // Nauru
  "+675",  // Papua-Neuguinea
  "+677",  // Salomonen
  "+678",  // Vanuatu
  "+681",  // Wallis und Futuna
  "+682",  // Cookinseln
  "+683",  // Niue
  "+686",  // Kiribati
  "+688",  // Tuvalu
  "+690",  // Tokelau
];

// EINE Reihenfolge fuer die Praefix-Suche (G5): die Klassen unterscheiden sich in der
// Begruendung und im Preis, nicht in der Wirkung. EXPORT nur dieser Union - der
// Strukturtest prueft daran Format und Ueberschneidungsfreiheit, ohne die Listen
// zweitzufassen; die Klassen-Arrays selbst bleiben modul-privat.
export const DENIED_PREFIXES = [...PREMIUM_PREFIXES, ...HIGH_COST_COUNTRY_PREFIXES];

// Liefert den TREFFENDEN Eintrag statt nur true/false (GAP-18): der Ablehnungsgrund
// allein sagt nicht, WELCHE Sub-Range gefeuert hat - genau das braucht die Forensik,
// wenn ein ganzes Land still blockiert wird (Pre-Mortem 1). Kein zweiter Durchlauf
// derselben Listen (G5): isDenied ist nur noch die Ja/Nein-Sicht darauf.
export function deniedPrefix(to) {
  if (EMERGENCY_SHORT_CODES.includes(to)) return to;
  return DENIED_PREFIXES.find((p) => to.startsWith(p)) ?? null;
}
export const isDenied = (to) => deniedPrefix(to) !== null;
