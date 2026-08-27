import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizePublicProfileUrl,
  facebookNumericId,
  isValidPublicProfileUrl,
  samePublicProfileIdentity,
} from "../lib/public-metrics";

const ID = "61566110230888";
const PROFILE_PHP = `https://www.facebook.com/profile.php?id=${ID}`;
const PAGE_FORM = `https://www.facebook.com/p/Muellerstudio-${ID}/`;

test("the newer /p/ page URL is a valid public profile", () => {
  assert.equal(isValidPublicProfileUrl("facebook", PAGE_FORM), true);
  assert.equal(
    canonicalizePublicProfileUrl("facebook", PAGE_FORM),
    PAGE_FORM,
  );
});

test("query noise on the redirect target is stripped", () => {
  assert.equal(
    canonicalizePublicProfileUrl(
      "facebook",
      `https://www.facebook.com/p/Muellerstudio-${ID}/?wtsid=rdr_021f2oC627DIUZYSX&hr=1`,
    ),
    PAGE_FORM,
  );
});

test("the numeric id is recovered from every Facebook URL spelling", () => {
  assert.equal(facebookNumericId(PROFILE_PHP), ID);
  assert.equal(facebookNumericId(PAGE_FORM), ID);
  assert.equal(
    facebookNumericId(`https://www.facebook.com/pages/Some-Studio/${ID}/`),
    ID,
  );
});

test("both spellings of the same page are one identity", () => {
  // Regression: Facebook redirects profile.php?id=… to /p/Name-id/ when
  // signed out. Before this, the collector rejected its own redirect target
  // and reported the page as unverifiable.
  assert.equal(samePublicProfileIdentity("facebook", PROFILE_PHP, PAGE_FORM), true);
  assert.equal(samePublicProfileIdentity("facebook", PAGE_FORM, PROFILE_PHP), true);
});

test("different pages remain distinct", () => {
  assert.equal(
    samePublicProfileIdentity(
      "facebook",
      PROFILE_PHP,
      "https://www.facebook.com/p/Someone-Else-61566110230999/",
    ),
    false,
  );
  assert.equal(
    samePublicProfileIdentity("facebook", PROFILE_PHP, "https://www.facebook.com/other/"),
    false,
  );
});

test("a vanity slug ending in a short number is not treated as an id", () => {
  // Otherwise /p/Studio-2024/ and /p/Gallery-2024/ would collide.
  assert.equal(facebookNumericId("https://www.facebook.com/p/Studio-2024/"), "");
  assert.equal(
    samePublicProfileIdentity(
      "facebook",
      "https://www.facebook.com/p/Studio-2024/",
      "https://www.facebook.com/p/Gallery-2024/",
    ),
    false,
  );
});

test("a vanity handle page still matches itself", () => {
  assert.equal(
    samePublicProfileIdentity(
      "facebook",
      "https://www.facebook.com/muellerstudio/",
      "https://www.facebook.com/muellerstudio",
    ),
    true,
  );
});

test("non-Facebook hosts are still rejected", () => {
  assert.equal(isValidPublicProfileUrl("facebook", `https://evil.example.com/p/X-${ID}/`), false);
});
