# @patrimonio/web — design system

O que E5 entregou: a camada de peças sobre a qual E6 constrói as telas. Nenhuma
tela de verdade existe ainda; o que a aplicação abre é a galeria, que é o
critério de saída deste épico e o lugar contra o qual as pranchas de design são
conferidas.

```bash
pnpm --filter @patrimonio/web dev     # a galeria em http://localhost:5173
pnpm --filter @patrimonio/web test
```

## Onde está cada coisa

| Pasta             | Conteúdo                                                               |
| ----------------- | ---------------------------------------------------------------------- |
| `src/styles.css`  | A camada de token: cor, tipografia, densidade e medida, nos dois temas |
| `src/lib/`        | Toda decisão que não depende de navegador, com teste                   |
| `src/components/` | As peças, finas de propósito: marcação, teclado e aparência            |
| `src/views/`      | A galeria. Em E6, as telas                                             |

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

## Larguras

As colunas secundárias somem em etapas, como a prancha 18 define, em vez de a
tabela rolar na horizontal ou o texto quebrar em duas linhas.

| Largura   | O que muda                                           |
| --------- | ---------------------------------------------------- |
| < 1400 px | Somem preço médio, rentabilidade e detalhe           |
| < 1240 px | A barra lateral colapsa para ícones                  |
| < 1100 px | Somem preço e resultado                              |
| < 1000 px | A barra lateral vira gaveta; somem quantidade e peso |
| < 600 px  | Só o que é essencial                                 |

## Atalhos

A lista está em `lib/shortcuts.ts` e a tela de ajuda (`?`) é gerada dela — uma
ajuda escrita à mão desatualiza no primeiro atalho novo. Navegação é sequência
de duas teclas (`G` e depois `P`), não modificador, porque `⌘P` já tem dono no
navegador. Nenhum atalho de letra dispara com o foco em campo de texto.
