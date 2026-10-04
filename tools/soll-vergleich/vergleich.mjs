const FEHLT = "fehlt";
const NICHT_IM_SOLL = "nicht im Soll";
const FEHLT_IN_DER_ANTWORT = "fehlt in der Antwort";
const KEIN_ZUGANG = "kein Zugang";
const BYPASS = "bypass_actors";
const RULESET = "Ruleset";
const REPO_EINSTELLUNGEN = "Repo-Einstellungen";
const MITARBEITER = "Mitarbeiter";
const CODEOWNERS = "CODEOWNERS";
const NICHT_PRUEFBAR_BYPASS =
  "Ruleset bypass_actors: nicht prüfbar mit den Rechten dieses Tokens (GitHub liefert das Feld nur an Konten mit Admin-Recht am Ruleset).";

function istObjekt(wert) {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

function geordnet(wert) {
  if (Array.isArray(wert)) return wert.map(geordnet);
  if (!istObjekt(wert)) return wert;
  const namen = Object.keys(wert).sort();
  return Object.fromEntries(namen.map((name) => [name, geordnet(wert[name])]));
}

function gleich(soll, ist) {
  return JSON.stringify(geordnet(soll)) === JSON.stringify(geordnet(ist));
}

function schluessel(eintrag) {
  if (eintrag.context !== undefined) return eintrag.context;
  if (eintrag.name !== undefined) return eintrag.name;
  if (eintrag.actor_type !== undefined) return `${eintrag.actor_type} ${eintrag.actor_id}`;
  return eintrag.type ?? JSON.stringify(geordnet(eintrag));
}

function nachSchluessel(liste) {
  const gesammelt = new Map();
  for (const eintrag of liste) {
    const name = String(schluessel(eintrag));
    gesammelt.set(gesammelt.has(name) ? `${name} (${gesammelt.size + 1})` : name, eintrag);
  }
  return gesammelt;
}

function alleNamen(erste, zweite) {
  return [...new Set([...erste, ...zweite])];
}

function listenUnterschiede(pfad, soll, ist) {
  if (![...soll, ...ist].every(istObjekt)) {
    const [sollMenge, istMenge] = [soll, ist].map((liste) => [...liste].sort());
    return gleich(sollMenge, istMenge) ? [] : [{ feld: pfad, soll: sollMenge, ist: istMenge }];
  }
  const sollEintraege = nachSchluessel(soll);
  const istEintraege = nachSchluessel(ist);
  return alleNamen(sollEintraege.keys(), istEintraege.keys()).flatMap((name) =>
    unterschiede(`${pfad}[${name}]`, sollEintraege.get(name), istEintraege.get(name)),
  );
}

function objektUnterschiede(pfad, soll, ist) {
  return alleNamen(Object.keys(soll), Object.keys(ist)).flatMap((name) =>
    unterschiede(pfad === "" ? name : `${pfad}.${name}`, soll[name], ist[name]),
  );
}

function unterschiede(pfad, soll, ist) {
  if (Array.isArray(soll) && Array.isArray(ist)) return listenUnterschiede(pfad, soll, ist);
  if (istObjekt(soll) && istObjekt(ist)) return objektUnterschiede(pfad, soll, ist);
  return gleich(soll, ist) ? [] : [{ feld: pfad, soll, ist }];
}

function text(wert, fehltText) {
  if (wert === undefined) return fehltText;
  return typeof wert === "string" ? wert : JSON.stringify(wert);
}

function zeile(bereich, { feld, soll, ist }) {
  return { bereich, feld, soll: text(soll, NICHT_IM_SOLL), ist: text(ist, FEHLT) };
}

function felderVergleich(bereich, soll, ist) {
  return Object.keys(soll)
    .flatMap((name) => unterschiede(name, soll[name], ist[name]))
    .map((eintrag) => zeile(bereich, eintrag));
}

export function rulesetVergleich(soll, ist) {
  const ohneBypass = Object.hasOwn(soll, BYPASS) && !Object.hasOwn(ist, BYPASS);
  const geprueft = Object.keys(soll).filter((name) => name !== "id");
  const felder = geprueft.filter((name) => !(ohneBypass && name === BYPASS));
  const sollFelder = Object.fromEntries(felder.map((name) => [name, soll[name]]));
  return {
    abweichungen: felderVergleich(RULESET, sollFelder, ist),
    nichtPruefbar: ohneBypass ? [NICHT_PRUEFBAR_BYPASS] : [],
  };
}

export function repoVergleich(soll, ist) {
  return Object.entries(soll).flatMap(([name, wert]) => {
    if (!Object.hasOwn(ist, name)) {
      return [
        { bereich: REPO_EINSTELLUNGEN, feld: name, soll: text(wert), ist: FEHLT_IN_DER_ANTWORT },
      ];
    }
    return unterschiede(name, wert, ist[name]).map((eintrag) => zeile(REPO_EINSTELLUNGEN, eintrag));
  });
}

export function mitarbeiterVergleich(soll, liste) {
  const ist = new Map(
    liste.map(({ login, role_name: rolle }) => [login, rolle ?? FEHLT_IN_DER_ANTWORT]),
  );
  const vorgesehen = new Map(Object.entries(soll));
  return alleNamen(vorgesehen.keys(), ist.keys())
    .filter((login) => vorgesehen.get(login) !== ist.get(login))
    .map((login) => ({
      bereich: MITARBEITER,
      feld: login,
      soll: vorgesehen.get(login) ?? KEIN_ZUGANG,
      ist: ist.get(login) ?? KEIN_ZUGANG,
    }));
}

function normalisiert(codeownersZeile) {
  return codeownersZeile.trim().split(/\s+/).join(" ");
}

function codeownersZeilen(inhalt) {
  return inhalt
    .split("\n")
    .map(normalisiert)
    .filter((codeownersZeile) => codeownersZeile !== "");
}

function nachMuster(zeilen) {
  return new Map(zeilen.map((codeownersZeile) => [codeownersZeile.split(" ")[0], codeownersZeile]));
}

function zeilenUnterschiede(sollZeilen, istZeilen) {
  const soll = nachMuster(sollZeilen);
  const ist = nachMuster(istZeilen);
  const geaendert = alleNamen(soll.keys(), ist.keys())
    .filter((muster) => soll.get(muster) !== ist.get(muster))
    .map((muster) => ({
      bereich: CODEOWNERS,
      feld: muster,
      soll: soll.get(muster) ?? NICHT_IM_SOLL,
      ist: ist.get(muster) ?? FEHLT,
    }));
  if (geaendert.length > 0 || sollZeilen.join("\n") === istZeilen.join("\n")) return geaendert;
  return [
    { bereich: CODEOWNERS, feld: "Reihenfolge der Zeilen", soll: "wie im Soll", ist: "abweichend" },
  ];
}

function fehlerZeilen(fehler) {
  if (fehler.length === 0) return [];
  const liste = fehler.map(({ line, kind }) => `Zeile ${line}: ${kind}`).join("; ");
  return [{ bereich: CODEOWNERS, feld: "codeowners/errors", soll: "keine", ist: liste }];
}

export function codeownersVergleich(soll, { inhalt, fehler }) {
  return [
    ...zeilenUnterschiede(soll.map(normalisiert), codeownersZeilen(inhalt)),
    ...fehlerZeilen(fehler),
  ];
}

export function environmentVergleich(name, soll, ist) {
  const bereich = `Environment ${name}`;
  if (ist === null) return [{ bereich, feld: "Environment", soll: "vorhanden", ist: FEHLT }];
  return felderVergleich(bereich, soll, ist);
}
