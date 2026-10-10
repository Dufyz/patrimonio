import type {
  Settings,
  SettingsBenchmark,
  SettingsCategory,
  SettingsInstitution,
} from '@patrimonio/contracts';

import { Money } from '../../components/number.js';
import { Button } from '../../components/primitives.js';
import {
  alertCopy,
  alertLimit,
  autoRuleText,
  benchmarkHow,
  benchmarkSource,
  benchmarkUse,
  categoryHold,
  fgcNote,
  groupCategories,
  institutionHold,
  plural,
  portfolioCount,
  portfolioHold,
  ROLE_LABEL,
  sortAlerts,
} from '../../lib/settings.js';
import { colorForToken } from '../../lib/tokens.js';
import {
  EditButton,
  Muted,
  ROW,
  SettingsSection,
  Switch,
  TD,
  TH,
  TH_RIGHT,
} from './parts.js';

/**
 * As cinco seções de cadastro: carteiras, alertas, categorias, instituições e
 * benchmarks. Nenhuma faz conta — contagem, soma e percentual chegam da `api`
 * —, e nenhuma escreve ainda: criar e editar são modais, e os modais são T-10.
 * O que cada linha mostra é o que o servidor usa para bloquear a exclusão, para
 * o bloqueio chegar explicado e não como um erro depois do clique.
 */

export const PortfoliosSection = ({
  settings,
}: {
  readonly settings: Settings;
}): React.ReactElement => (
  <SettingsSection
    id="carteiras"
    title="Carteiras"
    description="Uma carteira separa o dinheiro por propósito. Cada uma tem benchmark, estratégia e objetivos próprios, e cada posição pertence a uma carteira só. A ordem aqui é a ordem da barra lateral."
    action={
      <Button disabled title="Criar carteira chega com T-10">
        + Nova carteira
      </Button>
    }
  >
    {settings.portfolios.length === 0 ? (
      <p className="p-4 text-[0.8125rem] text-ink-3">
        Nenhuma carteira ainda. Crie a primeira para começar a lançar.
      </p>
    ) : (
      <table className="w-full text-[0.8125rem] whitespace-nowrap">
        <caption className="sr-only">Carteiras abertas</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Carteira
            </th>
            <th scope="col" className={TH}>
              Benchmark
            </th>
            <th scope="col" className={TH}>
              Estratégia
            </th>
            <th scope="col" className={TH}>
              Objetivo
            </th>
            <th scope="col" className={TH}>
              Impede excluir
            </th>
            <th scope="col" className="w-12" />
          </tr>
        </thead>
        <tbody>
          {settings.portfolios.map((portfolio) => {
            const hold = portfolioHold(portfolio.blocking);

            return (
              <tr key={portfolio.id} className={ROW}>
                <th scope="row" className={`${TD} text-left font-medium`}>
                  {portfolio.name}
                </th>
                <td className={TD}>{portfolio.benchmark?.name ?? <Muted>—</Muted>}</td>
                <td className={TD}>
                  {portfolio.strategy_categories === 0 ? (
                    <Muted>sem estratégia</Muted>
                  ) : (
                    plural(portfolio.strategy_categories, 'categoria', 'categorias')
                  )}
                </td>
                <td
                  className={`${TD} max-w-56 truncate`}
                  title={portfolio.goals.join(', ')}
                >
                  {portfolio.goals.length === 0 ? (
                    <Muted>—</Muted>
                  ) : (
                    portfolio.goals.join(', ')
                  )}
                </td>
                <td className={TD}>
                  {hold === null ? (
                    <Muted>nada: pode ser excluída</Muted>
                  ) : (
                    <span title="A carteira tem lançamentos: excluir pede um destino para eles">
                      {hold}
                    </span>
                  )}
                </td>
                <td className="pr-4 text-right">
                  <EditButton label={`a carteira ${portfolio.name}`} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    )}
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line px-4 py-3 text-[0.8125rem]">
      <span className="text-ink-2">
        <strong className="font-medium text-ink">Carteiras arquivadas</strong> saem da
        barra lateral; o histórico fica guardado.
      </span>
      <span className="text-ink-3">
        {settings.archived_portfolios.length === 0
          ? 'nenhuma arquivada'
          : `${plural(settings.archived_portfolios.length, 'arquivada', 'arquivadas')} · ${settings.archived_portfolios
              .map((portfolio) => portfolio.name)
              .join(', ')}`}
      </span>
    </div>
  </SettingsSection>
);

export const AlertsSection = ({
  settings,
}: {
  readonly settings: Settings;
}): React.ReactElement => (
  <SettingsSection
    id="alertas"
    title="Alertas"
    description="Regras que alimentam Requer atenção na Visão geral. Cada alerta aparece marcado com a carteira afetada. Limites marcados “da carteira” valem para a estratégia de cada carteira."
  >
    <table className="w-full text-[0.8125rem]">
      <caption className="sr-only">Regras de alerta</caption>
      <thead>
        <tr>
          <th scope="col" className={TH}>
            Alerta
          </th>
          <th scope="col" className={TH}>
            Limite
          </th>
          <th scope="col" className={TH_RIGHT}>
            Ativo
          </th>
        </tr>
      </thead>
      <tbody>
        {sortAlerts(settings.alerts).map((rule) => {
          const copy = alertCopy(rule.kind);

          return (
            <tr key={rule.kind} className="h-14 border-t border-line">
              <th scope="row" className={`${TD} text-left font-normal`}>
                <span className="block font-medium">{copy.label}</span>
                <span className="block text-ink-3">{copy.description}</span>
              </th>
              <td className={`${TD} tabular`}>{alertLimit(rule)}</td>
              <td className={`${TD} text-right`}>
                <Switch
                  checked={rule.enabled}
                  label={`Regra ${copy.label}`}
                  title="Ligar e desligar regras chega com o motor de alertas (O-01)"
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    <p className="border-t border-line px-4 py-3 text-[0.8125rem] text-ink-3">
      Hoje só as regras de mercado estão cadastradas; as demais chegam com o motor de
      alertas (O-01), junto com o interruptor de cada uma.
    </p>
  </SettingsSection>
);

const CategoryRow = ({
  category,
  nested,
}: {
  readonly category: SettingsCategory;
  readonly nested: boolean;
}): React.ReactElement => {
  const hold = categoryHold(category);

  return (
    <tr className={ROW}>
      <th
        scope="row"
        className={`${TD} text-left ${nested ? 'pl-9 font-normal' : 'font-semibold'}`}
      >
        <span className="inline-flex items-center gap-2">
          {nested ? (
            <span
              aria-hidden="true"
              className="size-2 rounded-xs"
              style={{ backgroundColor: colorForToken(category.color_token) }}
            />
          ) : null}
          {category.name}
        </span>
      </th>
      <td className={`${TD} text-ink-2`}>{autoRuleText(category.auto_rule)}</td>
      <td className={`${TD} tabular text-right`}>{category.assets}</td>
      <td className={TD}>
        {category.strategies === 0 ? (
          <Muted>nenhuma</Muted>
        ) : (
          portfolioCount(category.strategies)
        )}
      </td>
      <td className={TD}>{hold === null ? <Muted>—</Muted> : hold}</td>
      <td className="pr-4 text-right">
        <EditButton label={`a categoria ${category.name}`} />
      </td>
    </tr>
  );
};

export const CategoriesSection = ({
  settings,
}: {
  readonly settings: Settings;
}): React.ReactElement => {
  const groups = groupCategories(settings.categories);

  return (
    <SettingsSection
      id="categorias"
      title="Categorias de ativo"
      description="Categorias são a base da Estratégia e das cores do app. Cada ativo novo entra na categoria cuja regra ele cumpre; dá para sobrescrever em cada ativo. Grupos somam as categorias de dentro. Renomear uma categoria mantém tudo o que está ligado a ela."
      action={
        <Button disabled title="Criar categoria chega com T-10">
          + Categoria
        </Button>
      }
    >
      {groups.length === 0 ? (
        <p className="p-4 text-[0.8125rem] text-ink-3">Nenhuma categoria cadastrada.</p>
      ) : (
        <table className="w-full text-[0.8125rem]">
          <caption className="sr-only">Categorias de ativo, em dois níveis</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>
                Categoria
              </th>
              <th scope="col" className={TH}>
                Regra automática
              </th>
              <th scope="col" className={TH_RIGHT}>
                Ativos
              </th>
              <th scope="col" className={TH}>
                Em estratégias
              </th>
              <th scope="col" className={TH}>
                Impede excluir
              </th>
              <th scope="col" className="w-12" />
            </tr>
          </thead>
          <tbody>
            {groups.flatMap(({ group, children }) => [
              <CategoryRow key={group.id} category={group} nested={false} />,
              ...children.map((child) => (
                <CategoryRow key={child.id} category={child} nested />
              )),
            ])}
          </tbody>
        </table>
      )}
    </SettingsSection>
  );
};

const FgcCell = ({
  institution,
}: {
  readonly institution: SettingsInstitution;
}): React.ReactElement => {
  const { fgc } = institution;
  if (fgc === null) return <Muted>{fgcNote(institution)}</Muted>;

  // Largura de barra é geometria, não dinheiro: o percentual já chegou pronto.
  const width = Math.min(Number(fgc.used_pct), 100);
  const state = fgc.over_limit
    ? 'bg-negative'
    : width >= 80
      ? 'bg-attention'
      : 'bg-accent';

  return (
    <span className="flex items-center justify-end gap-3">
      <span
        role="meter"
        aria-label={`Exposição de ${institution.name} contra o limite do FGC`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
        className="h-1.5 w-14 overflow-hidden rounded-full bg-panel-2"
      >
        <span className={`block h-full ${state}`} style={{ width: `${width}%` }} />
      </span>
      <span className="tabular whitespace-nowrap">
        <Money value={fgc.exposure} decimals={0} bare /> /{' '}
        <Money value={fgc.limit} decimals={0} bare />
      </span>
    </span>
  );
};

export const InstitutionsSection = ({
  settings,
}: {
  readonly settings: Settings;
}): React.ReactElement => (
  <SettingsSection
    id="instituicoes"
    title="Instituições"
    description="Onde o dinheiro está. A instituição de custódia guarda o ativo; o emissor é quem deve o título. O app soma a exposição por emissor para mostrar quanto está coberto pelo FGC, que garante até R$ 250 mil por CPF e instituição."
    action={
      <Button disabled title="Criar instituição chega com T-10">
        + Instituição
      </Button>
    }
  >
    {settings.institutions.length === 0 ? (
      <p className="p-4 text-[0.8125rem] text-ink-3">Nenhuma instituição cadastrada.</p>
    ) : (
      <table className="w-full text-[0.8125rem] whitespace-nowrap">
        <caption className="sr-only">Instituições</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Instituição
            </th>
            <th scope="col" className={TH}>
              Papel
            </th>
            <th scope="col" className={TH}>
              Carteiras
            </th>
            <th scope="col" className={TH_RIGHT}>
              Caixa
            </th>
            <th scope="col" className={TH_RIGHT}>
              Exposição FGC
            </th>
            <th scope="col" className={TH}>
              Impede excluir
            </th>
            <th scope="col" className="w-12" />
          </tr>
        </thead>
        <tbody>
          {settings.institutions.map((institution) => {
            const hold = institutionHold(institution.blocking);

            return (
              <tr key={institution.id} className={ROW}>
                <th scope="row" className={`${TD} text-left font-medium`}>
                  {institution.name}
                </th>
                <td className={TD}>{ROLE_LABEL[institution.role]}</td>
                <td
                  className={`${TD} max-w-28 truncate`}
                  title={institution.portfolios.join(', ')}
                >
                  {institution.portfolios.length === 0 ? (
                    <Muted>—</Muted>
                  ) : (
                    institution.portfolios.join(', ')
                  )}
                </td>
                <td className={`${TD} text-right`}>
                  {institution.cash === null ? (
                    <Muted>—</Muted>
                  ) : (
                    <Money value={institution.cash} />
                  )}
                </td>
                <td className={`${TD} text-right`}>
                  <FgcCell institution={institution} />
                </td>
                <td className={TD}>{hold === null ? <Muted>—</Muted> : hold}</td>
                <td className="pr-4 text-right">
                  <EditButton label={`a instituição ${institution.name}`} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    )}
  </SettingsSection>
);

const isComposite = (benchmark: SettingsBenchmark): boolean => benchmark.kind !== 'index';

export const BenchmarksSection = ({
  settings,
}: {
  readonly settings: Settings;
}): React.ReactElement => (
  <SettingsSection
    id="benchmarks"
    title="Benchmarks"
    description="Índices usados para comparar rentabilidade. Os índices base vêm de dados de mercado; os compostos são calculados a partir deles. Cada carteira escolhe o seu."
    action={
      <Button disabled title="Criar benchmark composto chega com T-10">
        + Benchmark composto
      </Button>
    }
  >
    <table className="w-full text-[0.8125rem]">
      <caption className="sr-only">Benchmarks</caption>
      <thead>
        <tr>
          <th scope="col" className={TH}>
            Benchmark
          </th>
          <th scope="col" className={TH}>
            Como é calculado
          </th>
          <th scope="col" className={TH}>
            Fonte
          </th>
          <th scope="col" className={TH}>
            Usado por
          </th>
          <th scope="col" className="w-12" />
        </tr>
      </thead>
      <tbody>
        {settings.benchmarks.map((benchmark) => (
          <tr key={benchmark.id} className={ROW}>
            <th scope="row" className={`${TD} text-left font-medium`}>
              {benchmark.name}
            </th>
            <td className={TD}>{benchmarkHow(benchmark)}</td>
            <td className={TD}>{benchmarkSource(benchmark)}</td>
            <td className={TD}>{benchmarkUse(benchmark.used_by)}</td>
            <td className="pr-4 text-right">
              {isComposite(benchmark) ? (
                <EditButton label={`o benchmark ${benchmark.name}`} />
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </SettingsSection>
);
