import { describe, expect, it } from 'vitest';
import { compileFindRegex, parseFindQuery } from '../../src/workers/graph/findQuery';

describe('parseFindQuery', () => {
  it('splits a list on commas and whitespace and drops repeats', () => {
    expect(parseFindQuery(' 12, 7\tNODE_3 ,,12\n', false)).toEqual({ kind: 'names', names: ['12', '7', 'NODE_3'] });
  });

  it('keeps a regex whole', () => {
    expect(parseFindQuery(' ^NODE_1[0-9]$ ', true)).toEqual({ kind: 'regex', source: '^NODE_1[0-9]$' });
  });

  it('has nothing to find in blank input', () => {
    expect(parseFindQuery(' , ', false)).toBeUndefined();
    expect(parseFindQuery('  ', true)).toBeUndefined();
  });
});

describe('compileFindRegex', () => {
  it('explains a bad pattern', () => {
    expect(() => compileFindRegex('a(')).toThrow('Not a valid regular expression');
    expect(compileFindRegex('^a.c').test('abc')).toBe(true);
  });
});
