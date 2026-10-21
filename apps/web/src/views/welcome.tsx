import { useState } from 'react';

import { Button } from '../components/primitives.js';
import { notifyPortfoliosChanged } from '../lib/portfolio_events.js';
import { PortfolioDialog } from './registers/portfolio_dialogs.js';

/**
 * A tela de quem ainda não tem carteira.
 *
 * Sem carteira não há o que mostrar: toda posição, lançamento, estratégia e
 * objetivo pertence a uma. Antes, essa pessoa caía em Configurações, que é uma
 * tela de ajuste e não diz por onde começar. Aqui a próxima ação é uma só —
 * criar a primeira carteira — e o resto do caminho vem dito embaixo.
 *
 * Criar a carteira reaproveita o modal de Configurações; ao salvar, o aviso de
 * carteiras alteradas faz o app reler a lista e abrir a Visão geral sozinho.
 */

const STEPS = [
  {
    title: 'Crie uma carteira',
    text: 'Dê um nome: reserva, investimentos, imóvel. Cada carteira tem estratégia e objetivos próprios.',
  },
  {
    title: 'Defina a estratégia',
    text: 'Quanto de cada classe de ativo você quer ter. Pode ficar para depois.',
    action: 'Definir estratégia',
  },
  {
    title: 'Lance o que você já tem',
    text: 'Uma compra por ativo, com preço médio, já basta para começar. Ou importe uma planilha em Configurações.',
    action: 'Novo lançamento',
  },
] as const;

export const WelcomeScreen = ({
  onOpenSettings,
}: {
  readonly onOpenSettings: () => void;
}): React.ReactElement => {
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center gap-4 p-6">
      <section className="rounded-panel border border-line bg-panel p-7 shadow-panel">
        <p className="tabular text-label font-medium tracking-[0.06em] text-ink-3 uppercase">
          Patrimônio
        </p>
        <h1 className="mt-1 text-[1.5rem] leading-8 font-semibold">
          Seu patrimônio aparece aqui depois do primeiro lançamento
        </h1>
        <p className="mt-1 text-[0.8125rem] text-ink-2">
          Três passos; nenhum gráfico ou tabela vazio é mostrado antes disso.
        </p>

        <ol className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="flex flex-col items-start gap-1.5 rounded-panel border border-line p-5"
            >
              <span
                aria-hidden="true"
                className={`tabular grid size-6 place-items-center rounded-full text-xs font-semibold ${
                  index === 0 ? 'bg-accent text-btn-ink' : 'bg-panel-2 text-ink-2'
                }`}
              >
                {index + 1}
              </span>
              <h2 className="mt-1 text-[0.9375rem] font-semibold">{step.title}</h2>
              <p className="flex-1 text-[0.8125rem] text-ink-2">{step.text}</p>
              {'action' in step ? (
                <Button disabled title="Disponível depois de criar a carteira">
                  {step.action}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Criar primeira carteira
                </Button>
              )}
            </li>
          ))}
        </ol>
      </section>

      <p className="flex flex-wrap items-center gap-1 text-[0.8125rem] text-ink-2">
        A tela troca os blocos por um roteiro. Assim que existe um lançamento, os blocos
        normais aparecem, mesmo com pouca informação.
        <Button variant="ghost" onClick={onOpenSettings}>
          Abrir configurações
        </Button>
      </p>

      {creating ? (
        <PortfolioDialog
          portfolio={null}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            notifyPortfoliosChanged();
          }}
        />
      ) : null}
    </div>
  );
};
