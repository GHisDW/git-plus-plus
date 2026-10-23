import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, GitCommitHorizontal, Sparkles, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react';
import type { CommitResult, DiffResult, RepoSnapshot } from '../../shared/types';
import { call, errorDetail, errorMessage } from '../lib/api';
import { useApp } from '../state/AppState';
import { Spinner } from './ui';

export function CommitBox({
  snapshot,
  diff,
  onCommitted,
  blockedReason,
}: {
  snapshot: RepoSnapshot;
  diff: DiffResult | null;
  onCommitted: () => void;
  blockedReason?: string | null;
}): React.JSX.Element {
  const { settings, runOperation, toast } = useApp();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [showDescription, setShowDescription] = useState(false);
  const [amend, setAmend] = useState(false);
  const [signoff, setSignoff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const staged = snapshot.files.filter((file) => file.staged || file.conflicted);
  const conflicts = snapshot.stats.conflicted;
  const canCommit = subject.trim().length > 0 && (staged.length > 0 || amend) && !blockedReason && conflicts === 0 && !busy;

  useEffect(() => {
    const focus = () => textareaRef.current?.focus();
    window.addEventListener('gitpp:action', focus as EventListener);
    const handler = (event: Event) => {
      if ((event as CustomEvent<string>).detail === 'focus-commit') focus();
    };
    window.addEventListener('gitpp:action', handler);
    return () => window.removeEventListener('gitpp:action', handler);
  }, []);

  const commit = async () => {
    if (!canCommit) return;
    setBusy(true);
    const result = await runOperation<CommitResult>(
      amend ? 'Amending commit…' : 'Creating commit…',
      () => call('git.commit', {
        repoPath: snapshot.info.path,
        message: subject.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(amend ? { amend: true } : {}),
        ...(signoff ? { signoff: true } : {}),
      }),
      { refresh: false },
    );
    setBusy(false);
    if (result) {
      toast('success', amend ? 'Commit amended' : 'Commit created', `${result.shortSha} · ${result.filesChanged} file${result.filesChanged === 1 ? '' : 's'} changed`);
      setSubject('');
      setDescription('');
      setAmend(false);
      onCommitted();
    }
  };

  const suggest = async () => {
    if (!diff) return;
    setAiBusy(true);
    try {
      const response = await call('ai.explain', {
        repoPath: snapshot.info.path,
        task: 'commit-message',
        input: diff.text.slice(0, 24_000),
      });
      const lines = response.text.replace(/^```\w*\n?|```$/g, '').trim().split('\n');
      setSubject((lines[0] ?? '').replace(/^commit:\s*/i, '').slice(0, 200));
      const body = lines.slice(1).join('\n').trim();
      if (body) {
        setDescription(body);
        setShowDescription(true);
      }
      toast('info', 'Commit message suggested', `${response.model} generated this from your staged diff. Review it before committing.`);
    } catch (error) {
      toast('error', 'AI suggestion failed', errorDetail(error) ?? errorMessage(error));
    } finally {
      setAiBusy(false);
    }
  };

  const aiReady = settings.ai.enabled && settings.ai.consent && settings.ai.hasKey;

  return (
    <div className="commit-box">
      <div className="staged-summary">
        <GitCommitHorizontal size={12} />
        <span>{staged.length} staged file{staged.length === 1 ? '' : 's'}</span>
        {amend ? <span className="tag amber">amend</span> : null}
        <div className="spacer" />
        {aiReady ? (
          <button className="btn ghost sm" onClick={() => void suggest()} disabled={aiBusy || !diff || staged.length === 0} title="Send the staged diff to your configured AI provider">
            {aiBusy ? <Spinner /> : <Sparkles size={11} />} Suggest
          </button>
        ) : null}
      </div>
      <textarea
        ref={textareaRef}
        className="input"
        placeholder={conflicts > 0 ? 'Resolve conflicts before committing…' : 'Commit subject (required)'}
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void commit();
          }
        }}
        rows={2}
        spellCheck
        aria-label="Commit subject"
        disabled={conflicts > 0}
      />
      <button className="btn ghost sm" style={{ marginTop: 4, paddingLeft: 2 }} onClick={() => setShowDescription((value) => !value)}>
        {showDescription ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        {showDescription ? 'Hide description' : 'Add description'}
      </button>
      {showDescription ? (
        <textarea
          className="input commit-extra"
          placeholder="Optional extended description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          spellCheck
          aria-label="Commit description"
        />
      ) : null}
      <div className="row" style={{ marginTop: 6, gap: 12, flexWrap: 'wrap' }}>
        <label className="checkbox-row" title="Replace the previous commit. This rewrites local history.">
          <input type="checkbox" checked={amend} onChange={(event) => setAmend(event.target.checked)} />
          Amend previous commit
        </label>
        <label className="checkbox-row" title="Add a Signed-off-by trailer">
          <input type="checkbox" checked={signoff} onChange={(event) => setSignoff(event.target.checked)} />
          Sign off
        </label>
      </div>
      {amend ? (
        <div className="banner warn" style={{ marginTop: 8, padding: '6px 9px' }}>
          <AlertTriangle size={13} />
          <span>Amending rewrites the last commit. If it was already pushed, you will need a force-push with lease.</span>
        </div>
      ) : null}
      {blockedReason ? (
        <div className="banner danger" style={{ marginTop: 8, padding: '6px 9px' }}>
          <ShieldCheck size={13} />
          <span>{blockedReason}</span>
        </div>
      ) : null}
      {conflicts > 0 ? (
        <div className="banner danger" style={{ marginTop: 8, padding: '6px 9px' }}>
          <AlertTriangle size={13} />
          <span>{conflicts} conflicted file{conflicts === 1 ? '' : 's'} must be resolved first.</span>
        </div>
      ) : null}
      <div className="commit-actions">
        <button className="btn primary" onClick={() => void commit()} disabled={!canCommit}>
          {busy ? <Spinner /> : <GitCommitHorizontal size={14} />}
          {amend ? 'Amend commit' : 'Commit to'} {snapshot.info.head.branch ?? 'detached HEAD'}
        </button>
        <button className="btn" onClick={() => setAmend((value) => !value)} title="Toggle amend mode" disabled={busy}>Amend</button>
      </div>
      <div className="row" style={{ marginTop: 6, justifyContent: 'space-between' }}>
        <span className="small dim">Never stages files automatically.</span>
        <span className="small dim">{settings.shortcuts.commit}</span>
      </div>
    </div>
  );
}
