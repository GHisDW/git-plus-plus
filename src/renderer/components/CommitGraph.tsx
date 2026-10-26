import React from 'react';
import type { CommitSummary } from '../../shared/types';
import { buildEdges } from '../../shared/graph';
import { cx } from '../lib/utils';

const ROW = 46;
const LANE = 12;
const LEFT = 10;
const COLORS = ['var(--accent)', 'var(--purple)', 'var(--cyan)', 'var(--green)', 'var(--amber)', 'var(--red)'];

export function CommitGraph({ commits, selected, onSelect }: { commits: CommitSummary[]; selected: string | null; onSelect: (commit: CommitSummary) => void }): React.JSX.Element {
  const edges = buildEdges(commits);
  const laneBySha = new Map(commits.map((commit) => [commit.sha, commit.lane ?? 0]));
  return (
    <div role="listbox" aria-label="Commit history">
      {commits.map((commit, index) => (
        <button
          key={commit.sha}
          className={cx('graph-row', selected === commit.sha && 'selected')}
          onClick={() => onSelect(commit)}
          role="option"
          aria-selected={selected === commit.sha}
        >
          <svg className="graph-svg" viewBox={`0 0 82 ${ROW}`} aria-hidden>
            {edges
              .filter((edge) => edge.fromIndex <= index && index <= edge.toIndex)
              .map((edge, edgeIndex) => {
                const fromX = LEFT + edge.fromLane * LANE;
                const toX = LEFT + edge.toLane * LANE;
                const span = Math.max(1, edge.toIndex - edge.fromIndex);
                const topT = (index - edge.fromIndex + (edge.fromIndex === index ? 0.5 : 0)) / span;
                const bottomT = (index - edge.fromIndex + (edge.toIndex === index ? 0.5 : 1)) / span;
                const x1 = fromX + (toX - fromX) * topT;
                const x2 = fromX + (toX - fromX) * bottomT;
                const y1 = edge.fromIndex === index ? ROW / 2 : 0;
                const y2 = edge.toIndex === index ? ROW / 2 : ROW;
                return (
                  <path
                    key={edgeIndex}
                    className={cx('graph-edge', edge.isMerge && 'merge')}
                    d={`M ${x1} ${y1} L ${x2} ${y2}`}
                    stroke={COLORS[(edge.isMerge ? edge.fromLane + 1 : edge.fromLane) % COLORS.length]}
                    opacity={0.8}
                  />
                );
              })}
            <circle cx={LEFT + (commit.lane ?? 0) * LANE} cy={ROW / 2} r={4.2} className="graph-node" style={{ fill: COLORS[(commit.lane ?? 0) % COLORS.length] }} />
            {commit.refs.length > 0 ? <circle cx={LEFT + (commit.lane ?? 0) * LANE} cy={ROW / 2} r={7} fill="none" stroke={COLORS[(commit.lane ?? 0) % COLORS.length]} strokeWidth={1} opacity={0.5} /> : null}
          </svg>
          <div className="graph-main">
            <span className="graph-subject" title={commit.subject}>{commit.subject || '(no commit message)'}</span>
            <span className="graph-meta">
              {commit.refs.length > 0 ? (
                <span className="refs">
                  {commit.refs.slice(0, 3).map((ref) => (
                    <span key={ref} className={cx('tag', ref.startsWith('tag:') ? 'amber' : ref.includes('HEAD') ? 'accent' : ref.includes('/') ? 'purple' : 'green')}>{ref.replace('tag: ', '')}</span>
                  ))}
                </span>
              ) : null}
              <span className="author">{commit.author}</span>
              <span>·</span>
              <span>{new Date(commit.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })}</span>
            </span>
          </div>
          <div className="graph-side">
            <span className="sha">{commit.shortSha}</span>
            {commit.parents.length > 1 ? <span>merge</span> : null}
            {laneBySha.get(commit.sha) !== undefined && commit.lane !== undefined && commit.lane > 4 ? <span>lane {commit.lane}</span> : null}
          </div>
        </button>
      ))}
    </div>
  );
}
