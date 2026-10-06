import { createHash } from "node:crypto";

const TEXT_SCHLUESSEL = ["description", "title", "$schema", "examples"];
const REKURSIVE_SCHLUESSEL = ["properties", "items", "required"];
const SCHEMA_LISTEN = ["anyOf", "allOf", "oneOf"];
const IGNORIERT = [...TEXT_SCHLUESSEL, ...REKURSIVE_SCHLUESSEL];
const HINT_NAMEN = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];

export const RUNBOOK_ANKER = Object.freeze({
  additiv: "additive-aenderung",
  bruch: "bruch",
  widget: "widget-uris",
  ablauf: "ablauf-bei-rot",
  sperre: "sperre",
});

export const VERTRAG_ARTEN = Object.freeze(["erstfassung", "additiv", "bruch"]);
export const MIN_BEGRUENDUNG_ZEICHEN = 40;
const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

const VERWEIS_PRAEFIXE = ["docs/", "src/", "test/", "scripts/"];
const INTERNE_KENNUNG = /\b(T2-\d+|T-\d+|OW-[A-Z0-9]+|H-\d+|[NOWX]-\d+)\b/g;

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

const nachUri = (links, rechts) => (links.uri < rechts.uri ? -1 : Number(links.uri > rechts.uri));
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

export function teilstand(stand, profilId) {
  const profil = stand.profile[profilId];
  if (!profil) return { profile: {}, werkzeuge: {} };
  const namen = profil.werkzeuge.filter((name) => stand.werkzeuge[name] !== undefined);
  return {
    profile: { [profilId]: profil },
    werkzeuge: Object.fromEntries(namen.map((name) => [name, stand.werkzeuge[name]])),
  };
}

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

const neueEingabeEigenschaft = (neu, ctx) => (name) => {
  const detail = pfadText([...ctx.pfad, name]);
  if ((neu.required ?? []).includes(name)) {
    return befund({ art: "bruch", merkmal: "eingabe: neues Pflichtfeld", ort: ctx.ort, detail });
  }
  return befund({ art: "additiv", merkmal: "eingabe: neue optionale Eigenschaft", ort: ctx.ort, detail });
};

const nimmtWeitereEigenschaften = (schema) => schema.additionalProperties === undefined || schema.additionalProperties === true;

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

export function klassifiziere(alt, neu) {
  const profilIds = [...new Set([...Object.keys(alt.profile), ...Object.keys(neu.profile)])].sort();
  const befunde = profilIds.flatMap((id) => profilAbweichungen(id, alt.profile[id], neu.profile[id]));
  const gemeinsam = Object.keys(alt.werkzeuge).filter((name) => neu.werkzeuge[name] !== undefined);
  for (const name of gemeinsam.sort()) {
    befunde.push(...werkzeugAbweichungen(name, alt.werkzeuge[name], neu.werkzeuge[name]));
  }
  return befunde;
}

export function befundZeile(eintrag) {
  const orte = [eintrag.profil && `Profil ${eintrag.profil}`, eintrag.werkzeug && `Werkzeug ${eintrag.werkzeug}`];
  const ort = orte.filter(Boolean).join(", ");
  return `${eintrag.art}: ${eintrag.merkmal} [${ort}] ${eintrag.detail} -> docs/RUNBOOK-MCP-UPDATE.md#${eintrag.runbook}`;
}

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

function sollArt(abweichungen) {
  if (abweichungen.length === 0) return null;
  return abweichungen.some((eintrag) => eintrag.art === "bruch") ? "bruch" : "additiv";
}

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

function praefixBefunde(kette, { quelle, aenderungen }) {
  if (aenderungen.length > kette.length) {
    return [`aenderungen: kuerzer als im committeten Stand ${quelle} - bestehende Eintraege nie entfernen`];
  }
  const index = aenderungen.findIndex((eintrag, i) => kanonisch(eintrag) !== kanonisch(kette[i]));
  if (index === -1) return [];
  return [`aenderungen[${index}]: weicht vom committeten Stand ${quelle} ab - bestehende Eintraege nie aendern, nur anhaengen`];
}

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

export const fehlendeVeroeffentlichteUris = (veroeffentlicht, lesbar) =>
  veroeffentlicht.filter((uri) => !lesbar.includes(uri));

const WIDGET_URI = /^ui:\/\/hermes\/([a-z0-9-]+)\/v([1-9]\d*)\.html$/;

export function widgetUriTeile(uri) {
  const treffer = WIDGET_URI.exec(uri);
  return treffer ? { widgetId: treffer[1], version: Number(treffer[2]) } : null;
}

function standUris(stand) {
  const profile = Object.values(stand.profile ?? {});
  const uris = profile.flatMap((profil) => [
    ...Object.values(profil.widgets ?? {}),
    ...(profil.ressourcen ?? []).map((eintrag) => eintrag.uri),
  ]);
  return [...new Set(uris)].sort();
}

export function geschuetzteUriBefunde(vertrag, { standZu }) {
  const marke = vertrag.veroeffentlichung ?? null;
  const live = marke ? standZu(marke.stand_sha256) : undefined;
  const veroeffentlicht = live ? standUris(live) : [];
  return nurIn(vertrag.veroeffentlichte_widget_uris ?? [], veroeffentlicht).map(
    (uri) => `veroeffentlichte_widget_uris: ${uri} ist keine URI des veroeffentlichten Stands - aus der Liste nehmen`,
  );
}

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

function istVorlauf(frueher, marke, { bisher, standZu }) {
  const vertrag = frueher.vertrag;
  if (standSha256(vertrag) !== marke.stand_sha256) return false;
  if (markeVon(frueher)?.stand_sha256 !== bisher.stand_sha256) return false;
  return markenBruchBefunde(vertrag, bisher, standZu).length === 0;
}

function vorlaufBefunde(marke, { standZu, fruehereVertraege }) {
  const bisher = fruehereVertraege.map(markeVon).find((frueher) => frueher && frueher.stand_sha256 !== marke.stand_sha256);
  if (!bisher) return [];
  if (fruehereVertraege.some((frueher) => istVorlauf(frueher, marke, { bisher, standZu }))) return [];
  return [
    `veroeffentlichung: ${marke.stand_sha256} war nie unter der bisherigen Marke committet und dort sperrfrei - ` +
      "erst den Stand unter der alten Marke committen, die Marke erst nach der Freigabe vorruecken",
  ];
}

export function veroeffentlichungsBefunde(vertrag, umgebung) {
  const marke = vertrag.veroeffentlichung ?? null;
  const befunde = markenHistorieBefunde(vertrag, marke, umgebung.fruehereVertraege);
  if (marke) befunde.push(...markenBruchBefunde(vertrag, marke, umgebung.standZu), ...vorlaufBefunde(marke, umgebung));
  return befunde;
}

export const interneKennungen = (text) => [...text.matchAll(INTERNE_KENNUNG)].map(([kennung]) => kennung);

function pfadAusVerweis(verweis) {
  const [pfad] = verweis.split(/[:#]/);
  const istPfad = pfad === "package.json" || VERWEIS_PRAEFIXE.some((praefix) => pfad.startsWith(praefix));
  return istPfad ? pfad : null;
}

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
