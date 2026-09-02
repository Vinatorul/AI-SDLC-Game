import type { ActionBallotChoice, GameState } from '@ai-sdlc/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { BallotFocus } from './BallotFocus';

it('показывает ведущему разбор победителя и не больше двух заметных вариантов', () => {
  const html = renderToStaticMarkup(<BallotFocus state={resultState()} />);
  expect(html).toContain('Разбор победителя');
  expect(html).toContain('Разбор второго варианта');
  expect(html).toContain('Разбор третьего варианта');
  expect(html).not.toContain('Разбор четвёртого варианта');
});

function resultState(): GameState {
  const choices = [
    'победителя',
    'второго варианта',
    'третьего варианта',
    'четвёртого варианта',
  ].map(choice);
  return {
    currentBallot: {
      choices,
      id: 'action-ballot',
      kind: 'ACTION',
      selectedChoiceId: 'action-0',
      stage: 'review',
      tiedChoiceIds: [],
      voteTallies: [0.4, 0.3, 0.2, 0.1].map((share, index) => ({
        choiceId: `action-${index}`,
        count: share * 10,
        share,
      })),
    },
    currentRound: { number: 1, title: 'Проверяем варианты' },
    phase: 'RESULT',
    rules: { notableVoteShare: 0.2 },
    stageProgress: { review: { appliedActions: [], state: 'AS_IS' } },
  } as unknown as GameState;
}

function choice(label: string, index: number): ActionBallotChoice {
  return {
    description: `Описание ${label}.`,
    evidence: 'SCENARIO',
    id: `action-${index}`,
    key: String(index),
    kind: 'ACTION',
    repeatable: true,
    shortFeedback: `Разбор ${label}.`,
    stage: 'review',
    title: `Решение ${index + 1}`,
  };
}
