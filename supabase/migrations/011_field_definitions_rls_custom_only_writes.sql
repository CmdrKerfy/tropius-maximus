-- Tighten field_definitions: authenticated users may only INSERT/UPDATE/DELETE rows
-- with category = 'custom'. Seed / built-in rows remain readable and immutable via the API.

DROP POLICY IF EXISTS "authenticated all field_definitions" ON field_definitions;

CREATE POLICY "authenticated read field_definitions" ON field_definitions
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated insert custom field_definitions" ON field_definitions
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND category = 'custom');

CREATE POLICY "authenticated update custom field_definitions" ON field_definitions
  FOR UPDATE
  USING (auth.role() = 'authenticated' AND category = 'custom')
  WITH CHECK (auth.role() = 'authenticated' AND category = 'custom');

CREATE POLICY "authenticated delete custom field_definitions" ON field_definitions
  FOR DELETE USING (auth.role() = 'authenticated' AND category = 'custom');
