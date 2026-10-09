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
| `pnpm test:live`                          | Bateria de contrato contra as APIs reais; noturna  |
| `pnpm verify:sources`                     | A mesma bateria, gravando o resultado no banco     |
| `pnpm format`                             | Prettier                                           |
| `pnpm verify`                             | Lint, typecheck e testes, na ordem do CI           |
| `pnpm migrate [up \| down [n] \| status]` | Runner de migration; `--test` usa o banco de teste |
| `pnpm infra:up` / `infra:reset`           | Sobe o ambiente / apaga os volumes e recria        |

## Estrutura

```text
apps/
  api/      Express. Valida, roda casos de uso e grava o pedido na outbox
  worker/   Relay da outbox, as seis filas e os jobs
  web/      SPA em Vite. O design system está em `src/lib` e `src/components` (E5)
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

O que está declarado e ainda não calcula nada: os estágios `alerts` e `import`
atravessam o pipeline e registram que a implementação chega em E7. `exporter` tem
só a superfície.

## Fase 4 · Dados de mercado

As fontes externas, atrás de `MarketDataProvider`: Banco Central para CDI, Selic
e IPCA, Tesouro Direto pelo JSON do site com o CSV do Tesouro Transparente
atrás, brapi para renda variável com um provedor alternativo declarado por
configuração, e o COTAHIST anual da B3 para o histórico. Nenhum caso de uso
conhece o nome de uma fonte: trocar a principal é mudar a ordem da cadeia.

**A regra que governa o pacote inteiro: ausência nunca vira zero.** Um preço zero
gravado por engano zera a posição, e o erro se propaga por toda a série de
`position_daily` até alguém notar meses depois. Papel sem cotação entra em
`missing`, a posição dele vale o custo, e a linha fica marcada.

Preços, índices e Tesouro são coletados no mesmo estágio, e o fechamento do dia
é encadeado pela transição do pipeline. Isso torna estrutural a ordem que
importa: a marcação na curva de um CDB depende do fator do CDI do dia, e fechar
antes dele gravaria o título rendendo zero. Três agendamentos com quinze minutos
de diferença funcionariam na maioria dos dias, e "na maioria dos dias" é o
problema.

Lançar hoje uma compra de 2015 dispara o backfill daquele papel desde 2015, que
busca só os dias úteis sem preço e pede o recálculo ao terminar — é esse último
recálculo que põe a série na tela. Renda fixa de banco não dispara backfill:
nenhuma fonte tem preço dela, e ela é marcada na curva.

Mudança de formato da fonte é erro nomeado, não número errado: `FormatChangedError`
diz qual campo, guarda o trecho recebido e encerra o job em vez de insistir contra
uma API que mudou de contrato. Vírgula por ponto, casa decimal a mais e campo novo
desconhecido são tolerados, porque o valor é o mesmo.

`market_source_run` guarda uma linha por execução por fonte, e é dela que sai a
situação em Configurações: quem respondeu por último, quanto da cota do mês foi
consumido, qual foi a última falha e com que mensagem. `GET /api/market/health`
entrega isso pronto; a tela em si entra em E6, com o design system.

A verificação noturna (`pnpm test:live`) fala com as APIs reais e abre issue
quando o formato muda. Ela não bloqueia commit nem deploy: depende da internet, e
um teste de commit que depende de a brapi estar no ar é um teste que ensina a
equipe a ignorar vermelho. Fonte fora do ar não é notícia; formato mudado é.

## Fase 6 · Telas

A primeira tela de verdade está de pé: **Posições**, a tabela de tudo que está
em carteira hoje. `pnpm dev` abre nela; a galeria do design system continua em
`/galeria`.

`GET /api/positions` entrega a tela pronta em **duas consultas**: uma traz as
linhas, a outra traz tudo que é soma — subtotal por grupo, total geral,
contagem de cada pastilha e o cabeçalho. Duas, e não dez, porque o banco fica em
outra rede.

O que a tela **não** faz é somar. Subtotal, total, peso, resultado e contagem
chegam prontos da `api`, e é o que mantém o subtotal do grupo correto quando
"mostrar mais" esconde nove das catorze linhas: ele nunca dependeu das linhas
visíveis. Filtrar também é da `api`, pela mesma razão — um filtro aplicado no
navegador faria o subtotal descrever linhas que a tela escondeu.

Uma distinção que parece detalhe e não é. A variação do dia e o retorno de doze
meses **de uma linha** saem do valor unitário, que aporte e resgate não
contaminam: comprar mais do mesmo papel muda a quantidade, não o preço. As
mesmas medidas **de um grupo** não existem — a média ponderada de variações só
valeria sem fluxo no período —, e o retorno de um conjunto sai da série de cota,
que é por carteira. Por isso o cabeçalho traz o retorno da carteira e o subtotal
do grupo mostra traço: é a diferença entre não ter o número e inventá-lo.

## Design system

As pranchas de design são a especificação, não referência solta: `01 · Produto`
fixa paleta e tipografia, `03 · Componentes` define cada peça com suas medidas,
`16 · Menus e seletores` define as sobreposições e `18 · Casos limite` define o
que acontece quando falta ou sobra dado.

Tudo que o design system decide está em `apps/web/src/lib`, com teste; o
componente só desenha. Dinheiro continua sendo string do contrato até a tela — a
formatação faz aritmética decimal sobre string, e o `web` não soma: subtotal,
peso e variação chegam prontos da `api`. Zero e ausência são coisas diferentes
em todo lugar, inclusive no gráfico, onde buraco na série aparece como buraco.

Toda cor sai de token semântico, e uma regra de lint recusa cor literal dentro
de um componente. É o que faz Ações ter a mesma cor na tabela, na barra de
alocação e na linha do gráfico, nos dois temas.

A galeria do design system, que é o critério de saída de E5, continua em
`/galeria`: é lá que as peças são conferidas contra as pranchas, e é onde uma
mudança no botão aparece antes de aparecer em seis telas. Detalhes e as
divergências registradas — sem TanStack Table, sem Recharts, e as de T-02 contra
a prancha 05 — estão em `apps/web/README.md`.
