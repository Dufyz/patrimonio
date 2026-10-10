INSERT INTO alert_rule (kind, enabled, threshold, scope)
VALUES
  ('price_missing', TRUE, NULL, 'global'),
  ('price_stale', TRUE, '{"days": 3}'::JSONB, 'global'),
  ('corporate_event_pending', TRUE, NULL, 'global')
ON CONFLICT (kind) DO NOTHING;
