import anfrageMitFrist from "./anfrage-mit-frist.js";
import festerImportpfad from "./fester-importpfad.js";
import keineSelbstaufruf from "./keine-selbstaufruf.js";
import keineSelbstpruefung from "./keine-selbstpruefung.js";
import keineSpeicherAttrappe from "./keine-speicher-attrappe.js";

export default {
  meta: { name: "hermes-tests" },
  rules: {
    "keine-selbstaufruf": keineSelbstaufruf,
    "keine-selbstpruefung": keineSelbstpruefung,
    "fester-importpfad": festerImportpfad,
    "anfrage-mit-frist": anfrageMitFrist,
    "keine-speicher-attrappe": keineSpeicherAttrappe,
  },
};
