# Respostas gravadas do SGS

Capturadas uma vez da API real do Banco Central, em
`https://api.bcb.gov.br/dados/serie/bcdata.sgs.{serie}/dados?formato=json`.

A série 12 e a 11 publicam a taxa **do dia** em percentual; a 433 publica a
variação **do mês**. É essa diferença de unidade que o provedor declara e que
`calc` usa para converter.

O teste que fala com a API real vive em `bcb.live.test.ts` e roda só na
verificação noturna: é ele que descobre mudança de formato antes de ela
aparecer no patrimônio.
