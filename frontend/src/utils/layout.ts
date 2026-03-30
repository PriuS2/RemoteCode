export type LayoutDirection = "row" | "column";
export type PaneDropZone = "center" | "left" | "right" | "top" | "bottom";

export interface LayoutLeafNode {
  type: "leaf";
  paneId: string;
  sessionId: string;
}

export interface LayoutSplitNode {
  type: "split";
  splitId: string;
  direction: LayoutDirection;
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export type LayoutNode = LayoutLeafNode | LayoutSplitNode;

const PANE_ID_PREFIX = "pane";
const SPLIT_ID_PREFIX = "split";

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.max(0.1, Math.min(0.9, ratio));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createLeaf(sessionId: string, paneId = makeId(PANE_ID_PREFIX)): LayoutLeafNode {
  return {
    type: "leaf",
    paneId,
    sessionId,
  };
}

export function createSingleLayout(sessionId: string, paneId?: string): LayoutLeafNode {
  return createLeaf(sessionId, paneId);
}

export function collectLeafNodes(root: LayoutNode | null): LayoutLeafNode[] {
  if (!root) return [];
  if (root.type === "leaf") return [root];
  return [...collectLeafNodes(root.first), ...collectLeafNodes(root.second)];
}

export function collectSessionIds(root: LayoutNode | null): string[] {
  return collectLeafNodes(root).map((leaf) => leaf.sessionId).filter(Boolean);
}

export function getFirstLeaf(root: LayoutNode | null): LayoutLeafNode | null {
  if (!root) return null;
  if (root.type === "leaf") return root;
  return getFirstLeaf(root.first) ?? getFirstLeaf(root.second);
}

export function findLeafByPaneId(root: LayoutNode | null, paneId: string | null): LayoutLeafNode | null {
  if (!root || !paneId) return null;
  if (root.type === "leaf") return root.paneId === paneId ? root : null;
  return findLeafByPaneId(root.first, paneId) ?? findLeafByPaneId(root.second, paneId);
}

export function findPaneIdBySessionId(root: LayoutNode | null, sessionId: string): string | null {
  if (!sessionId) return null;
  return collectLeafNodes(root).find((leaf) => leaf.sessionId === sessionId)?.paneId ?? null;
}

export function collapseSingleChildSplits(root: LayoutNode | null): LayoutNode | null {
  if (!root) return null;
  if (root.type === "leaf") return root;
  const first = collapseSingleChildSplits(root.first);
  const second = collapseSingleChildSplits(root.second);
  if (!first && !second) return null;
  if (!first) return second;
  if (!second) return first;
  if (first === root.first && second === root.second) return root;
  return { ...root, first, second };
}

export function replacePaneSession(root: LayoutNode | null, paneId: string | null, sessionId: string): LayoutNode {
  if (!root) return createSingleLayout(sessionId);
  const targetPaneId = paneId ?? getFirstLeaf(root)?.paneId ?? null;
  if (!targetPaneId) return createSingleLayout(sessionId);

  const replace = (node: LayoutNode): LayoutNode => {
    if (node.type === "leaf") {
      if (node.paneId !== targetPaneId) return node;
      if (node.sessionId === sessionId) return node;
      return { ...node, sessionId };
    }
    const first = replace(node.first);
    const second = replace(node.second);
    if (first === node.first && second === node.second) return node;
    return { ...node, first, second };
  };

  return replace(root);
}

function zoneDirection(zone: PaneDropZone): LayoutDirection | null {
  if (zone === "left" || zone === "right") return "row";
  if (zone === "top" || zone === "bottom") return "column";
  return null;
}

function isBeforeZone(zone: PaneDropZone): boolean {
  return zone === "left" || zone === "top";
}

function insertLeafBesidePane(root: LayoutNode | null, targetPaneId: string, zone: PaneDropZone, leaf: LayoutLeafNode): LayoutNode | null {
  if (!root) return leaf;
  const direction = zoneDirection(zone);
  if (!direction) return root;

  const insert = (node: LayoutNode): LayoutNode => {
    if (node.type === "leaf") {
      if (node.paneId !== targetPaneId) return node;
      return isBeforeZone(zone)
        ? {
            type: "split",
            splitId: makeId(SPLIT_ID_PREFIX),
            direction,
            ratio: 0.5,
            first: leaf,
            second: node,
          }
        : {
            type: "split",
            splitId: makeId(SPLIT_ID_PREFIX),
            direction,
            ratio: 0.5,
            first: node,
            second: leaf,
          };
    }
    const first = insert(node.first);
    const second = insert(node.second);
    if (first === node.first && second === node.second) return node;
    return { ...node, first, second };
  };

  return insert(root);
}

interface ExtractLeafResult {
  root: LayoutNode | null;
  leaf: LayoutLeafNode | null;
}

function extractLeafByPaneId(root: LayoutNode | null, paneId: string): ExtractLeafResult {
  if (!root) return { root: null, leaf: null };
  if (root.type === "leaf") {
    if (root.paneId !== paneId) return { root, leaf: null };
    return { root: null, leaf: root };
  }

  const first = extractLeafByPaneId(root.first, paneId);
  if (first.leaf) {
    return {
      root: collapseSingleChildSplits(first.root ? { ...root, first: first.root, second: root.second } : root.second),
      leaf: first.leaf,
    };
  }

  const second = extractLeafByPaneId(root.second, paneId);
  if (second.leaf) {
    return {
      root: collapseSingleChildSplits(second.root ? { ...root, first: root.first, second: second.root } : root.first),
      leaf: second.leaf,
    };
  }

  return { root, leaf: null };
}

export function removeSessionFromLayout(root: LayoutNode | null, sessionId: string): LayoutNode | null {
  const paneId = findPaneIdBySessionId(root, sessionId);
  if (!paneId) return root;
  return collapseSingleChildSplits(extractLeafByPaneId(root, paneId).root);
}

export function placeSessionInPane(
  root: LayoutNode | null,
  sessionId: string,
  targetPaneId: string | null,
  zone: PaneDropZone,
): LayoutNode {
  const existingPaneId = findPaneIdBySessionId(root, sessionId);
  if (existingPaneId && existingPaneId === targetPaneId) {
    return root ?? createSingleLayout(sessionId);
  }

  const deduped = existingPaneId ? removeSessionFromLayout(root, sessionId) : root;
  if (!deduped) return createSingleLayout(sessionId);

  const effectiveTarget = findLeafByPaneId(deduped, targetPaneId)?.paneId ?? getFirstLeaf(deduped)?.paneId ?? null;
  if (!effectiveTarget) return createSingleLayout(sessionId);

  if (zone === "center") {
    return replacePaneSession(deduped, effectiveTarget, sessionId);
  }

  return insertLeafBesidePane(deduped, effectiveTarget, zone, createLeaf(sessionId)) ?? deduped;
}

export function movePaneToZone(
  root: LayoutNode | null,
  sourcePaneId: string,
  targetPaneId: string,
  zone: Exclude<PaneDropZone, "center">,
): LayoutNode | null {
  if (!root || sourcePaneId === targetPaneId) return root;

  const originalSource = findLeafByPaneId(root, sourcePaneId);
  if (!originalSource) return root;

  const extracted = extractLeafByPaneId(root, sourcePaneId);
  if (!extracted.leaf || !extracted.root) return root;
  if (!findLeafByPaneId(extracted.root, targetPaneId)) return root;
  return insertLeafBesidePane(extracted.root, targetPaneId, zone, extracted.leaf) ?? root;
}

export function swapPaneSessions(root: LayoutNode | null, sourcePaneId: string, targetPaneId: string): LayoutNode | null {
  if (!root || sourcePaneId === targetPaneId) return root;
  const sourceLeaf = findLeafByPaneId(root, sourcePaneId);
  const targetLeaf = findLeafByPaneId(root, targetPaneId);
  if (!sourceLeaf || !targetLeaf) return root;

  const replace = (node: LayoutNode): LayoutNode => {
    if (node.type === "leaf") {
      if (node.paneId === sourcePaneId) return { ...node, sessionId: targetLeaf.sessionId };
      if (node.paneId === targetPaneId) return { ...node, sessionId: sourceLeaf.sessionId };
      return node;
    }
    const first = replace(node.first);
    const second = replace(node.second);
    if (first === node.first && second === node.second) return node;
    return { ...node, first, second };
  };

  return replace(root);
}

export function updateSplitRatio(root: LayoutNode | null, splitId: string, ratio: number): LayoutNode | null {
  if (!root) return null;
  if (root.type === "leaf") return root;

  const first = updateSplitRatio(root.first, splitId, ratio);
  const second = updateSplitRatio(root.second, splitId, ratio);

  if (root.splitId === splitId) {
    return {
      ...root,
      ratio: clampRatio(ratio),
      first: first ?? root.first,
      second: second ?? root.second,
    };
  }

  if (first === root.first && second === root.second) return root;
  return { ...root, first: first ?? root.first, second: second ?? root.second };
}

export function pruneMissingSessions(root: LayoutNode | null, validSessionIds: Set<string>): LayoutNode | null {
  if (!root) return null;
  if (root.type === "leaf") {
    return validSessionIds.has(root.sessionId) ? root : null;
  }
  const first = pruneMissingSessions(root.first, validSessionIds);
  const second = pruneMissingSessions(root.second, validSessionIds);
  if (!first && !second) return null;
  if (!first) return second;
  if (!second) return first;
  if (first === root.first && second === root.second) return root;
  return { ...root, first, second };
}

function sanitizeLayoutNode(value: unknown, seenSessions: Set<string>, seenPanes: Set<string>, seenSplits: Set<string>): LayoutNode | null {
  if (!isObject(value) || typeof value.type !== "string") return null;
  if (value.type === "leaf") {
    if (typeof value.paneId !== "string" || typeof value.sessionId !== "string") return null;
    if (!value.paneId || !value.sessionId || seenSessions.has(value.sessionId) || seenPanes.has(value.paneId)) return null;
    seenSessions.add(value.sessionId);
    seenPanes.add(value.paneId);
    return {
      type: "leaf",
      paneId: value.paneId,
      sessionId: value.sessionId,
    };
  }
  if (value.type === "split") {
    if (
      typeof value.splitId !== "string"
      || (value.direction !== "row" && value.direction !== "column")
      || seenSplits.has(value.splitId)
    ) {
      return null;
    }
    seenSplits.add(value.splitId);
    const first = sanitizeLayoutNode(value.first, seenSessions, seenPanes, seenSplits);
    const second = sanitizeLayoutNode(value.second, seenSessions, seenPanes, seenSplits);
    if (!first || !second) return null;
    return {
      type: "split",
      splitId: value.splitId,
      direction: value.direction,
      ratio: clampRatio(typeof value.ratio === "number" ? value.ratio : 0.5),
      first,
      second,
    };
  }
  return null;
}

export function restoreLayout(serialized: unknown): LayoutNode | null {
  const restored = sanitizeLayoutNode(serialized, new Set(), new Set(), new Set());
  return collapseSingleChildSplits(restored);
}
