import { kostenDesAuftrags } from "../kosten.mjs";

const JE_ROLLE = "je Rolle";
const ERKUNDER = "erkunder";
export const WEGPRUEFER = "wegpruefer";
export const ERKUNDUNG = [ERKUNDER, WEGPRUEFER];

export function gemesseneKosten(root, beteiligte) {
  return kostenDesAuftrags(root, beteiligte.filter(({ sitzung }) => sitzung !== undefined)).summe.gesamt;
}

export function ohneGliederung({ soll, nurUmbau }) {
  return nurUmbau && soll.size === 0;
}

export class Kostenbuch {
  constructor() {
    this.jeLauf = {};
    this.wellen = [];
  }

  async gezaehlt({ gemessen, schritt }, arbeit) {
    const grund = gemessen();
    try {
      return await arbeit();
    } finally {
      this.wellen.push({ schritt, gemessen: gemessen() - grund });
    }
  }

  verbuche(schritte, kosten, { geworfen = false } = {}) {
    const rollen = geworfen ? [] : schritte.flat();
    const vorkommen = Map.groupBy(rollen, (rolle) => rolle);
    const eigene = [...vorkommen.keys()].reduce((summe, rolle) => summe + (kosten[rolle] ?? 0), 0);
    const rest = Object.values(kosten).reduce((summe, token) => summe + token, 0) - eigene;
    for (const [rolle, { length: laeufe }] of vorkommen) {
      const bisher = this.jeLauf[rolle] ?? { laeufe: 0, token: 0 };
      this.jeLauf[rolle] = { laeufe: bisher.laeufe + laeufe, token: bisher.token + (kosten[rolle] ?? 0) + (rest * laeufe) / rollen.length };
    }
  }

  bericht() {
    return { wellen: this.wellen, kostenJeLauf: this.jeLauf, kostenGebucht: JE_ROLLE };
  }
}
