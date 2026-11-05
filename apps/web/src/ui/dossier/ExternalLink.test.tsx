import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExternalLink } from './primitives';

describe('ExternalLink', () => {
  it('crée un lien pour une adresse http(s)', () => {
    render(<ExternalLink url="https://youtube.example/@chaine" />);
    const link = screen.getByRole('link', { name: 'youtube.example/@chaine' });
    expect(link).toHaveAttribute('href', 'https://youtube.example/@chaine');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  });

  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>'])(
    'affiche %j en texte, jamais comme un lien',
    (url) => {
      render(<ExternalLink url={url} />);
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.getByText(url)).toBeInTheDocument();
    },
  );
});
