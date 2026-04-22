-- ============================================================
-- Seed data: field_definitions + normalization_rules
-- Run after migrations to populate baseline configuration.
-- ============================================================

-- ── Field Definitions ──────────────────────────────────────

-- Visual category
INSERT INTO field_definitions (name, label, field_type, category, sort_order, curated_options) VALUES
('art_style', 'Art Style', 'multi_select', 'visual', 10, '["Hand Drawn","mixed media","Clay","Yarn","Polygon Graphics","2D","No Shading","Hyperrealistic","cursed art","That Reminds Me Of Something","you''ve changed","funny artworks","beautiful background","Less Detail Please","One of A Kind Backgrounds","trippy art","off color","IRL Background","watercolor","paper mario","print dots","crayon"]'),
('pose', 'Pose', 'multi_select', 'visual', 20, '["Flexing","hands on hips","Arms Crossed","Punch stance","balancing on one leg","winking","eyebrow raise","smirking","modeling","top of the mountain","drugged","mom says I''m handsome","pose for the camera","young bucks who will grow strong","I''m fabulous","that''s sus","living my best life","mouth agape","all hail the hypnotoad","looking down","looking up","in awe","talk to the hand","belly up","kid in a candy shop","this is my rock","Come At Me Bro","meditation","sunblockers","tongue out","view from above","chameleons","please don''t hurt me"]'),
('emotion', 'Emotion', 'multi_select', 'visual', 30, '["Happy","crying","depressed","Angry","Scared","Jaded","Thousand Yard Stare","disappointed","Shy","flabbergasted"]'),
('actions', 'Actions', 'multi_select', 'visual', 40, '["Dangerous Stunts","Running","Swinging","Sleeping","Jumping","Slapping","Deforestation","Earth Shattering","Rock Smashing","waving","singing","dancing","sailing","surfing","flying","exercising","battling","leaping out of water","We Have Liftoff","bullying","eating","attacking the cameraman","polluting","got gas","sweating","pondering life","being a detective","chillin like a villain","Showing off my Talent","Beam Me Up Scotty","Playtime","If I Fits I Sits","Full Speed Out of Focus","Firefighters","Pyros","Wearing Clothes","Doing Human Things","I''m On A Boat","Explosion","big stretch","climbing","keep rollin","hoarders","Taxi!","hangin around","knocked out","tightrope walkers","water skimmers","walking on water","diving","sliding","spinning","parkour","stair steppin","blowin smoke","hiding","holding something","psychic abilities","reading","property damage","weather shelter","floating on water","testing the water","wading in water","spewing poison","on one arm","playing in mud","belly flop","fishing","kicking","using imagination","breaking the fourth wall","well that sucks","trauma inducers","tree huggers","public servants","peeping toms"]'),
('camera_angle', 'Camera Angle', 'select', 'visual', 50, '["Aerial","Profile","Underbelly","Upside Down","Symmetrical","Reflection","Water Level","POV","Confusing Perspective","My Eyes Are Up Here","Staring Contest","Nature Photographer","Zoomed In","curved landscape","selfies","off center"]'),
('perspective', 'Perspective', 'select', 'visual', 60, '["Tiny","Gigantic","Rotate 90 Degrees","Exiting The Frame"]'),
('primary_color', 'Primary Color', 'select', 'visual', 70, '["black","blue","brown","gray","green","pink","purple","red","white","yellow"]'),
('secondary_color', 'Secondary Color', 'select', 'visual', 80, '["black","blue","brown","gray","green","pink","purple","red","white","yellow"]'),
('shape', 'Shape', 'select', 'visual', 90, '["ball","squiggle","fish","arms","blob","upright","legs","quadruped","wings","tentacles","heads","humanoid","bug-wings","armor"]');

-- Characters category
INSERT INTO field_definitions (name, label, field_type, category, sort_order, curated_options) VALUES
('main_character', 'Main Character', 'multi_select', 'characters', 10, '[]'),
('background_pokemon', 'Background Pokemon', 'multi_select', 'characters', 20, '[]'),
('background_humans', 'Background Humans', 'multi_select', 'characters', 30, '[]'),
('additional_characters', 'Additional Characters', 'multi_select', 'characters', 40, '["BFFs","Squad Gang","Trainer and Pokemon","Family First","Unexpected Partnerships"]');

-- Location & Region category
INSERT INTO field_definitions (name, label, field_type, category, sort_order, curated_options) VALUES
('weather', 'Weather', 'select', 'location', 10, '["Sunny","Rain","Snow","Snowflakes","Thunder","Clouds","Overcast","Aurora Borealis","Rainbow","Heavens Shine Down"]'),
('environment', 'Environment', 'select', 'location', 20, '["Indoors","Outdoors","Day","Night","Starry Night","Crescent Moon","Full Moon","Sunrise","Sunset","Spring","Summer","Autumn","Winter"]'),
('card_locations', 'Card Location', 'select', 'location', 30, '["Beach","City","Farm","Cave","Junkyard","In The Sky","Underwater","Rooftop","Stadium","Forest","desert dogs","underground","industrial","ancient ruins","Wrestling ring","cemetery","library","gym","pokemon center","pokemart","lab","pokemon league","volcano","post-apocalypse","kitchen","iceberg","swamp","savannah","jungle","garden","one-off locations"]'),
('pkmn_region', 'Pokemon Region', 'select', 'location', 40, '["Kanto","Johto","Hoenn","Sinnoh (Hisui)","Unova","Kalos","Alola","Galar","Paldea"]'),
('card_region', 'Card Region', 'select', 'location', 50, '["Kanto","Johto","Hoenn","Sinnoh (Hisui)","Unova","Kalos","Alola","Galar","Paldea"]'),
('background_details', 'Background Details', 'multi_select', 'location', 60, '["Island","House","pokemon center","pokemart","gym","retail store","boat","plane","car","Windmill","stump","spotlight","I see stars","hearts","purgatory","food","chaos","footprints","Question Marks","Indoor Livin","That Ain''t Right","Bubbles","Shadow","Flower Power","Clovers","shiny/sharp point","dolls/toys","yarn","shattered glass","riding the bench","train gang","log rollers","tech support","hieroglyphics","apple","berry","item","welcome to my crib","seeds","fallen leaves","waterfall","bridge","energy","portal","staircase","kelp","seafloor","in the ring","fountain","hiding spot","present","book","water droplet","volcano","fireplace","lilypad","rock","egg","crystals","dirty water","flower petals","patterned background","webs","fishing pole","laundry","Pokemon Card meta","balloons","cactus","fireworks"]'),
('storytelling', 'Storytelling', 'text', 'location', 70, '[]');

-- Items & Objects category
INSERT INTO field_definitions (name, label, field_type, category, sort_order, curated_options) VALUES
('items', 'Items', 'multi_select', 'items', 10, '["Clefairy Doll","Poke Doll","Leek","Exp Share","Lucky Egg","Arceus Plate","Technical Machine (TM)","Mask","Incense","Rare Candy","Fossil","apple"]'),
('held_item', 'Held Item', 'multi_select', 'items', 20, '["Berry","Food","Flower","Pokeball"]'),
('pokeball', 'Pokeball', 'multi_select', 'items', 30, '["Pokeball","Great Ball","Ultra Ball","Master Ball","Premier Ball","Luxury Ball","Timer Ball","Repeat Ball","Nest Ball","Dive Ball","Net Ball","Safari Ball","Dusk Ball","Heal Ball","Quick Ball","Fast Ball","Level Ball","Lure Ball","Heavy Ball","Love Ball","Moon Ball","Friend Ball","Sport Ball","Dream Ball","Park Ball","Beast Ball","Strange Ball","Cherish Ball","Hisuian Pokeball","Hisuian Feather Ball","Hisuian Heavy Ball"]'),
('evolution_items', 'Evolution Items', 'multi_select', 'items', 40, '["Fire Stone","Leaf Stone","Thunderstone","Water Stone","Sun Stone","Moon Stone","Shiny Stone","Dawn Stone","Dusk Stone","Ice Stone","Oval Stone","Deep Sea Scale","Deep Sea Tooth","Upgrade","Dubious Disc","Dragon Scale","Electrizer","Magmarizer","King''s Rock","Metal Coat","Prism Scale","Protector","Razor Claw","Razor Fang","Reaper Cloth","Sachet","Whipped Dream","Sweet","Cracked Pot","Masterpiece Teacup","Metal Alloy","Malicious Armor","Auspicious Armor","Galarica Cuff","Galarica Wreath","Black Augurite","Tart Apple"]'),
('berries', 'Berries', 'multi_select', 'items', 50, '["Cheri","Chesto","Pecha","Rawst","Aspear","Leppa","Oran","Persim","Lum","Sitrus","Figy","Wiki","Mago","Aguav","Iapapa","Razz","Bluk","Nanab","Wepear","Pinap","Pomeg","Kelpsy","Qualot","Hondew","Grepa","Tomato","Corn","Magost","Rabuta","Nomel","Spelon","Pamtre","Watmel","Durin","Belue","Occa","Passho","Wacan","Rindo","Yache","Chople","Kebia","Shuca","Coba","Payapa","Tanga","Charti","Kasib","Haban","Colbur","Babiri","Chilan","Liechi","Ganlon","Salac","Petaya","Apricot","Lansat","Starf","Enigma","Micle","Custap","Jaboca","Rowap","Roseli","Kee","Maranga","Hopo","Black Apricorn","Blue Apricorn","Green Apricorn","Pink Apricorn","Red Apricorn","White Apricorn","Yellow Apricorn","Brown Apricorn","Spoiled Apricorn"]');

-- Card Classification category
INSERT INTO field_definitions (name, label, field_type, category, sort_order, curated_options) VALUES
('card_subcategory', 'Card Subcategory', 'multi_select', 'classification', 10, '["Trainer''s Pokemon","Pokemon and Trainer","Radiant","Shining","Team Plasma","Prism Star","Delta Species","Greek","Prime","Amazing Rares","Lost Origin Smoke","BREAK","Full Art","Illustration Rare","Ultra Rare","Special Illustration Rare","Gold","Foreign Exclusive","Errors","Shiny Pokemon","Championship Promos","Pokemon League","Alternate Arts","Tera Border","Stamped Set Promo","Stamped Company Promo"]'),
('trainer_card_type', 'Trainer Card Type', 'select', 'classification', 20, '["Item","Supporter","Stadium","Tool","Energy"]'),
('trainer_card_subgroup', 'Trainer Card Subgroup', 'multi_select', 'classification', 30, '["Real background","Nameless Supporter","Surprisingly Named Supporter","Supporter wearing alternate outfit","Artwork Includes Pokemon","Doesn''t Seem like a Pokemon Card","Artwork Includes Other Items","ACE SPEC","Villain Team Items","dangerous stadiums"]'),
('stamp', 'Stamp', 'select', 'classification', 40, '["Pokemon Day","Anniversary","Pokemon Center","Pokemon League","Set","Championship Series","Finalist"]'),
('card_border', 'Card Border', 'select', 'classification', 50, '["Yellow","Silver","Blue"]'),
('energy_type', 'Energy Type', 'select', 'classification', 60, '["Basic","Special"]'),
('rival_group', 'Rival Group', 'select', 'classification', 70, '["Team Rocket","Team Aqua","Team Magma","Team Galactic","Team Plasma","Team Flare","Team Skull","Team Yell","Team Star","Aether Foundation","Team Rainbow Rocket"]'),
('holiday_theme', 'Holiday Theme', 'multi_select', 'classification', 80, '["Christmas","New Years","Valentine''s Day","St Patrick''s Day","Easter","Halloween","Thanksgiving","Mother''s Day"]'),
('multi_card', 'Multi-Card', 'multi_select', 'classification', 90, '["Storytelling","Different Angles","Part of the Bigger Picture","Copy Paste"]');

-- Video Metadata category
INSERT INTO field_definitions (name, label, field_type, category, sort_order, curated_options) VALUES
('video_game', 'Video Game', 'select', 'video', 10, '["Red/Blue","Gold/Silver","Ruby/Sapphire","FireRed/LeafGreen","Diamond/Pearl","Platinum","HeartGold/SoulSilver","Black/White","Black 2/White 2","X/Y","Omega Ruby/Alpha Sapphire","Sun/Moon","Ultra Sun/Ultra Moon","Let''s Go Pikachu/Eevee","Sword/Shield","Brilliant Diamond/Shining Pearl","Legends Arceus","Scarlet/Violet","Other"]'),
('video_game_location', 'Video Game Location', 'select', 'video', 20, '[]'),
('video_url', 'Video URL', 'url', 'video', 30, '[]'),
('video_title', 'Video Title', 'text', 'video', 40, '[]'),
('video_type', 'Video Type', 'multi_select', 'video', 50, '["Top 10","Every Card in a Region","What''s That Pokemon Card?"]'),
('video_region', 'Video Region', 'multi_select', 'video', 60, '["Kanto","Johto","Hoenn","Sinnoh","Unova","Kalos","Alola","Galar","Hisui","Paldea","Aquapolis","Holon","Peaceful Park"]'),
('video_location', 'Video Location', 'multi_select', 'video', 70, '[]'),
('video_appearance', 'Video Appearance', 'boolean', 'video', 80, '[]'),
('shorts_appearance', 'Shorts Appearance', 'boolean', 'video', 90, '[]'),
('region_appearance', 'Region Appearance', 'boolean', 'video', 100, '[]'),
('thumbnail_used', 'Thumbnail Used', 'boolean', 'video', 110, '[]'),
('top_10_themes', 'Top 10 Themes', 'select', 'video', 120, '["Agents of Destruction","Grimer","Trauma Inducers","Old School Graphics","Nameless Supporters","Unexpected Partnerships","Tree Huggers","Dangerous Stadiums","Flabbergasted","Balloons","Background Characters","Public Servants","Below the Surface","Ditto","Selfies","At Their Lowest","In Another Dimension","Peeping Toms","Rainbows","Reflections","Well That Sucks","Sun''s Out Guns Out","Off-Center","Sunblockers","Tongues","Crochet","Balancing On One Leg","Chameleons","Psyduck at Worlds","Doggos","Symmetrical Pokemon","Picnickers","Sunsets","Autumnal Landscapes","Breathtaking Views","Lights in the Darkness","Creepypasta","Run For Your Life","Spooky Ghosts","Yuka Morii","Accidental Giants","Pokemon League Items","Upside Down","Sachiko Adachi Artworks","Christmas","Fireworks","Legendary Cameos","Aerial Views","Valentines","POVs","Snow Days"]'),
('wtpc_episode', 'WTPC Episode', 'select', 'video', 130, '["Episode 1","Episode 2","Episode 3","Episode 4","Episode 5","Episode 6","Episode 7","Episode 8","Episode 9","Episode 10","Episode 11","Episode 12","Episode 13","Episode 14","Episode 15","Episode 16","Episode 17","Episode 18","Episode 19","Episode 20","Episode 21","Episode 22","Episode 23","Episode 24","Episode 25","Episode 26","Episode 27","Episode 28","Episode 29","Episode 30","Episode 31","Episode 32","Episode 33","Episode 34","Episode 35","Episode 36","Episode 37","Episode 38","Episode 39","Episode 40","Episode 41","Episode 42","Episode 43","Episode 44","Episode 45","Episode 46","Episode 47","Episode 48","Episode 49","Episode 50"]');

-- Collection category
INSERT INTO field_definitions (name, label, field_type, category, sort_order, curated_options) VALUES
('owned', 'Owned', 'boolean', 'collection', 10, '[]'),
('pocket_exclusive', 'Pocket Exclusive', 'boolean', 'collection', 20, '[]'),
('jumbo_card', 'Jumbo Card', 'boolean', 'collection', 30, '[]'),
('image_override', 'Image Override', 'url', 'collection', 40, '[]'),
('notes', 'Notes', 'text', 'collection', 50, '[]');


-- ── Normalization Rules ────────────────────────────────────

INSERT INTO normalization_rules (field_name, match_pattern, replace_with, rule_type) VALUES
-- Pokemon name normalization (applies to all fields)
(NULL, 'pokemon',  'Pokémon',  'exact'),
(NULL, 'Pokemon',  'Pokémon',  'exact'),
(NULL, 'POKEMON',  'Pokémon',  'exact'),
(NULL, 'Pokémon',  'Pokémon',  'exact'),
(NULL, 'pokmon',   'Pokémon',  'exact'),

-- Region normalization
('pkmn_region', 'kanto',  'Kanto',  'exact'),
('pkmn_region', 'johto',  'Johto',  'exact'),
('pkmn_region', 'hoenn',  'Hoenn',  'exact'),
('pkmn_region', 'sinnoh', 'Sinnoh (Hisui)', 'exact'),
('pkmn_region', 'unova',  'Unova',  'exact'),
('pkmn_region', 'kalos',  'Kalos',  'exact'),
('pkmn_region', 'alola',  'Alola',  'exact'),
('pkmn_region', 'galar',  'Galar',  'exact'),
('pkmn_region', 'paldea', 'Paldea', 'exact'),

-- Art style normalization
('art_style', '2d',          '2D',          'exact'),
('art_style', '3d',          '3D',          'exact'),
('art_style', 'cg',          'CG',          'exact'),
('art_style', 'Watercolour', 'watercolor',  'exact'),
('art_style', 'watercolour', 'watercolor',  'exact'),
('art_style', 'hand drawn',  'Hand Drawn',  'exact'),
('art_style', 'Hand drawn',  'Hand Drawn',  'exact');
