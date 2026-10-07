import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

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

const ERLAUBTE_GRUND_NAMEN = new Set(["GATE_ERROR_GRUND", "grund"]);
const GRUND_SCHLUESSEL = "grund";

function istBenannterGrund(node) {
  if (node.type === "Identifier") return ERLAUBTE_GRUND_NAMEN.has(node.name);
  return node.type === "MemberExpression" && !node.computed && node.property.name === GRUND_SCHLUESSEL;
}

const TABELLEN_QUELLE = {
  datei: { type: "string" },
  tabelle: { type: "string" },
};

function geladeneTabelle(context, { datei, tabelle }) {
  const pfad = join(context.cwd, datei);
  if (!existsSync(pfad)) return undefined;
  return createRequire(join(context.cwd, "package.json"))(pfad)[tabelle];
}

function tabelleFehlt(context, { datei, tabelle }) {
  return {
    Program: (node) => context.report({ node, messageId: "tabelleFehlt", data: { datei, tabelle } }),
  };
}

const TABELLE_FEHLT = "{{tabelle}} aus {{datei}} lässt sich nicht laden; ohne die Tabelle prüft diese Regel nichts.";

function ablehnungsgrundPruefer(context, gruende) {
  const bekannt = new Set(gruende);
  return (node) => {
    if (node === undefined) return;
    if (node.type !== "Literal") {
      if (!istBenannterGrund(node)) context.report({ node, messageId: "unbenannt" });
      return;
    }
    if (!bekannt.has(node.value))
      context.report({ node, messageId: "unbekannt", data: { grund: node.value } });
  };
}

const ablehnungsgruende = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { ...TABELLEN_QUELLE, sprache: { type: "string" } },
        required: ["datei", "tabelle", "sprache"],
        additionalProperties: false,
      },
    ],
    messages: {
      tabelleFehlt: TABELLE_FEHLT,
      unbekannt:
        "Ablehnungsgrund „{{grund}}“ fehlt in MCP_DENIAL_TEXTS (src/i18n/mcp-denial-texts.js). Jeder Grund braucht in jeder Sprache einen neutralen Text.",
      unbenannt:
        "Ablehnungsgrund nur als Zeichenkette, als GATE_ERROR_GRUND, als grund oder als <wert>.grund angeben, damit jeder Grund einen Tabelleneintrag hat.",
      tot: "Tabelleneintrag „{{grund}}“ in MCP_DENIAL_TEXTS wird in dieser Datei nie als Grund vergeben; streichen oder vergeben.",
    },
  },
  create(context) {
    const [einstellung] = context.options;
    const texte = geladeneTabelle(context, einstellung)?.[einstellung.sprache];
    if (texte === undefined) return tabelleFehlt(context, einstellung);
    const gruende = Object.keys(texte);
    const vergeben = new Set();
    const pruefen = ablehnungsgrundPruefer(context, gruende);
    const merken = (node) => {
      if (node?.type === "Literal") vergeben.add(node.value);
      pruefen(node);
    };
    return {
      [`ObjectExpression > Property[key.name="${GRUND_SCHLUESSEL}"][computed=false]`]: (node) =>
        merken(node.value),
      'CallExpression[callee.name="denialAudit"]': (node) => merken(node.arguments[0]),
      'VariableDeclarator[id.name="GATE_ERROR_GRUND"]': (node) => merken(node.init),
      "Program:exit": (node) => {
        for (const grund of gruende.filter((eintrag) => !vergeben.has(eintrag)))
          context.report({ node, messageId: "tot", data: { grund } });
      },
    };
  },
};

const TEXT_SUCHE = new Set(["includes", "match", "indexOf", "search", "startsWith", "endsWith"]);
const MELDUNGS_NAME = /(message|Message|msg|Msg)$/;
const FEHLER_NAME = /[Ee]rr/;

function letzterName(node) {
  if (node.type === "Identifier") return node.name;
  const benannt = node.type === "MemberExpression" && !node.computed;
  return benannt ? node.property.name : undefined;
}

function hatName(node, muster) {
  const name = letzterName(node);
  return name !== undefined && muster.test(name);
}

function istFehlerAlsText(node) {
  if (node.type !== "CallExpression") return false;
  const { callee } = node;
  if (callee.type === "Identifier" && callee.name === "String")
    return node.arguments.length === 1 && hatName(node.arguments[0], FEHLER_NAME);
  const toString = callee.type === "MemberExpression" && letzterName(callee) === "toString";
  return toString && node.arguments.length === 0 && hatName(callee.object, FEHLER_NAME);
}

function ohneArgumentAufgerufen(node) {
  return node.type === "CallExpression" && node.arguments.length === 0 && node.callee.type === "MemberExpression";
}

function istMeldungsText(empfaenger) {
  let node = empfaenger;
  while (node !== undefined) {
    if (node.type === "ChainExpression") node = node.expression;
    else if (hatName(node, MELDUNGS_NAME) || istFehlerAlsText(node)) return true;
    else node = ohneArgumentAufgerufen(node) ? node.callee.object : undefined;
  }
  return false;
}

const AUSNAHME = {
  type: "object",
  properties: { datei: { type: "string" }, grund: { type: "string", minLength: 1 } },
  required: ["datei", "grund"],
  additionalProperties: false,
};

const keineSteuerungUeberMeldung = {
  meta: {
    type: "problem",
    schema: { type: "array", items: AUSNAHME },
    messages: {
      steuerung:
        "Keine Entscheidung über den Text einer Fehlermeldung (GP-P1): das getypte Feld lesen, zum Beispiel err.providerDecline, statt {{suche}} auf einer Meldung.",
    },
  },
  create(context) {
    const datei = pfadInDerWurzel(context.cwd, context.filename);
    if (context.options.some((ausnahme) => ausnahme.datei === datei)) return {};
    return {
      "CallExpression > MemberExpression[computed=false]": (node) => {
        const suche = node.property.name;
        const aufgerufen = node.parent.callee === node;
        if (aufgerufen && TEXT_SUCHE.has(suche) && istMeldungsText(node.object))
          context.report({ node, messageId: "steuerung", data: { suche } });
      },
    };
  },
};

const ersterImport = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { quelle: { type: "string" } },
        required: ["quelle"],
        additionalProperties: false,
      },
    ],
    messages: {
      ersterImport:
        "Der erste Import dieser Datei muss „{{quelle}}“ sein, damit die Prozess-Wächter stehen, bevor irgendein anderes Modul geladen wird.",
    },
  },
  create(context) {
    const { quelle } = context.options[0];
    return {
      Program(node) {
        const erster = node.body.find((anweisung) => anweisung.type === "ImportDeclaration");
        if (erster?.source.value !== quelle)
          context.report({ node: erster ?? node, messageId: "ersterImport", data: { quelle } });
      },
    };
  },
};

function blattName(namensraumZugriff) {
  const { parent } = namensraumZugriff;
  const istBlatt = parent.type === "MemberExpression" && parent.object === namensraumZugriff;
  return istBlatt && !parent.computed ? parent.property.name : undefined;
}

function konfigBefund({ namensraeume, gruppen, blattPflicht = true }, namensraum, blatt) {
  if (gruppen.includes(namensraum)) return undefined;
  if (!Object.hasOwn(namensraeume, namensraum)) return "keinNamensraum";
  if (blatt === undefined) return blattPflicht ? "ohneBlatt" : undefined;
  return namensraeume[namensraum].includes(blatt) ? undefined : "unbekanntesBlatt";
}

const configPfade = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: {
          ...TABELLEN_QUELLE,
          gruppen: { type: "array", items: { type: "string" } },
          blattPflicht: { type: "boolean" },
        },
        required: ["datei", "tabelle", "gruppen"],
        additionalProperties: false,
      },
    ],
    messages: {
      tabelleFehlt: TABELLE_FEHLT,
      keinNamensraum: "config.{{namensraum}} ist kein Namensraum aus CONFIG_NAMESPACES in src/config.js.",
      ohneBlatt: "config.{{namensraum}} ohne Blatt; erwartet ist config.{{namensraum}}.<wert>.",
      unbekanntesBlatt: "config.{{namensraum}}.{{blatt}} steht nicht in CONFIG_NAMESPACES in src/config.js.",
    },
  },
  create(context) {
    const [einstellung] = context.options;
    const namensraeume = geladeneTabelle(context, einstellung);
    if (namensraeume === undefined) return tabelleFehlt(context, einstellung);
    const pruefung = { ...einstellung, namensraeume };
    return {
      'MemberExpression[object.type="Identifier"][object.name="config"][computed=false]': (node) => {
        const namensraum = node.property.name;
        const blatt = blattName(node);
        const messageId = konfigBefund(pruefung, namensraum, blatt);
        if (messageId !== undefined) context.report({ node, messageId, data: { namensraum, blatt } });
      },
    };
  },
};

export default {
  meta: { name: "hermes" },
  rules: {
    "keine-kommentare": keineKommentare,
    "kein-quelltext-als-text": keinQuelltextAlsText,
    "namen-ohne-begruendung": namenOhneBegruendung,
    "wort-nur-in": wortNurIn,
    ablehnungsgruende,
    "keine-steuerung-ueber-meldung": keineSteuerungUeberMeldung,
    "erster-import": ersterImport,
    "config-pfade": configPfade,
  },
};
