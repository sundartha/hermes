const PRODUKTCODE = "src/";

export function istProduktpfad(datei) {
  return datei.toLowerCase().startsWith(PRODUKTCODE);
}
