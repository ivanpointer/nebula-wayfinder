import { expect, test } from "@playwright/test";

test("renders the graph shell and a nonblank canvas", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Nebula Wayfinder")).toBeVisible();
  await expect(page.getByText("Clouds")).toBeVisible();
  await expect(page.getByRole("button", { name: "Auto arrange" })).toBeVisible();

  const canvas = page.locator("#renderCanvas");
  await expect(canvas).toBeVisible();

  await expect
    .poll(
      async () =>
        canvas.evaluate((node) => {
          const canvasNode = node as HTMLCanvasElement;
          const gl = canvasNode.getContext("webgl2") ?? canvasNode.getContext("webgl");
          if (!gl) {
            return false;
          }

          const samplePoints = [
            [0.25, 0.25],
            [0.5, 0.25],
            [0.75, 0.25],
            [0.25, 0.5],
            [0.5, 0.5],
            [0.75, 0.5],
            [0.25, 0.75],
            [0.5, 0.75],
            [0.75, 0.75],
          ];
          const pixel = new Uint8Array(4);

          return samplePoints.some(([x, y]) => {
            gl.readPixels(
              Math.floor(canvasNode.width * x),
              Math.floor(canvasNode.height * y),
              1,
              1,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              pixel,
            );
            return Array.from(pixel).some((value) => value > 0);
          });
        }),
      { timeout: 5000 },
    )
    .toBe(true);
});
