/**
 * Single annotation field editor for Card detail — used in the main form and the pin strip
 * (same `saveAnnotation` path). Field list matches `cardDetailPinRegistry.js`.
 */

import ComboBox from "./ComboBox.jsx";
import MultiComboBox from "./MultiComboBox.jsx";
import FormFieldLabel from "./ui/FormFieldLabel.jsx";
import {
  CARD_SUBCATEGORY_OPTIONS,
  HELD_ITEM_OPTIONS,
  POKEBALL_OPTIONS,
  EVOLUTION_ITEMS_OPTIONS,
  BERRIES_OPTIONS,
  HOLIDAY_THEME_OPTIONS,
  MULTI_CARD_OPTIONS,
  TRAINER_CARD_TYPE_OPTIONS,
  TRAINER_CARD_SUBGROUP_OPTIONS,
  VIDEO_TYPE_OPTIONS,
  TOP_10_THEMES_OPTIONS,
  WTPC_EPISODE_OPTIONS,
  VIDEO_REGION_OPTIONS,
  VIDEO_LOCATION_OPTIONS,
  STAMP_OPTIONS,
  CARD_BORDER_OPTIONS,
  ENERGY_TYPE_OPTIONS,
  RIVAL_GROUP_OPTIONS,
  ADDITIONAL_CHARACTER_THEME_OPTIONS,
} from "../lib/annotationOptions.js";

export {
  CARD_DETAIL_PINNABLE_KEYS,
  CARD_DETAIL_PIN_LABELS,
  CARD_DETAIL_PIN_GROUPS,
  CARD_DETAIL_PIN_MAX,
  normalizeCardDetailPins,
  isCardDetailPinnableKey,
} from "../lib/cardDetailPinRegistry.js";

const TCG_TYPE_OPTIONS = [
  "Colorless", "Darkness", "Dragon", "Fairy", "Fighting", "Fire",
  "Grass", "Lightning", "Metal", "Psychic", "Water",
];
const VIDEO_GAME_OPTIONS = [
  "Red/Blue", "Gold/Silver", "Ruby/Sapphire", "FireRed/LeafGreen",
  "Diamond/Pearl", "Platinum", "HeartGold/SoulSilver",
  "Black/White", "Black 2/White 2", "X/Y", "Omega Ruby/Alpha Sapphire",
  "Sun/Moon", "Ultra Sun/Ultra Moon", "Let's Go Pikachu/Eevee",
  "Sword/Shield", "Brilliant Diamond/Shining Pearl",
  "Legends Arceus", "Scarlet/Violet", "Other",
];

const optArr = (v) => (Array.isArray(v) ? v : []);

const fullSpan = "col-span-1 sm:col-span-2 xl:col-span-3";

/**
 * @param {{
 *   fieldKey: string,
 *   ann: object,
 *   card: object,
 *   types?: string[],
 *   annValue: function,
 *   saveAnnotation: function,
 *   formOpts: object,
 *   inputClass: string,
 *   idSuffix?: string
 * }} props
 */
export default function CardDetailFieldControl({
  fieldKey,
  ann,
  card,
  types = [],
  annValue,
  saveAnnotation,
  formOpts,
  inputClass,
  idSuffix = "",
}) {
  const opts = formOpts || {};
  const suf = idSuffix;

  switch (fieldKey) {
    case "set_name":
      return (
        <div className={fullSpan}>
          <FormFieldLabel>Set name</FormFieldLabel>
          <ComboBox
            value={annValue("set_name") || card?.set_name || ""}
            onChange={(v) => saveAnnotation("set_name", v)}
            options={optArr(opts.setName)}
            placeholder="Set name"
            className={inputClass + " w-full"}
          />
        </div>
      );
    case "rarity":
      return (
        <div>
          <FormFieldLabel>Rarity</FormFieldLabel>
          <ComboBox
            value={annValue("rarity") || card?.rarity || ""}
            onChange={(v) => saveAnnotation("rarity", v)}
            options={optArr(opts.rarity)}
            placeholder="Promo"
            className={inputClass + " w-full"}
          />
        </div>
      );
    case "artist":
      return (
        <div>
          <FormFieldLabel>Artist</FormFieldLabel>
          <ComboBox
            value={annValue("artist") || card?.artist || ""}
            onChange={(v) => saveAnnotation("artist", v)}
            options={optArr(opts.artist)}
            placeholder="Ken Sugimori"
            className={inputClass + " w-full"}
          />
        </div>
      );
    case "types":
      return (
        <div>
          <FormFieldLabel>Type</FormFieldLabel>
          <MultiComboBox
            value={annValue("types", true) || types.join(", ")}
            onChange={(v) => saveAnnotation("types", v)}
            options={TCG_TYPE_OPTIONS}
            placeholder="Fire, Water, Lightning, etc."
          />
        </div>
      );
    case "unique_id":
      return (
        <div>
          <FormFieldLabel>Unique ID</FormFieldLabel>
          <input
            type="text"
            value={annValue("unique_id")}
            onChange={(e) => saveAnnotation("unique_id", e.target.value)}
            placeholder="e.g. custom-xy001"
            className={inputClass}
          />
        </div>
      );
    case "card_subcategory":
      return (
        <div>
          <FormFieldLabel>Card subcategory</FormFieldLabel>
          <MultiComboBox
            value={annValue("card_subcategory", true)}
            onChange={(v) => saveAnnotation("card_subcategory", v)}
            options={optArr(opts.cardSubcategory).length ? optArr(opts.cardSubcategory) : CARD_SUBCATEGORY_OPTIONS}
            placeholder="Full Art, Illustration Rare, etc."
          />
        </div>
      );
    case "evolution_line":
      return (
        <div>
          <FormFieldLabel>Evolution line</FormFieldLabel>
          <ComboBox
            value={annValue("evolution_line")}
            onChange={(v) => saveAnnotation("evolution_line", v)}
            options={optArr(opts.evolutionLine)}
            placeholder="Pichu → Pikachu → Raichu"
            className={inputClass + " w-full"}
          />
        </div>
      );
    case "card_border":
      return (
        <div>
          <FormFieldLabel>Card border color</FormFieldLabel>
          <ComboBox
            value={annValue("card_border")}
            onChange={(v) => saveAnnotation("card_border", v)}
            options={optArr(opts.cardBorder).length ? optArr(opts.cardBorder) : CARD_BORDER_OPTIONS}
            placeholder="Yellow, Silver, Blue, etc."
            className={inputClass + " w-full"}
          />
        </div>
      );
    case "stamp":
      return (
        <div>
          <FormFieldLabel>Stamp</FormFieldLabel>
          <ComboBox
            value={annValue("stamp")}
            onChange={(v) => saveAnnotation("stamp", v)}
            options={optArr(opts.stamp).length ? optArr(opts.stamp) : STAMP_OPTIONS}
            placeholder="Pokemon Center, Game Stop, etc."
            className={inputClass + " w-full"}
          />
        </div>
      );
    case "trainer_card_type":
      return (
        <div>
          <FormFieldLabel>Trainer card type</FormFieldLabel>
          <ComboBox
            value={annValue("trainer_card_type")}
            onChange={(v) => saveAnnotation("trainer_card_type", v)}
            options={optArr(opts.trainerCardType).length ? optArr(opts.trainerCardType) : TRAINER_CARD_TYPE_OPTIONS}
            placeholder="Supporter, Item, Stadium, etc."
            className={inputClass + " w-full"}
          />
        </div>
      );
    case "trainer_card_subgroup":
      return (
        <div>
          <FormFieldLabel>Trainer card subgroup</FormFieldLabel>
          <MultiComboBox
            value={annValue("trainer_card_subgroup", true)}
            onChange={(v) => saveAnnotation("trainer_card_subgroup", v)}
            options={optArr(opts.trainerCardSubgroup).length ? optArr(opts.trainerCardSubgroup) : TRAINER_CARD_SUBGROUP_OPTIONS}
            placeholder="Nameless Supporter, Villain Team Items, etc."
          />
        </div>
      );
    case "energy_type":
      return (
        <div>
          <FormFieldLabel>Energy card type</FormFieldLabel>
          <ComboBox
            value={annValue("energy_type")}
            onChange={(v) => saveAnnotation("energy_type", v)}
            options={optArr(opts.energyType).length ? optArr(opts.energyType) : ENERGY_TYPE_OPTIONS}
            placeholder="Basic, Special"
            className={inputClass + " w-full"}
          />
        </div>
      );
    case "pkmn_region":
      return (
        <div>
          <FormFieldLabel>Featured region</FormFieldLabel>
          <ComboBox
            value={annValue("pkmn_region")}
            onChange={(v) => saveAnnotation("pkmn_region", v)}
            options={optArr(opts.pkmnRegion)}
            placeholder="Kanto, Johto, Aquapolis, etc."
            className={inputClass + " w-full"}
          />
        </div>
      );
    case "card_locations":
      return (
        <div>
          <FormFieldLabel>Card location</FormFieldLabel>
          <ComboBox
            value={annValue("card_locations")}
            onChange={(v) => saveAnnotation("card_locations", v)}
            options={optArr(opts.cardLocations)}
            placeholder="Pallet Town, Route 110, etc."
            className={inputClass + " w-full"}
          />
        </div>
      );
    case "environment":
      return (
        <div>
          <FormFieldLabel>Environment</FormFieldLabel>
          <MultiComboBox
            value={annValue("environment", true)}
            onChange={(v) => saveAnnotation("environment", v)}
            options={optArr(opts.environment)}
            placeholder="Forest, Beach, Stadium, etc."
          />
        </div>
      );
    case "weather":
      return (
        <div>
          <FormFieldLabel>Weather</FormFieldLabel>
          <ComboBox
            value={annValue("weather")}
            onChange={(v) => saveAnnotation("weather", v)}
            options={optArr(opts.weather)}
            placeholder="Sunny, Lightning, Clouds, etc."
            className={inputClass + " w-full"}
          />
        </div>
      );
    case "background_details":
      return (
        <div>
          <FormFieldLabel>Background details</FormFieldLabel>
          <MultiComboBox
            value={annValue("background_details", true)}
            onChange={(v) => saveAnnotation("background_details", v)}
            options={optArr(opts.backgroundDetails)}
            placeholder="Island, Stump, Seafloor, Bridge, etc."
          />
        </div>
      );
    case "holiday_theme":
      return (
        <div>
          <FormFieldLabel>Holiday theme</FormFieldLabel>
          <MultiComboBox
            value={annValue("holiday_theme", true)}
            onChange={(v) => saveAnnotation("holiday_theme", v)}
            options={optArr(opts.holidayTheme).length ? optArr(opts.holidayTheme) : HOLIDAY_THEME_OPTIONS}
            placeholder="Halloween, Christmas, etc."
          />
        </div>
      );
    case "actions":
      return (
        <div>
          <FormFieldLabel>Actions</FormFieldLabel>
          <MultiComboBox
            value={annValue("actions", true)}
            onChange={(v) => saveAnnotation("actions", v)}
            options={optArr(opts.actions)}
            placeholder="Dancing, Firefighters, On A Boat"
          />
        </div>
      );
    case "pose":
      return (
        <div>
          <FormFieldLabel>Pose</FormFieldLabel>
          <MultiComboBox
            value={annValue("pose", true)}
            onChange={(v) => saveAnnotation("pose", v)}
            options={optArr(opts.pose)}
            placeholder="Flexing, Come At Me Bro, etc."
          />
        </div>
      );
    case "emotion":
      return (
        <div>
          <FormFieldLabel>Emotion</FormFieldLabel>
          <MultiComboBox
            value={annValue("emotion", true)}
            onChange={(v) => saveAnnotation("emotion", v)}
            options={optArr(opts.emotion)}
            placeholder="Crying, Scared, Angry, etc."
          />
        </div>
      );
    case "items":
      return (
        <div>
          <FormFieldLabel>Items</FormFieldLabel>
          <MultiComboBox
            value={annValue("items", true)}
            onChange={(v) => saveAnnotation("items", v)}
            options={optArr(opts.items)}
            placeholder="Clefairy Doll, Apple, Fossil, etc."
          />
        </div>
      );
    case "held_item":
      return (
        <div>
          <FormFieldLabel>Held item</FormFieldLabel>
          <MultiComboBox
            value={annValue("held_item", true)}
            onChange={(v) => saveAnnotation("held_item", v)}
            options={optArr(opts.heldItem).length ? optArr(opts.heldItem) : HELD_ITEM_OPTIONS}
            placeholder="Food, Flower, Pokeball, etc."
          />
        </div>
      );
    case "berries":
      return (
        <div>
          <FormFieldLabel>Berries (if present)</FormFieldLabel>
          <MultiComboBox
            value={annValue("berries", true)}
            onChange={(v) => saveAnnotation("berries", v)}
            options={optArr(opts.berries).length ? optArr(opts.berries) : BERRIES_OPTIONS}
            placeholder="Oran Berry, Razz Berry, etc."
          />
        </div>
      );
    case "pokeball":
      return (
        <div>
          <FormFieldLabel>Pokeball type (if present)</FormFieldLabel>
          <MultiComboBox
            value={annValue("pokeball", true)}
            onChange={(v) => saveAnnotation("pokeball", v)}
            options={optArr(opts.pokeball).length ? optArr(opts.pokeball) : POKEBALL_OPTIONS}
            placeholder="Great Ball, Timer Ball, etc."
          />
        </div>
      );
    case "evolution_items":
      return (
        <div>
          <FormFieldLabel>Evolution items (if present)</FormFieldLabel>
          <MultiComboBox
            value={annValue("evolution_items", true)}
            onChange={(v) => saveAnnotation("evolution_items", v)}
            options={optArr(opts.evolutionItems).length ? optArr(opts.evolutionItems) : EVOLUTION_ITEMS_OPTIONS}
            placeholder="Leaf Stone, Upgrade, etc."
          />
        </div>
      );
    case "background_pokemon":
      return (
        <div>
          <FormFieldLabel>Background Pokémon</FormFieldLabel>
          <MultiComboBox
            value={annValue("background_pokemon", true)}
            onChange={(v) => saveAnnotation("background_pokemon", v)}
            options={optArr(opts.backgroundPokemon)}
            placeholder="Squirtle, Pikachu, etc."
          />
        </div>
      );
    case "background_humans":
      return (
        <div>
          <FormFieldLabel>Background people type</FormFieldLabel>
          <MultiComboBox
            value={annValue("background_humans", true)}
            onChange={(v) => saveAnnotation("background_humans", v)}
            options={optArr(opts.backgroundHumans)}
            placeholder="Gym Leader, Trainer, Civilian"
          />
        </div>
      );
    case "additional_characters":
      return (
        <div>
          <FormFieldLabel>Background people name</FormFieldLabel>
          <MultiComboBox
            value={annValue("additional_characters", true)}
            onChange={(v) => saveAnnotation("additional_characters", v)}
            options={optArr(opts.additionalCharacters)}
            placeholder="Brock, Professor Oak, Delinquent"
          />
        </div>
      );
    case "rival_group":
      return (
        <div>
          <FormFieldLabel>Rival faction</FormFieldLabel>
          <ComboBox
            value={annValue("rival_group")}
            onChange={(v) => saveAnnotation("rival_group", v)}
            options={optArr(opts.rivalGroup).length ? optArr(opts.rivalGroup) : RIVAL_GROUP_OPTIONS}
            placeholder="Team Rocket, Team Aqua, etc."
            className={inputClass + " w-full"}
          />
        </div>
      );
    case "additional_character_theme":
      return (
        <div>
          <FormFieldLabel>Additional character theme</FormFieldLabel>
          <MultiComboBox
            value={annValue("additional_character_theme", true)}
            onChange={(v) => saveAnnotation("additional_character_theme", v)}
            options={optArr(opts.additionalCharacterTheme).length ? optArr(opts.additionalCharacterTheme) : ADDITIONAL_CHARACTER_THEME_OPTIONS}
            placeholder="Family First, Squad Gang, etc."
          />
        </div>
      );
    case "art_style":
      return (
        <div>
          <FormFieldLabel>Art style</FormFieldLabel>
          <MultiComboBox
            value={annValue("art_style", true)}
            onChange={(v) => saveAnnotation("art_style", v)}
            options={optArr(opts.artStyle)}
            placeholder="2D, Clay, Trippy Art, etc."
          />
        </div>
      );
    case "camera_angle":
      return (
        <div>
          <FormFieldLabel>Camera angle</FormFieldLabel>
          <ComboBox
            value={annValue("camera_angle")}
            onChange={(v) => saveAnnotation("camera_angle", v)}
            options={optArr(opts.cameraAngle)}
            placeholder="Aerial, Upside Down, etc."
            className={inputClass + " w-full"}
          />
        </div>
      );
    case "perspective":
      return (
        <div>
          <FormFieldLabel>Perspective</FormFieldLabel>
          <ComboBox
            value={annValue("perspective")}
            onChange={(v) => saveAnnotation("perspective", v)}
            options={optArr(opts.perspective)}
            placeholder="POV, Tiny, Rotate 90 Degrees"
            className={inputClass + " w-full"}
          />
        </div>
      );
    case "multi_card":
      return (
        <div>
          <FormFieldLabel>Multi card</FormFieldLabel>
          <MultiComboBox
            value={annValue("multi_card", true)}
            onChange={(v) => saveAnnotation("multi_card", v)}
            options={optArr(opts.multiCard).length ? optArr(opts.multiCard) : MULTI_CARD_OPTIONS}
            placeholder="Storytelling, Different Angles, etc."
          />
        </div>
      );
    case "video_game":
      return (
        <div>
          <FormFieldLabel>Video game</FormFieldLabel>
          <MultiComboBox
            value={annValue("video_game", true)}
            onChange={(v) => saveAnnotation("video_game", v)}
            options={VIDEO_GAME_OPTIONS}
            placeholder="X/Y"
          />
        </div>
      );
    case "video_game_location":
      return (
        <div>
          <FormFieldLabel>Video game location</FormFieldLabel>
          <MultiComboBox
            value={annValue("video_game_location", true)}
            onChange={(v) => saveAnnotation("video_game_location", v)}
            options={optArr(opts.videoGameLocation).length ? optArr(opts.videoGameLocation) : VIDEO_LOCATION_OPTIONS}
            placeholder="Pallet Town, Route 1"
          />
        </div>
      );
    case "shorts_appearance":
      return (
        <div className="flex items-center gap-2 pt-1 pb-1">
          <input
            type="checkbox"
            id={`cardDetail-shortsAppearance${suf}`}
            checked={!!ann.shorts_appearance}
            onChange={(e) => saveAnnotation("shorts_appearance", e.target.checked)}
            className="rounded"
          />
          <label htmlFor={`cardDetail-shortsAppearance${suf}`} className="text-sm text-gray-700">
            Shorts appearance
          </label>
        </div>
      );
    case "region_appearance":
      return (
        <div className="flex items-center gap-2 pt-1 pb-1">
          <input
            type="checkbox"
            id={`cardDetail-regionAppearance${suf}`}
            checked={!!ann.region_appearance}
            onChange={(e) => saveAnnotation("region_appearance", e.target.checked)}
            className="rounded"
          />
          <label htmlFor={`cardDetail-regionAppearance${suf}`} className="text-sm text-gray-700">
            Region appearance
          </label>
        </div>
      );
    case "thumbnail_used":
      return (
        <div className="flex items-center gap-2 pt-1 pb-1">
          <input
            type="checkbox"
            id={`cardDetail-thumbnailUsed${suf}`}
            checked={!!ann.thumbnail_used}
            onChange={(e) => saveAnnotation("thumbnail_used", e.target.checked)}
            className="rounded"
          />
          <label htmlFor={`cardDetail-thumbnailUsed${suf}`} className="text-sm text-gray-700">
            Thumbnail used
          </label>
        </div>
      );
    case "video_title":
      return (
        <div className={fullSpan}>
          <FormFieldLabel>Video title</FormFieldLabel>
          <MultiComboBox
            value={annValue("video_title", true)}
            onChange={(v) => saveAnnotation("video_title", v)}
            options={optArr(opts.videoTitle)}
            placeholder="Video title"
          />
        </div>
      );
    case "video_type":
      return (
        <div className={fullSpan}>
          <FormFieldLabel>Video type</FormFieldLabel>
          <MultiComboBox
            value={annValue("video_type", true)}
            onChange={(v) => saveAnnotation("video_type", v)}
            options={optArr(opts.videoType).length ? optArr(opts.videoType) : VIDEO_TYPE_OPTIONS}
            placeholder="Top 10, Every Card in a Region"
          />
        </div>
      );
    case "video_region":
      return (
        <div>
          <FormFieldLabel>Video region</FormFieldLabel>
          <MultiComboBox
            value={annValue("video_region", true)}
            onChange={(v) => saveAnnotation("video_region", v)}
            options={optArr(opts.videoRegion).length ? optArr(opts.videoRegion) : VIDEO_REGION_OPTIONS}
            placeholder="Kanto, Johto"
          />
        </div>
      );
    case "top_10_themes":
      return (
        <div>
          <FormFieldLabel>Top 10 themes</FormFieldLabel>
          <MultiComboBox
            value={annValue("top_10_themes", true)}
            onChange={(v) => saveAnnotation("top_10_themes", v)}
            options={optArr(opts.top10Themes).length ? optArr(opts.top10Themes) : TOP_10_THEMES_OPTIONS}
            placeholder="Theme"
          />
        </div>
      );
    case "wtpc_episode":
      return (
        <div>
          <FormFieldLabel>WTPC episode number</FormFieldLabel>
          <MultiComboBox
            value={annValue("wtpc_episode", true)}
            onChange={(v) => saveAnnotation("wtpc_episode", v)}
            options={WTPC_EPISODE_OPTIONS}
            placeholder="Episode 1"
          />
        </div>
      );
    case "video_location":
      return (
        <div>
          <FormFieldLabel>Video location</FormFieldLabel>
          <MultiComboBox
            value={annValue("video_location", true)}
            onChange={(v) => saveAnnotation("video_location", v)}
            options={optArr(opts.videoLocation).length ? optArr(opts.videoLocation) : VIDEO_LOCATION_OPTIONS}
            placeholder="Pallet Town, Lumiose City"
          />
        </div>
      );
    case "pocket_exclusive":
      return (
        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id={`cardDetail-pocketExclusive${suf}`}
            checked={!!ann.pocket_exclusive}
            onChange={(e) => saveAnnotation("pocket_exclusive", e.target.checked)}
            className="rounded"
          />
          <label htmlFor={`cardDetail-pocketExclusive${suf}`} className="text-sm text-gray-700">
            Pocket exclusive
          </label>
        </div>
      );
    case "owned":
      return (
        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id={`cardDetail-owned${suf}`}
            checked={!!ann.owned}
            onChange={(e) => saveAnnotation("owned", e.target.checked)}
            className="rounded"
          />
          <label htmlFor={`cardDetail-owned${suf}`} className="text-sm text-gray-700">
            Owned
          </label>
        </div>
      );
    case "notes":
      return (
        <div className={fullSpan}>
          <FormFieldLabel>Notes</FormFieldLabel>
          <textarea
            value={annValue("notes")}
            onChange={(e) => saveAnnotation("notes", e.target.value)}
            rows={3}
            placeholder="Any additional notes..."
            className={inputClass + " w-full"}
          />
        </div>
      );
    default:
      return null;
  }
}
