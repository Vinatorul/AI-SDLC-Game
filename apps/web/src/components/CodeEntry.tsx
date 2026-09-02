import { type FormEvent, useState } from 'react';

type CodeEntryProps = {
  action: string;
  description: string;
  onSubmit: (code: string) => void;
  title: string;
};

type RoomCodeFormProps = {
  action: string;
  className?: string;
  onSubmit: (code: string) => void;
};

export function CodeEntry({ action, description, onSubmit, title }: CodeEntryProps) {
  return (
    <section className="entry-card">
      <p className="eyebrow">Код комнаты</p>
      <h1>{title}</h1>
      <p>{description}</p>
      <RoomCodeForm action={action} onSubmit={onSubmit} />
    </section>
  );
}

export function RoomCodeForm({ action, className, onSubmit }: RoomCodeFormProps) {
  const [code, setCode] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (normalized) onSubmit(normalized);
  }
  return (
    <form className={className} onSubmit={submit}>
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
  );
}
