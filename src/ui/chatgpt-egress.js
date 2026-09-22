// Client-Erkennung "kommt diese Anfrage nachweislich von ChatGPT?" (T2-01, T-31-Folgearbeit).
// OpenAI dokumentiert genau diesen Weg selbst: "You can also allowlist ChatGPT's
// published egress IP ranges" (developers.openai.com/plugins/build/auth#client-
// identification). Die veroeffentlichte Liste liegt unter
// https://openai.com/chatgpt-connectors.json.
//
// Gespeist aus einer EINGECHECKTEN Kopie (chatgpt-egress-ranges.json, Herkunft +
// Abrufdatum in deren Feldern _source/_fetchedAt) - KEIN Netz-Call zur Laufzeit (P4/
// P16: ein Request-Pfad ruft nie extern nach, das waere sowohl eine neue Fehlerquelle
// als auch eine neue Latenz pro MCP-Request). Aktualisierungsweg: die Datei erneut von
// https://openai.com/chatgpt-connectors.json herunterladen, _fetchedAt auf das
// Abrufdatum setzen, _upstreamCreationTime aus dem Feld "creationTime" der Antwort
// uebernehmen, unveraendert committen.
//
// node:net BlockList: keine neue Dependency (Konvention "wenige Dependencies,
// bewusst gehalten"). Eine CIDR-Blockliste mit Exact-/Subnet-Matches fuer IPv4 UND
// IPv6; ein IPv4-gemapptes IPv6-Literal (z.B. von Express' req.ip hinter "trust
// proxy") matcht dabei transparent gegen eine reine IPv4-Subnetz-Regel.
//
// Fail-closed (Owner-Entscheidung T2-01): jede ungueltige/fehlende Eingabe (kein
// IP-String, kaputte/fehlende Liste, unbekanntes Praefix-Format) liefert false. Das
// ist die SICHERE Richtung, weil dieses Praedikat ausschliesslich steuert, ob
// ZUSAETZLICH `_meta.ui.domain` gesetzt wird (der Alias openai/widgetDomain bleibt in
// jedem Fall unveraendert) - eine falsche "false" unterlaesst hoechstens ein Feld,
// eine falsche "true" wuerde einem falschen Aufrufer eine engere Sandbox vortaeuschen
// bzw. den Origin unpassend verraten (Streuwirkung, kein Sicherheits-Gate im Sinne
// von CLAUDE.md - aber trotzdem fail-closed gebaut).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { BlockList, isIP } from "node:net";

const RANGES_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "chatgpt-egress-ranges.json",
);

// node:net isIP()-Konvention: 4 oder 6 (0 = kein IP-String). EINE benannte Konstante
// statt eines verstreuten Literals (G25) - IPV4_FAMILY braucht keinen eigenen Namen,
// da nirgends gegen "4" verglichen wird (nur gegen FAMILY_IPV6 bzw. Wahrheitswert).
const FAMILY_IPV6 = 6;
const IPV4_MAX_PREFIX = 32;
const IPV6_MAX_PREFIX = 128;

// Ein Listen-Element {ipv4Prefix|ipv6Prefix: "a.b.c.d/n"} auf GENAU einen CIDR-String
// reduzieren (kein Format-Check hier, nur Feld-Auswahl - G30, eine Aufgabe pro Funktion).
function cidrOf(entry) {
  const value = entry?.ipv4Prefix ?? entry?.ipv6Prefix;
  return typeof value === "string" ? value : null;
}

// "a.b.c.d/n" (oder IPv6-Aequivalent) in { address, prefix, family } parsen - null bei
// JEDEM Formfehler (kein "/", unparsbare Adresse, kein/ungueltiges Praefix). Getrennt
// von addPrefixEntry (G30/G34: Parsing UND Eintragen sind zwei Aufgaben).
function parseCidr(cidr) {
  const slashIndex = cidr.indexOf("/");
  if (slashIndex < 0) return null;
  const address = cidr.slice(0, slashIndex);
  const family = isIP(address);
  if (!family) return null;
  const prefix = Number(cidr.slice(slashIndex + 1));
  const maxPrefix = family === FAMILY_IPV6 ? IPV6_MAX_PREFIX : IPV4_MAX_PREFIX;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return null;
  return { address, prefix, family };
}

// Ein einzelnes Listen-Element in die BlockList eintragen. Unbekanntes/kaputtes Format
// wird STILL uebersprungen (ein einzelner fehlerhafter Eintrag darf nicht die gesamte
// Liste unbrauchbar machen) - der einzige Fehlerfall, der zaehlt, ist "Datei fehlt/ist
// kein JSON" (s. buildBlockList).
function addPrefixEntry(list, entry) {
  const cidr = cidrOf(entry);
  if (!cidr) return;
  const parsed = parseCidr(cidr);
  if (!parsed) return;
  try {
    list.addSubnet(parsed.address, parsed.prefix, parsed.family === FAMILY_IPV6 ? "ipv6" : "ipv4");
  } catch {
    // Von node:net abgelehnt (z.B. Host-Bits gesetzt) -> ueberspringen, Rest bleibt wirksam.
  }
}

// EINMAL beim Modul-Laden gebaut (stabiler Singleton, kein Lazy-Init-Antipattern,
// P15) - dieselbe Machart wie mcpNativeRenderer (ui/adapters/mcp-native.js). Eine
// fehlende/kaputte Datei bricht NICHT den Boot: leere BlockList -> jede IP liefert
// false (fail-closed Richtung "keine ChatGPT-Erkennung").
function buildBlockList() {
  const list = new BlockList();
  try {
    const raw = readFileSync(RANGES_PATH, "utf8");
    const data = JSON.parse(raw);
    const prefixes = Array.isArray(data?.prefixes) ? data.prefixes : [];
    for (const entry of prefixes) addPrefixEntry(list, entry);
  } catch {
    // Datei fehlt oder ist kein JSON -> leere Liste, s.o.
  }
  return list;
}

const chatgptEgressList = buildBlockList();

// true NUR wenn ip ein geparster IPv4/IPv6-String ist UND in der Liste steckt.
// Kein String, leerer String, unparsbare Adresse -> false (fail-closed).
export function isChatGptEgressIp(ip) {
  if (typeof ip !== "string" || !ip) return false;
  const family = isIP(ip);
  if (!family) return false;
  try {
    return chatgptEgressList.check(ip, family === FAMILY_IPV6 ? "ipv6" : "ipv4");
  } catch {
    return false;
  }
}
