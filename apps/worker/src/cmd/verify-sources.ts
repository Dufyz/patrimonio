import { createConnection, closeDatabase, createRepositories } from '@patrimonio/db';
import { environment } from '@patrimonio/env';
import { formatChanges, probeSources, reportOf } from '@patrimonio/market';

/**
 * `pnpm verify:sources` — a bateria de contrato contra as APIs reais, com o
 * resultado gravado.
 *
 * A mesma sondagem que o teste noturno usa, para as duas não divergirem: o teste
 * roda no CI, onde não há banco, e este script roda onde há — e é ele que faz o
 * resultado da última verificação aparecer na tela de dados de mercado, que é o
 * que M-17 pede.
 *
 * O código de saída distingue o que importa: formato mudado é 1, porque pede
 * alguém; fonte fora do ar é 0, porque não é notícia e falhar por isso
 * transformaria o detector num gerador de ruído.
 */
const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const argv = process.argv.slice(2);
const argumentOf = (name: string): string | undefined =>
  argv.find((item) => item.startsWith(`--${name}=`))?.split('=')[1];

const today = new Date();
const reference =
  argumentOf('date') ?? new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
const from = argumentOf('from') ?? `${reference.slice(0, 7)}-01`;

const sql = createConnection({
  connection: environment.database.connection,
  poolSize: 1,
  applicationName: 'patrimonio-verify-sources',
});

try {
  const startedAt = new Date().toISOString();

  const results = await probeSources({
    reference_date: reference as `${number}-${number}-${number}`,
    from: from as `${number}-${number}-${number}`,
    timeoutMs: environment.market.requestTimeoutMs,
    ...(environment.market.brapiToken === undefined
      ? {}
      : { brapiToken: environment.market.brapiToken }),
  });

  const finishedAt = new Date().toISOString();

  write(`verificação de ${reference}\n`);
  write(reportOf(results));

  const repositories = createRepositories(sql);

  for (const result of results) {
    const recorded = await repositories.market.recordRun({
      source: result.source,
      kind: 'contract_check',
      // Nula de propósito: a bateria não coleta dado, só confere formato.
      reference_date: null,
      started_at: startedAt,
      finished_at: finishedAt,
      ok: result.outcome === 'ok',
      items: result.items,
      error:
        result.outcome === 'ok'
          ? null
          : (result.message ?? `formato de ${result.source} não reconhecido`),
      detail: result.detail === null ? null : { ...result.detail },
    });

    if (recorded.isFailure()) {
      process.stderr.write(`não foi possível registrar ${result.source}\n`);
    }
  }

  const changed = formatChanges(results);

  if (changed.length > 0) {
    process.stderr.write(
      `\nformato mudou em ${changed.length} fonte(s): ${changed
        .map((result) => result.source)
        .join(', ')}\n`,
    );
    process.exitCode = 1;
  }
} finally {
  await closeDatabase(sql);
}
