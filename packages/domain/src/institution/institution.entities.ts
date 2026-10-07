/**
 * Onde o ativo está custodiado e quem é o emissor. Os dois papéis moram na
 * mesma tabela porque na prática a mesma instituição costuma fazer os dois — e
 * separar em duas tabelas obrigaria a cadastrar o Banco C duas vezes.
 *
 * O papel de emissor é o que alimenta a exposição ao FGC: o limite de R$ 250
 * mil é por emissor, não por corretora.
 */
export const INSTITUTION_ROLES = ['custodian', 'issuer', 'both'] as const;

export type InstitutionRole = (typeof INSTITUTION_ROLES)[number];

export const isInstitutionRole = (value: unknown): value is InstitutionRole =>
  typeof value === 'string' && (INSTITUTION_ROLES as readonly string[]).includes(value);

export type Institution = {
  readonly id: string;
  readonly name: string;
  readonly role: InstitutionRole;
  readonly fgc_covered: boolean;
  /** Somado a cada compra e venda, como sugestão no lançamento. */
  readonly brokerage_per_order: string;
  readonly custody_monthly_fee: string;
  readonly created_at: string;
  readonly updated_at: string;
};

/** O teto do FGC por emissor. Não é configuração: é a regra do fundo. */
export const FGC_LIMIT_BRL = '250000';
