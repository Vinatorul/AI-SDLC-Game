import { type FormEvent, useState } from 'react';

type CodeEntryProps = {
  action: string;
  description: string;
  onSubmit: (code: string) => void;
  title: string;
};

export function CodeEntry({ action, description, onSubmit, title }: CodeEntryProps) {
  const [code, setCode] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (normalized) onSubmit(normalized);
  }
  return (
    <section className="entry-card">
      <p className="eyebrow">Код комнаты</p>
      <h1>{title}</h1>
      <p>{description}</p>
      <form onSubmit={submit}>
        <input
          aria-label="Код комнаты"
          autoCapitalize="characters"
          maxLength={8}
          onChange={(event) => setCode(event.target.value)}
          placeholder="ABC234"
          value={code}
        />
        <button className="primary-button" type="submit">
          {action}
        </button>
      </form>
    </section>
  );
}
