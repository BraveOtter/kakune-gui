import { describe, expect, it } from "vitest";
import { translate } from "./i18n";

describe("translate", () => {
  it("returns the Spanish context label", () => {
    expect(translate("es", "contexts")).toBe("Contextos");
  });
});
