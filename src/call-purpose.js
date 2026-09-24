// Zweckbindung und Datenminimierung fuer ausgehende Anrufe, EINE Quelle fuer zwei Orte:
// die Beschreibung von place_call (mcp-tools.js) und die Server-Instructions
// (mcp-server-info.js). Beide erreichen nur das Client-Modell - deshalb englisch wie der
// Rest dieser Texte.
//
// Anlass: die OpenAI Usage Policies und Plugin Guidelines verbieten Telemarketing, Spam,
// politische Kampagnen und das Erheben eingeschraenkter Daten (Gesundheitsdaten, amtliche
// Kennnummern) ueber das notwendige Mass hinaus. Die Mengen-Gates (Stundenlimit,
// Ziel-Grenze, Kostendecke) bremsen Masse, aber sie verhindern keinen einzelnen Werbeanruf -
// die Zweckbindung muss am Entscheidungspunkt des Modells stehen.
//
// Grenze dieses Textes: er ist eine Anweisung an das Client-Modell, KEINE serverseitige
// Pruefung. Der Server liest den Zweck eines Anrufs nicht; die Safety-Gates bleiben die
// einzige harte Sperre (docs/OPENAI-POLICY-ABGLEICH.md nennt das als Restluecke). Im
// Gespraech setzt der Server dieselbe Grenze selbst (boundaries.noProhibitedPurpose, nur
// ausgehend, claude.js boundaryRules) - auch das eine Anweisung, an das Gespraechsmodell.
//
// BEWUSST ohne Grossbuchstaben-Emphase: die Beschreibungen von place_call tragen eine
// gepinnte Emphase-Inventur (test/p15-mcp-tool-descriptions-en.test.js).
export const CALL_PURPOSE_RULE =
  "Use place_call only for the user's own errands with a specific person or business, such as " +
  "appointments, reservations, inquiries or messages - never for telemarketing, advertising, " +
  "sales or cold calls, fundraising, mass surveys, political campaigning, lobbying or " +
  "election-related calls; decline such requests. Pass health details only as far as the call " +
  "strictly needs them (the kind of appointment, not diagnoses or medical history), and never " +
  "government identification numbers such as social security, tax, passport or identity card " +
  "numbers.";
