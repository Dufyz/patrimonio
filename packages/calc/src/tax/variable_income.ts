import { Decimal } from 'decimal.js';

/**
 * O imposto sobre renda variável é apurado por mês e por classe, não por venda:
 * a isenção olha a soma das vendas do mês inteiro, e o prejuízo de um mês reduz
 * a base de outro. Por isso este módulo recebe o conjunto de vendas e devolve a
 * apuração mês a mês, em ordem — processar uma venda isolada daria a resposta
 * errada sempre que houver outra venda no mesmo mês.
 *
 * Nenhuma função aqui chama `new Date()`: a data da venda entra como string, e a
 * ordem é a da própria sequência.
 */
export const TAXABLE_CLASSES = ['stock', 'fii', 'etf'] as const;

export type TaxableClass = (typeof TAXABLE_CLASSES)[number];

/**
 * R$ 20 mil de vendas por mês, e só em ação. O valor é parâmetro porque é lei, e
 * lei muda: o dia em que o limite subir não pode exigir recompilar o motor.
 */
export const MONTHLY_EXEMPTION_BRL = '20000.00';

/** FII é 20%; ação e ETF de índice são 15% no swing trade. */
export const DEFAULT_TAX_RATES: Readonly<Record<TaxableClass, string>> = {
  stock: '15',
  fii: '20',
  etf: '15',
};

/**
 * Só ação tem isenção por valor de venda. FII nunca é isento, mesmo com venda
 * de cem reais no mês, e ETF de índice também não — é a confusão mais comum, e
 * a que mais aparece como imposto não pago.
 */
export const EXEMPT_CLASSES: readonly TaxableClass[] = ['stock'];

export type TaxableSale = {
  readonly transaction_id: string | null;
  /** `YYYY-MM-DD`: o mês de apuração sai daqui. */
  readonly trade_date: string;
  readonly asset_class: TaxableClass;
  /** Valor da venda, que é o que conta para o limite de isenção. */
  readonly proceeds: string;
  /** Lucro ou prejuízo da venda, já líquido das taxas da operação. */
  readonly result: string;
};

export type TaxPolicy = {
  readonly monthly_exemption_brl?: string | undefined;
  readonly rates?: Readonly<Partial<Record<TaxableClass, string>>> | undefined;
  readonly exempt_classes?: readonly TaxableClass[] | undefined;
};

export type TaxMonth = {
  readonly year: number;
  readonly month: number;
  readonly asset_class: TaxableClass;
  readonly sales_total: string;
  readonly gross_result: string;
  readonly exempt: boolean;
  /** Prejuízo anterior consumido por este mês. */
  readonly loss_offset: string;
  readonly taxable_base: string;
  readonly tax_rate: string;
  readonly tax_due: string;
  /** Saldo de prejuízo que segue para o mês seguinte, e atravessa o ano. */
  readonly loss_carried_forward: string;
};

/**
 * A venda com o que a apuração do mês decidiu sobre ela. É o que
 * `realized_result` guarda nas colunas `exempt` e `loss_offset`.
 */
export type TaxedSale = TaxableSale & {
  readonly exempt: boolean;
  readonly loss_offset: string;
};

export type TaxLedger = {
  readonly months: readonly TaxMonth[];
  readonly sales: readonly TaxedSale[];
  /** O saldo de prejuízo por classe no fim da série. */
  readonly loss_balance: Readonly<Record<TaxableClass, string>>;
};

const MONEY_DP = 2;
const zero = new Decimal(0);

const money = (value: Decimal): string =>
  value.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP);

const monthKey = (sale: TaxableSale): string =>
  `${sale.trade_date.slice(0, 7)}:${sale.asset_class}`;

type Bucket = {
  readonly year: number;
  readonly month: number;
  readonly asset_class: TaxableClass;
  readonly sales: TaxableSale[];
};

/**
 * Agrupa por mês e classe preservando a ordem cronológica. A ordem importa: o
 * prejuízo de janeiro só pode reduzir a base de março se março for processado
 * depois, e o saldo de prejuízo atravessa o ano.
 */
const bucketize = (sales: readonly TaxableSale[]): Bucket[] => {
  const buckets = new Map<string, Bucket>();

  for (const sale of sales) {
    const key = monthKey(sale);
    const existing = buckets.get(key);

    if (existing === undefined) {
      buckets.set(key, {
        year: Number(sale.trade_date.slice(0, 4)),
        month: Number(sale.trade_date.slice(5, 7)),
        asset_class: sale.asset_class,
        sales: [sale],
      });
      continue;
    }

    existing.sales.push(sale);
  }

  return [...buckets.values()].sort((left, right) => {
    if (left.year !== right.year) return left.year - right.year;
    if (left.month !== right.month) return left.month - right.month;
    return left.asset_class < right.asset_class ? -1 : 1;
  });
};

/**
 * O prejuízo compensado pelo mês é um número só, e `realized_result` guarda um
 * por venda. A divisão é proporcional ao lucro de cada venda, com a sobra de
 * centavo na última: a soma das partes é exatamente o total compensado, que é a
 * única propriedade que precisa valer.
 */
const spreadOffset = (
  sales: readonly TaxableSale[],
  offset: Decimal,
  exempt: boolean,
): TaxedSale[] => {
  const profitable = sales.filter((sale) => new Decimal(sale.result).isPositive());

  const profit = profitable.reduce(
    (total, sale) => total.plus(new Decimal(sale.result)),
    zero,
  );

  if (offset.isZero() || profit.isZero()) {
    return sales.map((sale) => ({ ...sale, exempt, loss_offset: '0.00' }));
  }

  // A chave é a posição na lista, não o id do lançamento: duas vendas podem
  // chegar sem id — numa prévia, por exemplo — e colidiriam num mapa por id.
  const shares = sales.map(() => zero);
  let assigned = zero;
  let remaining = profitable.length;

  sales.forEach((sale, index) => {
    if (!new Decimal(sale.result).isPositive()) return;

    remaining -= 1;

    const share =
      remaining === 0
        ? offset.minus(assigned)
        : offset
            .times(new Decimal(sale.result))
            .dividedBy(profit)
            .toDecimalPlaces(MONEY_DP);

    assigned = assigned.plus(share);
    shares[index] = share;
  });

  return sales.map((sale, index) => ({
    ...sale,
    exempt,
    loss_offset: money(shares[index] ?? zero),
  }));
};

/**
 * A apuração completa: um registro por mês e classe, as vendas anotadas com o
 * que o mês decidiu, e o saldo de prejuízo que segue.
 */
export const taxLedger = (
  sales: readonly TaxableSale[],
  policy: TaxPolicy = {},
): TaxLedger => {
  const exemption = new Decimal(policy.monthly_exemption_brl ?? MONTHLY_EXEMPTION_BRL);
  const exemptClasses = new Set(policy.exempt_classes ?? EXEMPT_CLASSES);
  const rates = { ...DEFAULT_TAX_RATES, ...policy.rates };

  const balance = new Map<TaxableClass, Decimal>(
    TAXABLE_CLASSES.map((asset_class) => [asset_class, zero]),
  );

  const months: TaxMonth[] = [];
  const taxed: TaxedSale[] = [];

  for (const bucket of bucketize(sales)) {
    const salesTotal = bucket.sales.reduce(
      (total, sale) => total.plus(new Decimal(sale.proceeds)),
      zero,
    );
    const grossResult = bucket.sales.reduce(
      (total, sale) => total.plus(new Decimal(sale.result)),
      zero,
    );

    const exempt =
      exemptClasses.has(bucket.asset_class) &&
      salesTotal.lessThanOrEqualTo(exemption) &&
      !salesTotal.isZero();

    const carried = balance.get(bucket.asset_class) ?? zero;
    const rate = new Decimal(rates[bucket.asset_class]);

    // Mês isento não gera prejuízo compensável: a operação que não é tributada
    // também não dá direito a abater nada depois. É a assimetria da regra, e
    // esquecê-la infla o saldo de prejuízo ano após ano.
    if (exempt) {
      months.push({
        year: bucket.year,
        month: bucket.month,
        asset_class: bucket.asset_class,
        sales_total: money(salesTotal),
        gross_result: money(grossResult),
        exempt: true,
        loss_offset: '0.00',
        taxable_base: '0.00',
        tax_rate: rate.toFixed(2),
        tax_due: '0.00',
        loss_carried_forward: money(carried),
      });

      taxed.push(...spreadOffset(bucket.sales, zero, true));
      continue;
    }

    if (!grossResult.isPositive()) {
      const updated = carried.plus(grossResult.abs());
      balance.set(bucket.asset_class, updated);

      months.push({
        year: bucket.year,
        month: bucket.month,
        asset_class: bucket.asset_class,
        sales_total: money(salesTotal),
        gross_result: money(grossResult),
        exempt: false,
        loss_offset: '0.00',
        taxable_base: '0.00',
        tax_rate: rate.toFixed(2),
        tax_due: '0.00',
        loss_carried_forward: money(updated),
      });

      taxed.push(...spreadOffset(bucket.sales, zero, false));
      continue;
    }

    const offset = Decimal.min(carried, grossResult);
    const base = grossResult.minus(offset);
    const remaining = carried.minus(offset);

    balance.set(bucket.asset_class, remaining);

    months.push({
      year: bucket.year,
      month: bucket.month,
      asset_class: bucket.asset_class,
      sales_total: money(salesTotal),
      gross_result: money(grossResult),
      exempt: false,
      loss_offset: money(offset),
      taxable_base: money(base),
      tax_rate: rate.toFixed(2),
      tax_due: money(base.times(rate).dividedBy(100)),
      loss_carried_forward: money(remaining),
    });

    taxed.push(...spreadOffset(bucket.sales, offset, false));
  }

  return {
    months,
    sales: taxed,
    loss_balance: Object.fromEntries(
      TAXABLE_CLASSES.map((asset_class) => [
        asset_class,
        money(balance.get(asset_class) ?? zero),
      ]),
    ) as Record<TaxableClass, string>,
  };
};

/** O mapa que `realized_result` usa para gravar `exempt` e `loss_offset`. */
export const annotationsByTransaction = (
  ledger: TaxLedger,
): ReadonlyMap<string, { readonly exempt: boolean; readonly loss_offset: string }> => {
  const annotations = new Map<
    string,
    { readonly exempt: boolean; readonly loss_offset: string }
  >();

  for (const sale of ledger.sales) {
    if (sale.transaction_id === null) continue;
    annotations.set(sale.transaction_id, {
      exempt: sale.exempt,
      loss_offset: sale.loss_offset,
    });
  }

  return annotations;
};
