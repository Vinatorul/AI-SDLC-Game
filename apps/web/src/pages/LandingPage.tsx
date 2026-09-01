import { stageKeys } from '@ai-sdlc/contracts';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { stageLabels, stageStateLabels } from '../labels';

export function LandingPage() {
  return (
    <Layout>
      <main className="landing-shell">
        <LandingHero />
        <section className="role-grid" aria-label="Выберите экран">
          <RoleLink
            body="Создать игру и управлять ходом."
            index="01"
            title="Я ведущий"
            to="/admin"
          />
          <RoleLink body="Войти по коду и голосовать." index="02" title="Я игрок" to="/play" />
          <RoleLink
            body="Открыть экран для проектора."
            index="03"
            title="Общий экран"
            to="/screen"
          />
        </section>
        <StagePreview />
      </main>
    </Layout>
  );
}

function LandingHero() {
  return (
    <header className="landing-hero">
      <p className="eyebrow">Интерактивный доклад · 8 этапов SDLC</p>
      <h1>Зал решает, где AI будет работать в SDLC</h1>
      <p className="lede">
        Выберите этап и решение. Игра покажет, что ускорилось, что сломалось и что теперь мешает
        поставке.
      </p>
    </header>
  );
}

function StagePreview() {
  return (
    <section className="stage-preview" aria-labelledby="map-title">
      <p className="eyebrow">Исходная карта</p>
      <h2 id="map-title">Победа — когда AI работает на всех восьми этапах</h2>
      <div className="stage-grid">
        {stageKeys.map((stage, index) => (
          <article className="stage-card" key={stage}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{stageLabels[stage]}</strong>
            <small>{stageStateLabels.AS_IS}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

type RoleLinkProps = { body: string; index: string; title: string; to: string };

function RoleLink({ body, index, title, to }: RoleLinkProps) {
  return (
    <Link className={`role-card ${index === '01' ? 'role-card-primary' : ''}`} to={to}>
      <span className="role-index">{index}</span>
      <h2>{title}</h2>
      <p>{body}</p>
    </Link>
  );
}
