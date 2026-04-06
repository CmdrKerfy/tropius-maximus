-- Allow numeric dynamic fields (Workbench / Field Management).
ALTER TABLE field_definitions DROP CONSTRAINT IF EXISTS chk_field_type;
ALTER TABLE field_definitions ADD CONSTRAINT chk_field_type CHECK (
  field_type IN ('select', 'multi_select', 'text', 'boolean', 'url', 'number')
);
