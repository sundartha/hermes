interface BesitzerAnlassEingabe {
  ownerOpening: (firstName: unknown) => string;
  firstName: unknown;
  openingLine: string;
}

export function besitzerAnlassEroeffnung({ ownerOpening, firstName, openingLine }: BesitzerAnlassEingabe): string {
  const begruessung = ownerOpening(firstName);
  return begruessung ? `${begruessung} ${openingLine}` : "";
}
