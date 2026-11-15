import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { workerSource } from '../../build/offline';

describe('the offline worker', () => {
  const source = workerSource(['index.html', 'assets/app-1.js', 'sw.js'], 'abc123');

  it('caches the root and every file but its own, under a name that carries the version', () => {
    expect(source).toContain("'grape-abc123'");
    expect(source).toContain('["./","./index.html","./assets/app-1.js"]');
    expect(source).not.toContain('./sw.js');
  });

  it('is a script that parses', () => {
    expect(() => new Script(source)).not.toThrow();
  });
});
