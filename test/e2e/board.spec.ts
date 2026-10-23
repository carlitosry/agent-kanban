import { expect, test, type Page } from "@playwright/test";
import { cli } from "./helpers.js";

const SHOTS = "docs/screenshots";

const card = (page: Page, id: string) => page.getByRole("button", { name: new RegExp(`^${id}:`) });
const column = (page: Page, state: string) => page.getByTestId(`col-${state}`);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("board")).toBeVisible();
});

test("1. a CLI move changes the card column without reloading", async ({ page }) => {
  await expect(column(page, "todo").getByRole("button", { name: /^T07:/ })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true; });

  cli("move", "T07", "in_progress", "--by", "fran");

  await expect(column(page, "in_progress").getByRole("button", { name: /^T07:/ })).toBeVisible();
  await expect(column(page, "todo").getByRole("button", { name: /^T07:/ })).toHaveCount(0);
  // The marker set before the move survives: the page was not reloaded.
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
});

test("2. blocking from the UI shows the raised hand", async ({ page }) => {
  await card(page, "T04").click();
  await page.getByRole("button", { name: "Bloquear", exact: true }).click();
  await page.getByLabel("Motivo del bloqueo").fill("Need the API contract confirmed");
  await page.getByLabel("Pregunta para una persona (opcional)").fill("Which error code for a duplicate title?");
  await page.getByRole("button", { name: "Bloquear", exact: true }).last().click();

  const blocked = column(page, "blocked").getByRole("button", { name: /^T04:/ });
  await expect(blocked).toBeVisible();
  await expect(blocked.getByLabel("Espera respuesta humana")).toBeVisible();
});

test("3. dark mode persists after reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "Cambiar a tema oscuro" }).click();
  await expect(html).toHaveClass(/dark/);
  await page.reload();
  await expect(html).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Cambiar a tema claro" })).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 390]) {
    test(`4. screenshot ${theme} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/");
      await page.evaluate((t) => localStorage.setItem("ak-theme", t), theme);
      await page.reload();
      await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^((?!dark).)*$/);
      await expect(page.getByTestId("board")).toBeVisible();
      await expect(column(page, "done").getByRole("button").first()).toBeAttached();
      await page.screenshot({ path: `${SHOTS}/board-${theme}-${width}.png` });
    });
  }
}
