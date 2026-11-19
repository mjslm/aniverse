import test from "node:test";
import assert from "node:assert/strict";
import { validateProfilePhoto, storedProfilePhoto, maxPhotoBytes } from "../dist/modules/profile-photo.js";

test("avatar uploads reject unsupported, empty, and oversized files", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.doesNotThrow(() => validateProfilePhoto({ type, size: maxPhotoBytes }));
  }
  for (const file of [null, { type: "image/svg+xml", size: 100 }, { type: "text/html", size: 100 }, { type: "image/png", size: 0 }, { type: "image/jpeg", size: maxPhotoBytes + 1 }]) {
    assert.throws(() => validateProfilePhoto(file));
  }
});

test("stored avatars accept only bounded JPEG data and never remote image URLs", () => {
  const jpeg = "data:image/jpeg;base64,/9j/AA==";
  assert.equal(storedProfilePhoto(jpeg), jpeg);
  for (const value of [null, "https://example.com/avatar.jpg", "javascript:alert(1)", "data:image/svg+xml,<svg/>", "data:image/jpeg;base64,<bad>", "data:image/jpeg;base64," + "A".repeat(180000)]) {
    assert.equal(storedProfilePhoto(value), "");
  }
});
