export function relativeTime(input: string | null | undefined, now = Date.now()): string {
  if (!input) return 'unknown';
  const then = new Date(input).getTime();
  if (Number.isNaN(then)) return input;
  const seconds = Math.round((now - then) / 1000);
  const future = seconds < 0;
  const abs = Math.abs(seconds);
  const suffix = (value: string) => (future ? `in ${value}` : `${value} ago`);
  if (abs < 45) return 'just now';
  if (abs < 3600) return suffix(`${Math.round(abs / 60)}m`);
  if (abs < 86_400) return suffix(`${Math.round(abs / 3600)}h`);
  if (abs < 2_592_000) return suffix(`${Math.round(abs / 86_400)}d`);
  if (abs < 31_536_000) return suffix(`${Math.round(abs / 2_592_000)}mo`);
  return suffix(`${Math.round(abs / 31_536_000)}y`);
}

export function formatDateTime(input: string | null | undefined): string {
  if (!input) return '—';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function splitCommitMessage(input: string): { summary: string; body: string } {
  const normalized = input.replace(/\r\n/g, '\n').trim();
  const [first, ...rest] = normalized.split('\n');
  return { summary: (first ?? '').trim(), body: rest.join('\n').trim() };
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
