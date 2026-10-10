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

| Endereço                    | O que é                                                   |
| --------------------------- | --------------------------------------------------------- |
| `/:carteira/visao-geral`    | T-01 · quanto eu tenho hoje, e o que precisa de mim       |
| `/:carteira/posicoes`       | T-02 · a tabela de tudo que está em carteira              |
| `/:carteira/ativo/:apelido` | T-03 · tudo sobre um ativo em um lugar                    |
| `/:carteira/movimentacoes`  | T-04 · o extrato do livro, onde se corrige o passado      |
| `/:carteira/desempenho`     | T-05 · quanto veio de aporte e quanto de rentabilidade    |
| `/:carteira/estrategia`     | T-06 · o dinheiro está dividido como eu disse que queria? |
| `/:carteira/objetivos`      | T-07 · o ritmo atual chega lá?                            |
| `/:carteira/configuracoes`  | T-08 · onde se ajusta o que as outras telas leem          |
| `/galeria`                  | a galeria do design system (E5)                           |

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
contam sob os _outros_ filtros: contar sob o tipo já escolhido zeraria todas as
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

## T-05 · Desempenho

A tela responde a pergunta que motivou o produto: **quanto do crescimento veio de
aporte e quanto veio de rentabilidade**. Ela a responde em quatro resoluções — a
carteira contra benchmarks ao longo do tempo, mês a mês, o saldo decomposto e a
quebra por carteira e por classe — e declara no rodapé como cada número foi
calculado. `GET /api/performance` entrega as quatro sobre o mesmo fechamento e a
mesma cota; cinco rotas deixariam cada tabela escolher o seu "hoje".

**Carteira rende pela cota; classe, por Dietz modificado.** A carteira tem cota
gravada, e o retorno de qualquer janela é a razão entre dois valores dela — é por
isso que aporte não vira rentabilidade. A classe não tem cota, e o retorno dela é uma
aproximação (ganho sobre o capital médio, cada fluxo pesando pelo tempo em que
ficou); o caixa fica de fora, e a tela o mostra como traço.

**Retorno ausente é traço, nunca zero.** Janela maior que o histórico, mês
anterior ao primeiro fechamento e benchmark sem nenhum fator no período chegam
como `null`. O benchmark sem dado ainda é avisado sob o gráfico e não vira uma
linha reta em 0%. Nada é anualizado.

**A diferença é em pontos percentuais**, e a grade mensal ganhou `extraKinds`
para escrevê-la assim ao lado do benchmark do ano.

**Os benchmarks da tela vão para a URL** (`?benchmarks=`), e o benchmark da
carteira fica sempre na frente — é a referência da grade e da decomposição. O
período padrão aqui é 24 meses, e não 12 como nas demais telas.

Em T-05, contra a prancha 08:

- **Sem o botão Exportar do cabeçalho.** Exportar CSV mora no painel da
  decomposição, que é a única tabela que se leva para uma planilha; exportar o
  resto seria duplicar a tela.
- **O "12 meses" da decomposição são os doze meses de calendário**, e pode
  diferir um pouco da janela 12M enquanto o mês corrente não fechou.
- **Benchmarks compostos** (`IPCA + 6%`, `50% CDI + 50% IBOV`) são definição do
  usuário e nascem em Configurações; a migration 030 semeia só os cinco índices
  simples.

## T-06 · Estratégia

A tela responde uma pergunta: **o dinheiro está dividido como eu disse que
queria?** O alvo se edita na própria tabela, ao lado do que a carteira tem hoje,
porque é ali que se vê o que cada ponto de alvo custa em reais. `GET
/api/allocation` entrega regras, tabela, desvio e — com `contribution` — o plano
de aporte sobre o mesmo fechamento; a escrita do alvo é a que já existia, `PUT
/portfolios/{id}/strategy`, e a das regras é o `PATCH` da carteira.

**A estratégia é de uma carteira.** Não existe visão consolidada: toda tela tem
uma carteira como escopo, e o endereço sem carteira cai na primeira.

**Só a soma dos alvos é conta do navegador**, feita em centésimos de ponto
percentual, em inteiros — `35,1 + 24,9` em ponto flutuante não é garantidamente
`60`, e é esse número que trava o botão de salvar. Desvio, valor no alvo e valor
a mover chegam prontos; enquanto há edição, essas colunas continuam sendo as da
estratégia salva, e a tela diz isso, em vez de recalcular dinheiro no navegador.

**Sem estratégia, desvio e valores são traço, não zero.** Com estratégia, a
categoria que ficou de fora tem alvo zero e o desvio dela é a posição inteira.
Zero não leva `+` nem cor: não tem direção.

**Nenhuma escrita é otimista.** O corpo só leva categorias com alvo acima de zero
(o banco guarda "sem alvo" como ausência de linha); zerar tudo salva "sem
estratégia", e a barra avisa antes. O erro do banco volta na barra com o texto
dele e o rascunho fica. `⌘S` salva de qualquer campo.

Em T-06, contra a prancha 09:

- **Regras são só leitura.** A tolerância é fixa em 5 pp e o benchmark se escolhe
  em Configurações; a tela só mostra os dois.
- **O botão Categorias está desabilitado**, pela razão de T-02: criar e
  reorganizar categorias é Configurações, e fingir que a ação existe custa mais
  confiança do que dizer que ela não existe.
- **Planejar aporte pede estratégia salva.** O plano usa o alvo que o banco
  tem; com alteração não salva o diálogo avisa e não calcula, em vez de planejar
  sobre um alvo que ainda não existe.
- **A barra do grupo fica vazia**, como a prancha desenha: o grupo é a soma das
  categorias e não tem alvo próprio para comparar.
- **O fundo da barra não é 100%**, e sim o maior valor da tabela arredondado de
  dez em dez: com Ações em 35,3% a barra cheia é 40%, e o desvio de um ponto se
  vê. Uma barra fixa em 100% deixaria toda linha menor que 25% como um traço.

## T-07 · Objetivos

A tela responde: **o ritmo atual chega lá?** `GET /api/goals` entrega, por
objetivo, progresso, onde deveria estar hoje, projeção, as duas trajetórias e a
tabela de aportes — tudo sobre o mesmo fechamento e a mesma premissa, numa
consulta só. O navegador não faz conta.

**A tela trabalha em reais de hoje.** Meta em reais de hoje é uma linha reta, o
patrimônio cresce à taxa **real** (`IPCA+6` quer dizer 6) e o aporte é em reais
de hoje. A projeção declara a taxa que usou, a base (real ou nominal) e, quando
alguém a trocou, qual era a premissa guardada. A taxa trocada vive na URL
(`?taxa=id:6`) e **nunca é gravada**: simular não edita o objetivo.

**Projeção bloqueada é explicada, nunca zero.** Sem premissa, premissa ilegível,
sem IPCA para meta nominal ou sem fechamento, não há taxa adivinhada: a tela
escreve o motivo e deixa informar uma taxa para simular.

**Sem carteira ligada é o patrimônio todo.** O filtro de carteira só seleciona
objetivos; ele não muda o que cada um mede.

Em T-07, contra as pranchas 10 e 18:

- **"Novo objetivo" e "Editar" estão desabilitados**, com a dica de que chegam
  com T-10 (escrita). A prancha os desenha; a leitura vem antes.
- **A barra de estado diz o status** ("No caminho", "Atrás do necessário",
  "Prazo vencido", "Atingido") em vez de repetir o nome do objetivo, que já é o
  título do painel.
- **Os números da prancha são ilustrativos.** O ritmo é a média de aporte líquido
  dos últimos 12 meses fechados (menos, quando a história é mais curta — dividir
  por doze subestimaria o ritmo), e a linha de "esperado hoje" aplica o plano
  desde a criação do objetivo.
- **Sem projeção para meta atingida ou prazo vencido**: o painel diz isso, em vez
  de um "chega em —" que parece resultado.

**Para revisar em `projectGoal` (calc):** em modo `amount_in_today_brl` ele infla
a meta pelo IPCA mas compõe o patrimônio pela taxa recebida. Com taxa real isso
cobra a inflação do alvo sem pagá-la ao patrimônio. A tela evita o problema
chamando-o sempre com `amount_in_today_brl: false`; a função em si não foi
alterada.

## T-08 · Configurações

A tela responde: **o que posso ajustar, e o que me impede de excluir?**
`GET /api/settings` entrega carteiras, alertas, categorias, instituições,
benchmarks, os padrões do lançamento e o estado do backup numa consulta só. A
seção de dados de mercado reaproveita `GET /api/market/health` (M-16), que já tem
o compasso próprio de releitura durante uma coleta; duplicá-la seria ter dois
lugares dizendo se o preço é de hoje. A seção aberta vive na URL (`?secao=`).

**Bloqueio de exclusão vem com a contagem.** Carteira, categoria e instituição
chegam com o que as prende ("41 lançamentos impedem"), e a tela escreve isso em
vez de deixar o erro explicar. A regra de bloquear é do servidor.

**Renomear categoria não perde lançamento**: o vínculo é pelo identificador,
não pelo nome.

Em T-08, contra a prancha 11:

- **A tela segue a prancha, com nove painéis, e não o texto do backlog.** O
  backlog cita "ativos cadastrados à mão"; a prancha não tem essa seção (o
  cadastro de ativo é do modal de T-10). Ficou a prancha.
- **Criar, editar e excluir estão desabilitados**, com a dica de que chegam com
  T-10 (modais).
- **Alertas são mostrados, não editados.** Os interruptores e limites ficam
  somente leitura até o motor de alertas (O-01); só as regras de mercado existem
  na base.
- **"Lançamentos" é leitura.** Janela do desfazer, IR em JCP e liquidação são
  configuração de implantação (variáveis de ambiente e regra do domínio), então
  a seção as mostra e diz que mudá-las é trocar a variável. Não há "Taxas da B3".
- **Backup**: "Fazer backup agora" funciona (202, mesma fila e mesma chave de
  deduplicação do diário), recusa quando o backup está desligado, e dois no mesmo
  dia gravam o mesmo arquivo. O estado vem do `pipeline_outbox`, porque o bucket
  só o worker enxerga. Exportar tudo, importar e excluir tudo ficam desabilitados
  (O-06, O-04, O-07). O interruptor de frequência foi omitido.
- **Preferências de exibição**: tema, densidade e ocultar valores funcionam
  (guardados no navegador). "Período padrão" e "Tela inicial" da prancha foram
  omitidos: exigiriam ligar o padrão a Visão geral, Desempenho e à rota inicial.
- **A navegação lateral destaca a seção clicada**, sem IntersectionObserver.

## T-11 · Orçamento de consultas por rota

Cada tela do `web` pede **uma rota** à `api`, e cada rota tem um limite de
consultas ao Postgres declarado em `apps/api/src/testing/query-budget.ts`. O
banco fica em outra rede, então uma consulta a mais é uma ida e volta a mais
sentida por quem olha a tela. Nenhuma tela passa de duas.

`apps/api/src/presentation/routes/query-budget.routes.test.ts` chama cada rota
de tela contra Postgres de verdade, conta o que o driver envia e falha ao passar
do limite — listando as consultas, para dizer qual foi a terceira. Roda em
`pnpm test`, sem ambiente além do que a suíte da `api` já usa.

**`begin` e `commit` não entram na conta, mas aparecem no relatório.** O
`UnitOfWork` os abre em volta da leitura; não são consultas da tela, mas são
idas ao banco, e esconder o número esconderia justamente o que o orçamento
existe para vigiar.

O relatório sai no fim da execução, no terminal e em
`apps/api/reports/query-budget.json` (fora do git), com a contagem por rota.
Subir um limite é editar `query-budget.ts`, e isso aparece na revisão.

## T-10 · Modais de lançamento

Compra, venda, provento, aporte, resgate, mover posição, editar e confirmar recebimento. Código em `src/views/entry/`, lógica pura em `src/lib/entry.ts`, chamadas em `src/api/entry.ts` e o provedor que abre tudo em `src/components/entry_provider.tsx` (atalho `N`, `useEntry()`).

- **O preview é o plano do salvamento.** Compra, venda, aporte e resgate usam `POST /transactions/preview`; edição, `/transactions/:id/preview`. A tela não calcula dinheiro.
- **Rota nova na api:** `POST /transactions/payouts/preview` (o provento não tinha preview). `createPayout` e o preview dividem `preparePayout`, e um teste prova que os números do preview são os gravados.
- **Venda acima da posição** falha no preview e a mensagem aparece no campo da quantidade.
- **Sem atualização otimista.** Gravar sobe `version` no provedor; Posições, ativo e Movimentações releem com ele.

### Divergências registradas

- **Imposto estimado na venda: não entregue.** Depende das vendas do mês em todas as carteiras e do saldo de prejuízo, que o preview atual não conhece. A tela mostra só o resultado realizado; inventar o imposto no navegador violaria "o preview é o do salvamento". Precisa de extensão do preview na api.
- **Aba Evento corporativo** aparece desativada, pois não há preview na api.
- **Cadastros** (carteira, categoria, instituição, benchmark, objetivo, edição do ativo) continuam desabilitados: não fazem parte desta entrega.
- **Entrada por texto** (colar "compra 100 ITUB4...") não foi feita.
- **Editar** não se aplica a evento; o modal explica e oferece fechar.
- **Duplicar** só vale para compra, venda, provento, aporte e resgate; só compra e venda levam os números. Em lote, só com uma linha selecionada.
- **Conferência visual (Chromium, contra as pranchas 13, 15 e 17):** abas no `Segmented` da prancha, modal estreito, campo de ativo com lupa e nome, rodapé cinza, "O que muda", "antes: 31,40", "Salvar alterações" e "Não foi pago" em vermelho. Diferenças que ficaram: a liquidação abre em branco (a prancha a mostra preenchida; o cálculo D+N é da api), a tabela de efeito traz também custo da posição e da carteira (a prancha só traz quantidade, preço médio, % e classe, mas o critério da história pede custo), "Resultado aberto" e "Rent. 12M" na edição não existem no preview, "Recebido em" na confirmação não existe na api e o rodapé da edição não tem "editado N vez · ver histórico".

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
- **Lançar compra e provento aparecem desabilitados**, com a
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
