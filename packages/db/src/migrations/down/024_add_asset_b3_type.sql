drop index if exists asset_b3_type_idx;
alter table asset drop constraint if exists asset_b3_type_known;
alter table asset drop column if exists b3_type;
