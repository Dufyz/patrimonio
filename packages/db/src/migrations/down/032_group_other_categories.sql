UPDATE category SET parent_id = NULL
 WHERE parent_id = '01960000-0002-7000-8000-000000000025';

DELETE FROM strategy_target
 WHERE portfolio_id IN (
   SELECT portfolio_id FROM strategy_target
    WHERE category_id = '01960000-0002-7000-8000-000000000025'
 );

DELETE FROM category WHERE id = '01960000-0002-7000-8000-000000000025';
