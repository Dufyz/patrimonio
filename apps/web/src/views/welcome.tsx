import { useState } from 'react';

import { Button, Panel } from '../components/primitives.js';
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
    text: 'Ela separa o dinheiro por propósito — aposentadoria, reserva, uma viagem. Cada carteira tem estratégia e objetivos próprios.',
  },
  {
    title: 'Registre os lançamentos',
    text: 'Compras, vendas e proventos, um a um, ou importe uma planilha CSV ou o JSON de uma exportação em Configurações.',
  },
  {
    title: 'Acompanhe o patrimônio',
    text: 'A Visão geral, as Posições e o retorno contra os benchmarks se montam a partir dos lançamentos.',
  },
] as const;

export const WelcomeScreen = ({
  onOpenSettings,
}: {
  readonly onOpenSettings: () => void;
}): React.ReactElement => {
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-screen-title leading-7 font-semibold">
          Comece pela primeira carteira
        </h1>
        <p className="text-[0.8125rem] text-ink-3">
          Você ainda não tem nenhuma carteira. Sem ela, o app não tem onde guardar
          lançamentos nem o que mostrar.
        </p>
      </header>

      <Panel>
        <ol className="flex flex-col">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="flex gap-4 border-t border-line px-4 py-3 first:border-t-0"
            >
              <span
                aria-hidden="true"
                className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-panel-2 text-xs font-medium text-ink-2"
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <h2 className="text-[0.8125rem] font-medium">{step.title}</h2>
                <p className="text-[0.8125rem] text-ink-3">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          Criar primeira carteira
        </Button>
        <Button variant="ghost" onClick={onOpenSettings}>
          Abrir configurações
        </Button>
      </div>

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
