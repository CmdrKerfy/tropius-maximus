/**
 * CustomCardForm — Expanded form to add custom cards with all fields
 * and optional GitHub auto-commit via PAT.
 */

import { useState, useEffect } from "react";
import { addCustomCard, fetchFormOptions } from "../db";
import { getToken, setToken, commitNewCard } from "../lib/github";
import ComboBox from "./ComboBox";
import MultiComboBox from "./MultiComboBox";

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
  const [weatherEnvironment, setWeatherEnvironment] = useState("");
  const [storytelling, setStorytelling] = useState("");
  const [backgroundDetails, setBackgroundDetails] = useState("");
  const [cardLocations, setCardLocations] = useState("");
  const [pkmnRegion, setPkmnRegion] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [shape, setShape] = useState("");
  const [evolutionLine, setEvolutionLine] = useState("");

  // ── Video fields ──
  const [videoGame, setVideoGame] = useState("");
  const [videoAppearance, setVideoAppearance] = useState(false);
  const [thumbnailUsed, setThumbnailUsed] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoTitle, setVideoTitle] = useState("");

  // ── Notes fields ──
  const [owned, setOwned] = useState(false);
  const [notes, setNotes] = useState("");

  // ── UI state ──
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [creating, setCreating] = useState(false);
  const [imageError, setImageError] = useState(false);

  // ── GitHub token ──
  const [ghToken, setGhToken] = useState(getToken());
  const [showTokenInput, setShowTokenInput] = useState(false);

  // ── Combobox options (loaded from DB) ──
  const [opts, setOpts] = useState({});

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
      if (!id || !name || !setIdVal || !setNameVal || !imageSmall || !source) {
        throw new Error("Please fill in all required fields");
      }

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
        background_pokemon: toArray(backgroundPokemon),
        background_humans: backgroundHumans ? toArray(backgroundHumans) : null,
        primary_color: primaryColor || "",
        secondary_color: secondaryColor || "",
        shape: shape || "",
        video_game: videoGame || null,
        video_appearance: videoAppearance,
        thumbnail_used: thumbnailUsed,
        video_url: videoUrl || "",
        video_title: videoTitle || "",
        unique_id: id,
        evolution_line: toArray(evolutionLine),
        emotion: emotion || "",
        pose: pose || "",
        camera_angle: cameraAngle || "",
        items: items || "",
        actions: actions || "",
        additional_characters: toArray(additionalCharacters),
        perspective: perspective || "",
        weather_environment: weatherEnvironment || "",
        storytelling: storytelling || "",
        background_details: toArray(backgroundDetails),
        card_locations: cardLocations || "",
        pkmn_region: pkmnRegion || "",
      };

      // Build card for DuckDB insert (arrays as JSON strings, evolution_line as arrow string)
      const dbCard = {
        ...cardJson,
        subtypes: JSON.stringify(cardJson.subtypes),
        types: JSON.stringify(cardJson.types),
        art_style: arrayStr(artStyle),
        main_character: arrayStr(mainCharacter),
        background_pokemon: arrayStr(backgroundPokemon),
        background_humans: backgroundHumans ? arrayStr(backgroundHumans) : "",
        additional_characters: arrayStr(additionalCharacters),
        background_details: arrayStr(backgroundDetails),
        evolution_line: toArray(evolutionLine).join(" → "),
        image_large: imageLarge || imageSmall,
        unique_id: id,
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
      setPerspective(""); setWeatherEnvironment(""); setStorytelling("");
      setBackgroundDetails(""); setCardLocations(""); setPkmnRegion("");
      setPrimaryColor(""); setSecondaryColor(""); setShape(""); setEvolutionLine("");
      setVideoGame(""); setVideoAppearance(false); setThumbnailUsed(false);
      setVideoUrl(""); setVideoTitle(""); setOwned(false); setNotes("");
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>ID <span className="text-red-500">*</span></label>
            <input type="text" value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g., xyp-JP279" required className={inputClass + " w-full"} />
          </div>
          <div>
            <label className={labelClass}>Name <span className="text-red-500">*</span></label>
            <ComboBox value={name} onChange={setName} options={opts.name || []} placeholder="e.g., Pikachu" className={inputClass + " w-full"} />
          </div>
          <div>
            <label className={labelClass}>Set ID <span className="text-red-500">*</span></label>
            <ComboBox value={setIdVal} onChange={setSetIdVal} options={opts.setId || []} placeholder="e.g., xyp" className={inputClass + " w-full"} />
          </div>
          <div>
            <label className={labelClass}>Set Name <span className="text-red-500">*</span></label>
            <ComboBox value={setNameVal} onChange={setSetNameVal} options={opts.setName || []} placeholder="e.g., XY Japanese Promos" className={inputClass + " w-full"} />
          </div>
          <div>
            <label className={labelClass}>Image URL <span className="text-red-500">*</span></label>
            <input type="url" value={imageSmall} onChange={(e) => { setImageSmall(e.target.value); setImageError(false); }} placeholder="https://..." required className={inputClass + " w-full"} />
          </div>
          <div>
            <label className={labelClass}>Source <span className="text-red-500">*</span></label>
            <ComboBox value={source} onChange={setSource} options={opts.source || []} placeholder="e.g., Japan Exclusive" className={inputClass + " w-full"} />
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
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
              <label className={labelClass}>Rarity</label>
              <ComboBox value={rarity} onChange={setRarity} options={opts.rarity || []} placeholder="Promo" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Special Rarity</label>
              <input type="text" value={specialRarity} onChange={(e) => setSpecialRarity(e.target.value)} placeholder="20th Anniversary" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Artist</label>
              <ComboBox value={artist} onChange={setArtist} options={opts.artist || []} placeholder="Ken Sugimori" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Number</label>
              <input type="text" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="XY279" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Alt Name</label>
              <input type="text" value={altName} onChange={(e) => setAltName(e.target.value)} placeholder="ピカチュウ" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Evolves From</label>
              <input type="text" value={evolvesFrom} onChange={(e) => setEvolvesFrom(e.target.value)} placeholder="Pichu" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Set Series</label>
              <ComboBox value={setSeries} onChange={setSetSeries} options={opts.setSeries || []} placeholder="XY" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Regulation Mark</label>
              <input type="text" value={regulationMark} onChange={(e) => setRegulationMark(e.target.value)} placeholder="G" className={inputClass + " w-full"} />
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className={labelClass}>Large Image URL</label>
              <input type="url" value={imageLarge} onChange={(e) => setImageLarge(e.target.value)} placeholder="https://... (defaults to small image)" className={inputClass + " w-full"} />
            </div>
          </div>
        </CollapsibleSection>

        {/* ── Annotations (collapsible) ── */}
        <CollapsibleSection title="Annotations">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className={labelClass}>Art Style</label>
              <MultiComboBox value={artStyle} onChange={setArtStyle} options={opts.artStyle || []} placeholder="Chibi, Cartoon" />
            </div>
            <div>
              <label className={labelClass}>Main Character</label>
              <MultiComboBox value={mainCharacter} onChange={setMainCharacter} options={opts.mainCharacter || []} placeholder="Pikachu" />
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
            <div>
              <label className={labelClass}>Emotion</label>
              <ComboBox value={emotion} onChange={setEmotion} options={opts.emotion || []} placeholder="Happy" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Pose</label>
              <ComboBox value={pose} onChange={setPose} options={opts.pose || []} placeholder="Jumping" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Camera Angle</label>
              <ComboBox value={cameraAngle} onChange={setCameraAngle} options={opts.cameraAngle || []} placeholder="Front" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Items</label>
              <ComboBox value={items} onChange={setItems} options={opts.items || []} placeholder="Poke Ball" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Actions</label>
              <ComboBox value={actions} onChange={setActions} options={opts.actions || []} placeholder="Running" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Perspective</label>
              <ComboBox value={perspective} onChange={setPerspective} options={opts.perspective || []} placeholder="" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Weather/Environment</label>
              <ComboBox value={weatherEnvironment} onChange={setWeatherEnvironment} options={opts.weatherEnvironment || []} placeholder="Sunny" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Storytelling</label>
              <ComboBox value={storytelling} onChange={setStorytelling} options={opts.storytelling || []} placeholder="Celebration" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Background Details</label>
              <MultiComboBox value={backgroundDetails} onChange={setBackgroundDetails} options={opts.backgroundDetails || []} placeholder="Trees, River" />
            </div>
            <div>
              <label className={labelClass}>Card Locations</label>
              <ComboBox value={cardLocations} onChange={setCardLocations} options={opts.cardLocations || []} placeholder="Nagoya" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Pokemon Region</label>
              <ComboBox value={pkmnRegion} onChange={setPkmnRegion} options={opts.pkmnRegion || []} placeholder="Johto" className={inputClass + " w-full"} />
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
              <label className={labelClass}>Shape</label>
              <ComboBox value={shape} onChange={setShape} options={SHAPE_OPTIONS} placeholder="upright" className={inputClass + " w-full"} />
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className={labelClass}>Evolution Line</label>
              <MultiComboBox value={evolutionLine} onChange={setEvolutionLine} options={opts.evolutionLine || []} placeholder="pichu, pikachu, raichu" />
              <p className="text-xs text-gray-400 mt-0.5">Stored as array in JSON, arrow-joined in DB</p>
            </div>
          </div>
        </CollapsibleSection>

        {/* ── Video (collapsible) ── */}
        <CollapsibleSection title="Video">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className={labelClass}>Video Game</label>
              <ComboBox value={videoGame} onChange={setVideoGame} options={VIDEO_GAME_OPTIONS} placeholder="X/Y" className={inputClass + " w-full"} />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" id="videoAppearance" checked={videoAppearance} onChange={(e) => setVideoAppearance(e.target.checked)} className="rounded" />
              <label htmlFor="videoAppearance" className="text-sm text-gray-700">Video Appearance</label>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" id="thumbnailUsed" checked={thumbnailUsed} onChange={(e) => setThumbnailUsed(e.target.checked)} className="rounded" />
              <label htmlFor="thumbnailUsed" className="text-sm text-gray-700">Thumbnail Used</label>
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className={labelClass}>Video URL</label>
              <input type="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtube.com/..." className={inputClass + " w-full"} />
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className={labelClass}>Video Title</label>
              <ComboBox value={videoTitle} onChange={setVideoTitle} options={opts.videoTitle || []} placeholder="Video title" className={inputClass + " w-full"} />
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

        {/* ── GitHub Settings (collapsible) ── */}
        <CollapsibleSection title="GitHub Auto-Commit Settings">
          <div className="space-y-3">
            {ghToken ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-green-700">GitHub PAT configured</span>
                <button
                  type="button"
                  onClick={() => setShowTokenInput(!showTokenInput)}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  {showTokenInput ? "Hide" : "Change"}
                </button>
                <button
                  type="button"
                  onClick={() => { setToken(""); setGhToken(""); }}
                  className="text-sm text-red-500 hover:text-red-700 underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-600">
                No GitHub PAT set. Cards will only be saved locally. To auto-commit to the repo,
                create a{" "}
                <a
                  href="https://github.com/settings/tokens?type=beta"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  fine-grained PAT
                </a>{" "}
                with <strong>Contents: Read and write</strong> permission for CmdrKerfy/tropius-maximus.
              </p>
            )}
            {(!ghToken || showTokenInput) && (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={ghToken}
                  onChange={(e) => setGhToken(e.target.value)}
                  placeholder="github_pat_..."
                  className={inputClass + " flex-1"}
                />
                <button
                  type="button"
                  onClick={() => { setToken(ghToken); setShowTokenInput(false); }}
                  className="px-3 py-1.5 bg-gray-700 text-white rounded text-sm hover:bg-gray-800"
                >
                  Save
                </button>
              </div>
            )}
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
