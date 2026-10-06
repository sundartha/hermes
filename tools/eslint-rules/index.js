import { pfadInDerWurzel } from "./bestand.js";
import keinQuelltextAlsText from "./kein-quelltext-als-text.js";
import keineKommentare from "./keine-kommentare.js";
import namenOhneBegruendung from "./namen-ohne-begruendung.js";

const GEPRUEFTE_KNOTEN = ["Identifier", "PrivateIdentifier", "Literal", "TemplateElement"];

const WOERTER = new Map([
  ["telnyx-belegabruf", /^(fetchCostRecordPool|assignCostRecords)$|(^|telnyx\.com)\/v2\/detail_records/],
  ["kein-anrufzeit-gate", /time_?zone|(^|\/)(time-context|nanp-area-codes)(\.js)?$/i],
  ["trunk-beleg-felder", /^elInboundTrunk(ZugangFp|BelegtAt)$|el_inbound_trunk_(zugang_fp|belegt_at)/],
]);

const EINTRAG = {
  type: "object",
  properties: {
    name: { enum: [...WOERTER.keys()] },
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
    .map((eintrag) => ({ ...eintrag, ausdruck: WOERTER.get(eintrag.name) }));
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
      for (const { ausdruck, name, meldung } of eintraege) {
        if (ausdruck.test(text))
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
