import { NIE_VORGABEN } from "../annahmen.mjs";
import { brauchtRotenTest } from "../format.mjs";
import { abschnitte } from "./abschnitte.mjs";
import { istObjekt, istText, liste } from "./erkundung.mjs";
import { PITCH, gleicherText } from "./nummern.mjs";
import { listenpunkteIn, szenarioMitSatz } from "./schnitt.mjs";

function listenpunkteDes(pitch, abschnitt) {
  return listenpunkteIn(abschnitte(pitch, [abschnitt]).abschnitte.get(abschnitt) ?? "");
}

function einzigerAuftragMitTest(schnitt) {
  const auftraege = liste(schnitt?.auftraege);
  const [auftrag] = auftraege;
  const passt = auftraege.length === 1 && istObjekt(auftrag) && brauchtRotenTest(auftrag) && Array.isArray(auftrag.wasDarfNiePassieren ?? []);
  return passt ? auftrag : null;
}

function fehlendeSaetze(pitch, soll, eigene) {
  const vorhanden = new Set(eigene.map((eintrag) => gleicherText(eintrag?.satz)));
  const fehlende = [];
  for (const abschnitt of NIE_VORGABEN) {
    for (const satz of listenpunkteDes(pitch, abschnitt)) {
      if (vorhanden.has(gleicherText(satz)) || szenarioMitSatz(satz, soll) !== undefined) continue;
      vorhanden.add(gleicherText(satz));
      fehlende.push({ satz, quelle: PITCH, abschnitt });
    }
  }
  return fehlende;
}

export function mitNieSaetzenDerVorgaben(schnitt, pitch, soll) {
  const auftrag = einzigerAuftragMitTest(schnitt);
  if (auftrag === null || !istText(pitch)) return schnitt;
  const eigene = auftrag.wasDarfNiePassieren ?? [];
  const fehlende = fehlendeSaetze(pitch, soll, eigene);
  return fehlende.length === 0 ? schnitt : { ...schnitt, auftraege: [{ ...auftrag, wasDarfNiePassieren: [...eigene, ...fehlende] }] };
}
