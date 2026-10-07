# Patrimônio

Organização patrimonial e de investimentos, para uso pessoal. Monorepo em
TypeScript com três apps — `api`, `worker` e `web` — e dez pacotes por camada.

O lançamento é a única verdade. Posição, saldo, cota e resultado são projeções
recalculáveis: podem ser apagadas e reconstruídas sem perda de informação.

## Começando

Pré-requisitos: Node 22, pnpm 10 e Docker.

```bash
cp .env.example .env     # packages/env valida tudo no boot
pnpm install
pnpm infra:up            # Postgres (5433), Postgres de teste (5434) e Redis (6380)
pnpm migrate up          # cria o schema; a api também faz isso no boot
pnpm seed:business-days  # calendário da B3, 2000–2035
pnpm dev                 # api :3333, worker e web :5173
```

| Endereço                                 | O que é                               |
| ---------------------------------------- | ------------------------------------- |
| `http://localhost:5173`                  | A web                                 |
| `http://localhost:3333/api/health-check` | Postgres, Redis e o último fechamento |
| `http://localhost:3333/api/docs`         | OpenAPI em Swagger UI                 |
| `http://localhost:3333/api/queues`       | Bull Board                            |

Nada aqui é exposto na internet. Não há autenticação porque não há o que
autenticar: ela entra na Fase 2, junto com a publicação.

## Comandos

| Comando                                   | O que faz                                          |
| ----------------------------------------- | -------------------------------------------------- |
| `pnpm dev`                                | Sobe api, worker e web ao mesmo tempo              |
| `pnpm build`                              | `turbo build`, reconstruindo só o afetado          |
| `pnpm lint`                               | ESLint em todos os pacotes                         |
| `pnpm typecheck`                          | Regra de camada + `tsc --noEmit` em todos          |
| `pnpm test`                               | Vitest, contra Postgres e Redis reais              |
| `pnpm format`                             | Prettier                                           |
| `pnpm verify`                             | Lint, typecheck e testes, na ordem do CI           |
| `pnpm migrate [up \| down [n] \| status]` | Runner de migration; `--test` usa o banco de teste |
| `pnpm infra:up` / `infra:reset`           | Sobe o ambiente / apaga os volumes e recria        |

## Estrutura

```text
apps/
  api/      Express. Valida, roda casos de uso e grava o pedido na outbox
  worker/   Relay da outbox, as seis filas e os jobs
  web/      SPA em Vite, consumindo a api por HTTP
packages/
  env/        Fonte única das variáveis de ambiente, validadas por zod no boot
  shared/     Either, o gerador `either` e o scrub do log. Sem dependência
  domain/     Tipos, enums, parsers e a máquina de estados do pipeline
  calc/       O motor financeiro: puro, sem banco, sem HTTP, sem relógio (E3)
  contracts/  O contrato HTTP em zod, compartilhado com o web
  application/Casos de uso, interfaces e a hierarquia de erros
  db/         Conexão, repositórios, migrations e o runner
  queue/      Conexão Redis, declaração das filas e `dispatch`
  market/     Provedores de cotação, índice e Tesouro (E4)
  exporter/   CSV e JSON da exportação (E7)
```

### A regra de dependência

Declarada no `package.json` de cada pacote, não em convenção escrita. Um
`import … from '@patrimonio/db'` dentro de `application` não compila, porque o
`node_modules` isolado do pnpm não o resolve. `scripts/check-layers.ts` roda
antes do `turbo typecheck` e recusa uma dependência que a camada não permite.

`apps/web` declara apenas `contracts` e `domain`. `packages/env` nunca é
importado pelo web.

### Convenções que o código cobra

| Assunto         | Regra                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Dinheiro        | `Decimal` no cálculo, `NUMERIC` no banco, string no transporte. Nunca `number` |
| Data de negócio | `date` no Postgres e string `YYYY-MM-DD` no código, nunca `Date` com fuso      |
| Erros           | `Either`, nunca exceção entre camadas. 4xx não reexecuta, 5xx reexecuta        |
| Dia útil        | Calendário da B3 na tabela `business_day`, não em biblioteca                   |
| Relógio         | Entra como parâmetro. Nenhuma função pura chama `new Date()`                   |
| Log             | `pino` em JSON. Valor monetário, quantidade e nome de ativo nunca entram       |
| Trabalho pesado | Vai para a outbox na mesma transação do estado que o origina                   |

## Testes

Nada de mock de banco: repositório, `apply` e rota rodam contra Postgres real,
no banco da porta 5434. Cada teste roda numa transação que sofre `ROLLBACK` no
final; o que precisa comitar limpa o que escreveu.

```bash
pnpm infra:up
pnpm test
```

O nome do teste descreve o comportamento financeiro, não a função: seis meses
depois, a lista de nomes é a especificação que não desatualiza, porque quebra
quando mente.

## Fase 1 · Fundação

O que está de pé: monorepo e ferramental, `Either`, `env`, hierarquia de erros,
ambiente em container, `packages/db` com unidade de trabalho, runner de
migration com checksum, o schema inteiro das 23 entidades, calendário de dias
úteis, api com middlewares e healthcheck, OpenAPI em Swagger UI, as seis filas,
outbox com coalescência, relay com `SKIP LOCKED`, `defineStage`, os dois
containers de composição, log com correlação e backup cifrado com retenção.

A conferência do calendário contra o arquivo de feriados da ANBIMA e o
calendário de negociação da B3 é o passo que falta: `pnpm holidays:report <ano>`
imprime o ano para comparação, e cada divergência encontrada vira uma linha em
`EXCEPTIONS`, em `packages/db/src/seeds/holidays.ts`.

## Fase 2 · Livro de lançamentos

O livro inteiro, pela API: carteiras com alvo de alocação, instituições com
exposição ao FGC por emissor, categorias em dois níveis com regra automática,
ativos de mercado que nascem no primeiro lançamento e títulos de renda fixa
cadastrados à mão.

Os sete tipos de lançamento gravam, editam e excluem com o efeito calculado
antes de salvar: compra e venda com liquidação sugerida em dia útil, aporte e
resgate sobre um caixa que é ativo sintético por instituição, provento com
quantidade apurada na data-com e recebimento confirmado depois, transferência de
duas pernas que preserva o preço médio, e evento corporativo aplicado só por
confirmação.

Toda escrita aceita `Idempotency-Key`, toda exclusão deixa desfazer por alguns
segundos, e uma linha de texto — `compra 100 itub4 36,84 ontem` — vira
lançamento interpretado antes de virar lançamento gravado.

O preview é o mesmo plano da gravação em modo que não grava: se o número da tela
divergir do que fica salvo, a confiança no app acaba ali.

Enquanto a projeção diária e o preço de mercado não existem, peso e alocação
saem do custo, e a resposta diz isso no campo `basis`. O motor de preço médio
vive em `packages/calc` e cobre compra, venda com resultado realizado,
transferência, evento corporativo e amortização; o resto de `calc` — cota,
marcação na curva, IR e projeção — chega em E3.

O que está declarado e ainda não calcula nada: os estágios `recalc`, `close`,
`market`, `alerts` e `import` atravessam o pipeline e registram que a
implementação chega em E3, E4 e E7. `market` e `exporter` têm só a superfície.
