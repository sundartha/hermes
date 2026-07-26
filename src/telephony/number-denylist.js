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
// Globale Best-effort-IRSF-Blockliste (outbound-p1b): die hoechsten Premium-/Satelliten-/
// IPRN-Risiko-Ziele weltweit. BEWUSST unvollstaendig - bei weltweiter Reichweite ('*',
// Phase 4) ist sie Beifang, NICHT der Hauptschutz (Hauptschutz = Kosten-Achse/Pre-Auth,
// Phase 1c). Strikt SUB-Ranges (Premium/Service/Satellit/IPRN), NIE ganze Laendercodes -
// eine gewoehnliche US-/ES-/DE-Mobilnummer muss durchkommen. Periodisch gegen eine
// gepflegte IRSF-Quelle aktualisieren. Quelle/Zweck je Gruppe im Kommentar.
const PREMIUM_PREFIXES = [
  // Satellit (Inmarsat / globale Mobil-Satellit) - sehr hohe Minutenpreise, IRSF-Liebling
  "+870",
  "+881",
  "+882",
  "+883",
  // IPRN (International Premium Rate Numbers)
  "+979",
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
  // Karibische NANP-Vorwahlen mit dokumentierter One-Ring-/Premium-Rueckruf-Historie
  // (IRSF). BEWUSST vollstaendige Laender-NPAs: der Betrug laeuft ueber regulaere
  // Teilnehmernummern dieser Ziele, eine feinere Grenze existiert nicht. Preis dieser
  // Entscheidung: kein Outbound in diese Laender (getragen, s. Phasenbericht).
  "+1809", "+1829", "+1849",  // Dominikanische Republik
  "+1876",                    // Jamaika
  "+1268", "+1284", "+1473", "+1649", "+1664", "+1767",
];

// Liefert den TREFFENDEN Eintrag statt nur true/false (GAP-18): der Ablehnungsgrund
// allein sagt nicht, WELCHE Sub-Range gefeuert hat - genau das braucht die Forensik,
// wenn ein ganzes Land still blockiert wird (Pre-Mortem 1). Kein zweiter Durchlauf
// derselben Listen (G5): isDenied ist nur noch die Ja/Nein-Sicht darauf.
export function deniedPrefix(to) {
  if (EMERGENCY_SHORT_CODES.includes(to)) return to;
  return PREMIUM_PREFIXES.find((p) => to.startsWith(p)) ?? null;
}
export const isDenied = (to) => deniedPrefix(to) !== null;
