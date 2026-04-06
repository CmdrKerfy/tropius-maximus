-- ============================================================
-- 002: Annotations table — user-generated card metadata
-- ============================================================

CREATE TABLE annotations (
  card_id         TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,

  -- Visual attributes (array fields stored as JSONB arrays)
  art_style             JSONB DEFAULT '[]',
  main_character        JSONB DEFAULT '[]',
  background_pokemon    JSONB DEFAULT '[]',
  background_humans     JSONB DEFAULT '[]',
  additional_characters JSONB DEFAULT '[]',
  background_details    JSONB DEFAULT '[]',
  emotion               JSONB DEFAULT '[]',
  pose                  JSONB DEFAULT '[]',
  actions               JSONB DEFAULT '[]',
  items                 JSONB DEFAULT '[]',
  held_item             JSONB DEFAULT '[]',
  pokeball              JSONB DEFAULT '[]',
  evolution_items       JSONB DEFAULT '[]',
  berries               JSONB DEFAULT '[]',
  card_subcategory      JSONB DEFAULT '[]',
  trainer_card_subgroup JSONB DEFAULT '[]',
  holiday_theme         JSONB DEFAULT '[]',
  multi_card            JSONB DEFAULT '[]',

  -- Single-value string fields
  camera_angle          TEXT,
  perspective           TEXT,
  weather               TEXT,
  environment           TEXT,
  storytelling          TEXT,
  card_locations        TEXT,
  pkmn_region           TEXT,
  card_region           TEXT,
  primary_color         TEXT,
  secondary_color       TEXT,
  shape                 TEXT,
  trainer_card_type     TEXT,
  stamp                 TEXT,
  card_border           TEXT,
  energy_type           TEXT,
  rival_group           TEXT,
  image_override        TEXT,
  notes                 TEXT,
  top_10_themes         TEXT,
  wtpc_episode          TEXT,

  -- Video metadata
  video_game            TEXT,
  video_game_location   TEXT,
  video_appearance      BOOLEAN DEFAULT FALSE,
  shorts_appearance     BOOLEAN DEFAULT FALSE,
  region_appearance     BOOLEAN DEFAULT FALSE,
  thumbnail_used        BOOLEAN DEFAULT FALSE,
  video_url             TEXT,
  video_title           TEXT,
  video_type            JSONB DEFAULT '[]',
  video_region          JSONB DEFAULT '[]',
  video_location        JSONB DEFAULT '[]',

  -- Collection
  pocket_exclusive      BOOLEAN DEFAULT FALSE,
  owned                 BOOLEAN DEFAULT FALSE,

  -- Dynamic fields created via Field Management UI
  extra                 JSONB DEFAULT '{}',

  -- Overrides for API-sourced card fields
  overrides             JSONB DEFAULT '{}',

  -- Optimistic locking
  version               INT DEFAULT 1,

  -- Audit
  updated_by            UUID REFERENCES auth.users(id),
  updated_at            TIMESTAMPTZ DEFAULT now(),

  -- Safety constraints
  CONSTRAINT chk_extra_is_object CHECK (jsonb_typeof(extra) = 'object'),
  CONSTRAINT chk_overrides_is_object CHECK (jsonb_typeof(overrides) = 'object')
);

-- GIN index for querying dynamic fields in extra
CREATE INDEX idx_annotations_extra ON annotations USING GIN (extra);

-- Index for finding unannotated cards (Data Health)
CREATE INDEX idx_annotations_card_id ON annotations(card_id);
