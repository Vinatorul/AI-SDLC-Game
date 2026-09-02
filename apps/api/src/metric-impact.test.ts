import { describe, expect, it } from 'vitest';
import { metricImpact } from './metric-impact';

describe('metricImpact', () => {
  it.each([
    [{ deliverySpeed: 2, quality: 1 }, 'IMPROVED'],
    [{ controllability: -1, quality: -2 }, 'WORSENED'],
    [{ deliverySpeed: 1, teamCapacity: -1 }, 'MIXED'],
    [{ deliverySpeed: 0 }, 'NEUTRAL'],
  ] as const)('определяет направление изменений %#', (effect, expected) => {
    expect(metricImpact(effect)).toBe(expected);
  });
});
