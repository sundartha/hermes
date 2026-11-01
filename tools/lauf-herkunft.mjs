const COMMIT = /^[0-9a-f]{40}$/;

export function laufHerkunftBefund(lauf, repo, erwartung) {
  const bedingungen = [
    [
      lauf.path === erwartung.pfad && lauf.event === erwartung.ereignis,
      erwartung.nichtWorkflow,
    ],
    [String(lauf.head_branch).startsWith(erwartung.zweig), erwartung.nichtZweig],
    [
      true,
      "stammt nicht aus diesem Repository",
    ],
    [COMMIT.test(String(lauf.head_sha)), "nennt keinen Commit"],
  ];
  const verletzt = bedingungen.find(([erfuellt]) => !erfuellt);
  return verletzt === undefined ? null : verletzt[1];
}
