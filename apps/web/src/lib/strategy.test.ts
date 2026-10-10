import type { AllocationResource } from '@patrimonio/contracts';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_DRAFT,
  barPosition,
  barScale,
  buildBody,
  editableRows,
  fieldError,
  fromPercent,
  groupTotal,
  inputText,
  isZeroDecimal,
  parseAmount,
  saveState,
  targetLabel,
  toHundredths,
  toPercentString,
  toleranceBand,
  withEdit,
} from './strategy.js';

type Node = AllocationResource['composition']['nodes'][number];

const line = (
  id: string,
  name: string,
  current: string,
  target: string | null,
  extra: Partial<Node> = {},
): Node => ({
  id,
  name,
  color_token: `class.${id}`,
  level: 'category',
  value: '0.00',
  current_pct: current,
  target_pct: target,
  deviation_pp: null,
  over_tolerance: false,
  amount_to_move: null,
  target_value: null,
  children: [],
  ...extra,
});

/** A carteira da prancha 09: dois grupos e o Caixa na raiz. */
const nodes: readonly Node[] = [
  line('rv', 'Renda variável', '59.40', '60.00', {
    level: 'group',
    children: [
      line('acoes', 'Ações', '35.30', '35.00') as never,
      line('fiis', 'FIIs', '24.10', '25.00') as never,
    ],
  }),
  line('rf', 'Renda fixa', '38.30', '37.00', {
    level: 'group',
    children: [
      line('inflacao', 'Inflação', '25.40', '25.00') as never,
      line('prefixada', 'Prefixada', '13.00', '12.00') as never,
      line('posfixada', 'Pós-fixada', '0.00', '0.00') as never,
    ],
  }),
  line('caixa', 'Caixa', '2.30', '3.00'),
];

const rows = editableRows(nodes);

describe('texto digitado → centésimos', () => {
  it('lê inteiro, vírgula e ponto, com até duas casas', () => {
    expect(toHundredths('35')).toBe(3500);
    expect(toHundredths('12,5')).toBe(1250);
    expect(toHundredths('12.25')).toBe(1225);
    expect(toHundredths('0')).toBe(0);
    expect(toHundredths('100')).toBe(10_000);
    expect(toHundredths(' 35 % ')).toBe(3500);
  });

  it('campo vazio é zero: apagar é "esta categoria não tem alvo"', () => {
    expect(toHundredths('')).toBe(0);
    expect(toHundredths('   ')).toBe(0);
  });

  it('recusa o que não é um percentual de 0 a 100 com duas casas', () => {
    for (const text of ['abc', '-5', '101', '100,01', '12,345', '1e2', '35%%', '1,2,3']) {
      expect(toHundredths(text), text).toBeNull();
    }
  });

  it('a mensagem de erro fica no campo', () => {
    expect(fieldError('35')).toBeNull();
    expect(fieldError('abc')).toMatch(/0 a 100/);
  });

  it('a `api` e o campo falam a mesma língua nos dois sentidos', () => {
    expect(fromPercent('35.00')).toBe(3500);
    expect(fromPercent('12.50')).toBe(1250);
    expect(fromPercent(null)).toBe(0);
    expect(toPercentString(3500)).toBe('35.00');
    expect(toPercentString(1205)).toBe('12.05');
    expect(inputText(3500)).toBe('35');
    expect(inputText(1250)).toBe('12,5');
    expect(inputText(1205)).toBe('12,05');
    expect(targetLabel(6000)).toBe('60%');
  });
});

describe('as linhas editáveis', () => {
  it('são as categorias — dos grupos e da raiz —, nunca o grupo', () => {
    expect(rows.map((row) => row.id)).toEqual([
      'acoes',
      'fiis',
      'inflacao',
      'prefixada',
      'posfixada',
      'caixa',
    ]);
    expect(rows.find((row) => row.id === 'acoes')).toMatchObject({
      saved: 3500,
      groupId: 'rv',
      colorToken: 'class.acoes',
    });
    expect(rows.find((row) => row.id === 'caixa')?.groupId).toBeNull();
  });

  it('ativo sem categoria não recebe alvo', () => {
    const comSemCategoria = editableRows([
      ...nodes,
      line('sem-categoria', 'Sem categoria', '1.00', null),
    ]);

    expect(comSemCategoria.map((row) => row.id)).not.toContain('sem-categoria');
  });

  it('sem estratégia, todo alvo salvo é zero', () => {
    const semAlvo = editableRows([line('a', 'A', '100.00', null)]);

    expect(semAlvo[0]?.saved).toBe(0);
  });
});

describe('a barra de salvar', () => {
  it('sem alteração não há o que salvar', () => {
    const state = saveState(rows, EMPTY_DRAFT);

    expect(state).toMatchObject({
      changed: 0,
      canSave: false,
      blocked: false,
      total: 10_000,
    });
  });

  it('trocar 35/25 por 30/30 fecha 100% e pode salvar', () => {
    let draft = withEdit(rows, EMPTY_DRAFT, 'acoes', '30');
    draft = withEdit(rows, draft, 'fiis', '30');

    expect(saveState(rows, draft)).toMatchObject({
      changed: 2,
      total: 10_000,
      canSave: true,
      blocked: false,
      message: '2 alterações não salvas',
    });
  });

  it('soma 96% trava o salvamento e aponta a diferença', () => {
    // Ações de 35 para 31: a prancha 18 mostra exatamente esta barra.
    const state = saveState(rows, withEdit(rows, EMPTY_DRAFT, 'acoes', '31'));

    expect(state.total).toBe(9600);
    expect(state.canSave).toBe(false);
    expect(state.blocked).toBe(true);
    expect(state.message).toBe('Soma 96% · faltam 4 pp para salvar');
  });

  it('soma acima de 100% diz que passou, não que faltou', () => {
    const state = saveState(rows, withEdit(rows, EMPTY_DRAFT, 'acoes', '40'));

    expect(state.message).toBe('Soma 105% · passou 5 pp para salvar');
    expect(state.canSave).toBe(false);
  });

  it('a diferença com casa decimal aparece inteira', () => {
    const state = saveState(rows, withEdit(rows, EMPTY_DRAFT, 'acoes', '34,5'));

    expect(state.message).toBe('Soma 99,5% · faltam 0,5 pp para salvar');
  });

  it('soma com casas decimais fecha sem derivar para ponto flutuante', () => {
    // 35,1 + 24,9 não é garantidamente 60 em ponto flutuante; em centésimos é.
    let draft = withEdit(rows, EMPTY_DRAFT, 'acoes', '35,1');
    draft = withEdit(rows, draft, 'fiis', '24,9');

    expect(saveState(rows, draft)).toMatchObject({ total: 10_000, canSave: true });
  });

  it('campo inválido trava e diz quantos corrigir', () => {
    const um = saveState(rows, withEdit(rows, EMPTY_DRAFT, 'acoes', 'abc'));
    expect(um).toMatchObject({ canSave: false, invalid: ['acoes'], total: null });
    expect(um.message).toBe('Corrija 1 campo para salvar');

    let dois = withEdit(rows, EMPTY_DRAFT, 'acoes', 'abc');
    dois = withEdit(rows, dois, 'fiis', '-1');
    expect(saveState(rows, dois).message).toBe('Corrija 2 campos para salvar');
  });

  it('digitar de volta o valor salvo desfaz a alteração', () => {
    const draft = withEdit(rows, EMPTY_DRAFT, 'acoes', '30');
    expect(Object.keys(draft)).toEqual(['acoes']);

    const desfeito = withEdit(rows, draft, 'acoes', '35');
    expect(desfeito).toEqual({});
    expect(saveState(rows, desfeito).changed).toBe(0);
  });

  it('digitar "35,00" também desfaz: o que vale é o número, não o texto', () => {
    expect(withEdit(rows, { acoes: '30' }, 'acoes', '35,00')).toEqual({});
  });

  it('zerar tudo é permitido e avisa que remove a estratégia', () => {
    let draft: Record<string, string> = {};
    for (const row of rows) draft = { ...draft, [row.id]: '0' };

    const state = saveState(rows, draft);

    expect(state.total).toBe(0);
    expect(state.canSave).toBe(true);
    expect(state.message).toMatch(/remove a estratégia/);
    expect(buildBody(rows, draft).targets).toEqual([]);
  });
});

describe('o grupo é a soma das categorias digitadas', () => {
  it('sem edição é a soma do que está salvo', () => {
    expect(groupTotal(rows, EMPTY_DRAFT, 'rv')).toBe(6000);
    expect(groupTotal(rows, EMPTY_DRAFT, 'rf')).toBe(3700);
  });

  it('acompanha o que está sendo digitado', () => {
    expect(groupTotal(rows, { acoes: '30', fiis: '30' }, 'rv')).toBe(6000);
    expect(groupTotal(rows, { acoes: '40' }, 'rv')).toBe(6500);
  });

  it('um campo inválido no grupo deixa o subtotal indefinido, não zero', () => {
    expect(groupTotal(rows, { acoes: 'x' }, 'rv')).toBeNull();
  });
});

describe('o corpo do PUT', () => {
  it('manda as categorias com alvo, em duas casas, e deixa de fora as de alvo zero', () => {
    expect(buildBody(rows, EMPTY_DRAFT)).toEqual({
      targets: [
        { category_id: 'acoes', target_pct: '35.00' },
        { category_id: 'fiis', target_pct: '25.00' },
        { category_id: 'inflacao', target_pct: '25.00' },
        { category_id: 'prefixada', target_pct: '12.00' },
        { category_id: 'caixa', target_pct: '3.00' },
      ],
    });
  });

  it('leva o que foi digitado no lugar do salvo', () => {
    const body = buildBody(rows, { posfixada: '5', prefixada: '7' });
    const alvo = (id: string) =>
      body.targets.find((target) => target.category_id === id)?.target_pct;

    expect(alvo('posfixada')).toBe('5.00');
    expect(alvo('prefixada')).toBe('7.00');
  });

  it('categoria que ficou em zero sai do corpo: o banco exige alvo acima de zero', () => {
    const body = buildBody(rows, { caixa: '0', acoes: '38' });

    expect(body.targets.map((target) => target.category_id)).not.toContain('caixa');
  });
});

describe('geometria das barras', () => {
  it('o fundo é o maior valor, arredondado para cima de dez em dez', () => {
    expect(barScale(nodes)).toBe(40);
    expect(barScale([line('a', 'A', '8.00', '9.00')])).toBe(10);
    expect(barScale([line('a', 'A', '40.00', '41.00')])).toBe(50);
    expect(barScale([])).toBe(10);
  });

  it('o alvo maior que o atual também define o fundo', () => {
    expect(barScale([line('a', 'A', '5.00', '55.00')])).toBe(60);
  });

  it('a posição fica presa entre 0 e 100', () => {
    expect(barPosition('20.00', 40)).toBe(50);
    expect(barPosition('0.00', 40)).toBe(0);
    expect(barPosition('90.00', 40)).toBe(100);
    expect(barPosition(null, 40)).toBe(0);
    expect(barPosition('-3', 40)).toBe(0);
  });

  it('a faixa de tolerância cerca o alvo', () => {
    // Alvo 20 ± 4 sobre um fundo de 40: de 16 a 24, ou de 40% a 60% da barra.
    expect(toleranceBand('20.00', '4.00', 40)).toEqual({ left: 40, width: 20 });
  });

  it('a faixa não passa do começo nem do fim da barra', () => {
    expect(toleranceBand('2.00', '5.00', 40)).toEqual({ left: 0, width: 17.5 });
    expect(toleranceBand('39.00', '5.00', 40)).toEqual({ left: 85, width: 15 });
  });

  it('sem alvo ou sem tolerância não há faixa', () => {
    expect(toleranceBand(null, '3.00', 40)).toBeNull();
    expect(toleranceBand('20.00', '0.00', 40)).toBeNull();
  });
});

describe('valor do aporte', () => {
  it('lê os jeitos de escrever dinheiro em pt-BR', () => {
    expect(parseAmount('4000')).toBe('4000');
    expect(parseAmount('4000,50')).toBe('4000.50');
    expect(parseAmount('4.000,50')).toBe('4000.50');
    expect(parseAmount('4.000')).toBe('4000');
    expect(parseAmount('4000.5')).toBe('4000.5');
    expect(parseAmount('R$ 1.234.567,89')).toBe('1234567.89');
  });

  it('zero, negativo, vazio e texto não têm o que sugerir', () => {
    for (const text of ['', '0', '0,00', '-10', 'abc', '1,234', '12,3,4']) {
      expect(parseAmount(text), text).toBeNull();
    }
  });
});

describe('zero', () => {
  it('não tem direção: nenhuma forma de zero é positiva nem negativa', () => {
    for (const zero of ['0', '0.00', '-0.00', '+0.0'])
      expect(isZeroDecimal(zero), zero).toBe(true);
    for (const other of ['0.01', '-1.00', '10', '', null])
      expect(isZeroDecimal(other), String(other)).toBe(false);
  });
});
