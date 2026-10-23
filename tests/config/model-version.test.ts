import { expect, it } from "vitest";
import { latestModelVersion } from "../../src/lib/config/dealer.js";

it("selects the highest numeric semver, independently of registry insertion order", () => {
  expect(latestModelVersion(["1.10.0", "1.2.100", "1.1.0"])).toBe("1.10.0");
  expect(latestModelVersion(["2.0.0", "1.99.99", "1.100.0"])).toBe("2.0.0");
  expect(latestModelVersion(["1.0.11", "1.0.2", "1.0.1"])).toBe("1.0.11");
});
it.each(
  [[], [""], ["1"], ["1.0"], ["1.0.0-rc1"], ["1.01.0"], ["9007199254740992.0.0"]].map(
    (versions) => ({ versions }),
  ),
)("rejects an invalid stable model version registry %j", ({ versions }) => {
  expect(() => latestModelVersion(versions)).toThrow(RangeError);
});
