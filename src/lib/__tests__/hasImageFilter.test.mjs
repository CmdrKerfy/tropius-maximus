import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { applyHasImageFilter } from "../../data/supabase/appAdapter.js";

// These exact filters were checked against PostgREST 14.5 (production's version) on a
// production-shaped fixture on 2026-09-27: a card with no image of its own but an
// image override counts as "Yes"; a blank override counts as "No".
const sb = createClient("https://example.test", "anon-key", { auth: { persistSession: false } });
const search = (value) => decodeURIComponent(applyHasImageFilter(sb.from("cards").select("id"), value).url.search);

test("Has Image Yes = card image or image override", () => {
  assert.equal(
    search("true"),
    "?select=id&or=(image_small.not.is.null,image_large.not.is.null,card_has_image_override.is.true)"
  );
});

test("Has Image No = no card image and no image override", () => {
  assert.equal(
    search("false"),
    "?select=id&image_small=is.null&image_large=is.null&card_has_image_override=is.false"
  );
});

test("Has Image All adds no filter", () => {
  for (const value of ["", undefined, "maybe"]) assert.equal(search(value), "?select=id");
});
