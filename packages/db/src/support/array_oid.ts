/**
 * Os OIDs dos tipos de array que as escritas em lote usam.
 *
 * `sql.array(valores)` sem OID adivinha o tipo pelo primeiro elemento e, quando
 * erra, manda o tipo **escalar** — o Postgres responde "cannot cast type boolean
 * to boolean[]" ou "malformed array literal", e a consulta nunca roda. Como toda
 * escrita em lote deste pacote passa por `unnest`, o OID vai explícito.
 *
 * Os valores saem do catálogo: `select typname, oid from pg_type where typname
 * in ('_bool','_date','_text','_numeric','_uuid','_int4','_timestamptz')`.
 */
export const ARRAY_OID = {
  boolean: 1000,
  date: 1182,
  text: 1009,
  numeric: 1231,
  uuid: 2951,
  integer: 1007,
  timestamptz: 1185,
} as const;
