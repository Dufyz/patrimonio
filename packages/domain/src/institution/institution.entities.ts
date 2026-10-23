/**
 * Onde o ativo está custodiado e quem é o emissor: a mesma instituição pode
 * fazer os dois papéis, e por isso não há papel no cadastro. O país (ISO 3166-1
 * alpha-2) separa as brasileiras, que vêm de catálogo, das estrangeiras, que a
 * pessoa cria na hora.
 */
export type Institution = {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly created_at: string;
  readonly updated_at: string;
};
