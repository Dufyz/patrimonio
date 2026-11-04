import type { InstitutionResource, Settings } from '@patrimonio/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';

import { createTransaction } from '../../api/entry.js';
import { fetchInstitutions } from '../../api/institutions.js';
import { fetchSearch } from '../../api/search.js';
import { Modal } from '../../components/overlay.js';
import { Button } from '../../components/primitives.js';
import { newAttemptKey } from '../../lib/entry.js';
import { formatMoney } from '../../lib/format.js';
import {
  IMPORT_FIELDS,
  IMPORT_KIND_LABEL,
  buildImportRows,
  guessMapping,
  missingFields,
  parseCsv,
} from '../../lib/import_csv.js';
import type { ImportField, ImportMapping, ImportRow } from '../../lib/import_csv.js';
import { looksLikeExport, readExport } from '../../lib/import_json.js';
import { Callout, Field, Select } from '../entry/fields.js';
import { FormShell } from '../entry/form_shell.js';

/**
 * Importar planilha (O-04): CSV de compras e vendas, ou o JSON da exportação, → lançamentos.
 *
 * O arquivo é lido no navegador, as colunas são reconhecidas pelo cabeçalho e
 * corrigíveis, e a prévia mostra o que entra e o que será ignorado antes de
 * qualquer gravação. Cada linha vira um lançamento comum, gravado pela mesma
 * rota do formulário — então valida igual, calcula igual e entra na fila de
 * recálculo igual. Em ordem de data, para a venda nunca chegar antes da compra.
 *
 * O papel é resolvido pelo código: ativo que já existe é reaproveitado e, se
 * não existe, o catálogo de papéis cria. Código que nenhum dos dois conhece
 * deixa a linha de fora, dita na prévia.
 */
type Outcome = {
  readonly imported: number;
  readonly failures: readonly { readonly line: number; readonly message: string }[];
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PREVIEW_ROWS = 6;

export const ImportDialog = ({
  settings,
  onClose,
  onDone,
}: {
  readonly settings: Settings;
  readonly onClose: () => void;
  readonly onDone: () => void;
}): React.ReactElement => {
  const [portfolioId, setPortfolioId] = useState(settings.portfolios[0]?.id ?? '');
  const [institutions, setInstitutions] = useState<readonly InstitutionResource[]>([]);
  const [institutionId, setInstitutionId] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<readonly (readonly string[])[]>([]);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  // O JSON da exportação já vem em linhas; só o CSV precisa de mapeamento.
  const [exported, setExported] = useState<{
    readonly rows: readonly ImportRow[];
    readonly skipped: number;
  } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchInstitutions(controller.signal)
      .then(setInstitutions)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const rows: readonly ImportRow[] = useMemo(
    () =>
      exported !== null
        ? exported.rows
        : mapping === null || table.length < 2
          ? []
          : buildImportRows(table, mapping),
    [exported, table, mapping],
  );
  const valid = rows.filter((row) => row.errors.length === 0);
  const invalid = rows.length - valid.length;
  const missing = mapping === null ? [] : missingFields(mapping);
  const header = table[0] ?? [];

  const pick = (file: File | undefined): void => {
    if (file === undefined) return;
    setReadError(null);
    setOutcome(null);

    if (file.size > MAX_FILE_BYTES) {
      setReadError('O arquivo passa de 5 MB. Divida-o em partes menores.');
      return;
    }

    file
      .text()
      .then((text) => {
        if (file.name.toLowerCase().endsWith('.json') || looksLikeExport(text)) {
          const read = readExport(text);
          if (!read.ok) {
            setReadError(read.message);
            return;
          }
          setFileName(file.name);
          setTable([]);
          setMapping(null);
          setExported({ rows: read.rows, skipped: read.skipped });
          return;
        }

        const parsed = parseCsv(text);
        if (parsed.length < 2) {
          setReadError('O arquivo não tem linhas de dados abaixo do cabeçalho.');
          return;
        }
        setFileName(file.name);
        setExported(null);
        setTable(parsed);
        setMapping(guessMapping(parsed[0] ?? []));
      })
      .catch(() => setReadError('Não foi possível ler o arquivo.'));
  };

  // Carteira e instituição do arquivo de exportação são reencontradas pelo nome;
  // o que não casa (ou o CSV, que não as traz) usa a escolha de cima.
  const portfolioOf = (row: ImportRow): string =>
    settings.portfolios.find((item) => item.name === row.portfolio_name)?.id ??
    portfolioId;
  const institutionOf = (row: ImportRow): string =>
    institutions.find((item) => item.name === row.institution_name)?.id ?? institutionId;

  const run = async (): Promise<void> => {
    if (!resolvable || valid.length === 0) return;
    setError(null);
    setOutcome(null);

    // Os papéis, uma busca por código: ativo existente ou instrumento do catálogo.
    const tickers = [
      ...new Set(valid.flatMap((row) => (row.ticker === null ? [] : [row.ticker]))),
    ];
    const known = new Map<
      string,
      | { readonly asset_id: string }
      | {
          readonly asset: {
            readonly ticker: string;
            readonly name: string;
            readonly b3_type: 'stock' | 'fii' | 'etf' | 'bdr' | 'treasury';
          };
        }
    >();

    for (const [index, ticker] of tickers.entries()) {
      setProgress(`Conferindo papéis… ${index + 1}/${tickers.length}`);
      try {
        const found = await fetchSearch(
          ticker,
          portfolioId || (settings.portfolios[0]?.id ?? ''),
        );
        const asset = found.assets.items.find(
          (item) => item.ticker.toUpperCase() === ticker,
        );
        const instrument = found.instruments.items.find(
          (item) => item.ticker.toUpperCase() === ticker,
        );

        if (asset !== undefined) known.set(ticker, { asset_id: asset.id });
        else if (instrument !== undefined) {
          known.set(ticker, {
            asset: { ticker, name: instrument.name, b3_type: instrument.b3_type },
          });
        }
      } catch {
        // Falha da busca deixa o papel como desconhecido; a prévia final diz quais.
      }
    }

    const ordered = [...valid].sort(
      (a, b) =>
        (a.trade_date as string).localeCompare(b.trade_date as string) ||
        (a.kind === b.kind ? 0 : a.kind === 'sell' ? 1 : -1) ||
        a.line - b.line,
    );

    let imported = 0;
    const failures: { line: number; message: string }[] = [];

    for (const [index, row] of ordered.entries()) {
      setProgress(`Importando… ${index + 1}/${ordered.length}`);
      const portfolio_id = portfolioOf(row);
      const institution_id = institutionOf(row);

      try {
        const target = known.get(row.ticker as string);

        if (target === undefined) {
          failures.push({
            line: row.line,
            message: `${row.ticker}: papel não encontrado no cadastro nem no catálogo`,
          });
          continue;
        }

        await createTransaction(
          {
            kind: row.kind as 'buy' | 'sell' | 'payout',
            portfolio_id,
            institution_id,
            trade_date: row.trade_date as string,
            quantity: row.quantity as string,
            unit_price: row.unit_price as string,
            fees: row.fees ?? '0',
            ...(row.settlement_date === undefined
              ? {}
              : { settlement_date: row.settlement_date }),
            ...(row.tax_withheld === undefined ? {} : { tax_withheld: row.tax_withheld }),
            ...(row.payout_kind === undefined ? {} : { payout_kind: row.payout_kind }),
            ...(row.record_date === undefined ? {} : { record_date: row.record_date }),
            ...(row.note === undefined ? {} : { note: row.note }),
            ...target,
          } as Parameters<typeof createTransaction>[0],
          newAttemptKey(),
        );
        imported += 1;
      } catch (cause) {
        failures.push({
          line: row.line,
          message: cause instanceof Error ? cause.message : 'a api não respondeu',
        });
      }
    }

    setProgress(null);
    setOutcome({ imported, failures });
    if (imported > 0) onDone();
  };

  const busy = progress !== null;
  const resolvable = valid.every(
    (row) => portfolioOf(row) !== '' && institutionOf(row) !== '',
  );
  const ready =
    (exported !== null || (mapping !== null && missing.length === 0)) &&
    valid.length > 0 &&
    resolvable;

  const setColumn = (field: ImportField, value: string): void =>
    setMapping((current) =>
      current === null
        ? current
        : { ...current, [field]: value === '' ? null : Number(value) },
    );

  return (
    <Modal
      open
      guard={outcome === null}
      title="Importar planilha"
      subtitle="CSV de compras e vendas ou o JSON da exportação viram lançamentos, com prévia antes de gravar"
      onClose={onClose}
    >
      {outcome !== null ? (
        <div className="flex flex-col gap-3">
          <Callout tone={outcome.failures.length === 0 ? 'info' : 'warning'}>
            {outcome.imported === 1
              ? '1 lançamento importado.'
              : `${outcome.imported} lançamentos importados.`}
            {outcome.failures.length > 0
              ? ` ${outcome.failures.length} ficaram de fora.`
              : ''}{' '}
            {outcome.imported > 0
              ? 'As posições se atualizam quando o recálculo terminar.'
              : ''}
          </Callout>
          {outcome.failures.length > 0 ? (
            <ul className="max-h-48 overflow-auto text-[0.8125rem] text-ink-2">
              {outcome.failures.slice(0, 30).map((failure) => (
                <li key={failure.line}>
                  Linha {failure.line}: {failure.message}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Fechar
            </Button>
          </div>
        </div>
      ) : (
        <FormShell
          pending={busy}
          error={error}
          canSave={ready}
          saveLabel={
            valid.length > 0 ? `Importar ${valid.length} lançamentos` : 'Importar'
          }
          onSave={() => void run()}
          onCancel={onClose}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Carteira">
              {(control) => (
                <Select
                  {...control}
                  invalid={false}
                  value={portfolioId}
                  options={settings.portfolios.map((item) => ({
                    id: item.id,
                    name: item.name,
                  }))}
                  onChange={(event) => setPortfolioId(event.target.value)}
                />
              )}
            </Field>
            <Field label="Instituição">
              {(control) => (
                <Select
                  {...control}
                  invalid={false}
                  placeholder="Escolha…"
                  value={institutionId}
                  options={institutions.map((item) => ({ id: item.id, name: item.name }))}
                  onChange={(event) => setInstitutionId(event.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="flex items-center gap-3">
            <input
              ref={input}
              type="file"
              accept=".csv,.txt,.json,text/csv,text/plain,application/json"
              className="hidden"
              aria-label="Arquivo de importação"
              onChange={(event) => pick(event.target.files?.[0])}
            />
            <Button onClick={() => input.current?.click()}>
              {fileName === null ? 'Escolher arquivo' : 'Trocar arquivo'}
            </Button>
            <span className="text-[0.8125rem] text-ink-3">
              {fileName ??
                'CSV (data, tipo, ativo, quantidade, preço, taxas) ou o JSON da exportação'}
            </span>
          </div>
          {readError === null ? null : <Callout tone="error">{readError}</Callout>}

          {exported !== null ? (
            <p className="text-[0.8125rem] text-ink-2">
              Exportação do Patrimônio: carteira e instituição são reencontradas pelo nome
              {exported.skipped > 0
                ? `; ${exported.skipped} lançamentos de eventos corporativos ficam de fora — registre-os de novo como evento corporativo`
                : ''}
              . Ativos cadastrados à mão (renda fixa de banco) precisam existir antes.
            </p>
          ) : null}

          {mapping === null && exported === null ? null : (
            <>
              {mapping === null ? null : (
                <div className="grid grid-cols-3 gap-3">
                  {IMPORT_FIELDS.map((item) => (
                    <Field key={item.field} label={item.label}>
                      {(control) => (
                        <Select
                          {...control}
                          invalid={item.required && mapping[item.field] === null}
                          placeholder={item.required ? 'Escolha a coluna…' : 'Não usar'}
                          value={
                            mapping[item.field] === null
                              ? ''
                              : String(mapping[item.field])
                          }
                          options={header.map((name, index) => ({
                            id: String(index),
                            name: name.trim() === '' ? `Coluna ${index + 1}` : name,
                          }))}
                          onChange={(event) => setColumn(item.field, event.target.value)}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              )}

              {missing.length > 0 ? (
                <Callout tone="error">Falta mapear: {missing.join(', ')}.</Callout>
              ) : (
                <>
                  <p className="text-[0.8125rem] text-ink-2">
                    {valid.length} de {rows.length} linhas prontas
                    {invalid > 0 ? `; ${invalid} com problema serão ignoradas` : ''}.
                  </p>
                  <div className="max-h-56 overflow-auto rounded-md border border-line">
                    <table className="w-full text-[0.8125rem]">
                      <thead className="text-left text-ink-3">
                        <tr>
                          <th className="px-2 py-1.5">Linha</th>
                          <th className="px-2 py-1.5">Data</th>
                          <th className="px-2 py-1.5">Tipo</th>
                          <th className="px-2 py-1.5">Ativo</th>
                          <th className="px-2 py-1.5 text-right">Qtd</th>
                          <th className="px-2 py-1.5 text-right">Preço</th>
                          <th className="px-2 py-1.5">Situação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...rows.filter((row) => row.errors.length > 0), ...valid]
                          .slice(0, PREVIEW_ROWS + Math.min(invalid, 10))
                          .map((row) => (
                            <tr key={row.line} className="border-t border-line">
                              <td className="px-2 py-1.5 tabular">{row.line}</td>
                              <td className="px-2 py-1.5 tabular">
                                {row.trade_date ?? '—'}
                              </td>
                              <td className="px-2 py-1.5">
                                {row.kind === null ? '—' : IMPORT_KIND_LABEL[row.kind]}
                              </td>
                              <td className="px-2 py-1.5">{row.ticker ?? '—'}</td>
                              <td className="px-2 py-1.5 text-right tabular">
                                {row.quantity ?? '—'}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular">
                                {row.unit_price === null
                                  ? '—'
                                  : formatMoney(row.unit_price).text}
                              </td>
                              <td
                                className={`px-2 py-1.5 ${row.errors.length > 0 ? 'text-negative' : 'text-ink-3'}`}
                              >
                                {row.errors.length > 0 ? row.errors.join(', ') : 'ok'}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
          {progress === null ? null : (
            <p className="text-[0.8125rem] text-ink-2">{progress}</p>
          )}
        </FormShell>
      )}
    </Modal>
  );
};
