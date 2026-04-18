/**
 * Single annotation field editor for Card detail — used in the main form and the pin strip
 * so values stay in sync (one saveAnnotation path).
 */

import ComboBox from "./ComboBox.jsx";
import MultiComboBox from "./MultiComboBox.jsx";
import FormFieldLabel from "./ui/FormFieldLabel.jsx";
/** Keys that can be pinned (subset of Card detail edit form; expand over time). */
export const CARD_DETAIL_PINNABLE_KEYS = [
  "set_name",
  "rarity",
  "pkmn_region",
  "card_locations",
  "environment",
  "pose",
  "emotion",
  "actions",
  "art_style",
  "background_pokemon",
  "owned",
  "notes",
];

export const CARD_DETAIL_PIN_LABELS = {
  set_name: "Set name",
  rarity: "Rarity",
  pkmn_region: "Featured region",
  card_locations: "Card location",
  environment: "Environment",
  pose: "Pose",
  emotion: "Emotion",
  actions: "Actions",
  art_style: "Art style",
  background_pokemon: "Background Pokémon",
  owned: "Owned",
  notes: "Notes",
};

const optArr = (v) => (Array.isArray(v) ? v : []);

/** @param {{ fieldKey: string, ann: object, card: object, annValue: function, saveAnnotation: function, formOpts: object, inputClass: string, idSuffix?: string }} props */
export default function CardDetailFieldControl({
  fieldKey,
  ann,
  card,
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
        <div className="col-span-1 sm:col-span-2 xl:col-span-3">
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
        <div className="col-span-1 sm:col-span-2 xl:col-span-3">
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
