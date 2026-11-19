import test from "node:test";
import assert from "node:assert/strict";
import { catalog } from "../dist/content/catalog.js";
import { suggestAnime } from "../dist/modules/search-suggestions.js";
test("typing a partial title suggests the intended anime before unrelated matches", () => {
  for (const query of ["demon", "dem", "kimetsu", "demom slayer"]) {
    assert.equal(suggestAnime(catalog, query)[0].id, "demon");
  }
  assert.equal(suggestAnime(catalog, "oshi")[0].id, "oshi");
});
test("suggestions stay within the available catalog and have useful empty states", () => {
  for (const query of ["", "   ", "#!@", "not-a-catalog-series-123"]) {
    assert.deepEqual(suggestAnime(catalog, query), []);
  }
  assert(suggestAnime(catalog, "a", { limit: 3 }).length <= 3);
  assert.deepEqual(suggestAnime(catalog, "demon", { filters: { studio: "MAPPA" } }), []);
});
test("Oshi no Ko season one has its published episode titles and ends at episode eleven", () => {
  const oshi = catalog.find((anime) => anime.id === "oshi");
  const episodes = oshi.seasons[0].episodes;
  assert.equal(episodes[1].title, "Third Option");
  assert.equal(episodes.at(-1).title, "Idol");
  assert.equal(episodes.length, 11);
  assert.equal(oshi.episodes, episodes.length);
});
