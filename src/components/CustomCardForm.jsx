/**
 * CustomCardForm — Expanded form to add custom cards with all fields.
 * DuckDB mode: optional GitHub PAT auto-commit. Supabase mode: saves to Postgres only.
 * Part B: Quick/Full layout, same-set batch add, session add log (sessionStorage), optional Workbench handoff.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Layers } from "lucide-react";
import {
  addTcgCard,
  addPocketCard,
  fetchFormOptions,
  FORM_OPTIONS_QUERY_KEY,
  useSupabaseBackend,
  generateManualCardId,
  normalizeCardNumberForStorage,
  buildManualCardId,
} from "../db";
import ComboBox from "./ComboBox";
import MultiComboBox from "./MultiComboBox";
import { toastError, toastSuccess, toastWarning } from "../lib/toast.js";
import { humanizeError } from "../lib/humanizeError.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/Dialog.jsx";
import {
  SOURCE_OPTIONS, CARD_SUBCATEGORY_OPTIONS, HELD_ITEM_OPTIONS, POKEBALL_OPTIONS,
  EVOLUTION_ITEMS_OPTIONS, BERRIES_OPTIONS, HOLIDAY_THEME_OPTIONS,
  MULTI_CARD_OPTIONS, TRAINER_CARD_TYPE_OPTIONS, TRAINER_CARD_SUBGROUP_OPTIONS,
  VIDEO_TYPE_OPTIONS, TOP_10_THEMES_OPTIONS, WTPC_EPISODE_OPTIONS,
  VIDEO_REGION_OPTIONS, VIDEO_LOCATION_OPTIONS,
  STAMP_OPTIONS, CARD_BORDER_OPTIONS, ENERGY_TYPE_OPTIONS, RIVAL_GROUP_OPTIONS,
  ADDITIONAL_CHARACTER_THEME_OPTIONS,
} from "../lib/annotationOptions";

// Sources with existing card databases — Card ID auto-generation is skipped
// for these to avoid ID collisions with real cards across annotation tables.
const NON_CUSTOM_SOURCES = new Set(["TCG"]);

const FORM_MODE_STORAGE_KEY = "tm_custom_card_form_mode";
const SESSION_ADD_LOG_STORAGE_KEY = "tm_custom_card_add_session_log";

function loadSessionAddLog() {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(SESSION_ADD_LOG_STORAGE_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j.slice(0, 80) : [];
  } catch {
    return [];
  }
}

function persistSessionAddLog(entries) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_ADD_LOG_STORAGE_KEY, JSON.stringify(entries.slice(0, 60)));
  } catch {
    /* ignore quota */
  }
}

/** Thrown when set+number maps to an existing card id — UI opens duplicate-ID dialog. */
class DuplicateCardIdFlow extends Error {
  constructor() {
    super("DUPLICATE_CARD_ID");
    this.name = "DuplicateCardIdFlow";
  }
}

function isDuplicateCardIdError(err) {
  const m = String(err?.message ?? err ?? "");
  if (/A card with this set and number already exists/i.test(m)) return true;
  if (/Card ID ".+" already exists/i.test(m)) return true;
  if (/Card with ID .+ already exists/i.test(m)) return true;
  if (/already exists/i.test(m) && /custom-/i.test(m)) return true;
  if (/duplicate key|unique constraint/i.test(m) && /cards/i.test(m)) return true;
  return false;
}

// Hardcoded option sets
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
        <ChevronRight
          className={`w-4 h-4 transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
          strokeWidth={2}
          aria-hidden
        />
        {title}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

function SectionShell({ quick, title, defaultOpen = true, children }) {
  if (quick) {
    return (
      <div className="pt-4 first:pt-0 border-t border-gray-200/90 first:border-0">
        <h4 className="text-sm font-semibold text-gray-800 mb-3">{title}</h4>
        {children}
      </div>
    );
  }
  return (
    <CollapsibleSection title={title} defaultOpen={defaultOpen}>
      {children}
    </CollapsibleSection>
  );
}

export default function CustomCardForm({ onCardAdded, onClose, onOpenPAT, onAddAndSendToWorkbench }) {
  const queryClient = useQueryClient();
  const isSupabase = useSupabaseBackend();
  const [hasGitHubPat, setHasGitHubPat] = useState(false);
  // ── Card table picker ──
  const [cardTable, setCardTable] = useState("tcg");

  // ── Required fields (TCG) ──
  const [name, setName] = useState("");
  const [setIdVal, setSetIdVal] = useState("");
  const [setNameVal, setSetNameVal] = useState("");
  const [imageSmall, setImageSmall] = useState("");
  const [source, setSource] = useState("");

  // ── Card details (TCG) ──
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

  // ── Card details (Pocket-specific) ──
  const [cardType, setCardType] = useState("");
  const [element, setElement] = useState("");
  const [stage, setStage] = useState("");
  const [retreatCost, setRetreatCost] = useState("");
  const [weakness, setWeakness] = useState("");
  const [packs, setPacks] = useState("");
  const [illustrator, setIllustrator] = useState("");

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
  const [backgroundDetails, setBackgroundDetails] = useState("");
  const [cardLocations, setCardLocations] = useState("");
  const [pkmnRegion, setPkmnRegion] = useState("");
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
  const [cardBorder, setCardBorder] = useState("");
  const [energyType, setEnergyType] = useState("");
  const [rivalGroup, setRivalGroup] = useState("");
  const [additionalCharacterTheme, setAdditionalCharacterTheme] = useState("");

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

  // ── New Attributes ──
  const [imageOverride, setImageOverride] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

  // ── UI state ──
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [setIdManual, setSetIdManual] = useState(false);

  // ── Combobox options (loaded from DB; shared cache with Workbench / CardDetail) ──
  const { data: opts = {} } = useQuery({
    queryKey: FORM_OPTIONS_QUERY_KEY,
    queryFn: fetchFormOptions,
    staleTime: 300_000,
  });

  const [formMode, setFormMode] = useState(() => {
    try {
      const v = localStorage.getItem(FORM_MODE_STORAGE_KEY);
      if (v === "full" || v === "quick") return v;
    } catch {
      /* ignore */
    }
    return "quick";
  });
  const [sameSetNext, setSameSetNext] = useState(true);
  const [sessionAddCount, setSessionAddCount] = useState(0);
  /** Per-attempt log for this browser session (persisted to sessionStorage). */
  const [sessionAddLog, setSessionAddLog] = useState(() => loadSessionAddLog());
  /** Links duplicate-ID dialog to a session log row to update on resolve. */
  const duplicateLogIdRef = useRef(null);
  /** Which primary action is active when resolving duplicate ID (submit / addAnother / workbench). */
  const saveIntentRef = useRef("submit");
  const [duplicateIdModalOpen, setDuplicateIdModalOpen] = useState(false);
  const [dupEditSetId, setDupEditSetId] = useState("");
  const [dupEditNumber, setDupEditNumber] = useState("");
  const [dupModalError, setDupModalError] = useState(null);
  const [dupChecking, setDupChecking] = useState(false);
  const nameFieldWrapRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(FORM_MODE_STORAGE_KEY, formMode);
    } catch {
      /* ignore */
    }
  }, [formMode]);

  useEffect(() => {
    persistSessionAddLog(sessionAddLog);
  }, [sessionAddLog]);

  const appendSessionAddLog = (entry) => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `log-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const row = { id, at: Date.now(), ...entry };
    setSessionAddLog((prev) => [row, ...prev].slice(0, 60));
    return id;
  };

  const updateSessionAddLog = (logId, patch) => {
    setSessionAddLog((prev) => prev.map((e) => (e.id === logId ? { ...e, ...patch } : e)));
  };

  const clearSessionAddLog = () => {
    setSessionAddLog([]);
    persistSessionAddLog([]);
  };

  // Auto-generate Set ID from Set Name for TCG custom-only sources.
  // Stops auto-filling if the user manually edits the Set ID field.
  useEffect(() => {
    if (cardTable === 'pocket' || NON_CUSTOM_SOURCES.has(source) || setIdManual) return;
    // Acronym: first letter of each word + any trailing digits (e.g. "Test Set Name, Set 4" → "tsns4")
    const derived = setNameVal
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .trim()
      .split(/\s+/)
      .map((w) => (/^\d+$/.test(w) ? w : w[0]))
      .join("")
      .toLowerCase();
    setSetIdVal(derived);
  }, [setNameVal, source, setIdManual, cardTable]);

  useEffect(() => {
    if (isSupabase) return;
    let cancelled = false;
    import("../lib/github")
      .then(({ getToken }) => {
        if (!cancelled) setHasGitHubPat(Boolean(getToken()));
      })
      .catch(() => {
        if (!cancelled) setHasGitHubPat(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isSupabase]);

  // Parse comma-separated string into array, filtering empty
  const toArray = (s) => s ? s.split(",").map(v => v.trim()).filter(Boolean) : [];
  const normalizeBackgroundDetailsInput = (s) => {
    const expanded = toArray(s).flatMap((token) =>
      String(token ?? "")
        .split(/[;,，；]/g)
        .map((part) => part.trim())
        .filter(Boolean)
    );
    const out = [];
    const seen = new Set();
    for (const raw of expanded) {
      const value = String(raw ?? "").trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
    return out;
  };
  // Format for JSON storage - returns JSON string of array or null
  const arrayStr = (s) => {
    const arr = toArray(s);
    return arr.length > 0 ? JSON.stringify(arr) : "";
  };

  const buildSharedAnnotationFields = (cardId) => {
    const bgPokemon = toArray(backgroundPokemon).map(v => v.toLowerCase());
    return {
      owned,
      notes: notes || "",
      art_style: toArray(artStyle),
      main_character: toArray(mainCharacter),
      background_pokemon: bgPokemon,
      background_humans: backgroundHumans ? toArray(backgroundHumans) : null,
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
      unique_id: cardId,
      evolution_line: (evolutionLine || "").toLowerCase(),
      emotion: toArray(emotion),
      pose: toArray(pose),
      camera_angle: cameraAngle || "",
      items: toArray(items),
      actions: toArray(actions),
      additional_characters: toArray(additionalCharacters),
      perspective: perspective || "",
      weather: weather || "",
      environment: environment || "",
      background_details: normalizeBackgroundDetailsInput(backgroundDetails),
      card_locations: cardLocations || "",
      pkmn_region: pkmnRegion || "",
      card_subcategory: toArray(cardSubcategory),
      held_item: toArray(heldItem),
      pokeball: toArray(pokeball),
      evolution_items: toArray(evolutionItems),
      berries: toArray(berries),
      holiday_theme: toArray(holidayTheme),
      multi_card: toArray(multiCard),
      trainer_card_type: trainerCardType || "",
      trainer_card_subgroup: toArray(trainerCardSubgroup),
      pocket_exclusive: pocketExclusive,
      stamp: stamp || "",
      card_border: cardBorder || "",
      energy_type: energyType || "",
      rival_group: rivalGroup || "",
      additional_character_theme: toArray(additionalCharacterTheme),
      image_override: imageOverride || "",
      video_url: videoUrl || "",
    };
  };

  const resetAllFields = () => {
    setName("");
    setSetIdVal("");
    setSetNameVal("");
    setImageSmall("");
    setImageLarge("");
    setSource("");
    setNumber("");
    setAltName("");
    setEvolvesFrom("");
    setHp("");
    setRarity("");
    setSpecialRarity("");
    setArtist("");
    setRegulationMark("");
    setSupertype("Pokémon");
    setSubtypes("");
    setTypes("");
    setSetSeries("");
    setCardType("");
    setElement("");
    setStage("");
    setRetreatCost("");
    setWeakness("");
    setPacks("");
    setIllustrator("");
    setArtStyle("");
    setMainCharacter("");
    setBackgroundPokemon("");
    setBackgroundHumans("");
    setAdditionalCharacters("");
    setEmotion("");
    setPose("");
    setCameraAngle("");
    setItems("");
    setActions("");
    setPerspective("");
    setWeather("");
    setEnvironment("");
    setBackgroundDetails("");
    setCardLocations("");
    setPkmnRegion("");
    setShape("");
    setEvolutionLine("");
    setVideoGame("");
    setVideoGameLocation("");
    setShortsAppearance(false);
    setRegionAppearance(false);
    setThumbnailUsed(false);
    setVideoTitle("");
    setVideoType("");
    setTop10Themes("");
    setWtpcEpisode("");
    setVideoRegion("");
    setVideoLocation("");
    setOwned(false);
    setNotes("");
    setCardSubcategory("");
    setHeldItem("");
    setPokeball("");
    setEvolutionItems("");
    setBerries("");
    setHolidayTheme("");
    setMultiCard("");
    setTrainerCardType("");
    setTrainerCardSubgroup("");
    setPocketExclusive(false);
    setStamp("");
    setCardBorder("");
    setEnergyType("");
    setRivalGroup("");
    setAdditionalCharacterTheme("");
    setImageOverride("");
    setVideoUrl("");
    setSetIdManual(false);
    setImageError(false);
  };

  const captureSameSetSnapshot = () => ({
    cardTable,
    setNameVal,
    setIdVal,
    source,
    setSeries,
    setIdManual,
  });

  const restoreSameSetSnapshot = (snap) => {
    setCardTable(snap.cardTable);
    if (snap.cardTable === "tcg") {
      setSetNameVal(snap.setNameVal);
      setSource(snap.source);
      setSetSeries(snap.setSeries);
      setSetIdManual(snap.setIdManual);
    } else {
      setSetIdVal(snap.setIdVal);
    }
  };

  const focusFirstQuickField = () => {
    requestAnimationFrame(() => {
      const wrap = nameFieldWrapRef.current;
      const nameInput = wrap?.querySelector?.("input");
      if (!name?.trim() && nameInput) {
        nameInput.focus();
        return;
      }
      document.getElementById("ccf-card-number")?.focus();
    });
  };

  const afterSuccessfulSave = async (intent, result, idOverride, opts = {}) => {
    const { quietToast = false } = opts;
    if (idOverride) {
      setSetIdVal(String(idOverride.setId).trim());
      setNumber(String(idOverride.number ?? ""));
      if (cardTable === "tcg") setSetIdManual(true);
    }
    queryClient.invalidateQueries({ queryKey: FORM_OPTIONS_QUERY_KEY });
    if (intent === "submit") {
      resetAllFields();
      const next = sessionAddCount + 1;
      setSessionAddCount(next);
      if (!quietToast) {
        toastSuccess(
          result.name
            ? `"${result.name}" added — ${next} saved this session.`
            : `Card added — ${next} saved this session.`
        );
      }
      onCardAdded?.();
    } else if (intent === "addAnother") {
      const snap = captureSameSetSnapshot();
      resetAllFields();
      if (sameSetNext) restoreSameSetSnapshot(snap);
      const next = sessionAddCount + 1;
      setSessionAddCount(next);
      if (!quietToast) {
        toastSuccess(
          result.name
            ? `"${result.name}" added — ${next} saved this session.`
            : `Card added — ${next} saved this session.`
        );
      }
      onCardAdded?.();
      focusFirstQuickField();
    } else if (intent === "workbench" && onAddAndSendToWorkbench) {
      resetAllFields();
      const next = sessionAddCount + 1;
      setSessionAddCount(next);
      await onAddAndSendToWorkbench(result.cardId);
    }
  };

  const runSaveIntent = async (intent, idOverride = null) => {
    saveIntentRef.current = intent;
    const label = name.trim() || "(unnamed card)";
    const logId = appendSessionAddLog({
      label,
      status: "pending",
      cardId: undefined,
      detail: null,
    });
    duplicateLogIdRef.current = null;
    setCreating(true);
    setError(null);
    try {
      const result = await performSave(true, idOverride);
      await afterSuccessfulSave(intent, result, idOverride, { quietToast: true });
      const sw = result?.syncWarning;
      if (sw) {
        toastWarning(sw);
        updateSessionAddLog(logId, {
          status: "partial",
          cardId: result.cardId,
          detail: sw,
        });
      } else {
        const okDetail =
          intent === "workbench"
            ? "Saved to the database and added to your default Workbench queue."
            : isSupabase
              ? "Saved to the database."
              : "Saved on this device.";
        updateSessionAddLog(logId, {
          status: "success",
          cardId: result.cardId,
          detail: okDetail,
        });
      }
    } catch (err) {
      if (err?.message === "SAVE_CANCELLED" || err?.name === "SaveCancelled") {
        updateSessionAddLog(logId, { status: "cancelled", detail: "Save cancelled." });
        return;
      }
      if (err instanceof DuplicateCardIdFlow) {
        duplicateLogIdRef.current = logId;
        setDupEditSetId(String(idOverride?.setId ?? setIdVal).trim());
        setDupEditNumber(String(idOverride?.number ?? number));
        setDupModalError(null);
        setDuplicateIdModalOpen(true);
        updateSessionAddLog(logId, {
          status: "duplicate",
          detail: "This Set ID and card number are already in use. Choose another combination in the dialog.",
        });
        return;
      }
      const m = err?.message || String(err);
      setError(m);
      updateSessionAddLog(logId, { status: "error", detail: humanizeError(err) });
      toastError(m);
    } finally {
      setCreating(false);
    }
  };

  const handleDuplicateApply = async () => {
    const sid = dupEditSetId.trim();
    const num = dupEditNumber;
    if (!sid || !String(num ?? "").trim()) {
      setDupModalError("Set ID and card number are required.");
      return;
    }
    const logId = duplicateLogIdRef.current;
    setCreating(true);
    setDupChecking(true);
    setDupModalError(null);
    try {
      try {
        await generateManualCardId(sid, num);
      } catch (err) {
        if (isDuplicateCardIdError(err)) {
          setDupModalError("That set and number are still in use. Change one or both, then try again.");
          return;
        }
        throw err;
      }
      const result = await performSave(true, { setId: sid, number: num });
      setDuplicateIdModalOpen(false);
      setDupModalError(null);
      await afterSuccessfulSave(saveIntentRef.current, result, { setId: sid, number: num }, { quietToast: true });
      const sw = result?.syncWarning;
      if (sw) {
        toastWarning(sw);
        if (logId) {
          updateSessionAddLog(logId, { status: "partial", cardId: result.cardId, detail: sw });
        }
      } else {
        const intent = saveIntentRef.current;
        const okDetail =
          intent === "workbench"
            ? "Saved to the database and added to your default Workbench queue."
            : isSupabase
              ? "Saved to the database."
              : "Saved on this device.";
        if (logId) {
          updateSessionAddLog(logId, { status: "success", cardId: result.cardId, detail: okDetail });
        } else {
          appendSessionAddLog({
            label: result.name?.trim() || "(unnamed card)",
            status: "success",
            cardId: result.cardId,
            detail: okDetail,
          });
        }
      }
      duplicateLogIdRef.current = null;
    } catch (err) {
      if (err?.message === "SAVE_CANCELLED" || err?.name === "SaveCancelled") {
        return;
      }
      if (err instanceof DuplicateCardIdFlow) {
        setDupModalError("That combination is still taken. Try a different set or number.");
        return;
      }
      const hm = humanizeError(err);
      setDupModalError(hm);
      if (logId) updateSessionAddLog(logId, { status: "error", detail: hm });
    } finally {
      setCreating(false);
      setDupChecking(false);
    }
  };

  const performSave = async (silent = false, idOverride = null) => {
    const effSetId = String(idOverride?.setId ?? setIdVal).trim();
    const effNumberRaw = idOverride?.number ?? number;
    const effNumber = typeof effNumberRaw === "string" ? effNumberRaw : String(effNumberRaw ?? "");

    if (imageSmall && imageError && typeof window !== "undefined") {
      const ok = window.confirm(
        "The image preview failed to load (wrong URL, a blocked hotlink, or network). It might still work in the app. Save anyway?"
      );
      if (!ok) {
        const cancel = new Error("SAVE_CANCELLED");
        cancel.name = "SaveCancelled";
        throw cancel;
      }
    }

    if (cardTable === "pocket") {
      if (!name || !effNumber || !effSetId || !imageSmall) {
        throw new Error("Please fill in all required fields (Name, Set ID, Number, Image URL)");
      }

      let cardId;
      try {
        cardId = await generateManualCardId(effSetId, effNumber);
      } catch (err) {
        if (isDuplicateCardIdError(err)) throw new DuplicateCardIdFlow();
        throw err;
      }
      const sharedFields = buildSharedAnnotationFields(cardId);
      const pocketCardJson = {
        id: cardId,
        name,
        set_id: effSetId,
        number: normalizeCardNumberForStorage(effNumber),
        rarity: rarity || "",
        card_type: cardType || "",
        element: element || "",
        hp: hp ? Number(hp) || null : null,
        stage: stage || "",
        retreat_cost: retreatCost ? Number(retreatCost) || null : null,
        weakness: weakness || "",
        evolves_from: evolvesFrom || null,
        packs: toArray(packs),
        image_url: imageSmall,
        illustrator: illustrator || "",
        source: "Pocket",
        _table: "pocket",
        ...sharedFields,
      };

      try {
        await addPocketCard(pocketCardJson);
      } catch (err) {
        if (isDuplicateCardIdError(err)) throw new DuplicateCardIdFlow();
        throw err;
      }

      let syncWarning = null;
      if (isSupabase) {
        if (!silent) toastSuccess(`Pocket card "${name}" saved to the database.`);
      } else {
        let ghCommitted = false;
        const { getToken, commitNewCard } = await import("../lib/github");
        const token = getToken();
        if (token) {
          try {
            await commitNewCard(token, pocketCardJson);
            ghCommitted = true;
          } catch (ghErr) {
            console.warn("GitHub commit failed:", ghErr.message);
            const msg = ghErr?.message || "";
            const errText =
              msg.includes("403")
                ? "Your card was saved on this device, but we don't have permission to sync it to the cloud. Check your PAT in Settings (it needs Read and write access)."
                : "Your card was saved on this device, but syncing to the cloud failed. It won't appear on other devices until sync works. You can try again later or check Settings.";
            syncWarning = errText;
            setError(errText);
            if (!silent) toastError(errText);
          }
        }

        if (ghCommitted) {
          if (!silent) toastSuccess(`Pocket card "${name}" added and committed to GitHub!`);
        } else if (!token) {
          if (!silent) toastSuccess(`Pocket card "${name}" added locally. Set a GitHub PAT in Settings to auto-commit.`);
        }
      }
      return { cardId, name, isPocket: true, syncWarning };
    }

    if (!name || !effNumber || !setNameVal || !imageSmall || !source) {
      throw new Error("Please fill in all required fields");
    }
    if (!effSetId) {
      throw new Error(
        "Set ID is missing. Use a Source other than “TCG” for auto-generated Set IDs, open full form to type a Set ID, or adjust Set Name until a Set ID appears."
      );
    }

    const bgPokemon = toArray(backgroundPokemon).map((v) => v.toLowerCase());

    let cardId;
    try {
      cardId = await generateManualCardId(effSetId, effNumber);
    } catch (err) {
      if (isDuplicateCardIdError(err)) throw new DuplicateCardIdFlow();
      throw err;
    }
    const sharedFields = buildSharedAnnotationFields(cardId);
    const cardJson = {
      id: cardId,
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
      set_id: effSetId,
      set_name: setNameVal,
      set_series: setSeries || "",
      number: normalizeCardNumberForStorage(effNumber),
      regulation_mark: regulationMark || "",
      image_small: imageSmall,
      image_large: imageLarge || imageSmall,
      source,
      _table: "tcg",
      ...sharedFields,
      background_pokemon: bgPokemon,
    };

    const dbCard = {
      ...cardJson,
      subtypes: JSON.stringify(cardJson.subtypes),
      types: JSON.stringify(cardJson.types),
      art_style: arrayStr(artStyle),
      main_character: arrayStr(mainCharacter),
      background_pokemon: bgPokemon.length ? JSON.stringify(bgPokemon) : "",
      background_humans: backgroundHumans ? arrayStr(backgroundHumans) : "",
      additional_characters: arrayStr(additionalCharacters),
      background_details: (() => {
        const normalized = normalizeBackgroundDetailsInput(backgroundDetails);
        return normalized.length > 0 ? JSON.stringify(normalized) : "";
      })(),
      image_large: imageLarge || imageSmall,
      card_subcategory: arrayStr(cardSubcategory),
      items: arrayStr(items),
      held_item: arrayStr(heldItem),
      pokeball: arrayStr(pokeball),
      evolution_items: arrayStr(evolutionItems),
      berries: arrayStr(berries),
      holiday_theme: arrayStr(holidayTheme),
      multi_card: arrayStr(multiCard),
      trainer_card_subgroup: arrayStr(trainerCardSubgroup),
      additional_character_theme: arrayStr(additionalCharacterTheme),
      video_title: arrayStr(videoTitle),
      video_game: arrayStr(videoGame),
      video_game_location: arrayStr(videoGameLocation),
      video_type: arrayStr(videoType),
      top_10_themes: arrayStr(top10Themes),
      wtpc_episode: arrayStr(wtpcEpisode),
      video_region: arrayStr(videoRegion),
      video_location: arrayStr(videoLocation),
    };

    try {
      await addTcgCard(dbCard);
    } catch (err) {
      if (isDuplicateCardIdError(err)) throw new DuplicateCardIdFlow();
      throw err;
    }

    let syncWarning = null;
    if (isSupabase) {
      if (!silent) toastSuccess(`Card "${name}" saved to the database.`);
    } else {
      let ghCommitted = false;
      const { getToken, commitNewCard } = await import("../lib/github");
      const token = getToken();
      if (token) {
        try {
          await commitNewCard(token, cardJson);
          ghCommitted = true;
        } catch (ghErr) {
          console.warn("GitHub commit failed:", ghErr.message);
          const msg = ghErr?.message || "";
          const errText =
            msg.includes("403")
              ? "Your card was saved on this device, but we don't have permission to sync it to the cloud. Check your PAT in Settings (it needs Read and write access)."
              : "Your card was saved on this device, but syncing to the cloud failed. It won't appear on other devices until sync works. You can try again later or check Settings.";
          syncWarning = errText;
          setError(errText);
          if (!silent) toastError(errText);
        }
      }

      if (ghCommitted) {
        if (!silent) toastSuccess(`Card "${name}" added and committed to GitHub!`);
      } else if (!token) {
        if (!silent) toastSuccess(`Card "${name}" added locally. Set a GitHub PAT in Settings to auto-commit.`);
      }
    }
    return { cardId, name, isPocket: false, syncWarning };
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    void runSaveIntent("submit");
  };

  const handleSaveAndAddAnother = () => {
    void runSaveIntent("addAnother");
  };

  const handleAddAndSendToWorkbench = () => {
    if (!onAddAndSendToWorkbench) return;
    void runSaveIntent("workbench");
  };

  const inputClass =
    "px-3 py-1.5 border border-gray-300 rounded text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  const quick = formMode === "quick";

  const dupPreviewId = useMemo(() => {
    try {
      if (!dupEditSetId.trim()) return "";
      return buildManualCardId(dupEditSetId, dupEditNumber);
    } catch {
      return "";
    }
  }, [dupEditSetId, dupEditNumber]);

  const renderSecondarySections = (q) => (
    <>
        {/* ── Card Details (TCG, collapsible) ── */}
        {cardTable === 'tcg' && (
          <SectionShell quick={q} title="Card Details" defaultOpen={true}>
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
              <div>
                <label className={labelClass}>Rarity</label>
                <ComboBox value={rarity} onChange={setRarity} options={opts.rarity || []} placeholder="Promo" className={inputClass + " w-full"} />
              </div>
              <div>
                <label className={labelClass}>Special Rarity</label>
                <input type="text" value={specialRarity} onChange={(e) => setSpecialRarity(e.target.value)} placeholder="" className={inputClass + " w-full"} />
              </div>
              <div>
                <label className={labelClass}>Alt Name</label>
                <input type="text" value={altName} onChange={(e) => setAltName(e.target.value)} placeholder="" className={inputClass + " w-full"} />
              </div>
            </div>
          </SectionShell>
        )}

        {/* ── Card Details (Pocket, collapsible) ── */}
        {cardTable === 'pocket' && (
          <SectionShell quick={q} title="Card Details" defaultOpen={true}>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pb-2">
              <div>
                <label className={labelClass}>Card Type</label>
                <select value={cardType} onChange={(e) => setCardType(e.target.value)} className={inputClass + " w-full"}>
                  <option value="">—</option>
                  <option value="pokémon">Pokémon</option>
                  <option value="trainer">Trainer</option>
                  <option value="energy">Energy</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Element</label>
                <input type="text" value={element} onChange={(e) => setElement(e.target.value)} placeholder="Fire" className={inputClass + " w-full"} />
              </div>
              <div>
                <label className={labelClass}>HP</label>
                <input type="text" value={hp} onChange={(e) => setHp(e.target.value)} placeholder="60" className={inputClass + " w-full"} />
              </div>
              <div>
                <label className={labelClass}>Stage</label>
                <input type="text" value={stage} onChange={(e) => setStage(e.target.value)} placeholder="basic" className={inputClass + " w-full"} />
              </div>
              <div>
                <label className={labelClass}>Retreat Cost</label>
                <input type="number" value={retreatCost} onChange={(e) => setRetreatCost(e.target.value)} placeholder="1" className={inputClass + " w-full"} />
              </div>
              <div>
                <label className={labelClass}>Weakness</label>
                <input type="text" value={weakness} onChange={(e) => setWeakness(e.target.value)} placeholder="Water" className={inputClass + " w-full"} />
              </div>
              <div>
                <label className={labelClass}>Evolves From</label>
                <input type="text" value={evolvesFrom} onChange={(e) => setEvolvesFrom(e.target.value)} placeholder="Charmander" className={inputClass + " w-full"} />
              </div>
              <div>
                <label className={labelClass}>Packs</label>
                <input type="text" value={packs} onChange={(e) => setPacks(e.target.value)} placeholder="Charizard, Pikachu" className={inputClass + " w-full"} />
              </div>
              <div>
                <label className={labelClass}>Illustrator</label>
                <ComboBox value={illustrator} onChange={setIllustrator} options={opts.artist || []} placeholder="illustrator name" className={inputClass + " w-full"} />
              </div>
              <div>
                <label className={labelClass}>Evolution Line</label>
                <ComboBox value={evolutionLine} onChange={setEvolutionLine} options={opts.evolutionLine || []} placeholder="Charmander → Charmeleon → Charizard" className={inputClass + " w-full"} />
              </div>
              <div>
                <label className={labelClass}>Rarity</label>
                <input type="text" value={rarity} onChange={(e) => setRarity(e.target.value)} placeholder="◆◆◆" className={inputClass + " w-full"} />
              </div>
            </div>
          </SectionShell>
        )}

        {/* ── Annotations (collapsible) ── */}
        <SectionShell quick={q} title="Annotations" defaultOpen={true}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">

            {/* ── Mon Classification ── */}
            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Mon Classification</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            {cardTable === 'tcg' && (
              <>
                <div>
                  <label className={labelClass}>Card Subcategory</label>
                  <MultiComboBox value={cardSubcategory} onChange={setCardSubcategory} options={opts.cardSubcategory || CARD_SUBCATEGORY_OPTIONS} placeholder="Full Art, Illustration Rare, etc." />
                </div>
                <div>
                  <label className={labelClass}>Card Border Color</label>
                  <ComboBox value={cardBorder} onChange={setCardBorder} options={opts.cardBorder || CARD_BORDER_OPTIONS} placeholder="Yellow, Silver, Blue, etc." className={inputClass + " w-full"} />
                </div>
                <div>
                  <label className={labelClass}>Stamp</label>
                  <ComboBox value={stamp} onChange={setStamp} options={opts.stamp || STAMP_OPTIONS} placeholder="Pokemon Center, Game Stop, etc." className={inputClass + " w-full"} />
                </div>
              </>
            )}

            {/* ── Other Card Classification ── */}
            {cardTable === 'tcg' && (
              <>
                <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Other Card Classification</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
                <div>
                  <label className={labelClass}>Trainer Card Type</label>
                  <ComboBox value={trainerCardType} onChange={setTrainerCardType} options={opts.trainerCardType || TRAINER_CARD_TYPE_OPTIONS} placeholder="Supporter, Item, Stadium, etc." className={inputClass + " w-full"} />
                </div>
                <div>
                  <label className={labelClass}>Trainer Card Subgroup</label>
                  <MultiComboBox value={trainerCardSubgroup} onChange={setTrainerCardSubgroup} options={opts.trainerCardSubgroup || TRAINER_CARD_SUBGROUP_OPTIONS} placeholder="Nameless Supporter, Villain Team Items, etc." />
                </div>
                <div>
                  <label className={labelClass}>Energy Card Type</label>
                  <ComboBox value={energyType} onChange={setEnergyType} options={opts.energyType || ENERGY_TYPE_OPTIONS} placeholder="Basic, Special" className={inputClass + " w-full"} />
                </div>
              </>
            )}

            {/* ── Scene & Setting ── */}
            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Scene & Setting</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div>
              <label className={labelClass}>Card Location</label>
              <ComboBox value={cardLocations} onChange={setCardLocations} options={opts.cardLocations || []} placeholder="Pallet Town, Route 110, etc." className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Environment</label>
              <MultiComboBox value={environment} onChange={setEnvironment} options={opts.environment || []} placeholder="Forest, Beach, Stadium, etc." />
            </div>
            <div>
              <label className={labelClass}>Weather</label>
              <ComboBox value={weather} onChange={setWeather} options={opts.weather || []} placeholder="Sunny, Lightning, Clouds, etc." className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Background Details</label>
              <MultiComboBox value={backgroundDetails} onChange={setBackgroundDetails} options={opts.backgroundDetails || []} placeholder="Island, Stump, Seafloor, Bridge, etc." />
            </div>
            <div>
              <label className={labelClass}>Holiday Theme</label>
              <MultiComboBox value={holidayTheme} onChange={setHolidayTheme} options={opts.holidayTheme || HOLIDAY_THEME_OPTIONS} placeholder="Halloween, Christmas, etc." />
            </div>

            {/* ── Main Subject ── */}
            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Main Subject</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div>
              <label className={labelClass}>Actions</label>
              <MultiComboBox value={actions} onChange={setActions} options={opts.actions || []} placeholder="Dancing, Firefighters, On A Boat" />
            </div>
            <div>
              <label className={labelClass}>Pose</label>
              <MultiComboBox value={pose} onChange={setPose} options={opts.pose || []} placeholder="Flexing, Come At Me Bro, etc." />
            </div>
            <div>
              <label className={labelClass}>Emotion</label>
              <MultiComboBox value={emotion} onChange={setEmotion} options={opts.emotion || []} placeholder="Crying, Scared, Angry, etc." />
            </div>

            {/* ── Background Items ── */}
            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Background Items</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div>
              <label className={labelClass}>Items</label>
              <MultiComboBox value={items} onChange={setItems} options={opts.items || []} placeholder="Clefairy Doll, Apple, Fossil, etc." />
            </div>
            <div>
              <label className={labelClass}>Held Item</label>
              <MultiComboBox value={heldItem} onChange={setHeldItem} options={opts.heldItem || HELD_ITEM_OPTIONS} placeholder="Food, Flower, Pokeball, etc." />
            </div>
            <div>
              <label className={labelClass}>Berries (if present)</label>
              <MultiComboBox value={berries} onChange={setBerries} options={opts.berries || BERRIES_OPTIONS} placeholder="Oran Berry, Razz Berry, etc." />
            </div>
            <div>
              <label className={labelClass}>Pokeball Type (if present)</label>
              <MultiComboBox value={pokeball} onChange={setPokeball} options={opts.pokeball || POKEBALL_OPTIONS} placeholder="Great Ball, Timer Ball, etc." />
            </div>
            <div>
              <label className={labelClass}>Evolution Items (if present)</label>
              <MultiComboBox value={evolutionItems} onChange={setEvolutionItems} options={opts.evolutionItems || EVOLUTION_ITEMS_OPTIONS} placeholder="Leaf Stone, Upgrade, etc." />
            </div>

            {/* ── Additional Characters ── */}
            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Additional Characters</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div>
              <label className={labelClass}>Background Pokemon</label>
              <MultiComboBox value={backgroundPokemon} onChange={setBackgroundPokemon} options={opts.backgroundPokemon || []} placeholder="Squirtle, Pikachu, etc." />
            </div>
            <div>
              <label className={labelClass}>Background People Type</label>
              <MultiComboBox value={backgroundHumans} onChange={setBackgroundHumans} options={opts.backgroundHumans || []} placeholder="Gym Leader, Trainer, Civilian" />
            </div>
            <div>
              <label className={labelClass}>Background People Name</label>
              <MultiComboBox value={additionalCharacters} onChange={setAdditionalCharacters} options={opts.additionalCharacters || []} placeholder="Brock, Professor Oak, Delinquent" />
            </div>
            <div>
              <label className={labelClass}>Rival Faction</label>
              <ComboBox value={rivalGroup} onChange={setRivalGroup} options={opts.rivalGroup || RIVAL_GROUP_OPTIONS} placeholder="Team Rocket, Team Aqua, etc." className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Additional Character Theme</label>
              <ComboBox value={additionalCharacterTheme} onChange={setAdditionalCharacterTheme} options={ADDITIONAL_CHARACTER_THEME_OPTIONS} placeholder="Family First, Squad Gang, etc." className={inputClass + " w-full"} />
            </div>

            {/* ── Artistic Expression ── */}
            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Artistic Expression</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div>
              <label className={labelClass}>Art Style</label>
              <MultiComboBox value={artStyle} onChange={setArtStyle} options={opts.artStyle || []} placeholder="2D, Clay, Trippy Art, etc." />
            </div>
            <div>
              <label className={labelClass}>Camera Angle</label>
              <ComboBox value={cameraAngle} onChange={setCameraAngle} options={opts.cameraAngle || []} placeholder="Aerial, Upside Down, etc." className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Perspective</label>
              <ComboBox value={perspective} onChange={setPerspective} options={opts.perspective || []} placeholder="POV, Tiny, Rotate 90 Degrees" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Multi Card</label>
              <MultiComboBox value={multiCard} onChange={setMultiCard} options={opts.multiCard || MULTI_CARD_OPTIONS} placeholder="Storytelling, Different Angles, etc." />
            </div>

          </div>
        </SectionShell>

        {/* ── Video (collapsible) ── */}
        <SectionShell quick={q} title="Video" defaultOpen={true}>
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
        </SectionShell>

        {/* ── Notes (collapsible) ── */}
        <SectionShell quick={q} title="Notes" defaultOpen={false}>
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
        </SectionShell>

    </>
  );


  return (
    <>
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-800">Add Custom Card</h2>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            &times;
          </button>
        )}
      </div>

      {/* TCG / Pocket Picker */}
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setCardTable("tcg")}
          className={`flex-1 py-2 rounded text-sm font-medium border transition-colors ${
            cardTable === "tcg"
              ? "bg-green-600 text-white border-green-600"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          Add TCG Card
        </button>
        <button
          type="button"
          onClick={() => setCardTable("pocket")}
          className={`flex-1 py-2 rounded text-sm font-medium border transition-colors ${
            cardTable === "pocket"
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          Add Pocket Card
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2.5 mb-4 text-sm">
          <p className="flex-1">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 text-red-600 hover:text-red-800 font-medium"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 p-0.5 bg-gray-50" role="group" aria-label="Form layout">
            <button
              type="button"
              onClick={() => setFormMode("quick")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                quick ? "bg-white shadow text-gray-900" : "text-gray-600 hover:text-gray-800"
              }`}
            >
              Quick add
            </button>
            <button
              type="button"
              onClick={() => setFormMode("full")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                !quick ? "bg-white shadow text-gray-900" : "text-gray-600 hover:text-gray-800"
              }`}
            >
              Full form
            </button>
          </div>
        </div>
        {quick && (
          <div
            className="rounded-xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50/90 via-white to-emerald-50/40 p-3 shadow-sm ring-1 ring-emerald-500/10"
            role="region"
            aria-label="Quick add options"
          >
            <p className="text-xs text-gray-600 leading-relaxed">
              Required fields stay on top; open <strong>Details &amp; annotations</strong> for the rest (or add them later in Explore or Workbench).
            </p>
            <div className="mt-3 flex flex-col gap-2 border-t border-emerald-200/70 pt-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 shadow-sm">
                  <Layers className="h-4 w-4" strokeWidth={2} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">Keep set &amp; source</p>
                  <p className="text-xs text-gray-600">
                    Reuse the same set and source after you save—handy for multi-card runs.
                  </p>
                </div>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-3 self-end rounded-lg sm:self-center focus-within:outline-none focus-within:ring-2 focus-within:ring-emerald-500 focus-within:ring-offset-2">
                <span className="sr-only">Keep set and source for next card</span>
                <input
                  type="checkbox"
                  checked={sameSetNext}
                  onChange={(e) => setSameSetNext(e.target.checked)}
                  className="peer sr-only"
                />
                <span
                  className="relative inline-block h-6 w-11 shrink-0 rounded-full border border-gray-300/90 bg-gray-200 transition-colors peer-checked:border-emerald-500 peer-checked:bg-emerald-500 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 after:ease-out peer-checked:after:translate-x-5"
                  aria-hidden
                />
              </label>
            </div>
          </div>
        )}

        {/* ── Identity: TCG ── */}
        {cardTable === "tcg" && !quick && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div ref={nameFieldWrapRef}>
              <label className={labelClass}>
                Name <span className="text-red-500">*</span>
              </label>
              <ComboBox value={name} onChange={setName} options={opts.name || []} placeholder="e.g., Pikachu" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Set Series</label>
              <ComboBox value={setSeries} onChange={setSetSeries} options={opts.setSeries || []} placeholder="e.g., Black & White" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>
                Set Name <span className="text-red-500">*</span>
              </label>
              <ComboBox value={setNameVal} onChange={setSetNameVal} options={opts.setName || []} placeholder="e.g., XY Japanese Promos" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>
                Card Number <span className="text-red-500">*</span>
              </label>
              <input
                id="ccf-card-number"
                type="text"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="Number in set"
                className={inputClass + " w-full"}
              />
            </div>
            <div>
              <label className={labelClass}>Featured Region</label>
              <ComboBox value={pkmnRegion} onChange={setPkmnRegion} options={opts.pkmnRegion || []} placeholder="Kanto, Johto, Aquapolis, etc." className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>Artist</label>
              <ComboBox value={artist} onChange={setArtist} options={opts.artist || []} placeholder="Ken Sugimori" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>
                Source <span className="text-red-500">*</span>
              </label>
              <ComboBox
                value={source}
                onChange={setSource}
                options={[...new Set([...SOURCE_OPTIONS, ...(opts.source || [])])]}
                placeholder="e.g., Japan Exclusive"
                className={inputClass + " w-full"}
              />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                id="pocketExclusive"
                checked={pocketExclusive}
                onChange={(e) => setPocketExclusive(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="pocketExclusive" className="text-sm text-gray-700">
                Pocket Exclusive
              </label>
            </div>
            <div className="col-span-1 md:col-span-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 leading-snug">
              <strong className="text-gray-800">Set ID and card number</strong> form the unique card ID. For most
              sources, Set ID is auto-derived from Set Name. Source <strong>TCG</strong> turns that off (to reduce clashes
              with real TCG products) — pick a custom source or adjust Set Name / number so the ID is unique.
            </div>
            <div className="col-span-1 md:col-span-3">
              <label className={labelClass}>
                Image URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                value={imageSmall}
                onChange={(e) => {
                  setImageSmall(e.target.value);
                  setImageError(false);
                }}
                placeholder="https://..."
                required
                className={inputClass + " w-full"}
              />
            </div>
            <div className="col-span-1 md:col-span-3 pb-2">
              <label className={labelClass}>Large Image URL [Optional]</label>
              <input type="url" value={imageLarge} onChange={(e) => setImageLarge(e.target.value)} placeholder="https://..." className={inputClass + " w-full"} />
            </div>
          </div>
        )}

        {cardTable === "tcg" && quick && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div ref={nameFieldWrapRef} className="sm:col-span-2">
              <label className={labelClass}>
                Name <span className="text-red-500">*</span>
              </label>
              <ComboBox value={name} onChange={setName} options={opts.name || []} placeholder="e.g., Pikachu" className={inputClass + " w-full"} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>
                Set Name <span className="text-red-500">*</span>
              </label>
              <ComboBox value={setNameVal} onChange={setSetNameVal} options={opts.setName || []} placeholder="e.g., XY Japanese Promos" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>
                Card Number <span className="text-red-500">*</span>
              </label>
              <input
                id="ccf-card-number"
                type="text"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="Number in set"
                className={inputClass + " w-full"}
              />
            </div>
            <div>
              <label className={labelClass}>
                Source <span className="text-red-500">*</span>
              </label>
              <ComboBox
                value={source}
                onChange={setSource}
                options={[...new Set([...SOURCE_OPTIONS, ...(opts.source || [])])]}
                placeholder="e.g., Japan Exclusive"
                className={inputClass + " w-full"}
              />
            </div>
            <div className="sm:col-span-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 leading-snug">
              <strong className="text-gray-800">Set ID + number</strong> → unique ID. Non-TCG sources auto-fill Set ID
              from Set Name. Source <strong>TCG</strong> disables auto-fill — use a custom source if Set ID stays empty.
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>
                Image URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                value={imageSmall}
                onChange={(e) => {
                  setImageSmall(e.target.value);
                  setImageError(false);
                }}
                placeholder="https://..."
                required
                className={inputClass + " w-full"}
              />
            </div>
          </div>
        )}

        {/* ── Identity: Pocket ── */}
        {cardTable === "pocket" && !quick && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div ref={nameFieldWrapRef}>
              <label className={labelClass}>
                Name <span className="text-red-500">*</span>
              </label>
              <ComboBox value={name} onChange={setName} options={opts.name || []} placeholder="e.g., Pikachu" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>
                Set ID <span className="text-red-500">*</span>
              </label>
              <input type="text" value={setIdVal} onChange={(e) => setSetIdVal(e.target.value)} placeholder="e.g., A1" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>
                Card Number <span className="text-red-500">*</span>
              </label>
              <input
                id="ccf-card-number"
                type="text"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="e.g., 001"
                className={inputClass + " w-full"}
              />
            </div>
            <div>
              <label className={labelClass}>Featured Region</label>
              <ComboBox value={pkmnRegion} onChange={setPkmnRegion} options={opts.pkmnRegion || []} placeholder="Kanto" className={inputClass + " w-full"} />
            </div>
            <div className="col-span-1 md:col-span-3">
              <label className={labelClass}>
                Image URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                value={imageSmall}
                onChange={(e) => {
                  setImageSmall(e.target.value);
                  setImageError(false);
                }}
                placeholder="https://..."
                required
                className={inputClass + " w-full"}
              />
            </div>
          </div>
        )}

        {cardTable === "pocket" && quick && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div ref={nameFieldWrapRef} className="sm:col-span-2">
              <label className={labelClass}>
                Name <span className="text-red-500">*</span>
              </label>
              <ComboBox value={name} onChange={setName} options={opts.name || []} placeholder="e.g., Pikachu" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>
                Set ID <span className="text-red-500">*</span>
              </label>
              <input type="text" value={setIdVal} onChange={(e) => setSetIdVal(e.target.value)} placeholder="e.g., A1" className={inputClass + " w-full"} />
            </div>
            <div>
              <label className={labelClass}>
                Card Number <span className="text-red-500">*</span>
              </label>
              <input
                id="ccf-card-number"
                type="text"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="e.g., 001"
                className={inputClass + " w-full"}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>
                Image URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                value={imageSmall}
                onChange={(e) => {
                  setImageSmall(e.target.value);
                  setImageError(false);
                }}
                placeholder="https://..."
                required
                className={inputClass + " w-full"}
              />
            </div>
          </div>
        )}

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

        {quick ? (
          <details className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 mt-1">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 py-1 select-none">
              Details & annotations (optional)
            </summary>
            <p className="text-xs text-gray-600 mt-2 mb-4">
              Optional identity, stats, tags, and notes. You can complete these later in Explore or Workbench.
            </p>
            {cardTable === "tcg" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4 pb-4 border-b border-gray-200">
                <div>
                  <label className={labelClass}>Set Series</label>
                  <ComboBox value={setSeries} onChange={setSetSeries} options={opts.setSeries || []} placeholder="e.g., Black & White" className={inputClass + " w-full"} />
                </div>
                <div>
                  <label className={labelClass}>Featured Region</label>
                  <ComboBox value={pkmnRegion} onChange={setPkmnRegion} options={opts.pkmnRegion || []} placeholder="Kanto, Johto, Aquapolis, etc." className={inputClass + " w-full"} />
                </div>
                <div>
                  <label className={labelClass}>Artist</label>
                  <ComboBox value={artist} onChange={setArtist} options={opts.artist || []} placeholder="Ken Sugimori" className={inputClass + " w-full"} />
                </div>
                <div className="flex items-center gap-2 sm:col-span-2 md:col-span-1 pt-1">
                  <input type="checkbox" id="pocketExclusiveQuick" checked={pocketExclusive} onChange={(e) => setPocketExclusive(e.target.checked)} className="rounded" />
                  <label htmlFor="pocketExclusiveQuick" className="text-sm text-gray-700">Pocket Exclusive</label>
                </div>
                <div className="sm:col-span-2 md:col-span-3">
                  <label className={labelClass}>Large Image URL [Optional]</label>
                  <input type="url" value={imageLarge} onChange={(e) => setImageLarge(e.target.value)} placeholder="https://..." className={inputClass + " w-full"} />
                </div>
              </div>
            )}
            {cardTable === "pocket" && (
              <div className="mb-4 pb-4 border-b border-gray-200 max-w-md">
                <label className={labelClass}>Featured Region</label>
                <ComboBox value={pkmnRegion} onChange={setPkmnRegion} options={opts.pkmnRegion || []} placeholder="Kanto" className={inputClass + " w-full"} />
              </div>
            )}
            {renderSecondarySections(true)}
          </details>
        ) : (
          renderSecondarySections(false)
        )}

        {/* ── Add card actions ── */}
        {!isSupabase && !hasGitHubPat && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            No GitHub PAT configured — this card will only save locally to this browser.{" "}
            {onOpenPAT ? (
              <button
                type="button"
                onClick={onOpenPAT}
                className="font-medium hover:underline"
              >
                Add a PAT
              </button>
            ) : (
              "Add a PAT in Settings"
            )}{" "}
            to sync across devices.
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 bg-green-600 text-white rounded text-sm font-medium
                       hover:bg-green-700 disabled:bg-gray-400 transition-colors"
          >
            {creating ? "Adding…" : "Add card"}
          </button>
          <button
            type="button"
            disabled={creating}
            onClick={handleSaveAndAddAnother}
            className="px-4 py-2 bg-emerald-700 text-white rounded text-sm font-medium
                       hover:bg-emerald-800 disabled:bg-gray-400 transition-colors"
          >
            {creating ? "Adding…" : "Save & add another"}
          </button>
          {onAddAndSendToWorkbench && (
            <button
              type="button"
              disabled={creating}
              onClick={handleAddAndSendToWorkbench}
              className="px-4 py-2 bg-tm-canopy text-white rounded text-sm font-medium
                         hover:opacity-95 disabled:bg-gray-400 transition-colors"
            >
              {creating ? "Adding…" : "Add & send to Workbench"}
            </button>
          )}
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

        {sessionAddLog.length > 0 && (
          <div
            className="mt-4 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden"
            aria-label="This session add attempts"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900">This session — add attempts</h3>
              <button
                type="button"
                onClick={clearSessionAddLog}
                className="text-xs font-medium text-gray-600 hover:text-gray-900 underline"
              >
                Clear list
              </button>
            </div>
            <ul
              className="max-h-56 overflow-y-auto divide-y divide-gray-100 text-sm"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {sessionAddLog.map((row) => {
                const st = row.status || "success";
                const statusStyles = {
                  pending: "bg-amber-50/80 border-l-4 border-amber-400",
                  success: "bg-green-50/90 border-l-4 border-green-500",
                  error: "bg-red-50/90 border-l-4 border-red-500",
                  partial: "bg-amber-50 border-l-4 border-amber-600",
                  duplicate: "bg-amber-50 border-l-4 border-amber-500",
                  cancelled: "bg-gray-50 border-l-4 border-gray-400",
                };
                const statusLabel = {
                  pending: "Saving…",
                  success: "Saved",
                  error: "Not saved",
                  partial: "Saved locally — sync issue",
                  duplicate: "Needs new ID",
                  cancelled: "Cancelled",
                };
                return (
                  <li
                    key={row.id}
                    className={`px-3 py-2 ${statusStyles[st] || statusStyles.pending}`}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-medium text-gray-900">{row.label}</span>
                      {row.cardId && (
                        <span className="font-mono text-xs text-gray-600">{row.cardId}</span>
                      )}
                      <span className="text-xs font-medium text-gray-700">
                        — {statusLabel[st] || st}
                      </span>
                    </div>
                    {row.detail ? (
                      <p className="text-xs text-gray-700 mt-1 leading-snug">{row.detail}</p>
                    ) : null}
                    {row.at ? (
                      <p className="text-[10px] text-gray-400 mt-0.5 tabular-nums">
                        {new Date(row.at).toLocaleTimeString()}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <div className="px-3 py-2 text-xs text-gray-500 bg-gray-50/80 border-t border-gray-100 space-y-1">
              {isSupabase ? (
                <p>
                  Cards that reached the database are listed under{" "}
                  <Link to="/dashboard" className="text-green-700 font-medium hover:underline">
                    Dashboard → My submitted cards
                  </Link>
                  . <strong>Recent edits</strong> on the same page lists annotation changes (Workbench, card detail, batch)—not card creation.
                </p>
              ) : (
                <p>
                  This list stays in this browser tab until you clear it or close the tab. Failed attempts are not stored
                  server-side—fix the issue and try again.
                </p>
              )}
            </div>
          </div>
        )}
      </form>
    </div>

    <Dialog
      open={duplicateIdModalOpen}
      onOpenChange={(open) => {
        if (!open) {
          setDuplicateIdModalOpen(false);
          setDupModalError(null);
        }
      }}
    >
      <DialogContent className="fixed left-1/2 top-1/2 max-w-md w-[min(100%-1rem,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-0 shadow-xl">
        <div className="p-5 space-y-4">
          <DialogTitle className="text-lg font-semibold text-gray-900 pr-6">
            This card ID is already in the database
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-600">
            Card IDs are built from <span className="font-medium">Set ID</span> and{" "}
            <span className="font-medium">Card number</span>. Use a combination that is not taken yet, then check and save.
          </DialogDescription>
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Set ID</label>
              <input
                type="text"
                value={dupEditSetId}
                onChange={(e) => setDupEditSetId(e.target.value)}
                className={inputClass + " w-full"}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelClass}>Card number</label>
              <input
                type="text"
                value={dupEditNumber}
                onChange={(e) => setDupEditNumber(e.target.value)}
                className={inputClass + " w-full"}
                autoComplete="off"
              />
            </div>
            {dupPreviewId ? (
              <p className="text-xs text-gray-600">
                Preview ID:{" "}
                <code className="text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded text-[13px]">{dupPreviewId}</code>
              </p>
            ) : null}
            {dupModalError ? (
              <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{dupModalError}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 justify-end pt-1">
            <button
              type="button"
              className="px-3 py-2 text-sm rounded-lg bg-gray-100 text-gray-800 hover:bg-gray-200 font-medium"
              onClick={() => {
                setDuplicateIdModalOpen(false);
                setDupModalError(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={dupChecking}
              className="px-3 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 font-medium disabled:opacity-50"
              onClick={() => void handleDuplicateApply()}
            >
              {dupChecking ? "Checking…" : "Check & save"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
