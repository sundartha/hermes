const SCHLUESSEL_VORSATZ = "bis-freigabe:";

const schluesselVon = (token) => `${SCHLUESSEL_VORSATZ}${token}`;

export function makeAblageBisFreigabe(ablage) {
  return {
    ablegen: (token, audio, optionen) => ablage.ablegen(schluesselVon(token), audio, optionen),
    lesen: (token) => ablage.lesen(schluesselVon(token)),
    freigeben: (token) => ablage.freigeben(schluesselVon(token)),
  };
}
