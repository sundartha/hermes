import { startServer } from "../helpers.js";

export async function mitDienst(pruefung) {
  const srv = await startServer();
  try {
    await pruefung(srv);
  } finally {
    await srv.stop();
  }
}
