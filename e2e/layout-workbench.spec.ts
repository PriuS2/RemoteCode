import fs from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { getDropZoneGeometry } from "../frontend/src/utils/layoutDropGeometry";

type DropZone = "left" | "right" | "top" | "bottom" | "center";
type ResizeMessage = {
  sessionId: string | null;
  cols: number | null;
  rows: number | null;
  timestamp: number;
};
type ZonePointMode = "center" | "inside-edge" | "outside-edge";

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

async function withSessionDrag(
  page: Page,
  sourceSessionName: string,
  targetSessionName: string,
  action: (target: Locator, dataTransfer: Awaited<ReturnType<Page["evaluateHandle"]>>) => Promise<void>,
) {
  const source = sessionRow(page, sourceSessionName);
  const target = paneLeaf(page, targetSessionName).locator("[data-pane-drop-surface]").first();
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());

  await source.dispatchEvent("dragstart", { dataTransfer });
  await expect(target.locator(".pane-drop-overlay")).toBeVisible();

  try {
    await action(target, dataTransfer);
  } finally {
    await source.dispatchEvent("dragend", { dataTransfer });
    await expect(page.locator(".pane-drop-overlay")).toHaveCount(0);
  }
}

async function getZonePoint(target: Locator, zone: DropZone, mode: ZonePointMode) {
  const zoneLocator = target.locator(`[data-drop-zone="${zone}"]`);
  const box = await zoneLocator.boundingBox();
  if (!box) {
    throw new Error(`Unable to resolve visible drop zone bounds for ${zone}`);
  }

  if (mode === "center") {
    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
  }

  const insideOffset = 2;
  const outsideOffset = 2;

  if (mode === "inside-edge") {
    if (zone === "left") {
      return { x: box.x + box.width - insideOffset, y: box.y + box.height / 2 };
    }
    if (zone === "right") {
      return { x: box.x + insideOffset, y: box.y + box.height / 2 };
    }
    if (zone === "top") {
      return { x: box.x + box.width / 2, y: box.y + box.height - insideOffset };
    }
    if (zone === "bottom") {
      return { x: box.x + box.width / 2, y: box.y + insideOffset };
    }
  }

  if (zone === "left") {
    return { x: box.x + box.width + outsideOffset, y: box.y + box.height / 2 };
  }
  if (zone === "right") {
    return { x: box.x - outsideOffset, y: box.y + box.height / 2 };
  }
  if (zone === "top") {
    return { x: box.x + box.width / 2, y: box.y + box.height + outsideOffset };
  }
  if (zone === "bottom") {
    return { x: box.x + box.width / 2, y: box.y - outsideOffset };
  }
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

async function previewDropZone(
  page: Page,
  sourceSessionName: string,
  targetSessionName: string,
  zone: DropZone,
  mode: ZonePointMode,
  expectedZone: DropZone | null,
) {
  await withSessionDrag(page, sourceSessionName, targetSessionName, async (target, dataTransfer) => {
    const point = await getZonePoint(target, zone, mode);
    await target.dispatchEvent("dragover", {
      dataTransfer,
      clientX: point.x,
      clientY: point.y,
    });

    const activeZones = target.locator(".pane-drop-overlay__zone.is-active");
    if (!expectedZone) {
      await expect(activeZones).toHaveCount(0);
      return;
    }

    await expect(activeZones).toHaveCount(1);
    await expect(target.locator(`[data-drop-zone="${expectedZone}"]`)).toHaveClass(/is-active/);
  });
}

async function dragSessionToPane(page: Page, sourceSessionName: string, targetSessionName: string, zone: DropZone) {
  await withSessionDrag(page, sourceSessionName, targetSessionName, async (target, dataTransfer) => {
    const point = await getZonePoint(target, zone, "center");
    await target.dispatchEvent("dragover", {
      dataTransfer,
      clientX: point.x,
      clientY: point.y,
    });
    await target.dispatchEvent("drop", {
      dataTransfer,
      clientX: point.x,
      clientY: point.y,
    });
  });
}

async function getActualDropTargetPosition(target: Locator, zone: DropZone) {
  const box = await target.boundingBox();
  if (!box) {
    throw new Error(`Unable to resolve drop target bounds for ${zone}`);
  }

  const rect = getDropZoneGeometry({ width: box.width, height: box.height })[zone];
  return {
    x: Math.max(1, rect.left + rect.width / 2),
    y: Math.max(1, rect.top + rect.height / 2),
  };
}

async function dragSessionToPaneWithMouse(
  page: Page,
  sourceSessionName: string,
  targetSessionName: string,
  zone: DropZone,
) {
  const source = sessionRow(page, sourceSessionName);
  const target = paneLeaf(page, targetSessionName).locator("[data-pane-drop-surface]").first();
  const targetPosition = await getActualDropTargetPosition(target, zone);
  await source.dragTo(target, { targetPosition });
}

async function dragSessionToEmptyWorkbench(page: Page, sourceSessionName: string) {
  const source = sessionRow(page, sourceSessionName);
  const target = page.locator("main.terminal-area").first();
  const box = await target.boundingBox();
  if (!box) {
    throw new Error("Unable to resolve empty workbench bounds");
  }

  await source.dragTo(target, {
    targetPosition: {
      x: box.width / 2,
      y: box.height / 2,
    },
  });
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

async function terminalBufferHasText(page: Page, sessionName: string, text: string) {
  return page.evaluate(({ sessionName: targetSessionName, text: targetText }) => {
    const store = (
      window as Window & {
        __remoteCodeTerminalDebug?: Record<string, { sessionName: string; term: any }>;
      }
    ).__remoteCodeTerminalDebug ?? {};
    const entry = Object.values(store).find((item) => item.sessionName === targetSessionName);
    if (!entry) {
      return false;
    }

    const buffer = entry.term.buffer.active;
    for (let index = 0; index < buffer.length; index += 1) {
      const line = buffer.getLine(index)?.translateToString(true) ?? "";
      if (line.includes(targetText)) {
        return true;
      }
    }
    return false;
  }, { sessionName, text });
}

async function terminalBufferLength(page: Page, sessionName: string) {
  return page.evaluate((targetSessionName) => {
    const store = (
      window as Window & {
        __remoteCodeTerminalDebug?: Record<string, { sessionName: string; term: any }>;
      }
    ).__remoteCodeTerminalDebug ?? {};
    const entry = Object.values(store).find((item) => item.sessionName === targetSessionName);
    return entry ? entry.term.buffer.active.length : 0;
  }, sessionName);
}

async function waitForTerminalBufferText(page: Page, sessionName: string, text: string) {
  await expect.poll(async () => {
    return terminalBufferHasText(page, sessionName, text);
  }, {
    message: `Waiting for ${text} in ${sessionName} terminal buffer`,
    timeout: 20_000,
  }).toBe(true);
}

async function runTerminalCommand(page: Page, sessionName: string, command: string, expectedText?: string) {
  const pane = paneLeaf(page, sessionName);
  await pane.click();
  await page.keyboard.insertText(command);
  await page.keyboard.press("Enter");
  if (expectedText) {
    await waitForTerminalBufferText(page, sessionName, expectedText);
  }
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

  await dragSessionToPaneWithMouse(page, "A-Two", "A-One", "left");
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(2);
  await expect(paneLeaf(page, "A-Two")).toBeVisible();

  await dragSessionToPaneWithMouse(page, "A-Two", "A-One", "center");
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(1);
  await expect(paneLeaf(page, "A-Two")).toBeVisible();
  await expect(page.locator('[data-layout-node="leaf"]').filter({ hasText: "A-One" })).toHaveCount(0);

  await paneLeaf(page, "A-Two").getByTitle("Close Pane").click();
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(0);

  await dragSessionToEmptyWorkbench(page, "A-One");
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(1);
  await expect(paneLeaf(page, "A-One")).toBeVisible();

  await runTerminalCommand(
    page,
    "A-One",
    '1..600 | ForEach-Object { Write-Output ("KEEPALIVE-LINE-{0:D3}" -f $_) }',
    "KEEPALIVE-LINE-600",
  );
  await expect.poll(async () => {
    return terminalBufferLength(page, "A-One");
  }, {
    message: "Waiting for A-One scrollback to grow after keep-alive output",
    timeout: 20_000,
  }).toBeGreaterThan(500);

  await previewDropZone(page, "B-One", "A-One", "left", "inside-edge", "left");
  await previewDropZone(page, "B-One", "A-One", "left", "outside-edge", "center");
  await previewDropZone(page, "B-One", "A-One", "top", "inside-edge", "top");
  await previewDropZone(page, "B-One", "A-One", "top", "outside-edge", "center");

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
  await expect.poll(async () => {
    return terminalBufferLength(page, "A-One");
  }, {
    message: "Waiting for A-One scrollback to remain after layout restore",
    timeout: 20_000,
  }).toBeGreaterThan(500);
  await runTerminalCommand(page, "A-One", 'Write-Output "KEEPALIVE-RESTORED"', "KEEPALIVE-RESTORED");

  await paneLeaf(page, "A-One").getByTitle("Refresh").click();
  await expect.poll(async () => {
    return terminalBufferLength(page, "A-One");
  }, {
    message: "Waiting for A-One scrollback to remain after hard refresh",
    timeout: 20_000,
  }).toBeGreaterThan(500);
  await runTerminalCommand(page, "A-One", 'Write-Output "KEEPALIVE-REFRESHED"', "KEEPALIVE-REFRESHED");
  await expect(page.locator(".terminal-statusbar").filter({ hasText: "taken over" })).toHaveCount(0);

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
