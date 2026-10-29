import { starteAttrappe } from "../anrufe/attrappen-server.js";

export async function starteAnbieterServer(behandle) {
  const anfragen = [];
  const vermerke = (eintrag) => anfragen.push(eintrag);
  const attrappe = await starteAttrappe((req, res) => {
    let body = "";
    req.on("data", (teil) => (body += teil));
    req.on("end", () => behandle({ req, body, res, vermerke }));
  });
  return { ...attrappe, anfragen };
}
