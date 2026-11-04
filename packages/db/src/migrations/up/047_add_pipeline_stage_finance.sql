-- O estágio diário de Finanças entra no enum do pipeline.
ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'finance';
