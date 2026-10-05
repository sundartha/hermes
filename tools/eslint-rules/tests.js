import festerImportpfad from "./fester-importpfad.js";
import keineSelbstpruefung from "./keine-selbstpruefung.js";

export default {
  meta: { name: "hermes-tests" },
  rules: {
    "keine-selbstpruefung": keineSelbstpruefung,
    "fester-importpfad": festerImportpfad,
  },
};
