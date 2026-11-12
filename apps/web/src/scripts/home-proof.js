const SYNC_CLASS = "sync";
const DONE_CLASS = "done";
const NO_SOURCE = 3;

function reachedBy(times, now) {
  return times.filter((at) => now >= at).length;
}

function proofSync(proof, video) {
  const rows = Array.from(proof.querySelectorAll("[data-at]"));
  const times = rows.map((row) => parseFloat(row.dataset.at) || 0);
  let reached = 0;
  const show = (count) => {
    if (count <= reached) return;
    reached = count;
    rows.forEach((row, index) => row.classList.toggle(DONE_CLASS, index < reached));
  };
  return {
    follow: () => {
      if (video.paused) return;
      proof.classList.add(SYNC_CLASS);
      show(reachedBy(times, video.currentTime));
    },
    finish: () => show(rows.length),
  };
}

function wireFailure(video, finish) {
  video.addEventListener("error", finish);
  for (const source of video.querySelectorAll("source")) {
    source.addEventListener("error", () => {
      if (video.networkState === NO_SOURCE) finish();
    });
  }
}

export function wireProof(root = document, reduce = false) {
  if (reduce) return;
  for (const proof of root.querySelectorAll(".vproof")) {
    const video = proof.closest(".vslot")?.querySelector("video");
    if (!video) continue;
    const sync = proofSync(proof, video);
    video.addEventListener("timeupdate", sync.follow);
    wireFailure(video, sync.finish);
  }
}
