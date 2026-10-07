delete from alert_rule
 where kind in ('price_missing', 'price_stale', 'corporate_event_pending');
