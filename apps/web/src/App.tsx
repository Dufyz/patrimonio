import type { HealthCheckResource } from '@patrimonio/contracts';
import { useEffect, useState } from 'react';

import { fetchHealth } from './api/health.js';

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly health: HealthCheckResource }
  | { readonly kind: 'unreachable' };

/**
 * A casca da Fase 1. As telas entram em E6, sobre o design system de E5 — o que
 * existe aqui é o suficiente para provar que o contrato compartilhado funciona
 * de ponta a ponta.
 */
export const App = (): React.ReactElement => {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;

    fetchHealth()
      .then((health) => {
        if (active) setState({ kind: 'ready', health });
      })
      .catch(() => {
        if (active) setState({ kind: 'unreachable' });
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Patrimônio</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Fundação da Fase 1: api, worker e web de pé na sua máquina.
        </p>
      </header>

      <section className="rounded-lg bg-[var(--color-surface-raised)] p-5">
        {state.kind === 'loading' && (
          <p className="text-sm text-[var(--color-ink-muted)]">Consultando a api…</p>
        )}

        {state.kind === 'unreachable' && (
          <p className="text-sm text-[var(--color-negative)]">
            A api não respondeu. Suba o ambiente com <code>pnpm infra:up</code> e{' '}
            <code>pnpm dev</code>.
          </p>
        )}

        {state.kind === 'ready' && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-[var(--color-ink-muted)]">Estado</dt>
            <dd
              className={
                state.health.status === 'ok'
                  ? 'text-[var(--color-positive)]'
                  : 'text-[var(--color-negative)]'
              }
            >
              {state.health.status}
            </dd>

            <dt className="text-[var(--color-ink-muted)]">Postgres</dt>
            <dd>
              {state.health.checks.database.ok ? 'responde' : 'fora do ar'} ·{' '}
              {state.health.checks.database.latency_ms} ms
            </dd>

            <dt className="text-[var(--color-ink-muted)]">Redis</dt>
            <dd>
              {state.health.checks.redis.ok ? 'responde' : 'fora do ar'} ·{' '}
              {state.health.checks.redis.latency_ms} ms
            </dd>

            <dt className="text-[var(--color-ink-muted)]">Último fechamento</dt>
            <dd>{state.health.last_daily_close?.reference_date ?? 'nenhum ainda'}</dd>
          </dl>
        )}
      </section>
    </main>
  );
};
