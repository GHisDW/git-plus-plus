import { describe, expect, it } from 'vitest';
import { parseGithubRemote } from '../../src/main/services/github';

describe('parseGithubRemote', () => {
  it('parses HTTPS, SSH and scp-style remotes', () => {
    expect(parseGithubRemote('https://github.com/acme/northstar.git')).toEqual({ owner: 'acme', name: 'northstar' });
    expect(parseGithubRemote('https://github.com/acme/northstar')).toEqual({ owner: 'acme', name: 'northstar' });
    expect(parseGithubRemote('git@github.com:acme/northstar.git')).toEqual({ owner: 'acme', name: 'northstar' });
    expect(parseGithubRemote('ssh://git@github.com/acme/northstar.git')).toEqual({ owner: 'acme', name: 'northstar' });
  });

  it('rejects non-GitHub and malformed URLs', () => {
    expect(parseGithubRemote('https://gitlab.com/acme/northstar.git')).toBeNull();
    expect(parseGithubRemote('not a url')).toBeNull();
  });
});
