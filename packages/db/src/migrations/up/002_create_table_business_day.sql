-- O calendário da B3 em tabela: feriado bancário não é derivável de regra, e
-- a marcação na curva pró-rata conta dia útil, não dia corrido.
create table business_day (
  calendar_date      date    primary key,
  is_business_day    boolean not null,
  is_bank_holiday    boolean not null default false,
  is_trading_holiday boolean not null default false,
  holiday_name       text,
  constraint business_day_holiday_has_name
    check ((is_bank_holiday or is_trading_holiday) = (holiday_name is not null))
);

create index business_day_trading_idx
  on business_day (calendar_date) where is_business_day;
