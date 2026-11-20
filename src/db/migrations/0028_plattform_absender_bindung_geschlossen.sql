SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

UPDATE platform_number_use
   SET released_at = now()
 WHERE purpose = 'outbound_ani' AND released_at IS NULL;
