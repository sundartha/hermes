import { posix } from "node:path";

export function schluesselUmgezogen(objekt, { neuFuer }) {
  return Object.fromEntries(
    Object.entries(objekt).map(([pfad, wert]) => {
      const neu = neuFuer.get(pfad);
      return [neu === undefined || Object.hasOwn(objekt, neu) ? pfad : neu, wert];
    }),
  );
}

function feldUmgezogen(eintrag, feld, neuFuer) {
  const neu = neuFuer.get(eintrag[feld]);
  return neu === undefined ? eintrag : { ...eintrag, [feld]: neu };
}

function endungNachgezogen(eintrag, { alt, neu }) {
  const name = posix.basename(alt);
  const quelle = eintrag.unresolvedTo;
  if (typeof quelle !== "string" || !quelle.endsWith(`/${name}`)) return eintrag;
  return { ...eintrag, unresolvedTo: `${quelle.slice(0, -name.length)}${posix.basename(neu)}` };
}

export function abhaengigkeitenUmgezogen(liste, { neuFuer }) {
  return liste.map((eintrag) => {
    const umgezogen = feldUmgezogen(feldUmgezogen(eintrag, "from", neuFuer), "to", neuFuer);
    return umgezogen.to === eintrag.to ? umgezogen : endungNachgezogen(umgezogen, { alt: eintrag.to, neu: umgezogen.to });
  });
}
