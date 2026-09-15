import { describe, expect, it } from "vitest";
import { translate } from "./i18n";

describe("translate", () => {
  it("returns the Spanish context label", () => {
    expect(translate("es", "contexts")).toBe("Contextos");
  });

  it("translates phase 8 administration and connection states", () => {
    expect(translate("en", "administration")).toBe("Administration");
    expect(translate("es", "connectionOffline")).toBe("Sin conexión");
  });
});
