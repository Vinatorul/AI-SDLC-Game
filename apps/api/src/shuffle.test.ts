import { describe, expect, it } from 'vitest';
import { shuffledIds } from './shuffle';

describe('shuffledIds', () => {
  it('перемешивает копию списка по Fisher–Yates', () => {
    const source = ['a', 'b', 'c', 'd'];

    expect(shuffledIds(source, () => 0)).toEqual(['b', 'c', 'd', 'a']);
    expect(source).toEqual(['a', 'b', 'c', 'd']);
  });
});
