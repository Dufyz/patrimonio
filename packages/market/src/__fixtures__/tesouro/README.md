# Respostas gravadas do Tesouro

`treasurybondsinfo.json` é o JSON do site do Tesouro Direto, com o envelope
`response.TrsrBdTradgList[].TrsrBd`. Além dos três títulos normais ele carrega
dois casos de propósito: um produto que a tabela de tradução não conhece — que é
ignorado, não derruba a coleta — e um título já vencido, que sai sem erro.

`PrecoTaxaTesouroDireto.csv` é o arquivo do Tesouro Transparente: separador `;`,
decimal com vírgula e data em `DD/MM/YYYY`. Ele cobre o histórico desde 2002, e
é a fonte da carga inicial. A última linha é de outra data base, para provar que
o filtro por dia funciona.
