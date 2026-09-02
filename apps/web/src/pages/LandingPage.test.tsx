import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LandingPage } from './LandingPage';

describe('LandingPage', () => {
  it('оставляет на первом экране только вход и ссылки на рабочие режимы', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );
    expect(html).toContain('Зал решает, где AI работает в SDLC');
    expect(html).toContain('Открыть пульт');
    expect(html).toContain('Войти по коду');
    expect(html).toContain('aria-label="Код комнаты"');
    expect(html).toContain('Открыть общий экран');
    expect(html).not.toContain('Исходная карта');
    expect(html).not.toContain('Я игрок');
  });
});
