import http from "node:http";

import { FAKE_FIRST_CHUNK } from "../helpers/fake-tts-stream.mjs";

export function playTtsEnv(originUrl) {
  return {
    ELEVENLABS_PLAY_TTS_ENABLED: "true",
    ELEVENLABS_API_KEY: "test-elevenlabs-key",
    ELEVENLABS_VOICE_ID: "voice-1",
    ELEVENLABS_API_BASE: originUrl,
  };
}

export async function startSyntheseOrigin(nachErstemPaket) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "audio/mpeg");
      res.write(Buffer.from(FAKE_FIRST_CHUNK));
      nachErstemPaket(res, req);
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
