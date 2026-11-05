export function vereinigteTests(listen) {
  return [...new Set(listen.flat())].sort();
}

function fatalInDatei(rot, { tests }) {
  return tests.erste.includes(rot.datei) && !tests.nachsichtig.includes(rot.datei);
}

export function betroffeneDateien(rot, dateien) {
  return dateien.filter((einheit) => fatalInDatei(rot, einheit));
}
