/**
 * CustomCardForm — Expanded form to add custom cards with all fields
 * and optional GitHub auto-commit via PAT.
 */

import { useState, useEffect } from "react";
import { addCustomCard, fetchFormOptions } from "../db";
import { getToken, commitNewCard } from "../lib/github";
import ComboBox from "./ComboBox";
import MultiComboBox from "./MultiComboBox";
import {
  SOURCE_OPTIONS, CARD_SUBCATEGORY_OPTIONS, HELD_ITEM_OPTIONS, POKEBALL_OPTIONS,
  EVOLUTION_ITEMS_OPTIONS, BERRIES_OPTIONS, HOLIDAY_THEME_OPTIONS,
  MULTI_CARD_OPTIONS, TRAINER_CARD_TYPE_OPTIONS, TRAINER_CARD_SUBGROUP_OPTIONS,
  VIDEO_TYPE_OPTIONS, TOP_10_THEMES_OPTIONS, WTPC_EPISODE_OPTIONS,
  VIDEO_REGION_OPTIONS, VIDEO_LOCATION_OPTIONS,
  STAMP_OPTIONS,
} from "../lib/annotationOptions";

// Sources that have existing card databases — Card ID auto-generation is skipped
// for these to avoid ID collisions with real cards across annotation tables.
const NON_CUSTOM_SOURCES = new Set(["TCG", "Pocket"]);

// Hardcoded option sets
const COLOR_OPTIONS = [
  "black", "blue", "brown", "gray", "green", "pink", "purple", "red", "white", "yellow",
];
const SHAPE_OPTIONS = [
  "ball", "squiggle", "fish", "arms", "blob", "upright", "legs",
  "quadruped", "wings", "tentacles", "heads", "humanoid", "bug-wings", "armor",
];
const VIDEO_GAME_OPTIONS = [
  "Red/Blue", "Gold/Silver", "Ruby/Sapphire", "FireRed/LeafGreen",
  "Diamond/Pearl", "Platinum", "HeartGold/SoulSilver",
  "Black/White", "Black 2/White 2", "X/Y", "Omega Ruby/Alpha Sapphire",
  "Sun/Moon", "Ultra Sun/Ultra Moon", "Let's Go Pikachu/Eevee",
  "Sword/Shield", "Brilliant Diamond/Shining Pearl",
  "Legends Arceus", "Scarlet/Violet", "Other",
];

function CollapsibleSection({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t pt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left text-sm font-medium text-gray-600 hover:text-gray-800"
      >
        <svg
          className={`w-4 h-4 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {title}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export default function CustomCardForm({ onCardAdded, onClose }) {
  // ── Required fields ──
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [setIdVal, setSetIdVal] = useState("");
  const [setNameVal, setSetNameVal] = useState("");
  const [imageSmall, setImageSmall] = useState("");
  const [source, setSource] = useState("");

  // ── Card details ──
  const [supertype, setSupertype] = useState("Pokémon");
  const [subtypes, setSubtypes] = useState("");
  const [types, setTypes] = useState("");
  const [hp, setHp] = useState("");
  const [rarity, setRarity] = useState("");
  const [specialRarity, setSpecialRarity] = useState("");
  const [artist, setArtist] = useState("");
  const [number, setNumber] = useState("");
  const [altName, setAltName] = useState("");
  const [evolvesFrom, setEvolvesFrom] = useState("");
  const [setSeries, setSetSeries] = useState("");
  const [regulationMark, setRegulationMark] = useState("");
  const [imageLarge, setImageLarge] = useState("");

  // ── Annotation fields ──
  const [artStyle, setArtStyle] = useState("");
  const [mainCharacter, setMainCharacter] = useState("");
  const [backgroundPokemon, setBackgroundPokemon] = useState("");
  const [backgroundHumans, setBackgroundHumans] = useState("");
  const [additionalCharacters, setAdditionalCharacters] = useState("");
  const [emotion, setEmotion] = useState("");
  const [pose, setPose] = useState("");
  const [cameraAngle, setCameraAngle] = useState("");
  const [items, setItems] = useState("");
  const [actions, setActions] = useState("");
  const [perspective, setPerspective] = useState("");
  const [weather, setWeather] = useState("");
  const [environment, setEnvironment] = useState("");
  const [storytelling, setStorytelling] = useState("");
  const [backgroundDetails, setBackgroundDetails] = useState("");
  const [cardLocations, setCardLocations] = useState("");
  const [pkmnRegion, setPkmnRegion] = useState("");
  const [cardRegion, setCardRegion] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [shape, setShape] = useState("");
  const [evolutionLine, setEvolutionLine] = useState("");
  const [cardSubcategory, setCardSubcategory] = useState("");
  const [heldItem, setHeldItem] = useState("");
  const [pokeball, setPokeball] = useState("");
  const [evolutionItems, setEvolutionItems] = useState("");
  const [berries, setBerries] = useState("");
  const [holidayTheme, setHolidayTheme] = useState("");
  const [multiCard, setMultiCard] = useState("");
  const [trainerCardType, setTrainerCardType] = useState("");
  const [trainerCardSubgroup, setTrainerCardSubgroup] = useState("");
  const [pocketExclusive, setPocketExclusive] = useState(false);
  const [stamp, setStamp] = useState("");

  // ── Video fields ──
  const [videoGame, setVideoGame] = useState("");
  const [videoGameLocation, setVideoGameLocation] = useState("");
  const [shortsAppearance, setShortsAppearance] = useState(false);
  const [regionAppearance, setRegionAppearance] = useState(false);
  const [thumbnailUsed, setThumbnailUsed] = useState(false);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoType, setVideoType] = useState("");
  const [top10Themes, setTop10Themes] = useState("");
  const [wtpcEpisode, setWtpcEpisode] = useState("");
  const [videoRegion, setVideoRegion] = useState("");
  const [videoLocation, setVideoLocation] = useState("");

  // ── Notes fields ──
  const [owned, setOwned] = useState(false);
  const [notes, setNotes] = useState("");

  // ── UI state ──
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [creating, setCreating] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [setIdManual, setSetIdManual] = useState(false);

  // ── Combobox options (loaded from DB) ──
  const [opts, setOpts] = useState({});

  // Auto-generate Set ID from Set Name for custom-only sources.
  // Stops auto-filling if the user manually edits the Set ID field.
  useEffect(() => {
    if (NON_CUSTOM_SOURCES.has(source) || setIdManual) return;
    // Acronym: first letter of each word + any trailing digits (e.g. "Test Set Name, Set 4" → "tsns4")
    const derived = setNameVal
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .trim()
      .split(/\s+/)
      .map((w) => (/^\d+$/.test(w) ? w : w[0]))
      .join("")
      .toLowerCase();
    setSetIdVal(derived);
  }, [setNameVal, source, setIdManual]);

  // Auto-generate Card ID from Set ID + Card Number for custom-only sources.
  // Skipped for "TCG" and "Pocket" sources since those have existing card databases
  // with established IDs — a collision would corrupt annotation updates across tables.
  useEffect(() => {
    if (NON_CUSTOM_SOURCES.has(source)) return;
    setId(setIdVal && number ? `${setIdVal}-${number}` : "");
  }, [setIdVal, number, source]);

  useEffect(() => {
    fetchFormOptions()
      .then(setOpts)
      .catch((err) => console.warn("Failed to load form options:", err.message));
  }, []);

  // Parse comma-separated string into array, filtering empty
  const toArray = (s) => s ? s.split(",").map(v => v.trim()).filter(Boolean) : [];
  // Format for JSON storage - returns JSON string of array or null
  const arrayStr = (s) => {
    const arr = toArray(s);
    return arr.length > 0 ? JSON.stringify(arr) : "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setCreating(true);

    try {
      if (!name || !number || !setNameVal || !imageSmall || !source) {
        throw new Error("Please fill in all required fields");
      }

      const bgPokemon = toArray(backgroundPokemon).map(v => v.toLowerCase());

      // Build card object for custom_cards.json format
      const cardJson = {
        id,
        name,
        alt_name: altName || "",
        supertype: supertype || "",
        subtypes: toArray(subtypes),
        hp: hp ? Number(hp) || hp : null,
        types: toArray(types),
        evolves_from: evolvesFrom || null,
        rarity: rarity || "",
        special_rarity: specialRarity || "",
        artist: artist || "",
        art_style: toArray(artStyle),
        set_id: setIdVal,
        set_name: setNameVal,
        set_series: setSeries || "",
        number: number || "",
        regulation_mark: regulationMark || "",
        image_small: imageSmall,
        image_large: imageLarge || imageSmall,
        source,
        owned,
        notes: notes || "",
        main_character: toArray(mainCharacter),
        background_pokemon: bgPokemon,
        background_humans: backgroundHumans ? toArray(backgroundHumans) : null,
        primary_color: primaryColor || "",
        secondary_color: secondaryColor || "",
        shape: shape || "",
        video_game: toArray(videoGame),
        video_game_location: toArray(videoGameLocation),
        shorts_appearance: shortsAppearance,
        region_appearance: regionAppearance,
        thumbnail_used: thumbnailUsed,
        video_title: toArray(videoTitle),
        video_type: toArray(videoType),
        top_10_themes: toArray(top10Themes),
        wtpc_episode: toArray(wtpcEpisode),
        video_region: toArray(videoRegion),
        video_location: toArray(videoLocation),
        unique_id: id,
        evolution_line: (evolutionLine || "").toLowerCase(),
        emotion: toArray(emotion),
        pose: toArray(pose),
        camera_angle: cameraAngle || "",
        items: items || "",
        actions: toArray(actions),
        additional_characters: toArray(additionalCharacters),
        perspective: perspective || "",
        weather: weather || "",
        environment: environment || "",
        storytelling: storytelling || "",
        background_details: toArray(backgroundDetails),
        card_locations: cardLocations || "",
        pkmn_region: pkmnRegion || "",
        card_region: cardRegion || "",
        card_subcategory: toArray(cardSubcategory),
        held_item: heldItem || "",
        pokeball: pokeball || "",
        evolution_items: toArray(evolutionItems),
        berries: toArray(berries),
        holiday_theme: toArray(holidayTheme),
        multi_card: toArray(multiCard),
        trainer_card_type: trainerCardType || "",
        trainer_card_subgroup: toArray(trainerCardSubgroup),
        pocket_exclusive: pocketExclusive,
        stamp: stamp || "",
      };

      // Build card for DuckDB insert (arrays as JSON strings, evolution_line as arrow string)
      const dbCard = {
        ...cardJson,
        subtypes: JSON.stringify(cardJson.subtypes),
        types: JSON.stringify(cardJson.types),
        art_style: arrayStr(artStyle),
        main_character: arrayStr(mainCharacter),
        background_pokemon: bgPokemon.length ? JSON.stringify(bgPokemon) : "",
        background_humans: backgroundHumans ? arrayStr(backgroundHumans) : "",
        additional_characters: arrayStr(additionalCharacters),
        background_details: arrayStr(backgroundDetails),
        evolution_line: (evolutionLine || "").toLowerCase(),
        image_large: imageLarge || imageSmall,
        unique_id: id,
        card_subcategory:      arrayStr(cardSubcategory),
        evolution_items:       arrayStr(evolutionItems),
        berries:               arrayStr(berries),
        holiday_theme:         arrayStr(holidayTheme),
        multi_card:            arrayStr(multiCard),
        trainer_card_subgroup: arrayStr(trainerCardSubgroup),
        video_title:           arrayStr(videoTitle),
        video_game:            arrayStr(videoGame),
        video_game_location:     arrayStr(videoGameLocation),
        video_type:            arrayStr(videoType),
        top_10_themes:         arrayStr(top10Themes),
        wtpc_episode:          arrayStr(wtpcEpisode),
        video_region:          arrayStr(videoRegion),
        video_location:        arrayStr(videoLocation),
      };

      // Insert into local DuckDB
      await addCustomCard(dbCard);

      // Auto-commit to GitHub if token is set
      let ghCommitted = false;
      const token = getToken();
      if (token) {
        try {
          await commitNewCard(token, cardJson);
          ghCommitted = true;
        } catch (ghErr) {
          console.warn("GitHub commit failed:", ghErr.message);
          setError(`Card added locally but GitHub commit failed: ${ghErr.message}`);
        }
      }

      setSuccess(
        ghCommitted
          ? `Card "${name}" added and committed to GitHub!`
          : `Card "${name}" added locally.${token ? "" : " Set a GitHub PAT to auto-commit."}`
      );

      // Refetch form options so dropdowns include the newly submitted values
      fetchFormOptions().then(setOpts).catch(() => {});

      // Reset form
      setId(""); setName(""); setImageSmall(""); setImageLarge("");
      setSource("");
      setAltName(""); setEvolvesFrom(""); setHp(""); setRarity("");
      setSpecialRarity(""); setArtist(""); setNumber(""); setRegulationMark("");
      setArtStyle(""); setMainCharacter(""); setBackgroundPokemon("");
      setBackgroundHumans(""); setAdditionalCharacters(""); setEmotion("");
      setPose(""); setCameraAngle(""); setItems(""); setActions("");
      setPerspective(""); setWeather(""); setEnvironment(""); setStorytelling("");
      setBackgroundDetails(""); setCardLocations(""); setPkmnRegion(""); setCardRegion("");
      setPrimaryColor(""); setSecondaryColor(""); setShape(""); setEvolutionLine("");
      setVideoGame(""); setVideoGameRegion(""); setShortsAppearance(false); setRegionAppearance(false); setThumbnailUsed(false);
      setVideoTitle(""); setVideoType(""); setTop10Themes(""); setWtpcEpisode(""); setVideoRegion(""); setVideoLocation(""); setOwned(false); setNotes("");
      setCardSubcategory(""); setHeldItem(""); setPokeball("");
      setEvolutionItems(""); setBerries(""); setHolidayTheme("");
      setMultiCard(""); setTrainerCardType(""); setTrainerCardSubgroup("");
      setPocketExclusive(false); setStamp("");
      setSetIdManual(false);
      setImageError(false);

      onCardAdded?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const inputClass =
    "px-3 py-1.5 border border-gray-300 rounded text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-800">Add Custom Card</h2>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            &times;
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm mb-4">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded text-sm mb-4">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* ── Required Fields ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Name <span className="text-red-500">*</span></label>
            <ComboBox value={name} onChange={setName} options={opts.name || []} placeholder="e.g., Pikachu" className={inputClass + " w-full"} />
          </div>
          <div>
            <label className={labelClass}>Set Series</label>
            <ComboBox value={setSeries} onChange={setSetSeries} options={opts.setSeries || []} placeholder="e.g., Black & White" className={inputClass + " w-full"} />
          </div>
          <div>
            <label className={labelClass}>Set Name <span className="text-red-500">*</span></label>
            <ComboBox value={setNameVal} onChange={setSetNameVal} options={opts.setName || []} placeholder="e.g., XY Japanese Promos" className={inputClass + " w-full"} />
          </div>
          <div>
            <label className={labelClass}>Card Number <span className="text-red-500">*</span></label>
            <input type="text" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Number in set" className={inputClass + " w-full"} />
          </div>
          <div>
            <label className={labelClass}>Pokémon Region</label>
            <ComboBox value={pkmnRegion} onChange={setPkmnRegion} options={opts.pkmnRegion || []} placeholder="Johto" className={inputClass + " w-full"} />
          </div>
          <div>
            <label className={labelClass}>Artist</label>
            <ComboBox value={artist} onChange={setArtist} options={opts.artist || []} placeholder="Ken Sugimori" className={inputClass + " w-full"} />
          </div>
          <div>
            <label className={labelClass}>Source <span className="text-red-500">*</span></label>
            <ComboBox value={source} onChange={setSource} options={[...new Set([...SOURCE_OPTIONS, ...(opts.source || [])])]} placeholder="e.g., Japan Exclusive" className={inputClass + " w-full"} />
          </div>
          <div className="flex items-center gap-2 pt-5">
            <input type="checkbox" id="pocketExclusive" checked={pocketExclusive}
              onChange={(e) => setPocketExclusive(e.target.checked)} className="rounded" />
            <label htmlFor="pocketExclusive" className="text-sm text-gray-700">Pocket Exclusive</label>
          </div>
          <div className="col-span-1 md:col-span-3">
            <label className={labelClass}>Image URL <span className="text-red-500">*</span></label>
            <input type="url" value={imageSmall} onChange={(e) => { setImageSmall(e.target.value); setImageError(false); }} placeholder="https://..." required className={inputClass + " w-full"} />
          </div>
          <div className="col-span-1 md:col-span-3 pb-2">
            <label className={labelClass}>Large Image URL [Optional]</label>
            <input type="url" value={imageLarge} onChange={(e) => setImageLarge(e.target.value)} placeholder="https://..." className={inputClass + " w-full"} />
          </div>
        </div>

        {/* Image Preview */}
        {imageSmall && (
          <div className="flex justify-center">
            <div className="w-48">
              {!imageError ? (
                <img src={imageSmall} alt="Preview" className="w-full h-auto rounded shadow-md" onError={() => setImageError(true)} />
              ) : (
                <div className="w-full h-64 bg-gray-100 rounded flex items-center justify-center text-gray-500 text-sm">Failed to load</div>
              )}
            </div>
          </div>
        )}

        {/* ── Card Details (collapsible) ── */}
        <CollapsibleSection title="Card Details">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pb-2">
            <div>
              <label className={labelClass}>Supertype</label>
              <select value={supertype} onChange={(e) => setSupertype(e.target.value)} className={inputClass + " w-full"}>
                <option value="Pokémon">Pokémon</option>
                <option value="Trainer">Trainer</option>
                <option value="Energy">Energy</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Subtypes</label>
              <MultiComboBox value={subtypes} onChange={setSubtypes} options={opts.subtypes || []} placeholder="Basic, Stage 1" />
            </div>
            <div>
              <label className={labelClass}>Types</label>
              <MultiComboBox value={types} onChange={setTypes} options={opts.types || []} placeholder="Lightning, Fire" />
            </div>
            <div>
              <label className={labelClass}>HP</label>
              <input type="text" value={hp} onChange={(e) => setHp(e.target.value)} placeholder="60" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Evolves From</label>
              <input type="text" value={evolvesFrom} onChange={(e) => setEvolvesFrom(e.target.value)} placeholder="Pichu" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Evolution Line</label>
              <ComboBox value={evolutionLine} onChange={setEvolutionLine} options={opts.evolutionLine || []} placeholder="Pichu → Pikachu → Raichu" className={inputClass + " w-full"} />
            </div>
          </div>
        </CollapsibleSection>

        {/* ── Annotations (collapsible) ── */}
        <CollapsibleSection title="Annotations">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">

            {/* ── Card Classification ── */}
            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Card Classification</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div>
              <label className={labelClass}>Rarity</label>
              <ComboBox value={rarity} onChange={setRarity} options={opts.rarity || []} placeholder="Promo" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Card Subcategory</label>
              <MultiComboBox value={cardSubcategory} onChange={setCardSubcategory} options={opts.cardSubcategory || CARD_SUBCATEGORY_OPTIONS} placeholder="Full Art, Alternate Arts" />
            </div>
            <div>
              <label className={labelClass}>Trainer Card Type</label>
              <ComboBox value={trainerCardType} onChange={setTrainerCardType} options={opts.trainerCardType || TRAINER_CARD_TYPE_OPTIONS} placeholder="Item" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Trainer Card Subgroup</label>
              <MultiComboBox value={trainerCardSubgroup} onChange={setTrainerCardSubgroup} options={opts.trainerCardSubgroup || TRAINER_CARD_SUBGROUP_OPTIONS} placeholder="Nameless Supporter" />
            </div>
            <div>
              <label className={labelClass}>Stamp</label>
              <ComboBox value={stamp} onChange={setStamp}
                options={opts.stamp || STAMP_OPTIONS} placeholder="Pokemon Day"
                className={inputClass + " w-full"} />
            </div>

            {/* ── Background Characters ── */}
            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Background Characters</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div>
              <label className={labelClass}>Background Pokemon</label>
              <MultiComboBox value={backgroundPokemon} onChange={setBackgroundPokemon} options={opts.backgroundPokemon || []} placeholder="Bulbasaur, Squirtle" />
            </div>
            <div>
              <label className={labelClass}>Background Humans</label>
              <MultiComboBox value={backgroundHumans} onChange={setBackgroundHumans} options={opts.backgroundHumans || []} placeholder="Ash, Misty" />
            </div>
            <div>
              <label className={labelClass}>Additional Characters</label>
              <MultiComboBox value={additionalCharacters} onChange={setAdditionalCharacters} options={opts.additionalCharacters || []} placeholder="Friends, Rivals" />
            </div>
            {/* ── Subject ── */}
            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Subject</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div>
              <label className={labelClass}>Emotion</label>
              <MultiComboBox value={emotion} onChange={setEmotion} options={opts.emotion || []} placeholder="Happy" />
            </div>
            <div>
              <label className={labelClass}>Pose</label>
              <MultiComboBox value={pose} onChange={setPose} options={opts.pose || []} placeholder="Jumping" />
            </div>
            <div>
              <label className={labelClass}>Actions</label>
              <MultiComboBox value={actions} onChange={setActions} options={opts.actions || []} placeholder="Running" />
            </div>

            {/* ── Art Style ── */}
            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Art Style</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div>
              <label className={labelClass}>Art Style</label>
              <MultiComboBox value={artStyle} onChange={setArtStyle} options={opts.artStyle || []} placeholder="Chibi, Cartoon" />
            </div>
            <div>
              <label className={labelClass}>Camera Angle</label>
              <ComboBox value={cameraAngle} onChange={setCameraAngle} options={opts.cameraAngle || []} placeholder="Front" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Perspective</label>
              <ComboBox value={perspective} onChange={setPerspective} options={opts.perspective || []} placeholder="" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Primary Color</label>
              <ComboBox value={primaryColor} onChange={setPrimaryColor} options={COLOR_OPTIONS} placeholder="Yellow" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Secondary Color</label>
              <ComboBox value={secondaryColor} onChange={setSecondaryColor} options={COLOR_OPTIONS} placeholder="Brown" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Storytelling</label>
              <ComboBox value={storytelling} onChange={setStorytelling} options={opts.storytelling || []} placeholder="Celebration" className={inputClass + " w-full"} />
            </div>

            {/* ── Scene & Setting ── */}
            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Scene & Setting</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div>
              <label className={labelClass}>Card Region</label>
              <ComboBox value={cardRegion} onChange={setCardRegion} options={opts.cardRegion || []} placeholder="Johto" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Card Location</label>
              <ComboBox value={cardLocations} onChange={setCardLocations} options={opts.cardLocations || []} placeholder="Nagoya" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Weather</label>
              <ComboBox value={weather} onChange={setWeather} options={opts.weather || []} placeholder="Sunny" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Environment</label>
              <ComboBox value={environment} onChange={setEnvironment} options={opts.environment || []} placeholder="Indoors" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Background Details</label>
              <MultiComboBox value={backgroundDetails} onChange={setBackgroundDetails} options={opts.backgroundDetails || []} placeholder="Trees, River" />
            </div>

            {/* ── Items ── */}
            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Items</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div>
              <label className={labelClass}>Items</label>
              <ComboBox value={items} onChange={setItems} options={opts.items || []} placeholder="Poke Ball" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Held Item</label>
              <ComboBox value={heldItem} onChange={setHeldItem} options={opts.heldItem || HELD_ITEM_OPTIONS} placeholder="Berry" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Pokeball</label>
              <ComboBox value={pokeball} onChange={setPokeball} options={opts.pokeball || POKEBALL_OPTIONS} placeholder="Great Ball" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Evolution Items</label>
              <MultiComboBox value={evolutionItems} onChange={setEvolutionItems} options={opts.evolutionItems || EVOLUTION_ITEMS_OPTIONS} placeholder="Fire Stone" />
            </div>
            <div>
              <label className={labelClass}>Berries</label>
              <MultiComboBox value={berries} onChange={setBerries} options={opts.berries || BERRIES_OPTIONS} placeholder="Oran Berry" />
            </div>

            {/* ── Themes ── */}
            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Themes</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div>
              <label className={labelClass}>Holiday Theme</label>
              <MultiComboBox value={holidayTheme} onChange={setHolidayTheme} options={opts.holidayTheme || HOLIDAY_THEME_OPTIONS} placeholder="Halloween" />
            </div>
            <div>
              <label className={labelClass}>Multi Card</label>
              <MultiComboBox value={multiCard} onChange={setMultiCard} options={opts.multiCard || MULTI_CARD_OPTIONS} placeholder="Storytelling" />
            </div>

          </div>
        </CollapsibleSection>

        {/* ── Video (collapsible) ── */}
        <CollapsibleSection title="Video">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">

            {/* ── Video Games ── */}
            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Video Games</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div>
              <label className={labelClass}>Video Game</label>
              <MultiComboBox value={videoGame} onChange={setVideoGame} options={VIDEO_GAME_OPTIONS} placeholder="X/Y" />
            </div>
            <div>
              <label className={labelClass}>Video Game Location</label>
              <MultiComboBox value={videoGameLocation} onChange={setVideoGameLocation} options={opts.videoGameLocation || VIDEO_LOCATION_OPTIONS} placeholder="Pallet Town, Route 1" />
            </div>

            {/* ── YouTube Videos ── */}
            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">YouTube Videos</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div className="flex items-center gap-2 pt-1 pb-3">
              <input type="checkbox" id="shortsAppearance" checked={shortsAppearance} onChange={(e) => setShortsAppearance(e.target.checked)} className="rounded" />
              <label htmlFor="shortsAppearance" className="text-sm text-gray-700">Shorts Appearance</label>
            </div>
            <div className="flex items-center gap-2 pt-1 pb-3">
              <input type="checkbox" id="regionAppearance" checked={regionAppearance} onChange={(e) => setRegionAppearance(e.target.checked)} className="rounded" />
              <label htmlFor="regionAppearance" className="text-sm text-gray-700">Region Appearance</label>
            </div>
            <div className="flex items-center gap-2 pt-1 pb-3">
              <input type="checkbox" id="thumbnailUsed" checked={thumbnailUsed} onChange={(e) => setThumbnailUsed(e.target.checked)} className="rounded" />
              <label htmlFor="thumbnailUsed" className="text-sm text-gray-700">Thumbnail Used</label>
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className={labelClass}>Video Title</label>
              <MultiComboBox value={videoTitle} onChange={setVideoTitle} options={opts.videoTitle || []} placeholder="Video title" />
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className={labelClass}>Video Type</label>
              <MultiComboBox value={videoType} onChange={setVideoType}
                options={opts.videoType || VIDEO_TYPE_OPTIONS} placeholder="Top 10, Every Card in a Region" />
            </div>
            <div>
              <label className={labelClass}>Video Region</label>
              <MultiComboBox value={videoRegion} onChange={setVideoRegion}
                options={opts.videoRegion || VIDEO_REGION_OPTIONS} placeholder="Kanto, Johto" />
            </div>
            <div>
              <label className={labelClass}>Top 10 Themes</label>
              <MultiComboBox value={top10Themes} onChange={setTop10Themes}
                options={opts.top10Themes || TOP_10_THEMES_OPTIONS} placeholder="Theme" />
            </div>
            <div>
              <label className={labelClass}>WTPC Episode Number</label>
              <MultiComboBox value={wtpcEpisode} onChange={setWtpcEpisode}
                options={WTPC_EPISODE_OPTIONS} placeholder="Episode 1" />
            </div>
            <div>
              <label className={labelClass}>Video Location</label>
              <MultiComboBox value={videoLocation} onChange={setVideoLocation}
                options={opts.videoLocation || VIDEO_LOCATION_OPTIONS} placeholder="Pallet Town, Lumiose City" />
            </div>
          </div>
        </CollapsibleSection>

        {/* ── Notes (collapsible) ── */}
        <CollapsibleSection title="Notes">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="owned" checked={owned} onChange={(e) => setOwned(e.target.checked)} className="rounded" />
              <label htmlFor="owned" className="text-sm text-gray-700">Owned</label>
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Any additional notes..." className={inputClass + " w-full"} />
            </div>
          </div>
        </CollapsibleSection>

        {/* ── Submit ── */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 bg-green-600 text-white rounded text-sm font-medium
                       hover:bg-green-700 disabled:bg-gray-400 transition-colors"
          >
            {creating ? "Adding..." : "Add Card"}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded text-sm font-medium
                         hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
