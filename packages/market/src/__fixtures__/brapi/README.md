# Respostas gravadas da brapi

Capturadas de `https://brapi.dev/api/quote/{tickers}`. O envelope é
`{ results, requestedAt, took }`, e o fechamento está em `regularMarketPrice` —
lido depois do pregão, que é quando o job roda, ele é o fechamento do dia.

`quote-nao-encontrado.json` é o 404 da fonte para um papel que ela não conhece.
Ele é lido como resposta, não como falha: o ticker entra em `missing` e as
outras cotações da chamada continuam valendo.

`historico-3mo.json` é a série com `range=3mo&interval=1d`, com `date` em epoch
de segundos. Três meses é o que o plano gratuito dá — dez anos de backfill vêm
do COTAHIST.
