import assert from "node:assert/strict";

describe("packaged desktop shell", () => {
  it("renders the context landing page", async () => {
    const navigation = await browser.$("nav");
    await navigation.waitForDisplayed();

    const runtime = await browser.execute(() => ({
      originalInvoke: typeof window.__wdio_original_core__?.invoke,
      root: Boolean(document.querySelector("#root")),
      tauriInvoke: typeof window.__TAURI__?.core?.invoke,
    }));
    assert.equal(runtime.originalInvoke, "function", JSON.stringify(runtime));

    assert.match(await navigation.getText(), /Context(?:s|os)/);
    assert.ok(await browser.$("main").isDisplayed());
  });
});
