// Konfigurationstests der ElevenLabs-Agenten-VORLAGE im Repo
// (elevenlabs/agent_configs/outbound-agent.template.json). Zwei Eigentuemer-
// Entscheidungen, zwei Baenke:
//
// D2 (Regressionsschutz, "npm test"): die Werkzeugliste des Agenten ist EXAKT gepinnt, in
//   beide Richtungen - kommt ein Werkzeug dazu, wird der Test rot; faellt eines weg,
//   ebenso. Beides ist dann eine bewusste Entscheidung mit einer Zeile Begruendung statt
//   einer stillen Aenderung. Muster ROUTE_FINGERPRINT aus test/route-auth-inventory.test.js,
//   samt Buchhaltungs-Kommentar an der Liste. Die Sorge dahinter ist KONFIGURATIONS-DRIFT,
//   nicht ein bestimmtes Werkzeug: ein Kriterium wird gruen oder rot, weil jemand am
//   Agenten etwas an- oder abgehaengt hat, und niemand merkt es.
//
// R16 (Abnahmekriterium, "npm run test:abnahme", heute ROT): der Prompt nennt get_consult
//   nur, wenn das Rueckfrage-Gate (src/consult/gate.js) es zulaesst. Nennt der Prompt ein
//   Werkzeug, das das Gate sperrt, verspricht der Agent seinem Gegenueber eine Rueckfrage,
//   die nie kommt - oder er versucht einen Aufruf, der abgelehnt wird.
//
// GEMESSEN (2026-08-14), warum R16 ein Abnahmekriterium ist und kein Regressionsschutz:
//   - Bestandspfad: die Naht EXISTIERT. src/claude.js rendert consultRules(p) nur bei
//     p.consultAvailable, und agentTools(call) haengt das Werkzeug nur bei
//     consultAvailableFor(call) an. Beide Richtungen sind dort gepinnt
//     (test/ww-p3-consult-prompt-routing.test.js, gruen im Regressionslauf).
//   - ElevenLabs-Pfad: es gibt NICHTS Vergleichbares. Die Vorlage ist eine statische
//     JSON-Datei, die kein Laufzeit-Code liest (sie wird nur von
//     scripts/check-elevenlabs-tests.js und von Tests angefasst), ihr Prompt traegt den
//     Block "CONSULT TOOL (get_consult)" bedingungslos, und
//     src/conversation/conversation-ports.js kennt in StartConversationParams kein Feld,
//     ueber das eine Gate-Antwort beim Laufwerk ueberhaupt ankaeme.
//
// KEIN NETZ, KEIN KONTO: gepinnt wird die VORLAGE IM REPO, nie der Agent im ElevenLabs-
// Konto. Ob Vorlage und Konto uebereinstimmen, ist Sache des Vor-dem-Hochladen-Gates
// (scripts/check-elevenlabs-tests.js, "npm run elevenlabs:check") - nicht dieses Tests.
//
// Testnamen tragen bewusst KEINE i18n-Katalog-ID am Namensanfang (package.json
// config.i18nCatalogPattern), sonst landen sie im Gates-Lauf statt in ihrer Bank
// (Lehre catalog-id-prefix-misroutes-tests).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { config } from "../src/config.js";
import { consultAllowedFor } from "../src/consult/gate.js";
import { makeConfigOverrides } from "./helpers.js";

// Der Werkzeugname steht hier als Literal, nicht als Import von GET_CONSULT_TOOL_NAME:
// geprueft wird eine PROVIDER-Konfiguration, deren Schreibweise im JSON steht. Ein Test,
// der beide Seiten aus derselben Quelle zoege, koennte ein Auseinanderlaufen nicht sehen
// (dieselbe Begruendung wie in test/ww-p3-consult-prompt-routing.test.js).
const CONSULT_TOOL = "get_consult";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const TEMPLATE = JSON.parse(readFileSync(new URL(`../${TEMPLATE_REL}`, import.meta.url), "utf8"));

// Schluessel mit Unterstrich-Praefix sind Entwickler-Doku, kein Konfigurationsfeld -
// dieselbe Konvention, die scripts/check-elevenlabs-tests.js als DOC_KEY_PREFIX fuehrt.
const DOC_KEY_PREFIX = "_";
const configKeysOf = (obj) =>
  Object.keys(obj ?? {})
    .filter((key) => !key.startsWith(DOC_KEY_PREFIX))
    .sort();

// In Stufen gelesen statt in einer Kette: das Agenten-Objekt ist vier Ebenen tief
// (G36/Demeter, im Lint dieses Repos ein Fehler).
const agentSection = () => TEMPLATE.agent?.conversation_config?.agent ?? {};
const promptObject = () => agentSection().prompt;
const promptText = () => promptObject()?.prompt ?? "";
const toolIds = () => promptObject()?.tool_ids;
const declaredToolNames = () => configKeysOf(TEMPLATE.tools);
const toolEntry = (name) => TEMPLATE.tools?.[name] ?? {};

// Gepinntes Werkzeug-Inventar der Vorlage (Muster ROUTE_FINGERPRINT). EXAKT und in BEIDE
// Richtungen: ein Werkzeug mehr oder weniger macht diesen Test rot.
//
// BUCHHALTUNG - wann und warum diese Liste zuletzt geaendert wurde:
//   2026-08-14 angelegt mit genau EINEM Werkzeug: get_consult, die Rueckfrage an den
//   Auftraggeber (mit der Vorlage selbst entstanden). Kein Recherche-, kein Nachschlage-,
//   kein Kalender-Werkzeug - der Agent dieser Vorlage kann ausser sprechen nur genau das.
const TOOL_FINGERPRINT = ["get_consult"];

// Zweiter Fingerprint, weil ein Werkzeug nicht nur ueber die tools-Karte an den Agenten
// kommt: ElevenLabs haengt Faehigkeiten auch an weitere Felder des prompt-Objekts
// (eingebaute Werkzeuge, MCP-Server, Wissensdatenbank). Diese Datei kennt das
// Vokabular des Anbieters nicht vollstaendig und behauptet es auch nicht - sie pinnt
// stattdessen die KONFIGURATIONSFLAECHE: ein neues Feld im prompt-Objekt ist eine
// Aenderung am Werkzeugbestand, bis jemand das Gegenteil begruendet.
//
// BUCHHALTUNG: 2026-08-14 angelegt mit den zwei Feldern, die die Vorlage traegt.
const PROMPT_FIELD_FINGERPRINT = ["prompt", "tool_ids"];

const DRIFT_HINT =
  "Das ist erlaubt - aber nur bewusst: Liste in test/elevenlabs-agent-werkzeuge.test.js " +
  "nachziehen UND im Buchhaltungs-Kommentar in einer Zeile begruenden, was dazu kam oder " +
  "wegfiel. Ein Werkzeug, das still auftaucht oder verschwindet, dreht Abnahmekriterien " +
  "gruen oder rot, ohne dass jemand es entschieden hat.";

test("Werkzeug-Inventar der ElevenLabs-Vorlage: exakt die gepinnte Menge, in beide Richtungen", () => {
  // Positiv-Kontrolle: ein leeres Inventar bestuende die Gleichheitspruefung auch dann,
  // wenn der Leser oben gar nichts mehr faende (Lehre pruefkommando-ohne-positiv-kontrolle).
  assert.ok(TOOL_FINGERPRINT.length > 0, "der Fingerprint ist besetzt - sonst misst er nichts");

  assert.deepEqual(
    declaredToolNames(),
    TOOL_FINGERPRINT,
    `Der Werkzeugbestand in ${TEMPLATE_REL} (tools) hat sich geaendert. ${DRIFT_HINT}`,
  );
});

test("Werkzeug-Inventar der ElevenLabs-Vorlage: die Konfigurationsflaeche des Prompts ist gepinnt", () => {
  assert.deepEqual(
    configKeysOf(promptObject()),
    PROMPT_FIELD_FINGERPRINT,
    `Das prompt-Objekt in ${TEMPLATE_REL} traegt andere Felder als gepinnt - ein Werkzeug ` +
      `kann auch ueber ein NEUES Feld an den Agenten kommen, ohne in tools aufzutauchen. ` +
      DRIFT_HINT,
  );
});

test("Werkzeug-Inventar der ElevenLabs-Vorlage: jedes Werkzeug heisst ueberall gleich und haengt genau einmal am Agenten", () => {
  for (const name of declaredToolNames()) {
    assert.equal(
      toolEntry(name).tool_config?.name,
      name,
      `Werkzeug "${name}": Karten-Schluessel und tool_config.name laufen auseinander - ` +
        "hochgeladen wird der Wert aus tool_config, gepinnt wird der Schluessel.",
    );
  }

  const ids = toolIds();
  assert.ok(Array.isArray(ids), `${TEMPLATE_REL}: prompt.tool_ids ist eine Liste`);
  assert.equal(
    ids.length,
    declaredToolNames().length,
    "Jedes deklarierte Werkzeug haengt genau einmal am Agenten. Mehr Kennungen als " +
      `Werkzeuge heisst: der Agent traegt etwas, das die Vorlage nicht deklariert. ${DRIFT_HINT}`,
  );

  // Solange die Kennung noch ein <AUSFUELLEN: ...>-Platzhalter ist, laesst sie sich einem
  // Werkzeug zuordnen; nach dem Push steht dort eine Konto-Kennung, die keinen Namen mehr
  // traegt - dann greift nur noch die Mengengleichheit oben. Beide Zustaende sind gueltig.
  for (const entry of ids.filter((id) => String(id).includes("AUSFUELLEN"))) {
    assert.ok(
      declaredToolNames().some((name) => String(entry).includes(name)),
      `Die Platzhalter-Kennung "${entry}" nennt kein deklariertes Werkzeug.`,
    );
  }
});

// --- R16 -------------------------------------------------------------------------------

const { withConfigOverrides } = makeConfigOverrides(config);

// Die drei Faktoren des Gates (src/consult/gate.js), je einzeln zugedreht. Vier Faelle
// statt zwei: ein Gate, das immer dasselbe antwortet, wuerde die Richtungspruefung
// darunter trivial bestehen.
const GATE_CASES = Object.freeze([
  {
    name: "alle drei Faktoren offen",
    master: true,
    channel: true,
    allowConsult: true,
    allowed: true,
  },
  {
    name: "Tenant ohne Rueckfrage-Recht",
    master: true,
    channel: true,
    allowConsult: false,
    allowed: false,
  },
  { name: "Master-Schalter aus", master: false, channel: true, allowConsult: true, allowed: false },
  { name: "Kontext-Kanal aus", master: true, channel: false, allowConsult: true, allowed: false },
]);

const gateAnswerFor = (kase) =>
  withConfigOverrides({ consultEnabled: kase.master, assistantContextEnabled: kase.channel }, () =>
    consultAllowedFor({ allowConsult: kase.allowConsult }),
  );

// Die NAHT, die R16 verlangt - hier VOR dem Bau gepinnt, wie
// test/elevenlabs-consult-webhook-blockers.test.js den Namen
// recordElevenlabsConversationId vor dem Bau gepinnt hat.
//   ORT: src/conversation/ ist der im Kopf von conversation-ports.js begruendete Platz
//     fuer den KI-Gespraechsdienst (telephony/ traegt nur die Leitung).
//   EINGABE: die ANTWORT des Gates, nicht das Tenant-Profil - die Entscheidung faellt in
//     src/consult/gate.js und darf nicht ein zweites Mal nachgebaut werden. Genau dieser
//     Nachbau war Blocker BL-2 des Rueckfrage-Webhooks.
//   RUECKGABE: { prompt: string, toolNames: string[] }. Werkzeug-NAMEN, nicht die
//     ElevenLabs-Kennungen: die entstehen erst im Konto, und ein Test greift nicht ins
//     Netz. Weitere Felder darf die Naht liefern, dieser Test liest nur diese zwei.
const SEAM = Object.freeze({
  module: "../src/conversation/elevenlabs-agent-config.js",
  export: "outboundAgentConfigFor",
});

async function agentConfigSeam() {
  let module;
  try {
    module = await import(SEAM.module);
  } catch {
    module = null;
  }
  const build = module?.[SEAM.export];
  assert.equal(
    typeof build,
    "function",
    `NOCH NICHT GEBAUT: ${SEAM.module} exportiert ${SEAM.export}({ consultAllowed }) nicht. ` +
      "Solange es die Naht nicht gibt, gilt fuer den ElevenLabs-Pfad genau EIN Prompt - der " +
      `statische aus ${TEMPLATE_REL}, und der nennt get_consult in jeder Lage.`,
  );
  return build;
}

test("ABNAHME-R16: der ElevenLabs-Prompt nennt get_consult nur, wenn das Rueckfrage-Gate es zulaesst | ROT WEIL: der ElevenLabs-Pfad hat nur einen statischen Prompt in der Vorlage, der das Werkzeug bedingungslos nennt - eine gate-abhaengige Zusammenstellung wie consultRules() und agentTools() in src/claude.js existiert dort nicht | FIX: eine Naht, die Prompt und Werkzeugsatz des Agenten aus der Antwort von consultAllowedFor zusammenbaut - bei gesperrtem Gate ohne den CONSULT-TOOL-Block und ohne die Werkzeug-Kennung", async () => {
  // 1. Das Gate misst wirklich in beide Richtungen (Kontrolle, gruen).
  for (const kase of GATE_CASES) {
    assert.equal(gateAnswerFor(kase), kase.allowed, `Gate-Antwort im Fall "${kase.name}"`);
  }

  // 2. Kontrolle am Artefakt: die Vorlage nennt das Werkzeug ueberhaupt. Ohne sie waere
  //    die gesperrte Richtung unten von einem Prompt, der get_consult NIE nennt, nicht zu
  //    unterscheiden.
  assert.ok(
    promptText().includes(CONSULT_TOOL),
    `${TEMPLATE_REL} nennt ${CONSULT_TOOL} im Prompt - diese Kontrolle greift`,
  );

  // 3. Die eigentliche Pruefung, beide Richtungen ueber dieselbe Naht.
  const build = await agentConfigSeam();
  for (const kase of GATE_CASES) {
    const allowed = gateAnswerFor(kase);
    const built = build({ consultAllowed: allowed });
    assert.equal(
      String(built?.prompt ?? "").includes(CONSULT_TOOL),
      allowed,
      `Fall "${kase.name}": der Prompt nennt ${CONSULT_TOOL} genau dann, wenn das Gate es ` +
        "zulaesst - sonst verspricht der Agent eine Rueckfrage, die nie kommt.",
    );
    assert.equal(
      (built?.toolNames ?? []).includes(CONSULT_TOOL),
      allowed,
      `Fall "${kase.name}": ${CONSULT_TOOL} haengt genau dann am Agenten, wenn das Gate es ` +
        "zulaesst - sonst versucht er einen Aufruf, den der Webhook ablehnt.",
    );
  }
});
