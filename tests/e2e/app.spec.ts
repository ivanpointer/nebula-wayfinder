import { expect, test } from "@playwright/test";

test("renders the graph shell and a nonblank canvas", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Nebula Wayfinder")).toBeVisible();
  await expect(page.getByText("Clouds")).toBeVisible();

  const canvas = page.locator("#renderCanvas");
  await expect(canvas).toBeVisible();

  const nonBlank = await canvas.evaluate((node) => {
    const canvasNode = node as HTMLCanvasElement;
    const gl = canvasNode.getContext("webgl2") ?? canvasNode.getContext("webgl");
    if (!gl) {
      return false;
    }

    const pixel = new Uint8Array(4);
    gl.readPixels(
      Math.floor(canvasNode.width / 2),
      Math.floor(canvasNode.height / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel,
    );
    return Array.from(pixel).some((value) => value > 0);
  });

  expect(nonBlank).toBe(true);
});
