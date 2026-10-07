alter table transaction drop constraint if exists transaction_expected_only_on_payout;
alter table transaction drop column if exists expected_net_amount;
