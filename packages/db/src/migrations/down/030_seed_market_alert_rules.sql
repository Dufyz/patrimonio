DELETE FROM alert_rule
 WHERE kind IN ('price_missing', 'price_stale', 'corporate_event_pending');
