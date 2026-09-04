import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from './AdminPage';

afterEach(() => vi.unstubAllGlobals());

describe('AdminPage', () => {
  it('позволяет задать код новой комнаты', () => {
    const html = renderAdmin('/admin');
    expect(html).toContain('Код комнаты — необязательно');
    expect(html).toContain('pattern="[A-Za-z0-9]{4,12}"');
  });

  it('предлагает войти по паролю в другой вкладке', () => {
    const html = renderAdmin('/admin/DTN026');
    expect(html).toContain('Войти в пульт');
    expect(html).toContain('aria-label="Пароль ведущего"');
    expect(html).not.toContain('Эта вкладка не может управлять игрой');
  });
});

function renderAdmin(path: string) {
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => undefined });
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AdminPage />} path="/admin" />
        <Route element={<AdminPage />} path="/admin/:code" />
      </Routes>
    </MemoryRouter>,
  );
}
