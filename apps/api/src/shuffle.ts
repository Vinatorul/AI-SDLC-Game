import { randomInt } from 'node:crypto';

type PickIndex = (maxExclusive: number) => number;

export function shuffledIds(ids: readonly string[], pickIndex: PickIndex = randomInt) {
  const result = [...ids];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = pickIndex(index + 1);
    const current = result[index] as string;
    result[index] = result[swapIndex] as string;
    result[swapIndex] = current;
  }
  return result;
}
