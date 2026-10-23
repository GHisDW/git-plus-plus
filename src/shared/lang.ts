const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  sql: 'sql',
  xml: 'xml',
  svg: 'xml',
  lock: 'text',
};

export function languageForPath(path: string): string {
  const clean = path.split('?')[0] ?? path;
  const dot = clean.lastIndexOf('.');
  if (dot === -1 || dot === clean.length - 1) return 'text';
  return LANGUAGE_BY_EXT[clean.slice(dot + 1).toLowerCase()] ?? 'text';
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(path);
}

export function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000);
  if (sample.includes(0)) return true;
  let control = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) control += 1;
  }
  return sample.length > 0 && control / sample.length > 0.3;
}
