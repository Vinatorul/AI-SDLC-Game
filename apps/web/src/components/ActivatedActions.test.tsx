import type { GameState } from '@ai-sdlc/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ActivatedActions } from './ActivatedActions';

it('объясняет ведущему, какое старое решение заработало после текущего', () => {
  const state = {
    currentRound: {
      activatedActions: [
        {
          actionId: 'support.incident-mcp',
          completedByActionId: 'support.change-linked-signals',
          completedByTitle: 'Связать телеметрию с релизом',
          stage: 'support',
          title: 'Подключить AI к данным об инциденте',
        },
      ],
    },
  } as GameState;
  const html = renderToStaticMarkup(<ActivatedActions state={state} />);
  expect(html).toContain('Что ещё заработало');
  expect(html).toContain('Поддержка');
  expect(html).toContain(
    'После «Связать телеметрию с релизом» заработало AI-решение «Подключить AI к данным об инциденте».',
  );
});

it('объясняет ведущему, почему старое решение не включилось', () => {
  const state = {
    currentRound: {
      blockedActivations: [
        {
          actionId: 'support.incident-mcp',
          completedByActionId: 'support.change-linked-signals',
          completedByTitle: 'Связать телеметрию с релизом',
          reason: 'STAGE_BROKEN',
          stage: 'support',
          title: 'Подключить AI к данным об инциденте',
        },
      ],
    },
  } as GameState;
  const html = renderToStaticMarkup(<ActivatedActions state={state} />);
  expect(html).toContain('Что пока не заработало');
  expect(html).toContain('этап «Поддержка» всё ещё сломан');
  expect(html).toContain('Сначала почините этап, затем снова выберите это решение.');
});

it('объясняет ведущему, когда основа починила этап только до ручного процесса', () => {
  const state = {
    currentRound: {
      blockedActivations: [
        {
          actionId: 'productDiscovery.knowledge-skill',
          completedByActionId: 'productDiscovery.knowledge-base',
          completedByTitle: 'Собрать базу продуктовых решений',
          reason: 'STAGE_REPAIRED',
          stage: 'productDiscovery',
          title: 'Собрать для AI скилл поиска по продуктовым решениям',
        },
      ],
    },
  } as GameState;
  const html = renderToStaticMarkup(<ActivatedActions state={state} />);
  expect(html).toContain('Этап «Продуктовая проработка» снова работает без AI');
  expect(html).toContain('Чтобы включить «Собрать для AI скилл поиска по продуктовым решениям»');
  expect(html).toContain('снова выберите это AI-решение');
});
