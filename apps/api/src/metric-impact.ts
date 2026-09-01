import { type MetricDelta, type MetricImpact, metricKeys } from '@ai-sdlc/contracts';

export function metricImpact(effect: MetricDelta): MetricImpact {
  const values = metricKeys.map((key) => effect[key] ?? 0);
  const improved = values.some((value) => value > 0);
  const worsened = values.some((value) => value < 0);
  if (improved && worsened) return 'NEUTRAL';
  if (improved) return 'IMPROVED';
  if (worsened) return 'WORSENED';
  return 'NEUTRAL';
}
