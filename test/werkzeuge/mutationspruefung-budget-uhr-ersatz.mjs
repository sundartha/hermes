const EIN_TAG_MS = 86_400_000;

let stand = Date.now();

Date.now = () => {
  stand += EIN_TAG_MS;
  return stand;
};
