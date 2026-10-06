const BYTES = new TextEncoder();
export const FAKE_FIRST_CHUNK = BYTES.encode("ID3");
export const FAKE_REST_CHUNK = BYTES.encode("rest");

const DEFAULT_CONTENT_TYPE = "audio/mpeg";

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function makeReader({ chunks, restGate }) {
  let i = 0;
  return {
    async read() {
      if (i === 0) return { done: false, value: chunks[i++] };
      if (restGate) await restGate;
      if (i >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: chunks[i++] };
    },
  };
}

export function fakeTtsStreamResponse(opts = {}) {
  const chunks = opts.chunks ?? [FAKE_FIRST_CHUNK, FAKE_REST_CHUNK];
  const contentType = opts.contentType ?? DEFAULT_CONTENT_TYPE;
  return {
    ok: true,
    headers: { get: () => contentType },
    body: {
      getReader: () =>
        chunks.length === 0
          ? { read: async () => ({ done: true, value: undefined }) }
          : makeReader({ chunks, restGate: opts.restGate }),
    },
  };
}

export function recordingStreamFetch(opts = {}) {
  const urls = [];
  const calls = [];
  const fetchImpl = async (...args) => {
    urls.push(args[0]);
    calls.push(args);
    return fakeTtsStreamResponse(opts);
  };
  return { urls, calls, fetchImpl };
}
