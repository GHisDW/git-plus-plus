import type { CommitSummary } from './types';

/**
 * Assign a display lane to each commit in topo order. Lanes are reused when a
 * commit closes a line of history, which keeps the graph compact.
 * Mutates a shallow copy and returns it.
 */
export function assignLanes(commits: CommitSummary[], maxLanes = 8): CommitSummary[] {
  const active: Array<string | null> = [];
  for (const commit of commits) {
    let lane = active.indexOf(commit.sha);
    if (lane === -1) {
      const free = active.indexOf(null);
      if (free !== -1) {
        lane = free;
        active[free] = commit.sha;
      } else {
        lane = active.length;
        active.push(commit.sha);
      }
    }
    commit.lane = Math.min(lane, maxLanes - 1);

    active[lane] = null;
    let cursor = lane;
    for (const parent of commit.parents) {
      if (active.includes(parent)) continue;
      while (cursor < active.length && active[cursor] !== null) cursor += 1;
      if (cursor === active.length) active.push(parent);
      else active[cursor] = parent;
      cursor += 1;
    }
    // Trim trailing empty lanes.
    while (active.length > 0 && active[active.length - 1] === null) active.pop();
  }
  return commits;
}

export interface GraphEdge {
  fromLane: number;
  toLane: number;
  fromIndex: number;
  toIndex: number;
  isMerge: boolean;
}

/** Build edges between rendered rows so the graph can be drawn as SVG paths. */
export function buildEdges(commits: CommitSummary[]): GraphEdge[] {
  const laneBySha = new Map<string, { lane: number; index: number }>();
  commits.forEach((commit, index) => laneBySha.set(commit.sha, { lane: commit.lane ?? 0, index }));
  const edges: GraphEdge[] = [];
  commits.forEach((commit, index) => {
    commit.parents.forEach((parent, parentIndex) => {
      const target = laneBySha.get(parent);
      if (!target) return;
      edges.push({
        fromLane: commit.lane ?? 0,
        toLane: target.lane,
        fromIndex: index,
        toIndex: target.index,
        isMerge: parentIndex > 0,
      });
    });
  });
  return edges;
}
