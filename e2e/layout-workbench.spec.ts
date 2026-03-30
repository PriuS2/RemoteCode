import fs from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

type DropZone = "left" | "right" | "top" | "bottom" | "center";
type ResizeMessage = {
  sessionId: string | null;
  cols: number | null;
  rows: number | null;
  timestamp: number;
};

const tempRoot = path.join(process.cwd(), "e2e", ".tmp");
const projectADir = path.join(tempRoot, "project-a");
const projectBDir = path.join(tempRoot, "project-b");

function projectGroup(page: Page, projectName: string): Locator {
  return page.locator(".project-group").filter({ hasText: projectName }).first();
}

function projectLayoutButton(page: Page, projectName: string): Locator {
  return projectGroup(page, projectName).getByRole("button", { name: "Layout" });
}

function projectAddSessionButton(page: Page, projectName: string): Locator {
  return projectGroup(page, projectName).getByRole("button", { name: "+ Session" });
}

function sessionRow(page: Page, sessionName: string): Locator {
  return page.locator(".session-row").filter({ hasText: sessionName }).first();
}

function paneLeaf(page: Page, sessionName: string): Locator {
  return page.locator('[data-layout-node="leaf"]').filter({ hasText: sessionName }).first();
}

async function login(page: Page) {
  await page.goto("/");
  if (await page.getByTestId("login-password").isVisible().catch(() => false)) {
    await page.getByTestId("login-password").fill("test-password");
    await page.getByTestId("login-submit").click();
  }
  await expect(page.locator(".session-list")).toBeVisible();
}

async function createProject(page: Page, projectName: string, workPath: string) {
  await page.getByTestId("new-project-button").click();
  await expect(page.getByTestId("new-project-modal")).toBeVisible();
  await page.getByTestId("new-project-path").fill(workPath);
  await page.getByTestId("new-project-name").fill(projectName);
  await page.getByTestId("new-project-submit").click();
  await expect(page.getByTestId("new-project-modal")).toBeHidden();
  await expect(projectGroup(page, projectName)).toBeVisible();
}

async function createTerminalSession(page: Page, projectName: string, sessionName: string) {
  await projectAddSessionButton(page, projectName).click();
  await expect(page.getByTestId("add-session-modal")).toBeVisible();
  await page.getByTestId("add-session-name").fill(sessionName);
  await page.getByTestId("cli-option-terminal").click();
  await expect(page.getByTestId("cli-option-terminal")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("add-session-submit").click();
  await expect(page.getByTestId("add-session-modal")).toBeHidden();
  await expect(sessionRow(page, sessionName)).toBeVisible();
}

async function dragSessionToPane(page: Page, sourceSessionName: string, targetSessionName: string, zone: DropZone) {
  const source = sessionRow(page, sourceSessionName);
  const target = paneLeaf(page, targetSessionName).locator("[data-pane-drop-surface]").first();
  const box = await target.boundingBox();
  if (!box) {
    throw new Error(`Unable to resolve target pane bounds for ${targetSessionName}`);
  }

  const centerX = Math.round(box.width / 2);
  const centerY = Math.round(box.height / 2);
  const targetPosition = {
    left: { x: 14, y: centerY },
    right: { x: Math.max(14, Math.round(box.width - 14)), y: centerY },
    top: { x: centerX, y: 14 },
    bottom: { x: centerX, y: Math.max(14, Math.round(box.height - 14)) },
    center: { x: centerX, y: centerY },
  }[zone];

  await source.dragTo(target, { targetPosition });
}

async function dragDivider(page: Page, delta: number) {
  const divider = page.locator(".pane-layout__divider").first();
  const box = await divider.boundingBox();
  const className = await divider.getAttribute("class");
  if (!box) {
    throw new Error("Unable to resolve divider bounds");
  }

  const isRowDivider = className?.includes("pane-layout__divider--row") ?? false;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(
    isRowDivider ? startX + delta : startX,
    isRowDivider ? startY : startY + delta,
    { steps: 8 },
  );
  await page.mouse.up();

  return isRowDivider ? "row" : "column";
}

async function readTerminalSize(page: Page, sessionName: string) {
  const pane = paneLeaf(page, sessionName);
  await pane.click();
  await page.keyboard.type('Write-Output "SIZE:$($Host.UI.RawUI.WindowSize.Width)x$($Host.UI.RawUI.WindowSize.Height)"');
  await page.keyboard.press("Enter");

  await expect.poll(async () => {
    const text = await pane.textContent();
    const matches = [...(text ?? "").matchAll(/SIZE:(\d+)x(\d+)/g)];
    return matches.at(-1)?.[0] ?? null;
  }, {
    message: `Waiting for terminal size marker in ${sessionName}`,
    timeout: 15_000,
  }).not.toBeNull();

  const text = await pane.textContent();
  const matches = [...(text ?? "").matchAll(/SIZE:(\d+)x(\d+)/g)];
  const match = matches.at(-1);
  if (!match) {
    throw new Error(`Unable to read terminal size for ${sessionName}`);
  }

  return {
    cols: Number(match[1]),
    rows: Number(match[2]),
  };
}

async function getResizeMessages(page: Page): Promise<ResizeMessage[]> {
  return page.evaluate(() => {
    return [ ...((window as Window & { __resizeMessages?: ResizeMessage[] }).__resizeMessages ?? []) ];
  });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(projectADir, { recursive: true });
  await fs.mkdir(projectBDir, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const store: ResizeMessage[] = [];
    (window as Window & { __resizeMessages?: ResizeMessage[] }).__resizeMessages = store;
    const originalSend = WebSocket.prototype.send;

    WebSocket.prototype.send = function patchedSend(this: WebSocket, data: Parameters<typeof originalSend>[0]) {
      try {
        const raw = typeof data === "string" ? data : String(data);
        const parsed = JSON.parse(raw);
        if (parsed?.type === "resize") {
          const match = this.url.match(/\/ws\/terminal\/([^/?]+)/);
          store.push({
            sessionId: match?.[1] ?? null,
            cols: typeof parsed.data?.cols === "number" ? parsed.data.cols : null,
            rows: typeof parsed.data?.rows === "number" ? parsed.data.rows : null,
            timestamp: Date.now(),
          });
        }
      } catch {
        // Ignore non-JSON websocket frames.
      }

      return originalSend.call(this, data);
    };
  });
});

test("supports multi-pane layouts, autosave, restore, foreign-session prune, and resize propagation", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });

  await login(page);

  await createProject(page, "Layout Project A", projectADir);
  await createProject(page, "Layout Project B", projectBDir);

  await createTerminalSession(page, "Layout Project A", "A-One");
  await createTerminalSession(page, "Layout Project A", "A-Two");
  await createTerminalSession(page, "Layout Project B", "B-One");

  await projectLayoutButton(page, "Layout Project A").click();
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(1);
  await expect(paneLeaf(page, "A-One")).toBeVisible();

  await dragSessionToPane(page, "B-One", "A-One", "left");
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(2);
  await expect(paneLeaf(page, "B-One")).toBeVisible();

  await dragSessionToPane(page, "A-Two", "A-One", "bottom");
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(3);
  await expect(paneLeaf(page, "A-Two")).toBeVisible();

  await dragSessionToPane(page, "B-One", "A-Two", "center");
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(2);
  await expect(paneLeaf(page, "B-One")).toBeVisible();
  await expect(page.locator('[data-layout-node="leaf"]').filter({ hasText: "A-Two" })).toHaveCount(0);

  await page.waitForTimeout(700);

  const sizeBefore = await readTerminalSize(page, "A-One");
  await page.evaluate(() => {
    const store = (window as Window & { __resizeMessages?: ResizeMessage[] }).__resizeMessages;
    if (store) {
      store.length = 0;
    }
  });

  const firstLeafBefore = await paneLeaf(page, "A-One").boundingBox();
  const dividerDirection = await dragDivider(page, 120);
  const firstLeafAfter = await paneLeaf(page, "A-One").boundingBox();
  await expect.poll(async () => {
    return (await getResizeMessages(page)).length;
  }, {
    message: "Waiting for websocket resize messages after divider drag",
    timeout: 15_000,
  }).toBeGreaterThan(0);
  await expect.poll(async () => {
    const messages = await getResizeMessages(page);
    return messages.some((message) => {
      if (dividerDirection === "row") {
        return typeof message.cols === "number" && message.cols !== sizeBefore.cols;
      }
      return typeof message.rows === "number" && message.rows !== sizeBefore.rows;
    });
  }, {
    message: "Waiting for a changed terminal resize payload after divider drag",
    timeout: 15_000,
  }).toBe(true);
  await page.waitForTimeout(800);
  const resizeMessages = await getResizeMessages(page);

  expect(firstLeafBefore).not.toBeNull();
  expect(firstLeafAfter).not.toBeNull();
  if (dividerDirection === "row") {
    expect(Math.abs((firstLeafAfter?.width ?? 0) - (firstLeafBefore?.width ?? 0))).toBeGreaterThan(40);
  } else {
    expect(Math.abs((firstLeafAfter?.height ?? 0) - (firstLeafBefore?.height ?? 0))).toBeGreaterThan(40);
  }
  expect(resizeMessages.length).toBeGreaterThan(0);

  await sessionRow(page, "A-Two").click();
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(1);
  await expect(paneLeaf(page, "A-Two")).toBeVisible();

  await projectLayoutButton(page, "Layout Project A").click();
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(2);
  await expect(paneLeaf(page, "A-One")).toBeVisible();
  await expect(paneLeaf(page, "B-One")).toBeVisible();

  await page.reload();
  await expect(page.locator(".session-list")).toBeVisible();
  await projectLayoutButton(page, "Layout Project A").click();
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(2);
  await expect(paneLeaf(page, "B-One")).toBeVisible();

  await sessionRow(page, "B-One").click({ button: "right" });
  await page.locator(".context-menu__item").filter({ hasText: "Delete Session" }).click({ force: true });
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(sessionRow(page, "B-One")).toHaveCount(0);

  await projectLayoutButton(page, "Layout Project A").click();
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(1);
  await expect(paneLeaf(page, "A-One")).toBeVisible();

  expect(dialogs).toEqual([]);
});
