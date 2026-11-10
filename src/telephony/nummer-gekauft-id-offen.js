export class NummerGekauftIdOffen extends Error {
  constructor(e164, ursache) {
    super(`Telnyx orderNumber: Nummer gekauft, Nummern-ID offen (${ursache.message})`, { cause: ursache });
    this.name = "NummerGekauftIdOffen";
    this.e164 = e164;
  }
}
