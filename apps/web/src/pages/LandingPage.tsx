import { Link, useNavigate } from 'react-router-dom';
import { RoomCodeForm } from '../components/CodeEntry';
import { Layout } from '../components/Layout';

export function LandingPage() {
  const navigate = useNavigate();
  return (
    <Layout bare>
      <main className="landing-shell">
        <LandingHero />
        <LandingActions onJoin={(code) => navigate(`/play/${code}`)} />
      </main>
    </Layout>
  );
}

function LandingHero() {
  return (
    <header className="landing-hero">
      <p className="eyebrow">AI SDLC RPG · 8 этапов</p>
      <h1>Зал решает, где AI работает в SDLC</h1>
      <p className="lede">
        Участники выбирают этап и решение. Игра показывает, что ускорилось, что сломалось и чего не
        хватает команде.
      </p>
    </header>
  );
}

function LandingActions({ onJoin }: { onJoin: (code: string) => void }) {
  return (
    <section aria-label="Начать игру" className="landing-actions">
      <Link className="landing-host-link" to="/admin">
        <small>Для ведущего</small>
        <strong>Открыть пульт</strong>
      </Link>
      <div className="landing-join">
        <strong>Войти по коду</strong>
        <RoomCodeForm action="Войти" className="landing-code-form" onSubmit={onJoin} />
      </div>
      <Link className="landing-screen-link" to="/screen">
        Открыть общий экран
      </Link>
    </section>
  );
}
