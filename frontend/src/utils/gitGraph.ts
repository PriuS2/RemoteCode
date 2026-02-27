/**
 * Railroad-style commit graph layout algorithm.
 * Assigns lanes (columns) and colors to commits and their connecting lines.
 */

export interface GitLogEntry {
  hash: string;
  short_hash: string;
  parents: string[];
  refs: string[];
  message: string;
  author_name: string;
  author_email: string;
  date: string;
}

export interface GraphNode {
  hash: string;
  lane: number;
  color: string;
  parents: string[];
}

export interface GraphLine {
  fromLane: number;
  toLane: number;
  fromRow: number;
  toRow: number;
  color: string;
}

export interface GraphLayout {
  nodes: GraphNode[];
  lines: GraphLine[];
  maxLane: number;
}

const LANE_COLORS = [
  "#89b4fa", // blue
  "#a6e3a1", // green
  "#f9e2af", // yellow
  "#cba6f7", // mauve
  "#94e2d5", // teal
  "#f5c2e7", // pink
  "#fab387", // peach
  "#f38ba8", // red
];

export function computeGraphLayout(commits: GitLogEntry[]): GraphLayout {
  const nodes: GraphNode[] = [];
  const lines: GraphLine[] = [];

  // Active lanes: each slot holds the hash that lane is "expecting"
  const activeLanes: (string | null)[] = [];
  // Map from hash to its assigned row index
  const hashToRow = new Map<string, number>();
  // Map from hash to its lane (for connecting lines)
  const hashToLane = new Map<string, number>();

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];
    hashToRow.set(commit.hash, row);

    // Find lane for this commit: look for a lane expecting this hash
    let lane = activeLanes.indexOf(commit.hash);
    if (lane === -1) {
      // No lane expecting this commit — assign to first free lane
      lane = activeLanes.indexOf(null);
      if (lane === -1) {
        lane = activeLanes.length;
        activeLanes.push(null);
      }
    }

    const color = LANE_COLORS[lane % LANE_COLORS.length];
    hashToLane.set(commit.hash, lane);
    nodes.push({ hash: commit.hash, lane, color, parents: commit.parents });

    // Clear this lane (commit has arrived)
    activeLanes[lane] = null;

    // Assign parents to lanes
    const parents = commit.parents;
    for (let pi = 0; pi < parents.length; pi++) {
      const parentHash = parents[pi];

      // Check if any lane already expects this parent
      let parentLane = activeLanes.indexOf(parentHash);
      if (parentLane !== -1) {
        // Parent already expected in an existing lane — draw line to it
        const lineColor = LANE_COLORS[parentLane % LANE_COLORS.length];
        lines.push({ fromLane: lane, toLane: parentLane, fromRow: row, toRow: row + 1, color: lineColor });
      } else {
        // First parent: reuse current lane; subsequent: find/create new lane
        let targetLane: number;
        if (pi === 0) {
          targetLane = lane;
        } else {
          // Find first free lane
          targetLane = activeLanes.indexOf(null);
          if (targetLane === -1) {
            targetLane = activeLanes.length;
            activeLanes.push(null);
          }
        }
        activeLanes[targetLane] = parentHash;
        const lineColor = LANE_COLORS[targetLane % LANE_COLORS.length];
        lines.push({ fromLane: lane, toLane: targetLane, fromRow: row, toRow: row + 1, color: lineColor });
      }
    }

    // If commit has no parents (root), lane stays null (already cleared)
  }

  // Draw continuation lines for active lanes that pass through each row
  // (lanes that are not involved in the current commit but carry a line through)
  const continuationLines: GraphLine[] = [];
  const activeLanes2: (string | null)[] = [];

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];
    const commitLane = hashToLane.get(commit.hash)!;

    // For each active lane that is not the current commit's lane,
    // draw a straight continuation line
    for (let l = 0; l < activeLanes2.length; l++) {
      if (activeLanes2[l] !== null && l !== commitLane) {
        const lineColor = LANE_COLORS[l % LANE_COLORS.length];
        continuationLines.push({ fromLane: l, toLane: l, fromRow: row, toRow: row + 1, color: lineColor });
      }
    }

    // Update active lanes: clear current commit's lane
    let foundLane = -1;
    for (let l = 0; l < activeLanes2.length; l++) {
      if (activeLanes2[l] === commit.hash) {
        foundLane = l;
        break;
      }
    }
    if (foundLane === -1) {
      // First appearance
      while (activeLanes2.length <= commitLane) activeLanes2.push(null);
      foundLane = commitLane;
    }
    activeLanes2[foundLane] = null;

    // Assign parents
    const parents = commit.parents;
    for (let pi = 0; pi < parents.length; pi++) {
      const parentHash = parents[pi];
      let parentLane = activeLanes2.indexOf(parentHash);
      if (parentLane === -1) {
        if (pi === 0) {
          parentLane = foundLane;
        } else {
          parentLane = activeLanes2.indexOf(null);
          if (parentLane === -1) {
            parentLane = activeLanes2.length;
            activeLanes2.push(null);
          }
        }
        activeLanes2[parentLane] = parentHash;
      }
    }
  }

  const maxLane = Math.max(0, ...nodes.map((n) => n.lane));

  return { nodes, lines: [...lines, ...continuationLines], maxLane };
}
