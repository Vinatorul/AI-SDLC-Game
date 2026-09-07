import type { MetricDelta, MetricImpact } from '@ai-sdlc/contracts';

export function metricImpact(effect: MetricDelta): MetricImpact {
  const values = Object.values(effect).map((value) => value ?? 0);
  const improved = values.some((value) => value > 0);
  const worsened = values.some((value) => value < 0);
  if (improved && worsened) return 'MIXED';
  if (improved) return 'IMPROVED';
  if (worsened) return 'WORSENED';
  return 'NEUTRAL';
}
