import { pfadInDerWurzel } from "./bestand.js";
import keinQuelltextAlsText from "./kein-quelltext-als-text.js";
import keineKommentare from "./keine-kommentare.js";
import namenOhneBegruendung from "./namen-ohne-begruendung.js";

const GEPRUEFTE_KNOTEN = ["Identifier", "PrivateIdentifier", "Literal", "TemplateElement"];

const WOERTER = new Map([
  ["telnyx-belegabruf", /^(fetchCostRecordPool|assignCostRecords)$|(^|telnyx\.com)\/v2\/detail_records/],
  ["kein-anrufzeit-gate", /time_?zone|(^|\/)(time-context|nanp-area-codes)(\.js)?$/i],
  ["trunk-beleg-felder", /^elInboundTrunk(ZugangFp|BelegtAt)$|el_inbound_trunk_(zugang_fp|belegt_at)/],
  ["anthropic-vokabular", /^(input_schema|cache_control|max_tokens|tool_choice)$/],
  ["keine-aufnahme", /recordingUrl|startRecording|StartRecording/],
  ["tote-wahlwege", /^(originateViaCallControl|originateAiAssistantCall)$/],
  ["sprachkosten-buchen", /^addVoiceUsageCostCents$/],
  ["anruf-starten", /^(originateCall|originateElevenLabsCall)$/],
  ["inbound-tarif", /^voiceTariffInboundCents$/],
  ["altpfad-dashboard", /^\/tenant\.html/],
  ["sprachkennung", /^(de-DE|en-US|fr-FR)$/],
  ["datumsformat", /^(toLocale\w*|toString|Intl)$/],
  ["zugangsdaten", /^credentials$/],
  ["oeffentliche-adresse", /^(PUBLIC_URL|publicUrl)$/],
  ["inbound-geheimnis", /^elevenLabsInbound$/],
  ["speicher-import", /src\/store/],
]);

function istAufgerufen(node) {
  const { parent } = node;
  if (parent.type === "CallExpression") return parent.callee === node;
  const istEigenschaft = parent.type === "MemberExpression" && parent.property === node;
  const aufruf = parent.parent;
  return istEigenschaft && !parent.computed && aufruf.type === "CallExpression" && aufruf.callee === parent;
}

function istSchluessel(node) {
  const { parent } = node;
  return parent.type === "Property" && parent.key === node && !parent.computed;
}

const ART_PRUEFUNG = { aufruf: istAufgerufen, schluessel: istSchluessel };
const JEDE_ART = () => true;

const EINTRAG = {
  type: "object",
  properties: {
    name: { enum: [...WOERTER.keys()] },
    art: { enum: Object.keys(ART_PRUEFUNG) },
    nurIn: { type: "array", items: { type: "string" } },
    meldung: { type: "string" },
  },
  required: ["name", "nurIn", "meldung"],
  additionalProperties: false,
};

function knotenText(node) {
  if (node.type === "Literal") return node.value;
  return node.type === "TemplateElement" ? node.value.cooked : node.name;
}

function geltendeEintraege(context) {
  const datei = pfadInDerWurzel(context.cwd, context.filename);
  return context.options
    .filter(({ nurIn }) => !nurIn.includes(datei))
    .map((eintrag) => ({
      ...eintrag,
      ausdruck: WOERTER.get(eintrag.name),
      passtZurArt: ART_PRUEFUNG[eintrag.art] ?? JEDE_ART,
    }));
}

const wortNurIn = {
  meta: {
    type: "problem",
    schema: { type: "array", items: EINTRAG },
    messages: { wortNurIn: "{{name}}: {{meldung}}" },
  },
  create(context) {
    const eintraege = geltendeEintraege(context);
    const pruefen = (node) => {
      const text = knotenText(node);
      if (typeof text !== "string") return;
      for (const { ausdruck, passtZurArt, name, meldung } of eintraege) {
        if (ausdruck.test(text) && passtZurArt(node))
          context.report({ node, messageId: "wortNurIn", data: { name, meldung } });
      }
    };
    return Object.fromEntries(GEPRUEFTE_KNOTEN.map((typ) => [typ, pruefen]));
  },
};

export default {
  meta: { name: "hermes" },
  rules: {
    "keine-kommentare": keineKommentare,
    "kein-quelltext-als-text": keinQuelltextAlsText,
    "namen-ohne-begruendung": namenOhneBegruendung,
    "wort-nur-in": wortNurIn,
  },
};
