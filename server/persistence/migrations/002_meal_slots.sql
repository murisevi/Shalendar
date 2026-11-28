-- Shalendar PostgreSQL Migration (002_meal_slots.sql)
-- Adds configurable meal/day-part slots ('breakfast', 'lunch', 'snack', 'dinner')
-- and per-plan enabled_slots persistence without affecting existing plans.

ALTER TABLE plans
  DROP CONSTRAINT IF EXISTS plans_granularity_check;

ALTER TABLE plans
  ADD CONSTRAINT plans_granularity_check
  CHECK (granularity IN ('day', 'slots', 'meals'));

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS enabled_slots JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE availabilities
  DROP CONSTRAINT IF EXISTS availabilities_slot_check;

ALTER TABLE availabilities
  ADD CONSTRAINT availabilities_slot_check
  CHECK (slot IN ('all', 'morning', 'afternoon', 'evening', 'breakfast', 'lunch', 'snack', 'dinner'));
