// Reine Pruef-Logik des MCP-Kompatibilitaetsvertrags (docs/mcp-vertrag.json): kein Netz,
// keine Datei, kein Server. Verbraucher: test/mcp-kompatibilitaetsvertrag.test.js, der den
// ECHTEN tools/list-/resources/list-Output (test/mcp-draht-pfade.js) hier hineinreicht.
// Kein Testfall hier (Datei ohne .test.js-Endung): der Runner laedt sie nur als Import.
//
// Was der Vertrag zusichert, sind NUR Kompatibilitaetsmerkmale: Werkzeugnamen je Pfad,
// Eingabe-/Ausgabe-Gerippe (jedes Schema-Schluesselwort ausser reinem Text), Annotation-Hints,
// execution, securitySchemes, Widget-URIs und Resource-URIs. Beschreibungen, Titel und
// _meta-Texte sind KEIN Merkmal (anderweitig gepinnt, s. docs/RUNBOOK-MCP-UPDATE.md).
import { createHash } from "node:crypto";

// Gerippe eines JSON-Schemas, fail-closed: JEDER Schluessel geht ins Gerippe und wird
// verglichen - ausser den reinen Text-Schluesseln (TEXT_SCHLUESSEL) und den eigens
// rekursiv behandelten (REKURSIVE_SCHLUESSEL). Ein unbekanntes Schluesselwort (allOf, $ref,
// propertyNames, ...) faellt also nie still heraus; seine Aenderung ist ein Bruch.
const TEXT_SCHLUESSEL = ["description", "title", "$schema", "examples"];
const REKURSIVE_SCHLUESSEL = ["properties", "items", "required"];
// Listen von Teilschemata: werden je Eintrag auf ihr Gerippe reduziert (Text faellt heraus).
const SCHEMA_LISTEN = ["anyOf", "allOf", "oneOf"];
const IGNORIERT = [...TEXT_SCHLUESSEL, ...REKURSIVE_SCHLUESSEL];
const HINT_NAMEN = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];

// Anker der Abschnitte in docs/RUNBOOK-MCP-UPDATE.md, auf die ein Befund verweist.
// runbookBefunde() prueft, dass jeder hier genannte Anker im Runbook existiert.
export const RUNBOOK_ANKER = Object.freeze({
  additiv: "additive-aenderung",
  bruch: "bruch",
  widget: "widget-uris",
  ablauf: "ablauf-bei-rot",
  sperre: "sperre",
});

export const VERTRAG_ARTEN = Object.freeze(["erstfassung", "additiv", "bruch"]);
// Untergrenze fuer eine Begruendung: kurz genug fuer einen Satz, lang genug gegen
// Platzhalter wie "update" oder "neu gepinnt".
export const MIN_BEGRUENDUNG_ZEICHEN = 40;
const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

const VERWEIS_PRAEFIXE = ["docs/", "src/", "test/", "scripts/"];
const INTERNE_KENNUNG = /\b(T2-\d+|T-\d+|OW-[A-Z0-9]+|H-\d+|[NOWX]-\d+)\b/g;

// ---- Kanonische Form + Hash ----

export function kanonisch(wert) {
  if (Array.isArray(wert)) return `[${wert.map(kanonisch).join(",")}]`;
  if (wert && typeof wert === "object") {
    const schluessel = Object.keys(wert).filter((name) => wert[name] !== undefined);
    const paare = schluessel.sort().map((name) => `${JSON.stringify(name)}:${kanonisch(wert[name])}`);
    return `{${paare.join(",")}}`;
  }
  return JSON.stringify(wert ?? null);
}

export const standSha256 = (stand) =>
  createHash("sha256")
    .update(kanonisch({ profile: stand.profile, werkzeuge: stand.werkzeuge }))
    .digest("hex");

// ---- Gerippe ----

// Reihenfolge von type-Listen und enum-Werten traegt keine Bedeutung -> sortiert, damit
// eine reine Umsortierung nicht als Bruch erscheint.
const sortiertWennListe = (wert) => (Array.isArray(wert) ? [...wert].sort() : wert);

const flacheSchluessel = (schema) => Object.keys(schema).filter((key) => !IGNORIERT.includes(key));

function flachesGerippe(schema) {
  const gerippe = {};
  for (const name of flacheSchluessel(schema).filter((key) => schema[key] !== undefined)) {
    const liste = SCHEMA_LISTEN.includes(name) && Array.isArray(schema[name]);
    gerippe[name] = liste ? schema[name].map(schemaGerippe) : schema[name];
  }
  if (gerippe.type) gerippe.type = sortiertWennListe(gerippe.type);
  if (gerippe.enum) gerippe.enum = sortiertWennListe(gerippe.enum);
  return gerippe;
}

export function schemaGerippe(schema) {
  if (!schema || typeof schema !== "object") return null;
  const gerippe = flachesGerippe(schema);
  if (Array.isArray(schema.required)) gerippe.required = [...schema.required].sort();
  if (schema.items) gerippe.items = schemaGerippe(schema.items);
  if (schema.properties) {
    const eintraege = Object.entries(schema.properties).map(([name, teil]) => [name, schemaGerippe(teil)]);
    gerippe.properties = Object.fromEntries(eintraege);
  }
  return gerippe;
}

export function werkzeugMerkmale(tool) {
  const annotations = tool.annotations ?? {};
  return {
    eingabe: schemaGerippe(tool.inputSchema),
    ausgabe: schemaGerippe(tool.outputSchema),
    hinweise: Object.fromEntries(HINT_NAMEN.map((hint) => [hint, annotations[hint] ?? null])),
    ausfuehrung: tool.execution ?? null,
  };
}

// ---- Stand aus dem Draht ----

const nachUri = (links, rechts) => (links.uri < rechts.uri ? -1 : Number(links.uri > rechts.uri));
// Widget-URI, auf die ein Werkzeug am Draht verweist (undefined ohne Widget).
export const widgetUri = (tool) => tool._meta?.ui?.resourceUri;

function profilStand({ tools, resources = [] }) {
  const mitSchema = tools.filter((tool) => tool.securitySchemes !== undefined);
  const mitWidget = tools.filter((tool) => widgetUri(tool) !== undefined);
  return {
    werkzeuge: tools.map((tool) => tool.name).sort(),
    sicherheitsschemata: Object.fromEntries(mitSchema.map((tool) => [tool.name, tool.securitySchemes])),
    widgets: Object.fromEntries(mitWidget.map((tool) => [tool.name, widgetUri(tool)])),
    ressourcen: resources.map(({ uri, mimeType }) => ({ uri, mimeType })).sort(nachUri),
  };
}

function nimmMerkmaleAuf(katalog, tool, profilId) {
  const merkmale = werkzeugMerkmale(tool);
  const bekannt = katalog.get(tool.name);
  if (bekannt && kanonisch(bekannt.merkmale) !== kanonisch(merkmale)) {
    throw new Error(
      `Pfad-Divergenz: Werkzeug ${tool.name} hat auf "${bekannt.profilId}" und "${profilId}" ` +
        "verschiedene Vertragsmerkmale - ein Werkzeug muss auf jedem Pfad denselben Vertrag tragen.",
    );
  }
  if (!bekannt) katalog.set(tool.name, { merkmale, profilId });
}

// profile: { profilId: { tools, resources } } -> { profile, werkzeuge }. Wirft bei
// Pfad-Divergenz (dasselbe Werkzeug, verschiedene Merkmale auf zwei Pfaden).
export function standAusDraht(profile) {
  const katalog = new Map();
  const profilStaende = {};
  for (const [profilId, draht] of Object.entries(profile)) {
    profilStaende[profilId] = profilStand(draht);
    for (const tool of draht.tools) nimmMerkmaleAuf(katalog, tool, profilId);
  }
  const namen = [...katalog.keys()].sort();
  return {
    profile: profilStaende,
    werkzeuge: Object.fromEntries(namen.map((name) => [name, katalog.get(name).merkmale])),
  };
}

// Ausschnitt eines Stands auf EIN Profil (dessen Werkzeuge aus dem Katalog), damit ein
// einzelner Draht-Pfad gegen den Vertrag verglichen werden kann.
export function teilstand(stand, profilId) {
  const profil = stand.profile[profilId];
  if (!profil) return { profile: {}, werkzeuge: {} };
  const namen = profil.werkzeuge.filter((name) => stand.werkzeuge[name] !== undefined);
  return {
    profile: { [profilId]: profil },
    werkzeuge: Object.fromEntries(namen.map((name) => [name, stand.werkzeuge[name]])),
  };
}

// ---- Klassifikation (fail-closed: additiv NUR fuer die ausdruecklich genannten Faelle) ----

// ort: { profil?, werkzeug?, runbook? } - ohne runbook gilt der Abschnitt der Klasse.
const befund = ({ art, merkmal, ort, detail }) => ({
  art,
  merkmal,
  ...ort,
  detail,
  runbook: ort.runbook ?? RUNBOOK_ANKER[art],
});
const pfadText = (pfad) => pfad.join(".") || "(Wurzel)";
const nurIn = (liste, andere) => liste.filter((eintrag) => !andere.includes(eintrag));
const aenderungsText = (alt, neu) => `${kanonisch(alt)} -> ${kanonisch(neu)}`;

// Alle flachen Schluessel BEIDER Seiten: ein neu hinzugekommenes Schluesselwort ist
// ebenso ein Bruch wie ein entferntes oder geaendertes.
function flacheAbweichungen(alt, neu, ctx) {
  const schluessel = [...new Set([...flacheSchluessel(alt), ...flacheSchluessel(neu)])].sort();
  const geaendert = schluessel.filter((key) => kanonisch(alt[key]) !== kanonisch(neu[key]));
  return geaendert.map((key) =>
    befund({
      art: "bruch",
      merkmal: `${ctx.richtung}: ${key} geaendert`,
      ort: ctx.ort,
      detail: `${pfadText(ctx.pfad)}: ${key} ${aenderungsText(alt[key], neu[key])}`,
    }),
  );
}

// Neue Eingabe-Eigenschaft (je Name): additiv, solange sie optional ist - alte Aufrufe
// senden sie nicht.
const neueEingabeEigenschaft = (neu, ctx) => (name) => {
  const detail = pfadText([...ctx.pfad, name]);
  if ((neu.required ?? []).includes(name)) {
    return befund({ art: "bruch", merkmal: "eingabe: neues Pflichtfeld", ort: ctx.ort, detail });
  }
  return befund({ art: "additiv", merkmal: "eingabe: neue optionale Eigenschaft", ort: ctx.ort, detail });
};

// Ob das ALTE Objekt weitere Eigenschaften zulaesst: nur wenn additionalProperties fehlt
// oder true ist. false - und fail-closed jeder andere Wert, etwa ein Teilschema - schliesst
// eine unbekannte Eigenschaft aus.
const nimmtWeitereEigenschaften = (schema) => schema.additionalProperties === undefined || schema.additionalProperties === true;

// Neue Ausgabe-Eigenschaft (je Name, Pflicht oder optional): additiv NUR, wenn das alte
// Objekt, an dem sie hinzukommt, weitere Eigenschaften zulaesst - auf jeder Objektebene,
// denn vergleicheSchema laeuft rekursiv ueber properties und items. Sonst Bruch: ein
// Client, der das Ergebnis gegen die gehaltene alte Definition prueft (der MCP-SDK-Client
// tut das fuer structuredContent), lehnt die unbekannte Eigenschaft ab.
const neueAusgabeEigenschaft = (alt, ctx) => (name) => {
  const detail = pfadText([...ctx.pfad, name]);
  if (nimmtWeitereEigenschaften(alt)) {
    return befund({ art: "additiv", merkmal: "ausgabe: neue Eigenschaft", ort: ctx.ort, detail });
  }
  const merkmal = `ausgabe: neue Eigenschaft trotz additionalProperties ${kanonisch(alt.additionalProperties)}`;
  return befund({ art: "bruch", merkmal, ort: ctx.ort, detail });
};

function entfernteEigenschaft(name, ctx) {
  const was = ctx.richtung === "ausgabe" ? "Ausgabefeld entfernt" : "Eingabe-Eigenschaft entfernt";
  const detail = pfadText([...ctx.pfad, name]);
  return befund({ art: "bruch", merkmal: `${ctx.richtung}: ${was}`, ort: ctx.ort, detail });
}

function eigenschaftsAbweichungen(alt, neu, ctx) {
  const altProps = alt.properties ?? {};
  const neuProps = neu.properties ?? {};
  const altNamen = Object.keys(altProps);
  const neuNamen = Object.keys(neuProps);
  const neueEigenschaft = ctx.richtung === "ausgabe" ? neueAusgabeEigenschaft(alt, ctx) : neueEingabeEigenschaft(neu, ctx);
  const befunde = [
    ...nurIn(altNamen, neuNamen).map((name) => entfernteEigenschaft(name, ctx)),
    ...nurIn(neuNamen, altNamen).map(neueEigenschaft),
  ];
  for (const name of altNamen.filter((kandidat) => neuProps[kandidat] !== undefined)) {
    const kind = { ...ctx, pfad: [...ctx.pfad, name] };
    befunde.push(...vergleicheSchema(altProps[name], neuProps[name], kind));
  }
  return befunde;
}

// Pflicht-Aenderungen an Eigenschaften, die es vorher schon gab (neue Eigenschaften
// behandeln neueEingabeEigenschaft/neueAusgabeEigenschaft). Beide Richtungen sind Bruch: an
// der Eingabe wird es strenger bzw. lockerer, an der Ausgabe faellt ein Versprechen weg bzw.
// kommt ein neues hinzu.
function pflichtAbweichungen(alt, neu, ctx) {
  const altPflicht = alt.required ?? [];
  const neuPflicht = neu.required ?? [];
  const neuProps = neu.properties ?? {};
  const bestehend = Object.keys(alt.properties ?? {}).filter((name) => neuProps[name] !== undefined);
  const pflichtBefund = (merkmal) => (name) =>
    befund({ art: "bruch", merkmal: `${ctx.richtung}: ${merkmal}`, ort: ctx.ort, detail: pfadText([...ctx.pfad, name]) });
  const wirdPflicht = nurIn(neuPflicht, altPflicht).filter((name) => bestehend.includes(name));
  const nichtMehrPflicht = nurIn(altPflicht, neuPflicht).filter((name) => bestehend.includes(name));
  return [
    ...wirdPflicht.map(pflichtBefund("Feld wird Pflicht")),
    ...nichtMehrPflicht.map(pflichtBefund("Feld nicht mehr Pflicht")),
  ];
}

function vergleicheSchema(alt, neu, ctx) {
  if (alt === null && neu === null) return [];
  if (alt === null || neu === null) return schemaDaseinsAbweichung(alt, ctx);
  const befunde = [
    ...flacheAbweichungen(alt, neu, ctx),
    ...eigenschaftsAbweichungen(alt, neu, ctx),
    ...pflichtAbweichungen(alt, neu, ctx),
  ];
  if (alt.items || neu.items) {
    const kind = { ...ctx, pfad: [...ctx.pfad, "[]"] };
    befunde.push(...vergleicheSchema(alt.items ?? null, neu.items ?? null, kind));
  }
  return befunde;
}

// Genau eine Seite hat ein Schema: neu hinzugekommen ist nur das outputSchema selbst additiv.
function schemaDaseinsAbweichung(alt, ctx) {
  const detail = pfadText(ctx.pfad);
  if (alt !== null) return [befund({ art: "bruch", merkmal: `${ctx.richtung}: Schema entfernt`, ort: ctx.ort, detail })];
  const art = ctx.richtung === "ausgabe" && ctx.pfad.length === 0 ? "additiv" : "bruch";
  return [befund({ art, merkmal: `${ctx.richtung}: Schema neu`, ort: ctx.ort, detail })];
}

function hinweisAbweichungen(ort, alt, neu) {
  const geaendert = HINT_NAMEN.filter((hint) => alt.hinweise[hint] !== neu.hinweise[hint]);
  return geaendert.map((hint) =>
    befund({
      art: "bruch",
      merkmal: `Annotation ${hint} geaendert`,
      ort,
      detail: `${alt.hinweise[hint]} -> ${neu.hinweise[hint]}`,
    }),
  );
}

function werkzeugAbweichungen(name, alt, neu) {
  const ort = { werkzeug: name };
  const befunde = [
    ...vergleicheSchema(alt.eingabe, neu.eingabe, { richtung: "eingabe", pfad: [], ort }),
    ...vergleicheSchema(alt.ausgabe, neu.ausgabe, { richtung: "ausgabe", pfad: [], ort }),
    ...hinweisAbweichungen(ort, alt, neu),
  ];
  if (kanonisch(alt.ausfuehrung) !== kanonisch(neu.ausfuehrung)) {
    const detail = aenderungsText(alt.ausfuehrung, neu.ausfuehrung);
    befunde.push(befund({ art: "bruch", merkmal: "execution geaendert", ort, detail }));
  }
  return befunde;
}

function werkzeugListenAbweichungen(profil, alt, neu) {
  const entfernt = nurIn(alt.werkzeuge, neu.werkzeuge).map((werkzeug) =>
    befund({
      art: "bruch",
      merkmal: "Werkzeug entfernt oder umbenannt",
      ort: { profil, werkzeug },
      detail: `fehlt auf ${profil}`,
    }),
  );
  const hinzu = nurIn(neu.werkzeuge, alt.werkzeuge).map((werkzeug) =>
    befund({ art: "additiv", merkmal: "neues Werkzeug", ort: { profil, werkzeug }, detail: `neu auf ${profil}` }),
  );
  return [...entfernt, ...hinzu];
}

const gemeinsameWerkzeuge = (alt, neu) => alt.werkzeuge.filter((name) => neu.werkzeuge.includes(name));

function sicherheitsAbweichungen(profil, alt, neu) {
  const schema = (seite, werkzeug) => seite.sicherheitsschemata[werkzeug];
  const geaendert = gemeinsameWerkzeuge(alt, neu).filter(
    (werkzeug) => kanonisch(schema(alt, werkzeug)) !== kanonisch(schema(neu, werkzeug)),
  );
  return geaendert.map((werkzeug) =>
    befund({
      art: "bruch",
      merkmal: "securitySchemes geaendert",
      ort: { profil, werkzeug },
      detail: aenderungsText(schema(alt, werkzeug), schema(neu, werkzeug)),
    }),
  );
}

function widgetAbweichungen(profil, alt, neu) {
  const geaendert = gemeinsameWerkzeuge(alt, neu).filter((name) => alt.widgets[name] !== neu.widgets[name]);
  return geaendert.map((werkzeug) =>
    befund({
      art: "bruch",
      merkmal: "Widget-URI geaendert oder entfernt",
      ort: { profil, werkzeug, runbook: RUNBOOK_ANKER.widget, alteUri: alt.widgets[werkzeug] },
      detail: `${alt.widgets[werkzeug] ?? "(keins)"} -> ${neu.widgets[werkzeug] ?? "(keins)"}`,
    }),
  );
}

function ressourcenAbweichungen(profil, alt, neu) {
  const ort = { profil, runbook: RUNBOOK_ANKER.widget };
  const altUris = alt.ressourcen.map((eintrag) => eintrag.uri);
  const neuUris = neu.ressourcen.map((eintrag) => eintrag.uri);
  const neuMime = new Map(neu.ressourcen.map((eintrag) => [eintrag.uri, eintrag.mimeType]));
  const mimeGeaendert = alt.ressourcen.filter(
    (eintrag) => neuMime.has(eintrag.uri) && neuMime.get(eintrag.uri) !== eintrag.mimeType,
  );
  return [
    ...nurIn(altUris, neuUris).map((uri) =>
      befund({ art: "bruch", merkmal: "Resource-URI entfernt", ort: { ...ort, alteUri: uri }, detail: uri }),
    ),
    ...nurIn(neuUris, altUris).map((uri) => befund({ art: "additiv", merkmal: "neue Resource-URI", ort, detail: uri })),
    ...mimeGeaendert.map((eintrag) =>
      befund({
        art: "bruch",
        merkmal: "Resource-mimeType geaendert",
        ort,
        detail: `${eintrag.uri}: ${eintrag.mimeType} -> ${neuMime.get(eintrag.uri)}`,
      }),
    ),
  ];
}

function profilAbweichungen(profil, alt, neu) {
  const ort = { profil, runbook: RUNBOOK_ANKER.ablauf };
  if (!alt) return [befund({ art: "bruch", merkmal: "Profil nicht im Vertrag", ort, detail: profil })];
  if (!neu) return [befund({ art: "bruch", merkmal: "Profil nicht gemessen", ort, detail: profil })];
  return [
    ...werkzeugListenAbweichungen(profil, alt, neu),
    ...sicherheitsAbweichungen(profil, alt, neu),
    ...widgetAbweichungen(profil, alt, neu),
    ...ressourcenAbweichungen(profil, alt, neu),
  ];
}

// alt/neu: { profile, werkzeuge } -> Befundliste. Leer genau dann, wenn beide Staende
// dieselben Vertragsmerkmale tragen.
export function klassifiziere(alt, neu) {
  const profilIds = [...new Set([...Object.keys(alt.profile), ...Object.keys(neu.profile)])].sort();
  const befunde = profilIds.flatMap((id) => profilAbweichungen(id, alt.profile[id], neu.profile[id]));
  const gemeinsam = Object.keys(alt.werkzeuge).filter((name) => neu.werkzeuge[name] !== undefined);
  for (const name of gemeinsam.sort()) {
    befunde.push(...werkzeugAbweichungen(name, alt.werkzeuge[name], neu.werkzeuge[name]));
  }
  return befunde;
}

// Menschenlesbare Zeile je Befund, mit dem zustaendigen Runbook-Abschnitt.
export function befundZeile(eintrag) {
  const orte = [eintrag.profil && `Profil ${eintrag.profil}`, eintrag.werkzeug && `Werkzeug ${eintrag.werkzeug}`];
  const ort = orte.filter(Boolean).join(", ");
  return `${eintrag.art}: ${eintrag.merkmal} [${ort}] ${eintrag.detail} -> docs/RUNBOOK-MCP-UPDATE.md#${eintrag.runbook}`;
}

// ---- Aenderungskette ----

function eintragBefunde(eintrag, index) {
  const wo = `aenderungen[${index}]`;
  const befunde = [];
  if (!VERTRAG_ARTEN.includes(eintrag.art)) befunde.push(`${wo}: unbekannte art "${eintrag.art}"`);
  if (!ISO_DATUM.test(eintrag.datum ?? "")) befunde.push(`${wo}: datum nicht JJJJ-MM-TT`);
  if ((eintrag.begruendung ?? "").trim().length < MIN_BEGRUENDUNG_ZEICHEN) {
    befunde.push(`${wo}: begruendung kuerzer als ${MIN_BEGRUENDUNG_ZEICHEN} Zeichen`);
  }
  if (index === 0 && eintrag.art !== "erstfassung") befunde.push(`${wo}: erster Eintrag muss "erstfassung" sein`);
  if (index > 0 && eintrag.art === "erstfassung") befunde.push(`${wo}: "erstfassung" nur als erster Eintrag`);
  return befunde;
}

function katalogBefunde(vertrag) {
  const profilWerkzeuge = Object.values(vertrag.profile ?? {}).flatMap((profil) => profil.werkzeuge ?? []);
  const genutzt = [...new Set(profilWerkzeuge)];
  const katalog = Object.keys(vertrag.werkzeuge ?? {});
  return [
    ...nurIn(genutzt, katalog).map((name) => `werkzeuge: ${name} fehlt im Katalog`),
    ...nurIn(katalog, genutzt).map((name) => `werkzeuge: ${name} in keinem Profil`),
  ];
}

// Die Klasse, die ein Ketteneintrag nach der Klassifikation tragen muss: bruch, sobald ein
// Befund ein Bruch ist, sonst additiv; null, wenn sich kein Vertragsmerkmal aendert.
function sollArt(abweichungen) {
  if (abweichungen.length === 0) return null;
  return abweichungen.some((eintrag) => eintrag.art === "bruch") ? "bruch" : "additiv";
}

// Eintrag index gegen seinen Vorgaenger: art muss zur Klassifikation der beiden Staende
// passen. Damit laesst sich ein Bruch nicht als "additiv" eintragen.
function artBefunde(kette, index, standZu) {
  const wo = `aenderungen[${index}]`;
  const alt = standZu(kette[index - 1].stand_sha256);
  const neu = standZu(kette[index].stand_sha256);
  if (!alt || !neu) {
    return [`${wo}: Stand des Eintrags oder seines Vorgaengers nicht auffindbar - je Ketteneintrag ein Commit`];
  }
  const abweichungen = klassifiziere(alt, neu);
  const soll = sollArt(abweichungen);
  if (soll === null) return [`${wo}: keine Aenderung eines Vertragsmerkmals gegenueber dem Vorgaenger`];
  if (kette[index].art === soll) return [];
  const brueche = abweichungen.filter((eintrag) => eintrag.art === "bruch").map(befundZeile);
  return [`${wo}: art "${kette[index].art}", die Klassifikation ergibt "${soll}"`, ...brueche];
}

// Nur anhaengen: eine frueher committete Kette muss ein unveraendertes Praefix der
// aktuellen sein - jeder Eintrag kanonisch gleich, samt stand_sha256, art und
// begruendung. Ohne diese Regel liesse sich ein Bruch in einen bestehenden Eintrag
// hineinschreiben (z.B. den Hash der Erstfassung ueberschreiben), und die uebrigen
// Pruefungen blieben gruen, weil Vertrag und Draht wieder uebereinstimmen.
function praefixBefunde(kette, { quelle, aenderungen }) {
  if (aenderungen.length > kette.length) {
    return [`aenderungen: kuerzer als im committeten Stand ${quelle} - bestehende Eintraege nie entfernen`];
  }
  const index = aenderungen.findIndex((eintrag, i) => kanonisch(eintrag) !== kanonisch(kette[i]));
  if (index === -1) return [];
  return [`aenderungen[${index}]: weicht vom committeten Stand ${quelle} ab - bestehende Eintraege nie aendern, nur anhaengen`];
}

// vertrag: Inhalt von docs/mcp-vertrag.json. historie (Pflicht, damit keine Pruefung still
// entfaellt; Quelle: Datei-Stand und Git-Historie, s. Vertragstest):
//   standZu(stand_sha256) -> { profile, werkzeuge } oder undefined,
//   fruehereKetten: [{ quelle, aenderungen }] je committetem Stand der Vertragsdatei.
// -> Befundliste (leer = Kette in Ordnung).
export function pruefeKette(vertrag, { standZu, fruehereKetten }) {
  const kette = vertrag.aenderungen ?? [];
  if (kette.length === 0) return ["aenderungen: leer - mindestens die Erstfassung gehoert hinein"];
  const befunde = [...kette.flatMap(eintragBefunde), ...katalogBefunde(vertrag)];
  befunde.push(...fruehereKetten.flatMap((frueher) => praefixBefunde(kette, frueher)));
  for (let i = 1; i < kette.length; i++) befunde.push(...artBefunde(kette, i, standZu));
  for (let i = 1; i < kette.length; i++) {
    if (kette[i].stand_sha256 === kette[i - 1].stand_sha256) {
      befunde.push(`aenderungen[${i}]: gleicher stand_sha256 wie der Vorgaenger - Eintrag ohne Aenderung`);
    }
  }
  const ist = standSha256(vertrag);
  if (kette.at(-1).stand_sha256 !== ist) {
    befunde.push(`aenderungen: letzter stand_sha256 passt nicht zum Stand der Datei (${ist})`);
  }
  return befunde;
}

// ---- Veroeffentlichte Widget-URIs ----

export const fehlendeVeroeffentlichteUris = (veroeffentlicht, lesbar) =>
  veroeffentlicht.filter((uri) => !lesbar.includes(uri));

const WIDGET_URI = /^ui:\/\/hermes\/([a-z0-9-]+)\/v([1-9]\d*)\.html$/;

// ui://hermes/<widget>/v<version>.html -> { widgetId, version } oder null.
export function widgetUriTeile(uri) {
  const treffer = WIDGET_URI.exec(uri);
  return treffer ? { widgetId: treffer[1], version: Number(treffer[2]) } : null;
}

// Jede Widget- und Resource-URI, die irgendein Profil eines Stands nennt.
function standUris(stand) {
  const profile = Object.values(stand.profile ?? {});
  const uris = profile.flatMap((profil) => [
    ...Object.values(profil.widgets ?? {}),
    ...(profil.ressourcen ?? []).map((eintrag) => eintrag.uri),
  ]);
  return [...new Set(uris)].sort();
}

// Geschuetzte Widget-URIs (veroeffentlichte_widget_uris): die "published UI resource URIs",
// die der Server waehrend der Pruefungsluecke weiter ausliefern muss (Runbook, Abschnitt
// Widget-URIs). Hinein gehoert deshalb NUR eine URI, die der veroeffentlichte Stand
// (veroeffentlichung) nennt: ohne Veroeffentlichung ist die Liste leer, und rueckt die Marke
// auf einen Stand vor, der eine URI nicht mehr nennt, ist die Luecke fuer sie vorbei und sie
// faellt heraus. Dass eine verdraengte URI hineingehoert, erzwingt die Sperre
// (markenBruchBefunde), dass sie lesbar bleibt, der Draht-Test.
// umgebung: { standZu(stand_sha256) -> { profile, werkzeuge } oder undefined }.
export function geschuetzteUriBefunde(vertrag, { standZu }) {
  const marke = vertrag.veroeffentlichung ?? null;
  const live = marke ? standZu(marke.stand_sha256) : undefined;
  const veroeffentlicht = live ? standUris(live) : [];
  return nurIn(vertrag.veroeffentlichte_widget_uris ?? [], veroeffentlicht).map(
    (uri) => `veroeffentlichte_widget_uris: ${uri} ist keine URI des veroeffentlichten Stands - aus der Liste nehmen`,
  );
}

// ---- Sperre nach der Veroeffentlichung ----

// Waehrend der Pruefungsluecke muss die gehaltene Definition weiter funktionieren ("Keep
// existing input schemas and each published UI resource URI working during that gap.").
// Vertraeglich ist deshalb genau EIN Bruch: eine verdraengte Widget- bzw. Resource-URI,
// solange die alte URI geschuetzt ist - dann verlangt der Draht-Test, dass sie lesbar bleibt.
// Alles andere ist gesperrt, egal welcher Ketteneintrag es begleitet: auch ein entferntes
// oder umbenanntes Werkzeug, denn sein veroeffentlichtes Eingabeschema funktionierte bis zum
// naechsten Scan nicht mehr.
const vertraeglicherBruch = (eintrag, geschuetzt) => eintrag.alteUri !== undefined && geschuetzt.includes(eintrag.alteUri);

const kettenIndex = (vertrag, hash) => (vertrag.aenderungen ?? []).findIndex((eintrag) => eintrag.stand_sha256 === hash);
const markeVon = (frueher) => frueher.vertrag.veroeffentlichung ?? null;

function markenHistorieBefunde(vertrag, marke, fruehereVertraege) {
  const befunde = [];
  for (const frueher of fruehereVertraege) {
    const veroeffentlichung = markeVon(frueher);
    if (!veroeffentlichung) continue;
    if (!marke) {
      befunde.push(`veroeffentlichung: entfernt, stand in ${frueher.quelle} - die Marke wandert nur vorwaerts`);
      continue;
    }
    if (kettenIndex(vertrag, marke.stand_sha256) < kettenIndex(vertrag, veroeffentlichung.stand_sha256)) {
      befunde.push(`veroeffentlichung: zeigt auf einen aelteren Stand als in ${frueher.quelle} - nur vorwaerts`);
    }
  }
  return befunde;
}

function markenBruchBefunde(vertrag, marke, standZu) {
  if (!ISO_DATUM.test(marke.datum ?? "")) return ["veroeffentlichung: datum nicht JJJJ-MM-TT"];
  if (kettenIndex(vertrag, marke.stand_sha256) === -1) {
    return ["veroeffentlichung: stand_sha256 ist kein Stand der Aenderungskette"];
  }
  const live = standZu(marke.stand_sha256);
  if (!live) return ["veroeffentlichung: veroeffentlichter Stand nicht auffindbar - je Ketteneintrag ein Commit"];
  const geschuetzt = vertrag.veroeffentlichte_widget_uris ?? [];
  const gesperrt = klassifiziere(live, vertrag).filter(
    (eintrag) => eintrag.art === "bruch" && !vertraeglicherBruch(eintrag, geschuetzt),
  );
  const wo = `docs/RUNBOOK-MCP-UPDATE.md#${RUNBOOK_ANKER.sperre}`;
  return gesperrt.map((eintrag) => `gesperrt nach der Veroeffentlichung (${wo}): ${befundZeile(eintrag)}`);
}

// Ein frueherer Commit ist Vorlauf des neuen veroeffentlichten Stands, wenn er genau diesen
// Stand unter der bisherigen Marke trug und dort die Sperre bestand.
function istVorlauf(frueher, marke, { bisher, standZu }) {
  const vertrag = frueher.vertrag;
  if (standSha256(vertrag) !== marke.stand_sha256) return false;
  if (markeVon(frueher)?.stand_sha256 !== bisher.stand_sha256) return false;
  return markenBruchBefunde(vertrag, bisher, standZu).length === 0;
}

// Die Marke rueckt nur auf einen Stand vor, der vorher unter der bisherigen Marke committet
// war und dort die Sperre bestanden hat. Damit legitimiert weder ein Ketteneintrag noch das
// Versetzen der Marke einen Bruch gegen den bisher veroeffentlichten Stand. Die erste Marke
// setzt den Ausgangsstand und braucht keinen Vorlauf.
function vorlaufBefunde(marke, { standZu, fruehereVertraege }) {
  const bisher = fruehereVertraege.map(markeVon).find((frueher) => frueher && frueher.stand_sha256 !== marke.stand_sha256);
  if (!bisher) return [];
  if (fruehereVertraege.some((frueher) => istVorlauf(frueher, marke, { bisher, standZu }))) return [];
  return [
    `veroeffentlichung: ${marke.stand_sha256} war nie unter der bisherigen Marke committet und dort sperrfrei - ` +
      "erst den Stand unter der alten Marke committen, die Marke erst nach der Freigabe vorruecken",
  ];
}

// veroeffentlichung: null (nichts veroeffentlicht) oder { datum, stand_sha256 } - der Stand,
// den OpenAI live haelt. Ab dann vergleicht diese Pruefung den AKTUELLEN Vertrag (= Draht,
// s. Draht-Test) mit dem Stand der Marke und sperrt jeden Bruch gegen ihn - kumulativ, also
// auch ueber mehrere Ketteneintraege hinweg. Zwischenstaende, die nie Stand der Marke waren
// (auch einzeln von OpenAI freigegebene Werkzeuge), schuetzt sie nicht (Runbook, Sperre).
// Die Marke wandert nur vorwaerts und nur ueber einen Vorlauf (vorlaufBefunde).
// umgebung: { standZu, fruehereVertraege: [{ quelle, vertrag }] je committetem Stand, neuester zuerst }.
export function veroeffentlichungsBefunde(vertrag, umgebung) {
  const marke = vertrag.veroeffentlichung ?? null;
  const befunde = markenHistorieBefunde(vertrag, marke, umgebung.fruehereVertraege);
  if (marke) befunde.push(...markenBruchBefunde(vertrag, marke, umgebung.standZu), ...vorlaufBefunde(marke, umgebung));
  return befunde;
}

// ---- Runbook-Verweise ----

// Interne Kennungen (Phasen-, Befund-, Owner-Nummern) gehoeren in kein Dokument unter docs/.
export const interneKennungen = (text) => [...text.matchAll(INTERNE_KENNUNG)].map(([kennung]) => kennung);

function pfadAusVerweis(verweis) {
  const [pfad] = verweis.split(/[:#]/);
  const istPfad = pfad === "package.json" || VERWEIS_PRAEFIXE.some((praefix) => pfad.startsWith(praefix));
  return istPfad ? pfad : null;
}

// text: Runbook-Inhalt; umgebung: { exists(pfad) -> bool, skripte: [npm-Skriptnamen] }.
export function runbookBefunde(text, { exists, skripte }) {
  const befunde = [];
  for (const [, verweis] of text.matchAll(/`([^`\s]+)`/g)) {
    const pfad = pfadAusVerweis(verweis);
    if (pfad && !exists(pfad)) befunde.push(`Verweis auf nicht existierende Datei: ${pfad}`);
  }
  for (const [, skript] of text.matchAll(/npm run ([\w:-]+)/g)) {
    if (!skripte.includes(skript)) befunde.push(`npm run ${skript}: kein Skript in package.json`);
  }
  befunde.push(...interneKennungen(text).map((kennung) => `interne Kennung: ${kennung}`));
  for (const anker of Object.values(RUNBOOK_ANKER)) {
    if (!text.includes(`<a id="${anker}"></a>`)) befunde.push(`Anker fehlt: #${anker}`);
  }
  return befunde;
}
