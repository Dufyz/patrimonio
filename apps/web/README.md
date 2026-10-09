# @patrimonio/web — design system e telas

E5 entregou a camada de peças; E6 constrói as telas sobre ela. Três estão de
pé: **Visão geral**, que é onde a aplicação abre, **Posições**, e a **página do
ativo**, que abre das duas. A galeria continua existindo, em `/galeria`, e
continua sendo onde uma mudança no botão aparece antes de aparecer em seis
telas.

```bash
pnpm --filter @patrimonio/web dev     # Visão geral em http://localhost:5173
pnpm --filter @patrimonio/web test
```

| Endereço                    | O que é                                          |
| --------------------------- | ------------------------------------------------ |
| `/:carteira/visao-geral`    | T-01 · quanto eu tenho hoje, e o que precisa de mim |
| `/:carteira/posicoes`       | T-02 · a tabela de tudo que está em carteira     |
| `/todas/visao-geral`        | o mesmo, somando todas as carteiras              |
| `/:carteira/ativo/:apelido` | T-03 · tudo sobre um ativo em um lugar           |
| `/:carteira/movimentacoes`  | T-04 · o extrato do livro, onde se corrige o passado |
| `/galeria`                  | a galeria do design system (E5)                  |

O escopo é o apelido da carteira, não o identificador: `/longo-prazo/posicoes` é
um endereço que alguém cola em outra aba. O apelido do ativo segue a mesma
regra — `/longo-prazo/ativo/itub4` —, e título de banco abre pelo identificador,
porque `CDB-BANCOC-20280614` é chave de banco de dados e não nome de coisa. O
recorte de cada tela — agrupamento, busca, categoria, janela do gráfico, tipo de
lançamento — vai para a query, e o padrão nunca é escrito.

## Onde está cada coisa

| Pasta             | Conteúdo                                                               |
| ----------------- | ---------------------------------------------------------------------- |
| `src/styles.css`  | A camada de token: cor, tipografia, densidade e medida, nos dois temas |
| `src/lib/`        | Toda decisão que não depende de navegador, com teste                   |
| `src/components/` | As peças, finas de propósito: marcação, teclado e aparência            |
| `src/views/`      | As telas, e a galeria do design system                                 |
| `src/api/`        | Os clientes HTTP, validados pelo schema que a `api` usou para montar   |

A divisão entre `lib/` e `components/` é a regra da estratégia de testes: regra
dentro de componente não é testável e não é aceita. Ordenação, agrupamento,
colapso de coluna, resolução de período, codificação do estado na URL,
redução de série, escala de intensidade e casamento de atalho são funções puras
em `lib/`; o componente as chama.

## As decisões que valem conhecer antes de mexer

**Nenhum valor monetário passa por `number`.** O contrato manda dinheiro como
string justamente para isso, e a formatação não desfaz a decisão:
`lib/decimal.ts` separa sinal, move a vírgula e arredonda sobre string. É por
isso que `9.007.199.254.740.993,21` sai exato. A única fronteira em que um valor
vira número é `lib/chart/scale.ts`, e o que sai de lá é coordenada em pixel —
todo valor exibido continua formatado da string original.

**O `web` não soma dinheiro.** Subtotal de grupo, total geral, peso e variação
chegam prontos da `api`. É o que mantém o subtotal correto quando "mostrar mais"
esconde nove das catorze linhas: ele nunca dependeu das linhas visíveis.

**Zero é um dado; ausência não é.** `R$ 0,00` e `—` são coisas diferentes em
toda a aplicação, e confundi-las faz a tela mentir sem dizer nada falso. Mesma
regra no gráfico: buraco na série aparece como buraco, nunca como interpolação.

**Toda cor sai de token semântico.** `category.color_token` guarda `class.acoes`
e `lib/tokens.ts` é a única tradução para `var(--color-...)`. Uma regra de lint
recusa cor literal em `components/` e `views/`. O `@theme` do Tailwind é
`static` porque as cores de classe são lidas em tempo de execução, e sem isso o
compilador podava justamente as que nenhuma classe utilitária menciona.

**A preferência de tema tem três valores; o documento conhece dois.** `system` é
resolvido em JavaScript antes da primeira pintura, por um script embutido no
`index.html` que tem teste comparando a decisão dele com a de `lib/theme.ts`.

## T-02 · Posições

A tela é uma pergunta só — o que eu tenho —, e tudo nela existe para respondê-la
mais depressa. Três decisões valem conhecer:

**Nenhum filtro é aplicado no navegador.** Busca, categoria e agrupamento vão
para a `api`. Filtrar aqui seria mais rápido de escrever e quebraria o subtotal
na primeira pastilha clicada: o grupo somado lá passaria a descrever linhas que
a tela escondeu.

**Grupo não responde por retorno.** Valor, custo, resultado e peso somam; a
variação do dia e o retorno de doze meses, não. A média ponderada de variações
só valeria sem aporte nem resgate no período, e aporte no meio do mês é a regra.
O retorno correto de um conjunto sai da série de cota (C-07), que existe por
carteira — então o cabeçalho o traz, e o subtotal de grupo mostra traço.

**A linha abre embaixo dela mesma.** Conferir uma posição quase sempre significa
compará-la com as vizinhas, e sair da tela para isso perde o lugar. A página
inteira do ativo é T-03; o que abre aqui é o que cabe em seis números.

## T-03 · Página do ativo

A tela responde a pergunta seguinte à de Posições, e ela é de decisão: vale
manter, aumentar ou sair. A prancha 06 organiza a resposta em duas alturas — em
cima o imediato (quanto tenho, quanto vale, como o preço andou), embaixo o
contexto (de onde vem a renda, o que já foi lançado, o que o papel é) —, e
`views/asset.tsx` segue essa ordem.

**Um pedido entrega a tela inteira.** `GET /api/assets/:asset_id/page` traz
posição, preço, série, proventos por mês, lançamentos, cadastro e eventos.
Cinco rotas costuradas aqui dariam cinco momentos em que metade da tela está
pronta, e o orçamento de consultas (T-11) é por rota.

**A série do gráfico é a ajustada por evento.** É a única da aplicação que é:
`asset_price` guarda o preço como foi negociado, e é ele que todo cálculo de
patrimônio usa. Sem o ajuste, um desdobramento 1:2 apareceria no gráfico como
uma queda de 50% que não aconteceu (M-15), e as marcas de compra — que estão em
preço negociado — ficariam no lugar errado da escala. A legenda diz quando a
janela tem evento aplicado.

**Amortização não é rendimento.** Ela aparece como fatia própria na grade de
proventos e entra no total recebido, porque é dinheiro que entrou; e fica fora
do yield sobre custo e do retorno "com proventos", porque é devolução de capital
(L-08).

**Ausência continua não sendo zero.** Papel nunca vendido não mostra "resultado
realizado R$ 0,00" — a linha some, porque o zero leria como "vendi e não ganhei
nada". Posição zerada diz que está zerada em vez de mostrar seis zeros, e a
frase é diferente da de quem nunca teve fechamento: as duas mandam procurar o
problema em lugares diferentes.

O `SeriesChart` ganhou duas coisas que só esta tela usa, e que a prancha pede:
**marca** sobre a linha (a compra e a venda de quem olha) e **referência**
horizontal (o preço médio). Nenhuma das duas é série: elas não têm valor em
toda data, e entrar na legenda como controle faria "esconder a série" esconder
a linha inteira. Elas aparecem na legenda como explicação, não como botão.

## T-04 · Movimentações

O extrato do livro de lançamentos. A pergunta da tela não é "quanto tenho", é
"o que aconteceu, e o que cada lançamento mudou" — e a coluna **Efeito** é a
razão de ela existir: preço médio de antes e de depois, resultado realizado,
isenção, de onde veio o dinheiro.

**O Efeito vem do mesmo motor do recálculo.** `GET /api/statement` refaz o livro
de cada ativo que aparece na página com `ledgerEffects` (`packages/calc`), que é
o passo-a-passo de `applyLedger`, e não uma conta paralela. Um "PM depois" que
diferisse de Posições por um centavo seria um extrato que não confere. São duas
consultas por pedido: a página com todos os agregados, e o livro dos ativos.

**Todo agregado vem pronto.** Resumo do período, subtotal de mês e contagem de
cada pastilha são somados pela `api` sob o filtro, e é por isso que o subtotal
de setembro continua certo quando setembro atravessa duas páginas. As pastilhas
contam sob os *outros* filtros: contar sob o tipo já escolhido zeraria todas as
demais no primeiro clique.

**Excluir oferece desfazer, não confirma.** O aviso diz que o recálculo foi
enfileirado e o botão vale pela janela `UNDO_WINDOW_SECONDS`. Nada é otimista: a
linha só muda quando a `api` confirma, e enquanto houver carteira recalculando a
tela relê sozinha a cada poucos segundos.

Em T-04, mais quatro, contra a prancha 07:

- **A barra de lote não soma "compras 4.721,00".** O web não faz aritmética com
  dinheiro; ela diz o que a seleção contém ("2 compras"). Se a soma da seleção
  for necessária, ela entra na `api`.
- **"Recategorizar" do backlog virou "Mover para carteira"**, que é o que a
  prancha desenha e o único campo que o lote edita de fato; categoria é do
  ativo, não do lançamento.
- **Editar e Duplicar aparecem desabilitados**, com a história na dica: o
  formulário com preview é T-10.
- **Exportar CSV** está na barra de lote e exporta a seleção da página, com `;`
  e vírgula decimal. A exportação completa do recorte é O-06.

## Divergências registradas

A arquitetura declarava **TanStack Table** e **Recharts**. Nenhum dos dois está
aqui, e o motivo é o mesmo nos dois casos: o recurso central da biblioteca
colide com uma regra do projeto.

- **TanStack Table** resolve agrupamento calculando a agregação no cliente. Aqui
  o subtotal vem da `api`, e a parte que sobraria — estado de ordenação e
  visibilidade de coluna — é menor que a adaptação. O modelo de linhas está em
  `lib/table/model.ts`, com teste.
- **Recharts** não desenha buraco em área empilhada: um `null` no meio da pilha
  vira zero e o gráfico mostra uma queda que não existe. Como são quatro formas
  cartesianas simples e as exigências de dica, legenda e desempenho são
  específicas, o SVG é próprio — cerca de 600 linhas, contra a mesma ordem de
  grandeza em configuração e contorno.

Voltar atrás é contido: os gráficos estão atrás de `SeriesChart` e
`MonthlyBarsChart`, e a tabela atrás de `DataTable`.

Em T-02, mais quatro, todas contra a prancha 05:

- **A coluna `Dia`** não está na prancha e está aqui: o backlog pede variação do
  dia entre as colunas de T-02, e ela cabe ao lado de `Rent. 12M` sem disputar
  espaço com nada — as duas somem juntas abaixo de 1400 px.
- **O cabeçalho não é o `OverviewHeader` de D-05**, e sim a faixa compacta que a
  prancha 05 desenha. D-05 lista Posições entre as telas que o reusam; a prancha
  da tela, que é a especificação de layout, mostra outra coisa, e ela ganha.
- **O botão de exportar CSV da prancha não está aqui.** A exportação é O-06, em
  E7, e um botão que não exporta nada é pior que um botão a menos.
- **Lançar compra, provento e transferência aparecem desabilitados**, com a
  história que os entrega na própria dica. O formulário com preview é T-10, e
  fingir que a ação existe custa mais confiança do que dizer que ela não existe.

Em T-03, mais três, contra a prancha 06:

- **Os três blocos de baixo não dividem a largura em partes iguais.** O do meio
  é uma tabela de quatro colunas; os outros dois são um gráfico de barras e uma
  lista de pares. Em partes iguais a tabela cortava o valor, que é a coluna que
  ninguém abre a tela para não ver. A altura continua igual, que é o que O-10
  cobra.
- **"A receber" não ocupa coluna na lista de lançamentos.** A prancha o mostra
  no bloco de Proventos, que é onde a pergunta "o que ainda vai cair" é feita,
  e é lá que ele está; na lista, a linha inteira o diz na dica.
- **"Editar ativo" e "Mover entre carteiras" aparecem desabilitados**, com a
  história que os entrega na dica, pela razão de T-02: o formulário é T-10, e
  fingir que a ação existe custa mais confiança do que dizer que ela não existe.
  O preço manual, que é L-14, está de pé.

Duas coisas que a prancha 06 mostra e o design system não tinha entraram como
peça, em vez de como marcação solta nesta tela: a **marca** e a **referência**
do `SeriesChart`, e a opção `bare` de `formatMoney` — o valor com casas, milhar
e sinal, sem o `R$`, para a coluna que é inteira de reais e já diz isso no
cabeçalho.

Dois defeitos apareceram ao montar a tela e foram corrigidos onde estavam, e
não contornados aqui:

- `MonthlyBarsChart` usava o rótulo como chave de lista. O eixo de doze meses
  desta tela é a inicial de cada um, e `M`, `J` e `A` aparecem duas vezes —
  React descartava a segunda barra de cada par.
- `SeriesChart` sempre acrescentava uma etiqueta no último ponto do eixo. Quando
  o passo não caía exatamente nele, a etiqueta anterior ficava a meio passo de
  distância e as duas se imprimiam uma sobre a outra.

A etapa de largura da tabela densa passou a medir **a janela**, e não o
contêiner. A prancha 18 as define como consulta de mídia, e medir o elemento
escondia três colunas num monitor de 1440 px: a barra lateral e o respiro do
conteúdo comem trezentos deles, e a etapa de 1400 disparava com a tela inteira à
vista. O gráfico continua medindo o próprio elemento, que é mesmo sobre o espaço
que ele tem.

## Larguras

As colunas secundárias somem em etapas, como a prancha 18 define, em vez de a
tabela rolar na horizontal ou o texto quebrar em duas linhas.

| Largura   | O que muda                                           |
| --------- | ---------------------------------------------------- |
| < 1400 px | Somem preço médio, dia, rentabilidade e detalhe      |
| < 1240 px | A barra lateral colapsa para ícones                  |
| < 1100 px | Somem preço e resultado                              |
| < 1000 px | A barra lateral vira gaveta; somem quantidade e peso |
| < 600 px  | Só o que é essencial                                 |

## Atalhos

A lista está em `lib/shortcuts.ts` e a tela de ajuda (`?`) é gerada dela — uma
ajuda escrita à mão desatualiza no primeiro atalho novo. Navegação é sequência
de duas teclas (`G` e depois `P`), não modificador, porque `⌘P` já tem dono no
navegador. Nenhum atalho de letra dispara com o foco em campo de texto.
