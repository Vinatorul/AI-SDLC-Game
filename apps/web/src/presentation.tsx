import type { GameState, ScenarioPresentation } from '@ai-sdlc/contracts';
import { type CSSProperties, createContext, type ReactNode, useContext, useEffect } from 'react';
import frozenLegacyPresentation from '../../../content/legacy-presentation.json';

export const legacyPresentation: ScenarioPresentation = frozenLegacyPresentation;
const PresentationContext = createContext(legacyPresentation);

export function presentationFor(state: Pick<GameState, 'presentation'>) {
  return state.presentation ?? legacyPresentation;
}

export function usePresentation() {
  return useContext(PresentationContext);
}

export function RoomPresentation({
  children,
  state,
}: {
  children: ReactNode;
  state?: Pick<GameState, 'presentation'> | null;
}) {
  if (!state) return children;
  return (
    <PresentationProvider presentation={presentationFor(state)}>{children}</PresentationProvider>
  );
}

export function PresentationProvider({
  children,
  presentation,
}: {
  children: ReactNode;
  presentation: ScenarioPresentation;
}) {
  useEffect(() => {
    document.title = presentation.branding.title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', presentation.branding.description);
  }, [presentation]);
  return (
    <PresentationContext.Provider value={presentation}>{children}</PresentationContext.Provider>
  );
}

export function stageLabel(presentation: ScenarioPresentation, id: string) {
  return presentation.stages.find((stage) => stage.id === id)?.label ?? 'Этап';
}

export function propertyLabel(presentation: ScenarioPresentation, id: string) {
  return presentation.properties.find((property) => property.id === id)?.label ?? 'Подготовка';
}

export function metricLabel(state: GameState, id: string) {
  return state.metricDefinitions[id]?.label ?? 'Метрика';
}

export function presentationText(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    String(values[key] ?? placeholder),
  );
}

export function gridStyle(count: number): CSSProperties {
  return {
    '--columns-eight': Math.max(1, Math.min(count, 8)),
    '--columns-four': Math.max(1, Math.min(count, 4)),
    '--columns-two': Math.max(1, Math.min(count, 2)),
  } as CSSProperties;
}
