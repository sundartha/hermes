import { FUNKTIONEN, bereichVon, mitEltern, namenImMuster } from "./ast.mjs";
import { aufloesen, bindungsId, umfasst, weltAus } from "./bindung.mjs";
import { keineZerlegung } from "./einsetzen.mjs";

export { hilfeZerlegen, keineZerlegung } from "./einsetzen.mjs";

const GRENZEN = new Set([...FUNKTIONEN, "StaticBlock"]);
const VERBOTEN = new Set(["ThisExpression", "Super", "MetaProperty", "LabeledStatement"]);
const OBERSTE_VERBOTEN = new Set(["FunctionDeclaration", "ClassDeclaration"]);
const LET_CONST = new Set(["let", "const"]);
const DEKLARIERT = new Set(["let", "const", "var"]);
const ZIEL_ARTEN = new Set(["param", "let", "var"]);
const EINZIGE = 1;

const F1 = {
  erkenne: ({ aufruf, oben: [elter, liste] }) => {
    const passt = elter.type === "ExpressionStatement" && elter.expression === aufruf;
    return passt ? { form: "F1", anweisung: elter, liste } : undefined;
  },
  aufrufIn: (anweisung) => anweisung.expression,
  schluss: () => [],
};

const F2 = {
  erkenne: ({ aufruf, oben: [elter, anweisung, liste] }) => {
    const passt =
      elter.type === "VariableDeclarator" &&
      elter.init === aufruf &&
      elter.id.type === "Identifier";
    const einzeln = anweisung?.declarations?.length === EINZIGE && LET_CONST.has(anweisung.kind);
    return passt && einzeln
      ? { form: "F2", anweisung, liste, empfaenger: elter.id, art: anweisung.kind }
      : undefined;
  },
  aufrufIn: (anweisung) => anweisung.declarations?.[0]?.init,
  schluss: (plan, anweisung, wert) => {
    const [deklarator] = anweisung.declarations;
    return plan.entfaellt === "deklaration"
      ? []
      : [{ ...anweisung, declarations: [{ ...deklarator, init: wert }] }];
  },
};

const F3 = {
  erkenne: ({ aufruf, oben: [elter, anweisung, liste] }) => {
    const passt =
      elter.type === "AssignmentExpression" && elter.operator === "=" && elter.right === aufruf;
    const einfach =
      passt && elter.left.type === "Identifier" && anweisung?.type === "ExpressionStatement";
    return einfach ? { form: "F3", anweisung, liste, empfaenger: elter.left } : undefined;
  },
  aufrufIn: (anweisung) => anweisung.expression?.right,
  schluss: (plan, anweisung, wert) => {
    const zuweisung = { ...anweisung.expression, right: wert };
    return plan.entfaellt === "zuweisung" ? [] : [{ ...anweisung, expression: zuweisung }];
  },
};

const F4 = {
  erkenne: ({ aufruf, oben: [elter, liste] }) => {
    return elter.type === "ReturnStatement" && elter.argument === aufruf
      ? { form: "F4", anweisung: elter, liste }
      : undefined;
  },
  aufrufIn: (anweisung) => anweisung.argument,
  schluss: (_plan, anweisung, wert) => [{ ...anweisung, argument: wert }],
};

const FORMEN = [F1, F2, F3, F4];

function formAus(art, lage) {
  const treffer = art.erkenne(lage);
  return treffer && { ...treffer, aufrufIn: art.aufrufIn, schluss: art.schluss };
}

function hilfeForm(deklaration) {
  const namen = deklaration.params.map(({ name }) => name);
  const einfach = deklaration.params.every(({ type }) => type === "Identifier");
  return (
    Boolean(deklaration.id) &&
    !deklaration.async &&
    !deklaration.generator &&
    einfach &&
    new Set(namen).size === namen.length
  );
}

function einzigerAufruf(name, deklaration, welt) {
  const stellen = (welt.bezeichner.get(name) ?? []).filter(
    ({ knoten }) => knoten !== deklaration.id,
  );
  if (stellen.length !== EINZIGE) return undefined;
  const [{ knoten, eltern }] = stellen;
  const aufruf = eltern.at(-1);
  const echt = aufruf?.type === "CallExpression" && aufruf.callee === knoten;
  return echt ? { aufruf, oben: eltern.slice(0, -1) } : undefined;
}

function kandidatAus(deklaration, welt) {
  if (deklaration.type !== "FunctionDeclaration" || !hilfeForm(deklaration)) return undefined;
  const name = deklaration.id.name;
  const stelle = einzigerAufruf(name, deklaration, welt);
  return stelle ? { name, deklaration, ...stelle } : undefined;
}

function formSchritt(stand) {
  const { aufruf, oben } = stand;
  const lage = { aufruf, oben: oben.toReversed() };
  const form = FORMEN.map((art) => formAus(art, lage)).find(Boolean);
  const funktion = oben.findLast((vorfahr) => GRENZEN.has(vorfahr.type));
  const inHilfe = oben.some(
    ({ type, id }) => type === "FunctionDeclaration" && stand.namen.has(id?.name),
  );
  const nutzbar =
    form?.liste.type === "BlockStatement" && funktion && FUNKTIONEN.has(funktion.type) && !inHilfe;
  return nutzbar ? { ...stand, form: { ...form, aufruf, oben, funktion } } : undefined;
}

function eigeneKnoten(innen) {
  return innen.filter(({ eltern }) => !eltern.some(({ type }) => FUNKTIONEN.has(type)));
}

function rumpfErlaubt(rumpf, innen) {
  const var_ = ({ knoten }) => knoten.type === "VariableDeclaration" && knoten.kind === "var";
  const verboten = innen.some((eins) => VERBOTEN.has(eins.knoten.type) || var_(eins));
  const oberste = rumpf.body.some(
    (anweisung) => anweisung.directive !== undefined || OBERSTE_VERBOTEN.has(anweisung.type),
  );
  return !verboten && !oberste;
}

function rumpfAus(deklaration) {
  const rumpf = deklaration.body;
  const innen = mitEltern(rumpf);
  const eigene = eigeneKnoten(innen);
  if (!rumpfErlaubt(rumpf, innen)) return undefined;
  const rueckgaben = eigene
    .map(({ knoten }) => knoten)
    .filter(({ type }) => type === "ReturnStatement");
  const letzte = rumpf.body.at(-1);
  const keine = rueckgaben.length === 0;
  const gueltig =
    keine || (rueckgaben.length === EINZIGE && rueckgaben[0] === letzte && letzte.argument);
  const anweisungen = keine ? rumpf.body : rumpf.body.slice(0, -1);
  return gueltig ? { rueckgabe: rueckgaben[0], anweisungen } : undefined;
}

function lokaleVon(deklaration) {
  const deklarationen = deklaration.body.body.filter(({ type }) => type === "VariableDeclaration");
  return new Set(
    deklarationen.flatMap(({ declarations }) =>
      declarations.flatMap(({ id }) => namenImMuster(id)),
    ),
  );
}

function innenGebunden(deklaration, welt) {
  return new Set(
    welt.alle.filter(({ key }) => umfasst(deklaration.body, key)).map(({ name }) => name),
  );
}

function freiGelesen(deklaration, { knoten }, welt) {
  const bindung = aufloesen(welt.tabelle, knoten);
  if (bindung && umfasst(deklaration, bindung.key)) return true;
  return (welt.tabelle.get(knoten.name) ?? []).every(({ key }) => key.type === "Program");
}

function rumpfSchritt(stand) {
  const { deklaration } = stand;
  const rumpf = rumpfAus(deklaration);
  const innerhalb = stand.welt.bezuege.filter(({ knoten }) => umfasst(deklaration, knoten));
  if (!rumpf || !innerhalb.every((bezug) => freiGelesen(deklaration, bezug, stand.welt)))
    return undefined;
  const mitRueckgabe = stand.form.form !== "F1";
  if (mitRueckgabe === (rumpf.rueckgabe === undefined)) return undefined;
  return {
    ...stand,
    rumpf,
    lokale: lokaleVon(deklaration),
    gebunden: innenGebunden(deklaration, stand.welt),
  };
}

function vorherDeklariert(deklaration, form) {
  const kette = [...form.oben, form.aufruf];
  const block = kette.find(
    (knoten) => knoten.type === "BlockStatement" && knoten.body.includes(deklaration.knoten),
  );
  if (!block || !umfasst(form.funktion.body, block)) return false;
  const weg = kette[kette.indexOf(block) + EINZIGE];
  return block.body.indexOf(deklaration.knoten) < block.body.indexOf(weg);
}

function elternParameter(deklaration, form) {
  const huellen = form.oben.filter(({ type }) => FUNKTIONEN.has(type));
  const ab = huellen.indexOf(deklaration.key);
  return ab >= 0 && huellen.slice(ab).every((funktion) => umfasst(funktion.body, form.aufruf));
}

function sicherInitialisiert(deklaration, form) {
  if (deklaration.art === "param") return elternParameter(deklaration, form);
  return DEKLARIERT.has(deklaration.art) && vorherDeklariert(deklaration, form);
}

function argumentGebunden(argument, form, welt) {
  const bindung = aufloesen(welt.tabelle, argument);
  const sicher = bindung?.deklarationen.every((eins) => sicherInitialisiert(eins, form));
  return sicher ? bindung : undefined;
}

function argumenteSchritt(stand) {
  const argumente = stand.form.aufruf.arguments;
  const zahlGleich = argumente.length === stand.deklaration.params.length;
  if (!zahlGleich) return undefined;
  const bindungen = argumente.map((argument) => argumentGebunden(argument, stand.form, stand.welt));
  return bindungen.every(Boolean) ? { ...stand, argumente, bindungen } : undefined;
}

function zugewieseneParameter(deklaration, welt) {
  const namen = deklaration.params.map(({ name }) => name);
  return namen.filter((name) => welt.geschriebeneIds.has(bindungsId(name, deklaration)));
}

function innerhalbEinerFunktion(eltern, aussen) {
  return eltern.slice(eltern.indexOf(aussen) + EINZIGE).some(({ type }) => FUNKTIONEN.has(type));
}

function abbindungForm(stand, parameter) {
  const { form, argumente, deklaration, rumpf } = stand;
  const stelle = deklaration.params.findIndex(({ name }) => name === parameter);
  const ziel = form.empfaenger?.name;
  const rueckgabe = rumpf.rueckgabe?.argument;
  const zurueck = rueckgabe?.type === "Identifier" && rueckgabe.name === parameter;
  const einmal = argumente.filter(({ name }) => name === ziel).length === EINZIGE;
  return argumente[stelle]?.name === ziel && einmal && zurueck;
}

function abbindungOrt(stand, parameter) {
  const { form, welt, deklaration } = stand;
  const ziel = form.empfaenger.name;
  const bindung = aufloesen(welt.tabelle, form.empfaenger);
  const lokal =
    bindung && ZIEL_ARTEN.has(bindung.deklarationen[0].art) && umfasst(form.funktion, bindung.key);
  const imAufrufer = ({ knoten, eltern }) =>
    knoten.name === ziel &&
    umfasst(form.funktion, knoten) &&
    innerhalbEinerFunktion(eltern, form.funktion);
  const imHelfer = ({ knoten, eltern }) =>
    knoten.name === parameter &&
    umfasst(deklaration.body, knoten) &&
    innerhalbEinerFunktion(eltern, deklaration);
  const versucht = form.oben
    .slice(form.oben.indexOf(form.funktion) + EINZIGE)
    .some(({ type }) => type === "TryStatement");
  return (
    Boolean(lokal) && !welt.bezuege.some(imAufrufer) && !welt.bezuege.some(imHelfer) && !versucht
  );
}

function zuweisungSchritt(stand) {
  const zugewiesen = zugewieseneParameter(stand.deklaration, stand.welt);
  const abbinden = zugewiesen.length > 0;
  const stimmt =
    !abbinden ||
    (zugewiesen.length === EINZIGE &&
      abbindungForm(stand, zugewiesen[0]) &&
      abbindungOrt(stand, zugewiesen[0]));
  if (!stimmt) return undefined;
  const ziel = stand.form.empfaenger?.name;
  const frei = (argument, stelle) =>
    !stand.welt.geschriebeneIds.has(bindungsId(argument.name, stand.bindungen[stelle].key)) ||
    (abbinden && argument.name === ziel);
  return stand.argumente.every(frei) ? { ...stand, abbinden } : undefined;
}

function namenSchritt(stand) {
  const namen = [...stand.deklaration.params, ...stand.argumente].map(({ name }) => name);
  return namen.every((name) => !stand.gebunden.has(name)) ? stand : undefined;
}

function sonderName(stand) {
  const wert = stand.rumpf.rueckgabe?.argument;
  const passt =
    stand.form.form === "F2" &&
    wert?.type === "Identifier" &&
    wert.name === stand.form.empfaenger.name;
  return passt && stand.lokale.has(wert.name) ? wert.name : undefined;
}

function einzelnerDeklarator({ declarations }) {
  return declarations.length === EINZIGE ? declarations[0] : undefined;
}

function sonderDeklaration(stand, name) {
  const gesucht = (teil) =>
    teil.type === "VariableDeclaration" && teil.declarations.some(({ id }) => id.name === name);
  const deklaration = stand.rumpf.anweisungen.find(gesucht);
  const deklarator = deklaration && einzelnerDeklarator(deklaration);
  return deklarator?.id.type === "Identifier" && deklarator.init ? deklaration : undefined;
}

function sonderOk(stand, name) {
  const { form, welt } = stand;
  const deklaration = sonderDeklaration(stand, name);
  const gleicheArt =
    deklaration?.kind === form.art || (deklaration?.kind === "let" && form.art === "const");
  const imAufrufer = (welt.tabelle.get(name) ?? []).filter(({ key }) =>
    umfasst(form.funktion, key),
  );
  const bindung = aufloesen(welt.tabelle, form.empfaenger);
  const geschrieben = bindung && welt.geschriebeneIds.has(bindungsId(name, bindung.key));
  return Boolean(gleicheArt) && imAufrufer.length === EINZIGE && Boolean(bindung) && !geschrieben;
}

function lokaleFrei(stand, ausnahme) {
  const { form, welt } = stand;
  const draussen = ({ knoten }) =>
    umfasst(form.funktion, knoten) && !umfasst(form.anweisung, knoten);
  const namen = new Set(welt.bezuege.filter(draussen).map(({ knoten }) => knoten.name));
  return [...stand.lokale].every((lokal) => lokal === ausnahme || !namen.has(lokal));
}

function empfaengerFrei(stand) {
  const name = stand.form.empfaenger?.name;
  return name === undefined || !stand.gebunden.has(name);
}

function lokaleSchritt(stand) {
  const name = sonderName(stand);
  const empfaengerOk = name === undefined ? empfaengerFrei(stand) : sonderOk(stand, name);
  return empfaengerOk && lokaleFrei(stand, name) ? { ...stand, sonder: name } : undefined;
}

const SCHRITTE = [
  formSchritt,
  rumpfSchritt,
  argumenteSchritt,
  zuweisungSchritt,
  namenSchritt,
  lokaleSchritt,
];

function entfaellt(stand) {
  if (stand.sonder !== undefined) return "deklaration";
  return stand.abbinden ? "zuweisung" : undefined;
}

function planAus(kandidat, welt, namen) {
  let stand = { ...kandidat, welt, namen };
  for (const schritt of SCHRITTE) {
    stand = schritt(stand);
    if (stand === undefined) return undefined;
  }
  return {
    name: kandidat.name,
    form: stand.form.form,
    aufrufIn: stand.form.aufrufIn,
    schluss: stand.form.schluss,
    anweisung: stand.form.anweisung,
    parameter: kandidat.deklaration.params.map(({ name }) => name),
    argumente: stand.argumente.map(({ name }) => name),
    rumpf: stand.rumpf.anweisungen,
    wert: stand.rumpf.rueckgabe?.argument,
    entfaellt: entfaellt(stand),
  };
}

export function zerlegungsPlaene(programm, eintraege) {
  const welt = weltAus(programm, eintraege);
  const kandidaten = programm.body
    .map((deklaration) => kandidatAus(deklaration, welt))
    .filter(Boolean);
  const namen = new Set(kandidaten.map(({ name }) => name));
  const plaene = kandidaten.map((kandidat) => planAus(kandidat, welt, namen)).filter(Boolean);
  return {
    ...keineZerlegung(),
    plaene: new Map(plaene.map((plan) => [bereichVon(plan.anweisung), plan])),
    helfer: new Set(plaene.map(({ name }) => name)),
  };
}
