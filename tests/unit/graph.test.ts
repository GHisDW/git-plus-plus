import { describe, expect, it } from 'vitest';
import { assignLanes, buildEdges } from '../../src/shared/graph';
import type { CommitSummary } from '../../src/shared/types';

function commit(sha: string, parents: string[]): CommitSummary {
  return { sha, shortSha: sha.slice(0, 7), parents, author: 'A', authorEmail: 'a@example.test', date: '2026-01-01T00:00:00Z', subject: sha, body: '', refs: [] };
}

describe('commit graph lanes', () => {
  it('keeps a linear history on one lane', () => {
    const commits = assignLanes([commit('c3', ['c2']), commit('c2', ['c1']), commit('c1', [])]);
    expect(commits.map((entry) => entry.lane)).toEqual([0, 0, 0]);
  });

  it('assigns separate lanes to parallel branches and closes them', () => {
    const commits = assignLanes([
      commit('m', ['a', 'b']),
      commit('a', ['base']),
      commit('b', ['base']),
      commit('base', []),
    ]);
    expect(commits[0]?.lane).toBe(0);
    expect(commits[1]?.lane).toBe(0);
    expect(commits[2]?.lane).toBe(1);
    expect(commits[3]?.lane).toBe(0);
    const edges = buildEdges(commits);
    expect(edges.some((edge) => edge.isMerge)).toBe(true);
    expect(edges.some((edge) => edge.toLane === 1)).toBe(true);
  });

  it('survives missing parents without inventing edges', () => {
    const commits = assignLanes([commit('x', ['missing'])]);
    expect(buildEdges(commits)).toEqual([]);
  });
});
