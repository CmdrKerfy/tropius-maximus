import test from "node:test";
import assert from "node:assert/strict";
import { tcgdexAssetImageUrl, resolveShareImageUrl, shareOgImageCandidates } from "../sharePreviewImage.js";

test("tcgdex base path (serves HTML) gets a real file", () => {
  // Production case: Pocket P-A-054 share_preview_image came from raw_data.image.
  assert.equal(
    tcgdexAssetImageUrl("https://assets.tcgdex.net/en/tcgp/P-A/054", "jpg"),
    "https://assets.tcgdex.net/en/tcgp/P-A/054/high.jpg"
  );
  assert.equal(
    tcgdexAssetImageUrl("https://assets.tcgdex.net/en/tcgp/P-A/054/"),
    "https://assets.tcgdex.net/en/tcgp/P-A/054/high.webp"
  );
});

test("tcgdex file keeps its quality and switches format", () => {
  assert.equal(
    tcgdexAssetImageUrl("https://assets.tcgdex.net/en/neo/neo4/50/high.webp", "jpg"),
    "https://assets.tcgdex.net/en/neo/neo4/50/high.jpg"
  );
  assert.equal(
    tcgdexAssetImageUrl("https://assets.tcgdex.net/ja/SV/SV1S/001/low.webp", "jpg"),
    "https://assets.tcgdex.net/ja/SV/SV1S/001/low.jpg"
  );
});

test("other hosts and unexpected tcgdex files are unchanged", () => {
  for (const u of [
    "https://images.pokemontcg.io/xy8/76.png",
    "https://images.scrydex.com/pokemon/me3-1/large",
    "https://assets.tcgdex.net/en/logo.png",
    "not a url",
  ]) {
    assert.equal(tcgdexAssetImageUrl(u, "jpg"), u);
  }
  assert.equal(tcgdexAssetImageUrl("", "jpg"), "");
  assert.equal(tcgdexAssetImageUrl(null, "jpg"), null);
});

test("resolveShareImageUrl keeps field order and fixes tcgdex base paths for the browser page", () => {
  assert.equal(
    resolveShareImageUrl({ share_preview_image: "https://assets.tcgdex.net/en/tcgp/P-A/054", image_large: "x" }),
    "https://assets.tcgdex.net/en/tcgp/P-A/054/high.webp"
  );
  assert.equal(resolveShareImageUrl({ share_preview_image: "null", image_small: " https://a/b.png " }), "https://a/b.png");
  assert.equal(resolveShareImageUrl(null), "");
});

test("shareOgImageCandidates orders, converts to JPEG and de-duplicates", () => {
  assert.deepEqual(
    shareOgImageCandidates({
      share_preview_image: "https://assets.tcgdex.net/en/tcgp/P-A/054",
      image_override: "",
      image_large: "https://assets.tcgdex.net/en/tcgp/P-A/054/high.webp",
      image_small: "https://assets.tcgdex.net/en/tcgp/P-A/054/low.webp",
    }),
    ["https://assets.tcgdex.net/en/tcgp/P-A/054/high.jpg", "https://assets.tcgdex.net/en/tcgp/P-A/054/low.jpg"]
  );
  assert.deepEqual(shareOgImageCandidates({}), []);
});
