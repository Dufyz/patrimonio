-- RN-U2 · a marca "no patrimônio": conta sem ela não soma em Em contas.
ALTER TABLE fin_account ADD COLUMN in_wealth BOOLEAN NOT NULL DEFAULT TRUE;
