import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { getDropZoneGeometry } from "../frontend/src/utils/layoutDropGeometry";

type DropZone = "left" | "right" | "top" | "bottom" | "center";
type SessionType = "claude" | "opencode" | "kilo" | "folder" | "git" | "ide";

const screenshotDir = path.join(process.cwd(), "docs", "screenshots");
const tempRoot = path.join(process.cwd(), "e2e", ".tmp", "readme");
const alphaDir = path.join(tempRoot, "alpha-workspace");
const betaDir = path.join(tempRoot, "beta-workspace");

function screenshotPath(fileName: string) {
  return path.join(screenshotDir, fileName);
}

function runGit(cwd: string, args: string[]) {
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
  });
}

async function prepareWorkspaceFixtures() {
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(alphaDir, "src"), { recursive: true });
  await fs.mkdir(path.join(alphaDir, "docs"), { recursive: true });
  await fs.mkdir(path.join(betaDir, "notes"), { recursive: true });

  await fs.writeFile(
    path.join(alphaDir, "README_NOTES.md"),
    [
      "# Alpha Workspace",
      "",
      "- Multi-pane workbench demo",
      "- Git panel screenshot fixture",
      "- IDE and explorer sample files",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(alphaDir, "src", "main.ts"),
    [
      "export function greet(name: string) {",
      "  return `Hello, ${name}!`;",
      "}",
      "",
      "console.log(greet(\"Remote Code\"));",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(alphaDir, "src", "layout.ts"),
    [
      "export const layoutSummary = {",
      "  mode: \"project-layout\",",
      "  keepAlive: true,",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(alphaDir, "docs", "workflow.md"),
    [
      "# Workflow",
      "",
      "1. Open a project",
      "2. Create sessions",
      "3. Save the layout",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(betaDir, "notes", "todo.md"),
    [
      "# Beta Workspace",
      "",
      "- Shared shell for cross-project layout",
      "",
    ].join("\n"),
    "utf8",
  );

  runGit(alphaDir, ["init"]);
  runGit(alphaDir, ["config", "user.name", "Remote Code README"]);
  runGit(alphaDir, ["config", "user.email", "readme@example.com"]);
  runGit(alphaDir, ["add", "."]);
  runGit(alphaDir, ["commit", "-m", "Initial workspace"]);

  await fs.writeFile(
    path.join(alphaDir, "src", "main.ts"),
    [
      "export function greet(name: string) {",
      "  return `Hello from ${name}!`;",
      "}",
      "",
      "console.log(greet(\"Remote Code\"));",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(alphaDir, "docs", "workflow.md"),
    [
      "# Workflow",
      "",
      "1. Open a project",
      "2. Create sessions",
      "3. Save the layout",
      "4. Restore the workbench",
      "",
    ].join("\n"),
    "utf8",
  );
  runGit(alphaDir, ["add", "."]);
  runGit(alphaDir, ["commit", "-m", "Polish workspace docs"]);

  await fs.appendFile(
    path.join(alphaDir, "README_NOTES.md"),
    "\n- Pending edit for the Git panel screenshot\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(alphaDir, "scratch.txt"),
    "Untracked scratch file for status preview.\n",
    "utf8",
  );

  await fs.mkdir(screenshotDir, { recursive: true });
}

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

async function capture(page: Page, fileName: string) {
  await page.waitForTimeout(5000);
  await page.screenshot({
    path: screenshotPath(fileName),
    animations: "disabled",
  });
}

async function login(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("login-password")).toBeVisible();
  await page.getByTestId("login-password").fill("test-password");
  await page.getByTestId("login-submit").click();
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

async function openSessionModal(page: Page, projectName: string, sessionName: string, cliType: SessionType) {
  await projectAddSessionButton(page, projectName).click();
  await expect(page.getByTestId("add-session-modal")).toBeVisible();
  await page.getByTestId("add-session-name").fill(sessionName);
  await page.getByTestId(`cli-option-${cliType}`).click();
  await expect(page.getByTestId(`cli-option-${cliType}`)).toHaveAttribute("aria-pressed", "true");
}

async function submitSessionModal(page: Page, sessionName: string) {
  await expect(page.getByTestId("add-session-submit")).toBeEnabled();
  await page.getByTestId("add-session-submit").click();
  await expect(page.getByTestId("add-session-modal")).toBeHidden();
  await expect(sessionRow(page, sessionName)).toBeVisible();
}

async function createSession(page: Page, projectName: string, sessionName: string, cliType: SessionType) {
  await openSessionModal(page, projectName, sessionName, cliType);
  await submitSessionModal(page, sessionName);
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

async function waitForTerminalBufferText(page: Page, sessionName: string, text: string) {
  await expect.poll(async () => {
    return terminalBufferHasText(page, sessionName, text);
  }, {
    message: `Waiting for ${text} in ${sessionName} terminal buffer`,
    timeout: 20_000,
  }).toBe(true);
}

async function runTerminalCommand(page: Page, sessionName: string, command: string, expectedText: string) {
  const pane = paneLeaf(page, sessionName);
  await expect(pane).toBeVisible();
  await pane.click();
  await page.keyboard.insertText(command);
  await page.keyboard.press("Enter");
  await waitForTerminalBufferText(page, sessionName, expectedText);
}

async function getDropTargetPosition(target: Locator, zone: DropZone) {
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

async function getDropTargetClientPoint(target: Locator, zone: DropZone) {
  const box = await target.boundingBox();
  if (!box) {
    throw new Error(`Unable to resolve dragover bounds for ${zone}`);
  }

  const rect = getDropZoneGeometry({ width: box.width, height: box.height })[zone];
  return {
    x: box.x + rect.left + rect.width / 2,
    y: box.y + rect.top + rect.height / 2,
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
  const targetPosition = await getDropTargetPosition(target, zone);
  await source.dragTo(target, { targetPosition });
}

async function captureDropOverlay(
  page: Page,
  sourceSessionName: string,
  targetSessionName: string,
  zone: DropZone,
  fileName: string,
) {
  const source = sessionRow(page, sourceSessionName);
  const target = paneLeaf(page, targetSessionName).locator("[data-pane-drop-surface]").first();
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());

  await source.dispatchEvent("dragstart", { dataTransfer });
  await expect(target.locator(".pane-drop-overlay")).toBeVisible();

  try {
    const point = await getDropTargetClientPoint(target, zone);
    await target.dispatchEvent("dragover", {
      dataTransfer,
      clientX: point.x,
      clientY: point.y,
    });
    await expect(target.locator(`[data-drop-zone="${zone}"]`)).toHaveClass(/is-active/);
    await capture(page, fileName);
  } finally {
    await source.dispatchEvent("dragend", { dataTransfer });
    await expect(page.locator(".pane-drop-overlay")).toHaveCount(0);
  }
}

async function captureGitStatus(page: Page) {
  const gitPane = paneLeaf(page, "Git Review");
  await expect(gitPane).toContainText("README_NOTES.md", { timeout: 20_000 });
  const statusRow = gitPane.locator(".panel-list-row").filter({ hasText: "README_NOTES.md" }).first();
  await statusRow.click();
  await expect(gitPane).toContainText("Pending edit for the Git panel screenshot", { timeout: 20_000 });
  await capture(page, "readme-git-status.png");
}

async function captureGitLog(page: Page) {
  const gitPane = paneLeaf(page, "Git Review");
  await gitPane.getByRole("button", { name: "Log" }).click();
  const commitRow = gitPane.locator(".panel-list-row").filter({ hasText: "Polish workspace docs" }).first();
  await expect(commitRow).toBeVisible({ timeout: 20_000 });
  await commitRow.click();
  const changedFile = gitPane.locator(".panel-list-row").filter({ hasText: "src/main.ts" }).last();
  await expect(changedFile).toBeVisible({ timeout: 20_000 });
  await changedFile.click();
  await expect(gitPane).toContainText("Hello from", { timeout: 20_000 });
  await capture(page, "readme-git-log.png");
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await prepareWorkspaceFixtures();
});

test("captures README screenshots with the current workbench UX", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/");
  await expect(page.getByTestId("login-password")).toBeVisible();
  await capture(page, "readme-login.png");

  await login(page);

  await createProject(page, "Alpha Project", alphaDir);
  await createProject(page, "Beta Project", betaDir);

  await openSessionModal(page, "Alpha Project", "ClaudeCode", "claude");
  await capture(page, "readme-new-session.png");
  await submitSessionModal(page, "ClaudeCode");

  await createSession(page, "Alpha Project", "Opencode", "opencode");
  await createSession(page, "Alpha Project", "Project Files", "folder");
  await createSession(page, "Alpha Project", "Git Review", "git");
  await createSession(page, "Alpha Project", "Workspace IDE", "ide");
  await createSession(page, "Beta Project", "KiloCode", "kilo");

  await sessionRow(page, "ClaudeCode").click();
  await expect(paneLeaf(page, "ClaudeCode")).toBeVisible();
  await page.waitForTimeout(2000);
  await capture(page, "readme-claude-session.png");

  await projectLayoutButton(page, "Alpha Project").click();
  await expect(paneLeaf(page, "ClaudeCode")).toBeVisible();

  await captureDropOverlay(page, "Opencode", "ClaudeCode", "left", "readme-layout-editor.png");
  await dragSessionToPaneWithMouse(page, "Opencode", "ClaudeCode", "left");
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(2);

  await dragSessionToPaneWithMouse(page, "KiloCode", "ClaudeCode", "bottom");
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(3);
  await page.waitForTimeout(700);

  await sessionRow(page, "Project Files").click();
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(1);

  await projectLayoutButton(page, "Alpha Project").click();
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(3);
  await expect(paneLeaf(page, "ClaudeCode")).toBeVisible();
  await expect(paneLeaf(page, "Opencode")).toBeVisible();
  await expect(paneLeaf(page, "KiloCode")).toBeVisible();
  await capture(page, "readme-project-layout.png");

  await paneLeaf(page, "ClaudeCode").getByTitle("Open Alone").click();
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(1);
  await expect(paneLeaf(page, "ClaudeCode").getByTitle("Restore Layout")).toBeVisible();
  await paneLeaf(page, "ClaudeCode").getByTitle("Restore Layout").hover();
  await capture(page, "readme-open-alone-restore.png");
  await paneLeaf(page, "ClaudeCode").getByTitle("Restore Layout").click();
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(3);

  await sessionRow(page, "Project Files").click();
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(1);
  await expect(paneLeaf(page, "Project Files")).toContainText("README_NOTES.md", { timeout: 20_000 });
  await capture(page, "readme-file-explorer.png");

  await sessionRow(page, "Git Review").click();
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(1);
  await captureGitStatus(page);
  await captureGitLog(page);

  await sessionRow(page, "Workspace IDE").click();
  await expect(page.locator('[data-layout-node="leaf"]')).toHaveCount(1);
  await expect(paneLeaf(page, "Workspace IDE")).toContainText("Open a file to start editing.", { timeout: 20_000 });
  await paneLeaf(page, "Workspace IDE").getByRole("button", { name: "src" }).click();
  await expect(paneLeaf(page, "Workspace IDE").getByRole("button", { name: "main.ts" })).toBeVisible();
  await paneLeaf(page, "Workspace IDE").getByRole("button", { name: "main.ts" }).click();
  await expect(paneLeaf(page, "Workspace IDE")).toContainText("main.ts", { timeout: 20_000 });
  await capture(page, "readme-ide-workspace.png");
});
