import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';

const stages = [
  'Бизнес-заказ',
  'Продуктовая проработка',
  'Техническая проработка',
  'Написание кода',
  'Ревью',
  'Тестирование',
  'Деплой',
  'Поддержка',
];

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
            body="Показать карту и последствия."
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
      <p className="eyebrow">Интерактивный доклад · 5 раундов</p>
      <h1>Строим AI SDLC вместе с залом</h1>
      <p className="lede">
        Одно решение может ускорить поток, перенести узкое место или сломать процесс.
      </p>
    </header>
  );
}

function StagePreview() {
  return (
    <section className="stage-preview" aria-labelledby="map-title">
      <p className="eyebrow">Исходная карта</p>
      <h2 id="map-title">Восемь этапов. Пять решений.</h2>
      <div className="stage-grid">
        {stages.map((stage, index) => (
          <article className="stage-card" key={stage}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{stage}</strong>
            <small>Работает как раньше</small>
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
