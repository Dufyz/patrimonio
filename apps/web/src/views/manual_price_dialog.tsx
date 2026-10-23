import { useEffect, useState } from 'react';

import type { SetManualPriceResponse } from '@patrimonio/contracts';

import { setManualPrice } from '../api/manual_price.js';
import { Money } from '../components/number.js';
import { Modal } from '../components/overlay.js';
import { Button } from '../components/primitives.js';
import { amountInputValue, parseAmountInput } from '../lib/positions.js';
import { Callout, FieldLabel, MoneyInput } from './entry/fields.js';

/**
 * L-14 · Definir o preço de um ativo à mão.
 *
 * O preço manual vale até a fonte automática voltar a responder para aquele
 * ativo, e enquanto vale a linha aparece marcada. O preview do efeito vem da
 * `api` — é o mesmo cálculo que fica gravado, e não uma multiplicação feita
 * aqui: se os dois divergirem, a confiança no app acaba naquele número.
 *
 * O diálogo pede as cinco colunas de que precisa, e não uma linha de Posições
 * inteira: Posições e a página do ativo (T-03) leem recursos diferentes do
 * mesmo papel, e a forma mais estreita é a que serve às duas sem conversão.
 */
export type ManualPriceTarget = {
  readonly asset_id: string;
  readonly ticker: string;
  readonly name: string;
  /** O preço que o campo mostra ao abrir. */
  readonly price: string | null;
  readonly price_date: string | null;
};
export const ManualPriceDialog = ({
  position,
  /** O dia do último fechamento: é a data que o preço corrige por padrão. */
  defaultDate,
  onClose,
  onSaved,
}: {
  readonly position: ManualPriceTarget | null;
  readonly defaultDate: string | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): React.ReactElement | null => {
  const [price, setPrice] = useState('');
  const [date, setDate] = useState('');
  const [result, setResult] = useState<SetManualPriceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPrice(amountInputValue(position?.price ?? null));
    // A data do preço que está na tela, e o dia do fechamento quando o ativo
    // ainda não tem preço nenhum — que é justamente quando alguém o digita.
    setDate(position?.price_date ?? defaultDate ?? '');
    setResult(null);
    setError(null);
  }, [position, defaultDate]);

  if (position === null) return null;

  // `36,84` e `1.360,57` saem daqui como o decimal que o contrato aceita, sem
  // passar por `number`: é dinheiro, e a regra vale até no campo do formulário.
  const amount = parseAmountInput(price);

  const submit = (): void => {
    if (amount === null) {
      setError('Informe um valor como 36,84.');
      return;
    }

    setSaving(true);
    setError(null);

    setManualPrice(position.asset_id, { price_date: date, price: amount })
      .then((saved) => setResult(saved))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'A api não respondeu'),
      )
      .finally(() => setSaving(false));
  };

  return (
    <Modal
      open
      guard
      title={`Preço manual · ${position.ticker}`}
      subtitle="Para quando a fonte automática falha ou o ativo não tem cotação"
      onClose={onClose}
      footer={
        result === null ? (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={saving || amount === null || date.trim() === ''}
              onClick={submit}
            >
              {saving ? 'Salvando…' : 'Salvar preço'}
            </Button>
          </>
        ) : (
          <Button variant="primary" data-autofocus onClick={onSaved}>
            Fechar
          </Button>
        )
      }
    >
      {result === null ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5">
              <FieldLabel>Data do preço</FieldLabel>
              <input
                type="date"
                value={date}
                data-autofocus
                className="h-control rounded-control border border-line-2 bg-panel px-3 text-sm"
                onChange={(event) => setDate(event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <FieldLabel>Preço</FieldLabel>
              <MoneyInput
                invalid={false}
                maxDecimals={8}
                value={price}
                aria-label="Preço"
                onChange={(event) => setPrice(event.target.value)}
              />
            </label>
          </div>

          <Callout tone="info">
            Vale até a fonte automática voltar a responder. Nas tabelas, o preço aparece
            com a marca “manual”.
          </Callout>

          {error === null ? null : <p className="text-sm text-negative">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <table className="w-full overflow-hidden rounded-panel border border-line text-[0.8125rem]">
            <caption className="sr-only">Efeito do preço manual</caption>
            <thead className="bg-panel-2">
              <tr>
                <th
                  scope="col"
                  className="px-3 py-2 text-left tabular text-label font-medium tracking-[0.06em] text-ink-3 uppercase"
                >
                  Efeito
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-right tabular text-label font-medium tracking-[0.06em] text-ink-3 uppercase"
                >
                  Antes → depois
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <th scope="row" className="px-3 py-2.5 text-left font-medium">
                  Valor da posição
                </th>
                <td className="px-3 py-2.5 text-right">
                  <Money value={result.preview.position_value.before} />
                  {' → '}
                  <strong className="font-semibold">
                    <Money value={result.preview.position_value.after} />
                  </strong>
                </td>
              </tr>
            </tbody>
          </table>

          {/*
          A tabela não muda na hora, e dizer isso é mais honesto que deixar
          quem salvou procurando o número novo: Posições lê a projeção, e a
          projeção é reconstruída pelo recálculo que este salvamento
          enfileirou.
        */}
          <p className="text-[0.8125rem] text-ink-2">
            O recálculo foi enfileirado. A posição passa a valer{' '}
            <Money value={result.preview.position_value.after} /> quando ele terminar, e a
            linha fica marcada como preço manual.
          </p>
        </div>
      )}
    </Modal>
  );
};
