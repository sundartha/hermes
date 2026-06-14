// Store-Fassade: re-exportiert das aktive Backend. Die Datei MUSS als store.js
// bestehen bleiben - ESM resolved "./store.js" NICHT auf ein store/-Verzeichnis,
// die Caller (server/bridge/claude) und der Retention-Test importieren store.js
// unveraendert. P3a kennt nur das JSON-Backend; der Backend-Switch kommt spaeter.
export * from "./store/json.js";
