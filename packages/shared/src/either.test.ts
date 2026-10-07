import { describe, expect, it } from 'vitest';

import {
  either,
  eitherSync,
  failure,
  isEither,
  mapFailure,
  mapSuccess,
  mergeMany,
  mergeManyAsync,
  ok,
  partitionEithers,
  success,
} from './either.js';
import { unwrapFailure, unwrapSuccess } from './testing/unwrap.js';

describe('Either', () => {
  it('sucesso carrega o valor e se reconhece como sucesso', () => {
    const result = success(42);

    expect(result.isSuccess()).toBe(true);
    expect(result.isFailure()).toBe(false);
    expect(unwrapSuccess(result)).toBe(42);
  });

  it('falha carrega o valor e se reconhece como falha', () => {
    const result = failure('não achei');

    expect(result.isFailure()).toBe(true);
    expect(result.isSuccess()).toBe(false);
    expect(unwrapFailure(result)).toBe('não achei');
  });

  it('ok é sucesso sem valor', () => {
    expect(ok().isSuccess()).toBe(true);
  });

  it('isEither distingue um Either de um objeto parecido', () => {
    expect(isEither(success(1))).toBe(true);
    expect(isEither(failure(1))).toBe(true);
    expect(isEither({ kind: 'success', value: 1 })).toBe(false);
  });

  it('desembrulhar o lado errado estoura, em vez de passar calado', () => {
    expect(() => unwrapSuccess(failure('x'))).toThrow(/veio falha/);
    expect(() => unwrapFailure(success(1))).toThrow(/veio sucesso/);
  });
});

describe('gerador either', () => {
  it('yield* sobre sucesso devolve o valor e segue o fluxo', async () => {
    const run = either(async function* (start: number) {
      const first = yield* success(start + 1);
      const second = yield* await Promise.resolve(success(first * 2));
      return second + 1;
    });

    expect(unwrapSuccess(await run(1))).toBe(5);
  });

  it('yield* sobre falha encerra a função sem rodar o resto', async () => {
    const steps: string[] = [];

    const run = either(async function* () {
      steps.push('antes');
      const value = yield* failure('parou aqui');
      steps.push('depois');
      return value;
    });

    expect(unwrapFailure(await run())).toBe('parou aqui');
    expect(steps).toEqual(['antes']);
  });

  it('o tipo de erro é a união dos erros de cada passo', async () => {
    const run = either(async function* (which: 'a' | 'b') {
      const first = yield* which === 'a' ? failure({ code: 'A' as const }) : success(1);
      const second = yield* which === 'b' ? failure({ code: 'B' as const }) : success(2);
      return first + second;
    });

    // A união { code: 'A' } | { code: 'B' } é inferida: o acesso a .code compila.
    expect(unwrapFailure(await run('b')).code).toBe('B');
    expect(unwrapFailure(await run('a')).code).toBe('A');
  });

  it('eitherSync compõe sem promessa, para o código puro', () => {
    const run = eitherSync(function* (value: number) {
      const doubled = yield* value > 0 ? success(value * 2) : failure('negativo');
      return doubled;
    });

    expect(unwrapSuccess(run(2))).toBe(4);
    expect(unwrapFailure(run(-1))).toBe('negativo');
  });
});

describe('agregação', () => {
  it('mergeMany devolve a lista de sucessos quando todos passam', () => {
    expect(unwrapSuccess(mergeMany([success(1), success(2), success(3)]))).toEqual([
      1, 2, 3,
    ]);
  });

  it('mergeMany para na primeira falha', () => {
    expect(unwrapFailure(mergeMany([success(1), failure('x'), failure('y')]))).toBe('x');
  });

  it('mergeManyAsync resolve as promessas antes de agregar', async () => {
    const result = await mergeManyAsync([
      Promise.resolve(success(1)),
      Promise.resolve(success(2)),
    ]);

    expect(unwrapSuccess(result)).toEqual([1, 2]);
  });

  it('partitionEithers não descarta nem falha nem sucesso', () => {
    const { failures, successes } = partitionEithers([
      success(1),
      failure('x'),
      success(2),
    ]);

    expect(failures).toEqual(['x']);
    expect(successes).toEqual([1, 2]);
  });
});

describe('mapeamento', () => {
  it('mapSuccess transforma o sucesso e preserva a falha', () => {
    expect(unwrapSuccess(mapSuccess(success(2), (n) => n * 3))).toBe(6);
    expect(
      unwrapFailure(mapSuccess<string, number, number>(failure('x'), (n) => n * 3)),
    ).toBe('x');
  });

  it('mapFailure transforma a falha e preserva o sucesso', () => {
    expect(unwrapFailure(mapFailure(failure('x'), (f) => `erro: ${f}`))).toBe('erro: x');
    expect(unwrapSuccess(mapFailure<string, number, string>(success(2), (f) => f))).toBe(
      2,
    );
  });
});
