// Kompatibilitaetsvertrag des MCP-Servers (docs/mcp-vertrag.json, Vorgang in
// docs/RUNBOOK-MCP-UPDATE.md). Der Vertrag friert den Stand NICHT ein: jede Aenderung ist
// erlaubt, braucht aber einen Eintrag in der Aenderungskette. Wird ein Draht-Test rot,
// nennt die Meldung jede Abweichung mit Klasse (bruch/additiv) und Runbook-Abschnitt und
// schreibt den gemessenen Ist-Stand samt Hash in eine Datei unter os.tmpdir().
// Nach der Veroeffentlichung greifen zwei Regeln technisch statt nur per Runbook: der Test
// sperrt jeden Bruch gegen den veroeffentlichten Stand, den eine gehaltene Definition nicht
// vertraegt (eine verdraengte Widget-URI nur, wenn sie geschuetzt ist), und jede geschuetzte
// URI muss am Draht mit ihren gepinnten Bytes lesbar sein. Geschuetzt sind nur URIs des
// veroeffentlichten Stands, solange die Pruefungsluecke dauert - vor der Veroeffentlichung
// ist die Liste leer.
//
// Gemessen wird NUR am echten Draht (tools/list, resources/list, resources/read ueber
// HTTP /mcp und stdio, test/mcp-draht-pfade.js) - registerTool() verwirft unbekannte Felder
// still, ein Test am Registrierungsobjekt bewiese nichts. Es wird kein Werkzeug aufgerufen.
// Testnamen ohne Katalog-Praefix: dieser Test gehoert in `npm test`, nicht in test:gates.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { WIDGET_CALL, widgetHtml, widgetVersion } from "../src/ui/widget-catalog.js";
import {
  legacySnapshot,
  oauthSnapshot,
  stdioSnapshot,
  tokenSnapshot,
  CONSULT_ON,
  OAUTH_SUBJECT,
  NO_TENANT_SUBJECT,
} from "./mcp-draht-pfade.js";
import {
  RUNBOOK_ANKER,
  befundZeile,
  fehlendeVeroeffentlichteUris,
  geschuetzteUriBefunde,
  interneKennungen,
  kanonisch,
  klassifiziere,
  pruefeKette,
  runbookBefunde,
  standAusDraht,
  standSha256,
  teilstand,
  veroeffentlichungsBefunde,
  widgetUri,
  widgetUriTeile,
} from "./mcp-vertrag-pruefung.js";

const VERTRAG_RELATIV = "docs/mcp-vertrag.json";
const VERTRAG_PFAD = path.join(ROOT, VERTRAG_RELATIV);
const RUNBOOK_DATEI = "docs/RUNBOOK-MCP-UPDATE.md";
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const UI_ON = Object.freeze({ MCP_UI_ENABLED: "true" });
const JSON_EINRUECKUNG = 2;

// Fehlt die Datei, gilt ein leerer Vertrag: jeder Draht-Test wird rot und schreibt den
// Ist-Stand - so entsteht die Erstfassung aus dem Draht, nie von Hand.
const LEERER_VERTRAG = { profile: {}, werkzeuge: {}, veroeffentlichte_widget_uris: [], aenderungen: [] };
const VERTRAG = fs.existsSync(VERTRAG_PFAD) ? JSON.parse(fs.readFileSync(VERTRAG_PFAD, "utf8")) : LEERER_VERTRAG;
// Jede Messung liest die geschuetzten Widget-URIs zusaetzlich direkt per resources/read -
// auch die, die resources/list nicht mehr nennt (verdraengte, aber noch veroeffentlichte
// Fassungen).
const MIT_RESSOURCEN = Object.freeze({ ressourcen: true, zusatzUris: VERTRAG.veroeffentlichte_widget_uris });

// Profil-Ids stehen gleichlautend im Vertrag. ui: das Profil registriert Widgets.
const PROFILE = Object.freeze([
  { id: "http-legacy", messen: () => legacySnapshot({}, MIT_RESSOURCEN) },
  { id: "http-legacy-consult", messen: () => legacySnapshot(CONSULT_ON, MIT_RESSOURCEN) },
  { id: "http-legacy-ui", ui: true, messen: () => legacySnapshot(UI_ON, MIT_RESSOURCEN) },
  { id: "http-token", messen: () => tokenSnapshot({}, MIT_RESSOURCEN) },
  { id: "http-oauth", messen: () => oauthSnapshot({ subject: OAUTH_SUBJECT, ...MIT_RESSOURCEN }) },
  {
    id: "http-oauth-consult",
    messen: () => oauthSnapshot({ subject: OAUTH_SUBJECT, env: CONSULT_ON, ...MIT_RESSOURCEN }),
  },
  {
    id: "http-oauth-consult-ui",
    ui: true,
    messen: () => oauthSnapshot({ subject: OAUTH_SUBJECT, env: { ...CONSULT_ON, ...UI_ON }, ...MIT_RESSOURCEN }),
  },
  // OAuth mit UI ohne Consult: die Kombination der Code-Defaults beider Schalter.
  { id: "http-oauth-ui", ui: true, messen: () => oauthSnapshot({ subject: OAUTH_SUBJECT, env: UI_ON, ...MIT_RESSOURCEN }) },
  { id: "http-oauth-ohne-mandant", messen: () => oauthSnapshot({ subject: NO_TENANT_SUBJECT, ...MIT_RESSOURCEN }) },
  {
    id: "http-oauth-ohne-mandant-ui",
    ui: true,
    messen: () => oauthSnapshot({ subject: NO_TENANT_SUBJECT, env: UI_ON, ...MIT_RESSOURCEN }),
  },
  { id: "stdio", messen: () => stdioSnapshot({}, MIT_RESSOURCEN) },
  { id: "stdio-consult-env", messen: () => stdioSnapshot(CONSULT_ON, MIT_RESSOURCEN) },
  { id: "stdio-ui", ui: true, messen: () => stdioSnapshot(UI_ON, MIT_RESSOURCEN) },
]);

// Draht-Messungen der D1-Faelle, von D1-Gesamtstand und D2 wiederverwendet (ein Start je Profil).
const gemessen = {};

// Schreibt NUR Schemata, Namen und URIs (keine Daten, keine Secrets) nach os.tmpdir().
function schreibeIstStand(name, stand) {
  const datei = path.join(os.tmpdir(), `mcp-vertrag-ist-${name}.json`);
  const inhalt = { profile: stand.profile, werkzeuge: stand.werkzeuge, stand_sha256: standSha256(stand) };
  fs.writeFileSync(datei, `${JSON.stringify(inhalt, null, JSON_EINRUECKUNG)}\n`);
  return datei;
}

function vertragsMeldung(befunde, datei) {
  return [
    `Der Draht weicht vom Kompatibilitaetsvertrag (docs/mcp-vertrag.json) ab - ${befunde.length} Befund(e):`,
    ...befunde.map((eintrag) => `  - ${befundZeile(eintrag)}`),
    `Ist-Stand samt stand_sha256: ${datei}`,
    `Vorgang: ${RUNBOOK_DATEI}#${RUNBOOK_ANKER.ablauf}`,
  ].join("\n");
}

// Token-Modus: gemessen ueber localhost MIT Token (nur dort gibt es eine Werkzeugliste,
// s. tokenSnapshot). Beleg, dass der Auth-Pfad greift: ohne Token 401 - lokal UND ueber die
// Interface-IP; mit Token ueber die Interface-IP 403 (kein Mandant, fail-closed).
function pruefeTokenPfad(kontext, draht) {
  assert.equal(draht.ohneTokenStatus, HTTP_UNAUTHORIZED, "localhost ohne Token muss 401 liefern");
  if (!draht.interfaceIp) {
    kontext.diagnostic("keine Interface-IP vorhanden: Auth-Beleg nur ueber localhost");
    return;
  }
  assert.equal(draht.interfaceIp.ohneToken, HTTP_UNAUTHORIZED, "Interface-IP ohne Token muss 401 liefern");
  assert.equal(draht.interfaceIp.mitToken, HTTP_FORBIDDEN, "Interface-IP mit Token: kein Mandant, 403");
}

// ---- D1: je Profil der echte Draht gegen den Vertrag ----

for (const profil of PROFILE) {
  test(`Kompatibilitaetsvertrag D1: Draht-Profil ${profil.id} entspricht dem Vertrag`, async (kontext) => {
    const draht = await profil.messen();
    gemessen[profil.id] = draht;
    if (profil.id === "http-token") pruefeTokenPfad(kontext, draht);
    if (!profil.ui) {
      const mitUi = draht.tools.filter((tool) => tool._meta?.ui !== undefined);
      const namen = mitUi.map((tool) => tool.name);
      assert.deepEqual(namen, [], `${profil.id} ist kein UI-Profil, traegt aber _meta.ui`);
    }
    const ist = standAusDraht({ [profil.id]: draht });
    const befunde = klassifiziere(teilstand(VERTRAG, profil.id), ist);
    if (befunde.length > 0) assert.fail(vertragsMeldung(befunde, schreibeIstStand(profil.id, ist)));
  });
}

test("Kompatibilitaetsvertrag D1: Gesamtstand aller Profile ist pfad-konsistent und gleich dem Vertrag", () => {
  const fehlend = PROFILE.map((profil) => profil.id).filter((id) => !gemessen[id]);
  assert.deepEqual(fehlend, [], "Profile ohne Messung (deren D1-Fall ist vorher gescheitert)");
  const ist = standAusDraht(gemessen);
  if (standSha256(ist) === standSha256(VERTRAG)) return;
  assert.fail(vertragsMeldung(klassifiziere(VERTRAG, ist), schreibeIstStand("gesamt", ist)));
});

// ---- D2: veroeffentlichte und referenzierte Widget-URIs sind lesbar ----

// Die Pin-Datei direkt gelesen (wie test/openai-t2-02-widget-uris.test.js): Version ->
// SHA-256 des ausgelieferten HTML je Widget.
const WIDGET_PINS = JSON.parse(fs.readFileSync(path.join(ROOT, "src/ui/widget-versions.json"), "utf8"));
const sha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");

// Pin einer versionierten Widget-URI (undefined ohne Pin).
function pinFuerUri(uri) {
  const teile = widgetUriTeile(uri);
  return teile ? WIDGET_PINS[teile.widgetId]?.[String(teile.version)] : undefined;
}

// Eine gelesene geschuetzte URI liefert am Draht genau die gepinnten Bytes ihrer Version -
// die alte Fassung, nicht die aktuelle unter altem Namen; ohne Pin ist jede Fassung fremd.
// draht: { inhalte: uri -> text }, geschuetzt: veroeffentlichte_widget_uris.
function fremdeBytes(profilId, draht, geschuetzt) {
  const gelesen = geschuetzt.filter((uri) => draht.inhalte[uri] !== undefined);
  const abweichend = gelesen.filter((uri) => sha256Hex(draht.inhalte[uri]) !== pinFuerUri(uri));
  return abweichend.map((uri) => `${profilId}: ${uri} liefert andere Bytes als ihr Pin`);
}

test("Kompatibilitaetsvertrag D2: veroeffentlichte und referenzierte Widget-URIs sind auf jedem UI-Profil lesbar", () => {
  const befunde = [];
  for (const profil of PROFILE.filter((profil) => profil.ui)) {
    const draht = gemessen[profil.id];
    assert.ok(draht, `${profil.id} nicht gemessen (D1-Fall gescheitert)`);
    const referenziert = draht.tools.map(widgetUri).filter(Boolean);
    const gelistet = draht.resources.map((eintrag) => eintrag.uri);
    for (const uri of fehlendeVeroeffentlichteUris(VERTRAG.veroeffentlichte_widget_uris, draht.lesbar)) {
      befunde.push(`${profil.id}: veroeffentlichte URI nicht lesbar: ${uri}`);
    }
    befunde.push(...fremdeBytes(profil.id, draht, VERTRAG.veroeffentlichte_widget_uris));
    for (const uri of fehlendeVeroeffentlichteUris([...referenziert, ...gelistet], draht.lesbar)) {
      befunde.push(`${profil.id}: referenzierte oder gelistete URI nicht lesbar: ${uri}`);
    }
  }
  assert.deepEqual(befunde, [], `Abschnitt "Widget-URIs nach der Veroeffentlichung": ${RUNBOOK_DATEI}#${RUNBOOK_ANKER.widget}`);
});

// ---- U1: Klassifikation an einem synthetischen Stand (Positiv-Kontrollen je Klasse) ----

// Kopie von basis mit den Operationen { pfad, wert } (setzen) bzw. { pfad, entfernen: true }.
// Die Kontrollen beschreiben so nur, WAS sich aendert; basis selbst bleibt unberuehrt.
function abgeleitet(basis, operationen) {
  const kopie = structuredClone(basis);
  for (const { pfad, wert, entfernen } of operationen) {
    const eltern = pfad.slice(0, -1).reduce((knoten, schluessel) => knoten[schluessel], kopie);
    const letzter = pfad.at(-1);
    if (entfernen) delete eltern[letzter];
    else eltern[letzter] = structuredClone(wert);
  }
  return kopie;
}

const SICHERHEIT = [{ type: "oauth2", scopes: ["openid"] }];
const HINWEISE_SCHREIBEND = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
const HINWEISE_LESEND = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WIDGET_A = "ui://probe/a/v1.html";
const WIDGET_MIME = "text/html;profile=mcp-app";

const FIXTURE_DRAHT = {
  probe: {
    tools: [
      {
        name: "werkzeug_a",
        description: "Text ist kein Vertragsmerkmal",
        inputSchema: {
          type: "object",
          properties: { ziel: { type: "string" }, notiz: { type: "string" }, art: { type: "string", enum: ["x", "y"] } },
          required: ["ziel"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: { id: { type: "string" }, zeilen: { type: "array", items: { type: "string" } } },
          required: ["id", "zeilen"],
          additionalProperties: false,
        },
        annotations: HINWEISE_SCHREIBEND,
        execution: { taskSupport: "forbidden" },
        securitySchemes: SICHERHEIT,
        _meta: { ui: { resourceUri: WIDGET_A } },
      },
      {
        name: "werkzeug_b",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: HINWEISE_LESEND,
        securitySchemes: SICHERHEIT,
      },
    ],
    resources: [{ uri: WIDGET_A, mimeType: WIDGET_MIME }],
  },
};
const BASIS = standAusDraht(FIXTURE_DRAHT);

const PROFIL_P = ["profile", "probe"];
const WERKZEUG_A = ["werkzeuge", "werkzeug_a"];
const A_EIN = [...WERKZEUG_A, "eingabe"];
const A_AUS = [...WERKZEUG_A, "ausgabe"];
const setze = (pfad, wert) => ({ pfad, wert });
const entferne = (pfad) => ({ pfad, entfernen: true });

const KLASSIFIKATION = [
  ["identischer Stand", [], []],
  [
    "Werkzeug entfernt",
    [setze([...PROFIL_P, "werkzeuge"], ["werkzeug_a"]), entferne(["werkzeuge", "werkzeug_b"])],
    [["bruch", "Werkzeug entfernt"]],
  ],
  [
    "Werkzeug umbenannt",
    [
      setze([...PROFIL_P, "werkzeuge"], ["werkzeug_a", "werkzeug_c"]),
      setze(["werkzeuge", "werkzeug_c"], BASIS.werkzeuge.werkzeug_b),
      entferne(["werkzeuge", "werkzeug_b"]),
      setze([...PROFIL_P, "sicherheitsschemata"], { werkzeug_a: SICHERHEIT, werkzeug_c: SICHERHEIT }),
    ],
    [
      ["bruch", "Werkzeug entfernt"],
      ["additiv", "neues Werkzeug"],
    ],
  ],
  [
    "neues Pflichtfeld",
    [setze([...A_EIN, "properties", "pflicht"], { type: "string" }), setze([...A_EIN, "required"], ["pflicht", "ziel"])],
    [["bruch", "neues Pflichtfeld"]],
  ],
  ["bestehendes Feld wird Pflicht", [setze([...A_EIN, "required"], ["notiz", "ziel"])], [["bruch", "Feld wird Pflicht"]]],
  ["Pflicht an der Eingabe aufgehoben", [setze([...A_EIN, "required"], [])], [["bruch", "Feld nicht mehr Pflicht"]]],
  ["Typwechsel Eingabe", [setze([...A_EIN, "properties", "ziel", "type"], "number")], [["bruch", "eingabe: type geaendert"]]],
  [
    "optionale Eingabe-Eigenschaft entfernt",
    [entferne([...A_EIN, "properties", "notiz"])],
    [["bruch", "Eingabe-Eigenschaft entfernt"]],
  ],
  ["enum verengt", [setze([...A_EIN, "properties", "art", "enum"], ["x"])], [["bruch", "enum geaendert"]]],
  [
    "enum erweitert (fail-closed)",
    [setze([...A_EIN, "properties", "art", "enum"], ["x", "y", "z"])],
    [["bruch", "enum geaendert"]],
  ],
  [
    "additionalProperties geaendert",
    [setze([...A_EIN, "additionalProperties"], true)],
    [["bruch", "additionalProperties geaendert"]],
  ],
  [
    "Ausgabefeld entfernt",
    [entferne([...A_AUS, "properties", "zeilen"]), setze([...A_AUS, "required"], ["id"])],
    [["bruch", "Ausgabefeld entfernt"]],
  ],
  ["Ausgabefeld nicht mehr Pflicht", [setze([...A_AUS, "required"], ["id"])], [["bruch", "Feld nicht mehr Pflicht"]]],
  [
    "Typwechsel in Ausgabe-items",
    [setze([...A_AUS, "properties", "zeilen", "items", "type"], "number")],
    [["bruch", "ausgabe: type"]],
  ],
  ["outputSchema entfernt", [setze(A_AUS, null)], [["bruch", "Schema entfernt"]]],
  ["Annotation-Hint geaendert", [setze([...WERKZEUG_A, "hinweise", "destructiveHint"], false)], [["bruch", "destructiveHint"]]],
  ["execution geaendert", [setze([...WERKZEUG_A, "ausfuehrung"], null)], [["bruch", "execution"]]],
  [
    "securitySchemes geaendert",
    [setze([...PROFIL_P, "sicherheitsschemata", "werkzeug_b"], [{ type: "noauth" }])],
    [["bruch", "securitySchemes"]],
  ],
  [
    "Widget-URI geaendert",
    [setze([...PROFIL_P, "widgets", "werkzeug_a"], "ui://probe/a/v2.html")],
    [["bruch", "Widget-URI"]],
  ],
  ["Resource-URI entfernt", [setze([...PROFIL_P, "ressourcen"], [])], [["bruch", "Resource-URI entfernt"]]],
  [
    "neue optionale Eingabe",
    [setze([...A_EIN, "properties", "extra"], { type: "string" })],
    [["additiv", "neue optionale Eigenschaft"]],
  ],
  [
    "neues outputSchema, wo keins war",
    [setze(["werkzeuge", "werkzeug_b", "ausgabe"], { type: "object", properties: {} })],
    [["additiv", "Schema neu"]],
  ],
  [
    "neues Werkzeug",
    [
      setze([...PROFIL_P, "werkzeuge"], ["werkzeug_a", "werkzeug_b", "werkzeug_neu"]),
      setze(["werkzeuge", "werkzeug_neu"], BASIS.werkzeuge.werkzeug_b),
    ],
    [["additiv", "neues Werkzeug"]],
  ],
  [
    "neue Resource",
    [setze([...PROFIL_P, "ressourcen", 1], { uri: "ui://probe/b/v1.html", mimeType: WIDGET_MIME })],
    [["additiv", "neue Resource-URI"]],
  ],
];

function pruefeBefund(gefunden, [art, merkmal]) {
  assert.equal(gefunden.art, art, befundZeile(gefunden));
  assert.ok(gefunden.merkmal.includes(merkmal), `"${gefunden.merkmal}" nennt nicht "${merkmal}"`);
  assert.ok(Object.values(RUNBOOK_ANKER).includes(gefunden.runbook), "Runbook-Anker unbekannt");
}

for (const [name, operationen, erwartet] of KLASSIFIKATION) {
  test(`Kompatibilitaetsvertrag U1: ${name}`, () => {
    const befunde = klassifiziere(BASIS, abgeleitet(BASIS, operationen));
    assert.equal(befunde.length, erwartet.length, befunde.map(befundZeile).join("\n"));
    erwartet.forEach((erwartung, i) => pruefeBefund(befunde[i], erwartung));
  });
}

// Neue Ausgabe-Eigenschaft: ob sie additiv ist, entscheidet das ALTE Objekt, an dem sie
// hinzukommt - auf jeder Ebene, ob Pflicht oder optional. BASIS traegt oben
// additionalProperties:false wie alle Werkzeuge mit outputSchema im Vertrag; ZEILEN_OBJEKT
// macht aus den items von zeilen ein Objekt (wie calls in list_calls).
const ZEILEN_ITEMS = [...A_AUS, "properties", "zeilen", "items"];
const zeilenObjekt = (additionalProperties) =>
  abgeleitet(BASIS, [setze(ZEILEN_ITEMS, { type: "object", properties: { text: { type: "string" } }, additionalProperties })]);
const mitAlterAusgabe = (additionalProperties) => abgeleitet(BASIS, [setze([...A_AUS, "additionalProperties"], additionalProperties)]);
const NEU_OPTIONAL = [setze([...A_AUS, "properties", "neu"], { type: "string" })];
const NEU_PFLICHT = [...NEU_OPTIONAL, setze([...A_AUS, "required"], ["id", "neu", "zeilen"])];
const NEU_VERSCHACHTELT = [setze([...ZEILEN_ITEMS, "properties", "neu"], { type: "string" })];
const BRUCH_AP_FALSE = ["bruch", "ausgabe: neue Eigenschaft trotz additionalProperties false"];
const ADDITIV_AUSGABE = ["additiv", "ausgabe: neue Eigenschaft"];
const AUSGABE_ERWEITERT = [
  ["als Pflicht bei additionalProperties false ein Bruch", BASIS, NEU_PFLICHT, BRUCH_AP_FALSE],
  ["optional bei additionalProperties false ein Bruch", BASIS, NEU_OPTIONAL, BRUCH_AP_FALSE],
  ["verschachtelt (Objekt in items) bei additionalProperties false ein Bruch", zeilenObjekt(false), NEU_VERSCHACHTELT, BRUCH_AP_FALSE],
  ["bei additionalProperties als Teilschema ein Bruch (fail-closed)", mitAlterAusgabe({ type: "string" }), NEU_PFLICHT, ["bruch", "trotz additionalProperties"]],
  ["ohne additionalProperties additiv", abgeleitet(BASIS, [entferne([...A_AUS, "additionalProperties"])]), NEU_PFLICHT, ADDITIV_AUSGABE],
  ["bei additionalProperties true additiv", mitAlterAusgabe(true), NEU_PFLICHT, ADDITIV_AUSGABE],
  ["verschachtelt ohne additionalProperties additiv", zeilenObjekt(undefined), NEU_VERSCHACHTELT, ADDITIV_AUSGABE],
];

for (const [name, alt, operationen, erwartung] of AUSGABE_ERWEITERT) {
  test(`Kompatibilitaetsvertrag U1: neue Ausgabe-Eigenschaft ${name}`, () => {
    const befunde = klassifiziere(alt, abgeleitet(alt, operationen));
    assert.equal(befunde.length, 1, befunde.map(befundZeile).join("\n"));
    pruefeBefund(befunde[0], erwartung);
  });
}

// Jeder Objekt-Knoten eines Gerippes (ueber properties und items) mit seinem Pfad.
function objektKnoten(gerippe, pfad) {
  if (!gerippe || typeof gerippe !== "object") return [];
  const eigener = gerippe.properties ? [{ pfad, knoten: gerippe }] : [];
  const kinder = Object.entries(gerippe.properties ?? {}).flatMap(([name, teil]) => objektKnoten(teil, [...pfad, "properties", name]));
  return [...eigener, ...kinder, ...objektKnoten(gerippe.items, [...pfad, "items"])];
}

// Am echten Vertrag: an JEDEM Objekt-Knoten jedes outputSchema eine neue optionale
// Eigenschaft - Bruch genau dort, wo das Objekt keine weiteren Eigenschaften zulaesst.
test("Kompatibilitaetsvertrag U1: neue optionale Ausgabe-Eigenschaft auf jeder Objektebene des Vertrags richtig eingestuft", () => {
  const abweichend = [];
  let verschachteltGeschlossen = 0;
  for (const [name, merkmale] of Object.entries(VERTRAG.werkzeuge)) {
    const alt = { profile: {}, werkzeuge: { [name]: merkmale } };
    for (const { pfad, knoten } of objektKnoten(merkmale.ausgabe, [])) {
      const offen = knoten.additionalProperties === undefined || knoten.additionalProperties === true;
      if (!offen && pfad.length > 0) verschachteltGeschlossen += 1;
      const neu = abgeleitet(alt, [setze(["werkzeuge", name, "ausgabe", ...pfad, "properties", "neu_probe"], { type: "string" })]);
      const arten = klassifiziere(alt, neu).map((eintrag) => eintrag.art);
      const soll = offen ? "additiv" : "bruch";
      if (kanonisch(arten) !== kanonisch([soll])) abweichend.push(`${name} ${pfad.join(".") || "(Wurzel)"}: ${arten} statt ${soll}`);
    }
  }
  assert.deepEqual(abweichend, []);
  assert.ok(verschachteltGeschlossen > 0, "der Vertrag hat kein verschachteltes Objekt mit additionalProperties:false - Test waere leer");
});

test("Kompatibilitaetsvertrag U1: Beschreibungen und Titel sind kein Vertragsmerkmal", () => {
  const werkzeugA = ["probe", "tools", 0];
  const umformuliert = abgeleitet(FIXTURE_DRAHT, [
    setze([...werkzeugA, "description"], "voellig anderer Text"),
    setze([...werkzeugA, "title"], "Neuer Titel"),
    setze([...werkzeugA, "inputSchema", "properties", "ziel", "description"], "neu beschrieben"),
  ]);
  assert.equal(standSha256(standAusDraht(umformuliert)), standSha256(BASIS));
});

// Fail-closed am Gerippe: ein Schluesselwort ausserhalb der eigens behandelten faellt
// nicht still heraus, sondern ist ein Bruch - gemessen ueber standAusDraht, also am
// Draht-Format (Pfade relativ zu werkzeug_a im Fixture).
const ALL_OF_ZIEL = ["inputSchema", "properties", "ziel", "allOf"];
const UNBEKANNTE_SCHLUESSEL = [
  ["allOf an einer Eingabe-Eigenschaft", ALL_OF_ZIEL, [{ minLength: 1 }], "eingabe: allOf geaendert"],
  ["propertyNames an der Eingabe", ["inputSchema", "propertyNames"], { pattern: "^[a-z]+$" }, "eingabe: propertyNames geaendert"],
];
const setzeAnWerkzeugA = (pfad, wert) => abgeleitet(FIXTURE_DRAHT, [setze(["probe", "tools", 0, ...pfad], wert)]);

for (const [name, pfad, wert, merkmal] of UNBEKANNTE_SCHLUESSEL) {
  test(`Kompatibilitaetsvertrag U1: ${name} ist ein Bruch (fail-closed)`, () => {
    const befunde = klassifiziere(BASIS, standAusDraht(setzeAnWerkzeugA(pfad, wert)));
    assert.equal(befunde.length, 1, befunde.map(befundZeile).join("\n"));
    pruefeBefund(befunde[0], ["bruch", merkmal]);
  });
}

test("Kompatibilitaetsvertrag U1: allOf verschaerft ist ein Bruch, Text darin nicht", () => {
  const vorher = standAusDraht(setzeAnWerkzeugA(ALL_OF_ZIEL, [{ minLength: 1 }]));
  const verschaerft = standAusDraht(setzeAnWerkzeugA(ALL_OF_ZIEL, [{ minLength: 2 }]));
  const nurText = standAusDraht(setzeAnWerkzeugA(ALL_OF_ZIEL, [{ minLength: 1, description: "nur Text" }]));
  const befunde = klassifiziere(vorher, verschaerft);
  assert.equal(befunde.length, 1, befunde.map(befundZeile).join("\n"));
  pruefeBefund(befunde[0], ["bruch", "eingabe: allOf geaendert"]);
  assert.deepEqual(klassifiziere(vorher, nurText), []);
});

test("Kompatibilitaetsvertrag U1: Pfad-Divergenz desselben Werkzeugs wirft", () => {
  const abweichend = abgeleitet(FIXTURE_DRAHT.probe, [setze(["tools", 1, "annotations"], HINWEISE_SCHREIBEND)]);
  assert.throws(() => standAusDraht({ probe: FIXTURE_DRAHT.probe, probe_zwei: abweichend }), /Pfad-Divergenz: Werkzeug werkzeug_b/);
});

test("Kompatibilitaetsvertrag U1: kanonische Form ist unabhaengig von der Schluesselreihenfolge", () => {
  const vorwaerts = { eins: 1, liste: ["x", { zwei: "b", drei: "c" }] };
  const rueckwaerts = { liste: ["x", { drei: "c", zwei: "b" }], eins: 1 };
  assert.equal(kanonisch(vorwaerts), kanonisch(rueckwaerts));
});

// ---- U2: Aenderungskette ----

// Jeder committete Stand der Vertragsdatei aus der Git-Historie (fehlt Git, wirft der
// Aufruf: fail-closed).
function committeteVertraege() {
  const git = (argumente) => execFileSync("git", argumente, { cwd: ROOT, encoding: "utf8" });
  const commits = git(["log", "--format=%H", "--diff-filter=AM", "--", VERTRAG_RELATIV]).split("\n").filter(Boolean);
  return commits.map((commit) => ({ commit, vertrag: JSON.parse(git(["show", `${commit}:${VERTRAG_RELATIV}`])) }));
}

// Historie fuer pruefeKette: standZu schlaegt Staende nach stand_sha256 nach (Datei-Stand
// plus jeder committete Stand; damit prueft pruefeKette die art jedes Eintrags gegen die
// Klassifikation seines Vorgaengers), fruehereKetten traegt die Kette jedes committeten
// Stands (Nur-anhaengen-Pruefung).
function echteHistorie() {
  const committet = committeteVertraege();
  const staende = new Map([[standSha256(VERTRAG), VERTRAG]]);
  for (const { vertrag } of committet) {
    const hash = standSha256(vertrag);
    if (!staende.has(hash)) staende.set(hash, vertrag);
  }
  return {
    standZu: (hash) => staende.get(hash),
    fruehereKetten: committet.map(({ commit, vertrag }) => ({ quelle: commit, aenderungen: vertrag.aenderungen ?? [] })),
  };
}
// Nachschlagen in einer festen Liste synthetischer Staende (Positiv-Kontrollen).
const standAus =
  (...staende) =>
  (hash) =>
    staende.find((stand) => standSha256(stand) === hash);
const synthetisch = (staende, fruehereKetten = []) => ({ standZu: standAus(...staende), fruehereKetten });

const ERSTFASSUNG = {
  datum: "2026-01-01",
  art: "erstfassung",
  begruendung: "Synthetische Erstfassung fuer die Positiv-Kontrollen der Kettenpruefung.",
  stand_sha256: standSha256(BASIS),
};
const SYNTHETISCHER_VERTRAG = { ...BASIS, veroeffentlichte_widget_uris: [], aenderungen: [ERSTFASSUNG] };

test("Kompatibilitaetsvertrag U2: die committete Vertragsdatei hat eine gueltige Kette ohne interne Kennungen", () => {
  assert.deepEqual(pruefeKette(VERTRAG, echteHistorie()), []);
  const begruendungen = VERTRAG.aenderungen.map((eintrag) => eintrag.begruendung);
  const kommentar = [VERTRAG._kommentar ?? []].flat();
  assert.deepEqual(interneKennungen([...kommentar, ...begruendungen].join("\n")), []);
});

test("Kompatibilitaetsvertrag U2: synthetische Kette ist gueltig (Gegenprobe der Kontrollen)", () => {
  assert.deepEqual(pruefeKette(SYNTHETISCHER_VERTRAG, synthetisch([BASIS])), []);
});

const KETTEN_KONTROLLEN = [
  ["Stand geaendert ohne neuen Eintrag", [entferne([...A_AUS, "properties", "zeilen"])], /letzter stand_sha256/],
  ["zu kurze Begruendung", [setze(["aenderungen", 0, "begruendung"], "neu gepinnt")], /begruendung kuerzer/],
  ["unbekannte art", [setze(["aenderungen", 0, "art"], "egal")], /unbekannte art/],
  ["leere Kette", [setze(["aenderungen"], [])], /aenderungen: leer/],
  ["Datum nicht ISO", [setze(["aenderungen", 0, "datum"], "27.09.2026")], /datum nicht/],
  ["Werkzeug im Katalog ohne Profil", [setze(["werkzeuge", "verwaist"], BASIS.werkzeuge.werkzeug_b)], /in keinem Profil/],
  ["zwei Eintraege mit gleichem Hash", [setze(["aenderungen", 1], { ...ERSTFASSUNG, art: "additiv" })], /gleicher stand_sha256/],
];

for (const [name, operationen, muster] of KETTEN_KONTROLLEN) {
  test(`Kompatibilitaetsvertrag U2: Kontrolle ${name} liefert einen Befund`, () => {
    const befunde = pruefeKette(abgeleitet(SYNTHETISCHER_VERTRAG, operationen), synthetisch([BASIS]));
    assert.ok(befunde.some((zeile) => muster.test(zeile)), `kein Befund ${muster}: ${JSON.stringify(befunde)}`);
  });
}

// art gegen die Klassifikation: ein zweiter Eintrag nach der Erstfassung, dessen Stand
// sich wie angegeben aendert (Bruch = optionale Eingabe entfernt, additiv = neue optionale
// Eingabe).
const STAND_BRUCH = abgeleitet(BASIS, [entferne([...A_EIN, "properties", "notiz"])]);
const STAND_ADDITIV = abgeleitet(BASIS, [setze([...A_EIN, "properties", "extra"], { type: "string" })]);
function vertragMitZweitemEintrag(stand, art) {
  const eintrag = { ...ERSTFASSUNG, art, stand_sha256: standSha256(stand) };
  return { ...stand, veroeffentlichte_widget_uris: [], aenderungen: [ERSTFASSUNG, eintrag] };
}

const ART_KONTROLLEN = [
  ["Bruch als additiv eingetragen", STAND_BRUCH, "additiv", /art "additiv", die Klassifikation ergibt "bruch"/],
  ["Additives als bruch eingetragen", STAND_ADDITIV, "bruch", /art "bruch", die Klassifikation ergibt "additiv"/],
];

for (const [name, stand, art, muster] of ART_KONTROLLEN) {
  test(`Kompatibilitaetsvertrag U2: Kontrolle ${name} liefert einen Befund`, () => {
    const befunde = pruefeKette(vertragMitZweitemEintrag(stand, art), synthetisch([BASIS, stand]));
    assert.ok(befunde.some((zeile) => muster.test(zeile)), `kein Befund ${muster}: ${JSON.stringify(befunde)}`);
  });
}

test("Kompatibilitaetsvertrag U2: art passend zur Klassifikation ist gueltig (Gegenprobe)", () => {
  assert.deepEqual(pruefeKette(vertragMitZweitemEintrag(STAND_BRUCH, "bruch"), synthetisch([BASIS, STAND_BRUCH])), []);
  assert.deepEqual(pruefeKette(vertragMitZweitemEintrag(STAND_ADDITIV, "additiv"), synthetisch([BASIS, STAND_ADDITIV])), []);
});

test("Kompatibilitaetsvertrag U2: Kontrolle Vorgaengerstand nicht auffindbar liefert einen Befund", () => {
  const befunde = pruefeKette(vertragMitZweitemEintrag(STAND_BRUCH, "bruch"), synthetisch([STAND_BRUCH]));
  assert.ok(befunde.some((zeile) => /nicht auffindbar/.test(zeile)), JSON.stringify(befunde));
});

// Nur anhaengen: der committete Stand traegt die synthetische Erstfassung; der aktuelle
// Stand bricht (optionale Eingabe entfernt) und bringt den Bruch ohne neuen Eintrag unter.
// Ohne fruehereKetten liefert pruefeKette fuer genau diese Faelle keinen Befund - das
// belegt, dass die Nur-anhaengen-Regel sie faengt und nichts sonst.
const COMMITTETE_ERSTFASSUNG = Object.freeze([{ quelle: "synthetischer-commit", aenderungen: [ERSTFASSUNG] }]);
const alsVertrag = (stand, aenderungen) => ({ ...stand, veroeffentlichte_widget_uris: [], aenderungen });
const NEUE_ERSTFASSUNG = {
  datum: "2026-02-02",
  art: "erstfassung",
  begruendung: "Neue Erstfassung, die die bisherige Kette samt allen Eintraegen ersetzt.",
  stand_sha256: standSha256(STAND_BRUCH),
};
const ANHAENGE_KONTROLLEN = [
  ["Bruch mit ueberschriebenem Hash der Erstfassung", [{ ...ERSTFASSUNG, stand_sha256: standSha256(STAND_BRUCH) }]],
  ["Kette durch eine neue Erstfassung ersetzt", [NEUE_ERSTFASSUNG]],
];

for (const [name, aenderungen] of ANHAENGE_KONTROLLEN) {
  test(`Kompatibilitaetsvertrag U2: Kontrolle ${name} liefert einen Befund`, () => {
    const vertrag = alsVertrag(STAND_BRUCH, aenderungen);
    const befunde = pruefeKette(vertrag, synthetisch([BASIS, STAND_BRUCH], COMMITTETE_ERSTFASSUNG));
    assert.ok(befunde.some((zeile) => /nie aendern, nur anhaengen/.test(zeile)), JSON.stringify(befunde));
    assert.deepEqual(pruefeKette(vertrag, synthetisch([BASIS, STAND_BRUCH])), [], "Gegenprobe ohne Historie");
  });
}

test("Kompatibilitaetsvertrag U2: Kontrolle Kette gekuerzt liefert einen Befund", () => {
  const committet = [{ quelle: "synthetischer-commit", aenderungen: vertragMitZweitemEintrag(STAND_BRUCH, "bruch").aenderungen }];
  const befunde = pruefeKette(SYNTHETISCHER_VERTRAG, synthetisch([BASIS, STAND_BRUCH], committet));
  assert.ok(befunde.some((zeile) => /nie entfernen/.test(zeile)), JSON.stringify(befunde));
});

test("Kompatibilitaetsvertrag U2: angehaengter Eintrag nach committeter Erstfassung ist gueltig (Gegenprobe)", () => {
  const vertrag = vertragMitZweitemEintrag(STAND_BRUCH, "bruch");
  assert.deepEqual(pruefeKette(vertrag, synthetisch([BASIS, STAND_BRUCH], COMMITTETE_ERSTFASSUNG)), []);
});

// ---- U3: veroeffentlichte URIs ----

test("Kompatibilitaetsvertrag U3: eine veroeffentlichte, nicht lesbare URI ist ein Befund", () => {
  const alt = "ui://probe/alt/v1.html";
  assert.deepEqual(fehlendeVeroeffentlichteUris([WIDGET_A, alt], [WIDGET_A]), [alt]);
  assert.deepEqual(fehlendeVeroeffentlichteUris([WIDGET_A], [WIDGET_A]), []);
});

// Positiv-Kontrolle der Byte-Pruefung aus D2 (dort heute ohne geschuetzte URI): fremde
// Bytes unter einer gepinnten URI und eine URI ohne Pin sind je ein Befund; die aktuelle
// Fassung unter ihrer eigenen URI ist keiner.
test("Kompatibilitaetsvertrag U3: fremde Bytes unter einer geschuetzten URI oder eine URI ohne Pin sind ein Befund", () => {
  const version = widgetVersion(WIDGET_CALL);
  const aktuell = `ui://hermes/${WIDGET_CALL}/v${version}.html`;
  const ohnePin = `ui://hermes/${WIDGET_CALL}/v${version + 1}.html`;
  const falsch = { inhalte: { [aktuell]: "manipuliert", [ohnePin]: widgetHtml(WIDGET_CALL) } };
  const erwartet = [aktuell, ohnePin].map((uri) => `probe: ${uri} liefert andere Bytes als ihr Pin`);
  assert.deepEqual(fremdeBytes("probe", falsch, [aktuell, ohnePin]), erwartet);
  assert.deepEqual(fremdeBytes("probe", { inhalte: { [aktuell]: widgetHtml(WIDGET_CALL) } }, [aktuell]), []);
});

// ---- Veroeffentlichte Staende (Fixtures fuer U4 und U5) ----

// Ein wohlgeformter Hash, der zu keinem Stand gehoert.
const FREMDER_HASH = sha256Hex("kein Stand der Kette");
const MARKE_BASIS = Object.freeze({ datum: "2026-01-02", stand_sha256: standSha256(BASIS) });
const WIDGET_A2 = "ui://probe/a/v2.html";
const STAND_OHNE_B = abgeleitet(BASIS, [setze([...PROFIL_P, "werkzeuge"], ["werkzeug_a"]), entferne(["werkzeuge", "werkzeug_b"])]);
const STAND_WIDGET_NEU = abgeleitet(BASIS, [
  setze([...PROFIL_P, "widgets", "werkzeug_a"], WIDGET_A2),
  setze([...PROFIL_P, "ressourcen"], [{ uri: WIDGET_A2, mimeType: WIDGET_MIME }]),
]);
// werkzeug_a heisst jetzt werkzeug_c, ohne das Pflichtfeld ziel und mit neuer Widget-URI.
const WERKZEUG_C = abgeleitet(BASIS.werkzeuge.werkzeug_a, [entferne(["eingabe", "properties", "ziel"]), setze(["eingabe", "required"], [])]);
const STAND_UMBENANNT = abgeleitet(BASIS, [
  setze([...PROFIL_P, "werkzeuge"], ["werkzeug_b", "werkzeug_c"]),
  setze(["werkzeuge", "werkzeug_c"], WERKZEUG_C),
  entferne(["werkzeuge", "werkzeug_a"]),
  setze([...PROFIL_P, "sicherheitsschemata"], { werkzeug_b: SICHERHEIT, werkzeug_c: SICHERHEIT }),
  setze([...PROFIL_P, "widgets"], { werkzeug_c: WIDGET_A2 }),
  setze([...PROFIL_P, "ressourcen"], [{ uri: WIDGET_A2, mimeType: WIDGET_MIME }]),
]);

// Vertrag mit Erstfassung (BASIS, veroeffentlicht) und einem zweiten Eintrag fuer stand.
function nachVeroeffentlichung(stand, geschuetzt = [], marke = MARKE_BASIS) {
  const art = klassifiziere(BASIS, stand).some((eintrag) => eintrag.art === "bruch") ? "bruch" : "additiv";
  return { ...vertragMitZweitemEintrag(stand, art), veroeffentlichte_widget_uris: geschuetzt, veroeffentlichung: marke };
}

// ---- U4: geschuetzte Widget-URIs (nur URIs des veroeffentlichten Stands) ----

test("Kompatibilitaetsvertrag U4: die committete Vertragsdatei schuetzt nur URIs des veroeffentlichten Stands", () => {
  const befunde = geschuetzteUriBefunde(VERTRAG, { standZu: echteHistorie().standZu });
  assert.deepEqual(befunde, [], `Abschnitt "Widget-URIs nach der Veroeffentlichung": ${RUNBOOK_DATEI}#${RUNBOOK_ANKER.widget}`);
});

const geschuetztUnter = (vertrag, stand) => geschuetzteUriBefunde(vertrag, { standZu: standAus(BASIS, stand) });
const MARKE_WIDGET_NEU = Object.freeze({ datum: "2026-01-03", stand_sha256: standSha256(STAND_WIDGET_NEU) });

const URI_KONTROLLEN = [
  ["URI geschuetzt, obwohl nichts veroeffentlicht ist", nachVeroeffentlichung(STAND_WIDGET_NEU, [WIDGET_A], null)],
  ["verdraengte URI nach vorgerueckter Marke weiter geschuetzt", nachVeroeffentlichung(STAND_WIDGET_NEU, [WIDGET_A], MARKE_WIDGET_NEU)],
  ["neue, noch nicht veroeffentlichte URI geschuetzt", nachVeroeffentlichung(STAND_WIDGET_NEU, [WIDGET_A, WIDGET_A2])],
];

for (const [name, vertrag] of URI_KONTROLLEN) {
  test(`Kompatibilitaetsvertrag U4: Kontrolle ${name} liefert einen Befund`, () => {
    const befunde = geschuetztUnter(vertrag, STAND_WIDGET_NEU);
    assert.ok(befunde.some((zeile) => /keine URI des veroeffentlichten Stands/.test(zeile)), befunde.join("\n"));
  });
}

test("Kompatibilitaetsvertrag U4: verdraengte URI des veroeffentlichten Stands ist geschuetzt (Gegenprobe)", () => {
  assert.deepEqual(geschuetztUnter(nachVeroeffentlichung(STAND_WIDGET_NEU, [WIDGET_A]), STAND_WIDGET_NEU), []);
  assert.deepEqual(geschuetztUnter(nachVeroeffentlichung(STAND_WIDGET_NEU, [], MARKE_WIDGET_NEU), STAND_WIDGET_NEU), []);
});

// ---- U5: Sperre nach der Veroeffentlichung ----

test("Kompatibilitaetsvertrag U5: die committete Vertragsdatei verletzt die Veroeffentlichungs-Sperre nicht", () => {
  const fruehereVertraege = committeteVertraege().map(({ commit, vertrag }) => ({ quelle: commit, vertrag }));
  const befunde = veroeffentlichungsBefunde(VERTRAG, { standZu: echteHistorie().standZu, fruehereVertraege });
  assert.deepEqual(befunde, [], `Sperre nach der Veroeffentlichung: ${RUNBOOK_DATEI}#${RUNBOOK_ANKER.sperre}`);
});

const sperre = (vertrag, stand, fruehereVertraege = []) =>
  veroeffentlichungsBefunde(vertrag, { standZu: standAus(BASIS, stand), fruehereVertraege });
const GESPERRT_WERKZEUG = /gesperrt nach der Veroeffentlichung.*Werkzeug entfernt oder umbenannt/;

// Jeder Bruch gegen den veroeffentlichten Stand ist gesperrt, auch mit passendem
// Ketteneintrag (nachVeroeffentlichung traegt ihn) - einzige Ausnahme ist die geschuetzte,
// am Draht lesbare alte URI.
const SPERR_KONTROLLEN = [
  ["entfernte Eingabe-Eigenschaft", nachVeroeffentlichung(STAND_BRUCH), STAND_BRUCH, /gesperrt nach der Veroeffentlichung/],
  ["entferntes Werkzeug", nachVeroeffentlichung(STAND_OHNE_B), STAND_OHNE_B, GESPERRT_WERKZEUG],
  [
    "umbenanntes Werkzeug ohne Pflichtfeld, alte Widget-URI geschuetzt",
    nachVeroeffentlichung(STAND_UMBENANNT, [WIDGET_A]),
    STAND_UMBENANNT,
    GESPERRT_WERKZEUG,
  ],
  ["Widget-URI ohne geschuetzte alte URI", nachVeroeffentlichung(STAND_WIDGET_NEU), STAND_WIDGET_NEU, /Widget-URI/],
  [
    "Marke auf einem Stand ausserhalb der Kette",
    nachVeroeffentlichung(STAND_ADDITIV, [], { datum: "2026-01-02", stand_sha256: FREMDER_HASH }),
    STAND_ADDITIV,
    /kein Stand der Aenderungskette/,
  ],
];

for (const [name, vertrag, stand, muster] of SPERR_KONTROLLEN) {
  test(`Kompatibilitaetsvertrag U5: Kontrolle ${name} liefert einen Befund`, () => {
    const befunde = sperre(vertrag, stand);
    assert.ok(befunde.some((zeile) => muster.test(zeile)), befunde.join("\n"));
  });
}

const ERLAUBT_NACH_VEROEFFENTLICHUNG = [
  ["neue optionale Eigenschaft", STAND_ADDITIV, []],
  ["Widget-Versionssprung mit geschuetzter alter URI", STAND_WIDGET_NEU, [WIDGET_A]],
];

for (const [name, stand, geschuetzt] of ERLAUBT_NACH_VEROEFFENTLICHUNG) {
  test(`Kompatibilitaetsvertrag U5: ${name} ist nach der Veroeffentlichung erlaubt (Gegenprobe)`, () => {
    assert.deepEqual(sperre(nachVeroeffentlichung(stand, geschuetzt), stand), []);
  });
}

test("Kompatibilitaetsvertrag U5: Kontrolle Marke zurueckgesetzt oder entfernt liefert einen Befund", () => {
  const spaeter = [{ quelle: "synthetischer-commit", vertrag: { veroeffentlichung: { datum: "2026-01-03", stand_sha256: standSha256(STAND_ADDITIV) } } }];
  const zurueck = sperre(nachVeroeffentlichung(STAND_ADDITIV), STAND_ADDITIV, spaeter);
  assert.ok(zurueck.some((zeile) => zeile.includes("aelteren Stand")), zurueck.join("\n"));
  const entfernt = sperre(nachVeroeffentlichung(STAND_ADDITIV, [], null), STAND_ADDITIV, spaeter);
  assert.ok(entfernt.some((zeile) => zeile.includes("entfernt")), entfernt.join("\n"));
});

// Vorlauf: die Marke rueckt nur auf einen Stand vor, der vorher unter der alten Marke
// committet war und dort sperrfrei ist. Historie neuester Commit zuerst.
const markeAuf = (stand) => ({ datum: "2026-01-03", stand_sha256: standSha256(stand) });
const commitUnterBasis = (stand, geschuetzt = []) => ({ quelle: "vorlauf-commit", vertrag: nachVeroeffentlichung(stand, geschuetzt) });
const BASIS_VEROEFFENTLICHT = Object.freeze({ quelle: "basis-commit", vertrag: { ...SYNTHETISCHER_VERTRAG, veroeffentlichung: MARKE_BASIS } });
const vorgerueckt = (stand) => nachVeroeffentlichung(stand, [], markeAuf(stand));
const OHNE_VORLAUF = /war nie unter der bisherigen Marke committet/;

const VORLAUF_KONTROLLEN = [
  ["Marke ohne Vorlauf-Commit vorgerueckt", STAND_ADDITIV, [BASIS_VEROEFFENTLICHT]],
  ["Marke auf einen Bruch vorgerueckt (Vorlauf unter der alten Marke gesperrt)", STAND_BRUCH, [commitUnterBasis(STAND_BRUCH), BASIS_VEROEFFENTLICHT]],
  ["Marke auf einen Widget-Sprung ohne geschuetzte alte URI vorgerueckt", STAND_WIDGET_NEU, [commitUnterBasis(STAND_WIDGET_NEU), BASIS_VEROEFFENTLICHT]],
];

for (const [name, stand, historie] of VORLAUF_KONTROLLEN) {
  test(`Kompatibilitaetsvertrag U5: Kontrolle ${name} liefert einen Befund`, () => {
    const befunde = sperre(vorgerueckt(stand), stand, historie);
    assert.ok(befunde.some((zeile) => OHNE_VORLAUF.test(zeile)), befunde.join("\n"));
  });
}

test("Kompatibilitaetsvertrag U5: Marke nach sperrfreiem Vorlauf vorgerueckt ist gueltig (Gegenprobe)", () => {
  const additiv = [commitUnterBasis(STAND_ADDITIV), BASIS_VEROEFFENTLICHT];
  assert.deepEqual(sperre(vorgerueckt(STAND_ADDITIV), STAND_ADDITIV, additiv), []);
  const widget = [commitUnterBasis(STAND_WIDGET_NEU, [WIDGET_A]), BASIS_VEROEFFENTLICHT];
  assert.deepEqual(sperre(vorgerueckt(STAND_WIDGET_NEU), STAND_WIDGET_NEU, widget), []);
});

// ---- R1: Runbook ----

const PAKET = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const UMGEBUNG = {
  exists: (relativ) => fs.existsSync(path.join(ROOT, relativ)),
  skripte: Object.keys(PAKET.scripts),
};

test("Kompatibilitaetsvertrag R1: Kontrolle - falscher Pfad, unbekanntes Skript, interne Kennung", () => {
  const anker = Object.values(RUNBOOK_ANKER).map((name) => `<a id="${name}"></a>`);
  const text = `${anker.join("\n")}\nSiehe \`src/gibt-es-nicht.js:12\`, dann npm run gibt-es-nicht, Befund T-99.`;
  assert.deepEqual(runbookBefunde(text, UMGEBUNG), [
    "Verweis auf nicht existierende Datei: src/gibt-es-nicht.js",
    "npm run gibt-es-nicht: kein Skript in package.json",
    "interne Kennung: T-99",
  ]);
  assert.ok(runbookBefunde("ohne Anker", UMGEBUNG).some((zeile) => zeile.startsWith("Anker fehlt")));
});
