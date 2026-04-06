-- ============================================================
-- 007: Row Level Security policies
-- All tables locked by default (automatic RLS enabled).
-- These policies grant access to authenticated users only.
-- ============================================================

-- Cards: everyone reads, nobody writes directly (ingest uses service role)
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read cards" ON cards
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated insert cards" ON cards
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "authenticated update cards" ON cards
  FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated delete cards" ON cards
  FOR DELETE USING (auth.role() = 'authenticated');

-- Sets: same as cards
ALTER TABLE sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read sets" ON sets
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated insert sets" ON sets
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "authenticated update sets" ON sets
  FOR UPDATE USING (auth.role() = 'authenticated');

-- Pokemon metadata: read-only for users
ALTER TABLE pokemon_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read pokemon_metadata" ON pokemon_metadata
  FOR SELECT USING (auth.role() = 'authenticated');

-- Annotations: full CRUD for authenticated users
ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated all annotations" ON annotations
  FOR ALL USING (auth.role() = 'authenticated');

-- Field definitions: read for all authenticated, write for all authenticated
ALTER TABLE field_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated all field_definitions" ON field_definitions
  FOR ALL USING (auth.role() = 'authenticated');

-- Normalization rules: read for all authenticated, write for all authenticated
ALTER TABLE normalization_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated all normalization_rules" ON normalization_rules
  FOR ALL USING (auth.role() = 'authenticated');

-- Edit history: read for all, insert for all (no update/delete)
ALTER TABLE edit_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read edit_history" ON edit_history
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated insert edit_history" ON edit_history
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Health check results: read-only for users
ALTER TABLE health_check_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read health_checks" ON health_check_results
  FOR SELECT USING (auth.role() = 'authenticated');

-- User preferences: users can only read/write their own
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own preferences" ON user_preferences
  FOR ALL USING (auth.uid() = user_id);

-- Workbench queues: users can only read/write their own
ALTER TABLE workbench_queues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own queues" ON workbench_queues
  FOR ALL USING (auth.uid() = user_id);
