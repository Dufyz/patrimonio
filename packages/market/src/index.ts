/**
 * Os provedores de cotação, índice e Tesouro, atrás da interface
 * `MarketDataProvider` declarada em `application/interfaces`.
 *
 * Entram em E4: Banco Central, Tesouro Direto, brapi, provedor alternativo e a
 * cadeia de fallback que marca `source_kind`. Cada provedor é testado contra
 * respostas HTTP gravadas em arquivo, mais um teste noturno contra a API real
 * que falha quando o formato muda.
 */
export {};
