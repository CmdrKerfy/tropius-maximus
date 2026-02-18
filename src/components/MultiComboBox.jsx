import { useState, useRef, useEffect } from "react";

export default function MultiComboBox({ value, onChange, options = [], placeholder = "", className = "" }) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  // Parse comma-separated string into array of trimmed non-empty values
  const tags = value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const remaining = options.filter(
    (opt) => !tags.some((t) => t.toLowerCase() === opt.toLowerCase())
  );
  const filtered = remaining.filter(
    (opt) => opt.toLowerCase().includes(inputVal.toLowerCase())
  );

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        // Commit any pending input on blur
        if (inputVal.trim()) {
          addTag(inputVal.trim());
        }
        setOpen(false);
        setInputVal("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [inputVal, tags]);

  function emitChange(newTags) {
    onChange(newTags.join(", "));
  }

  function addTag(tag) {
    if (!tag || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
    emitChange([...tags, tag]);
    setInputVal("");
  }

  function removeTag(idx) {
    const next = [...tags];
    next.splice(idx, 1);
    emitChange(next);
  }

  function handleInputChange(e) {
    const v = e.target.value;
    // If user types a comma, commit the tag
    if (v.endsWith(",")) {
      const tag = v.slice(0, -1).trim();
      if (tag) addTag(tag);
      return;
    }
    setInputVal(v);
    if (!open) setOpen(true);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (inputVal.trim()) {
        addTag(inputVal.trim());
      }
    } else if (e.key === "Backspace" && !inputVal && tags.length > 0) {
      removeTag(tags.length - 1);
    } else if (e.key === "Escape") {
      setOpen(false);
      setInputVal("");
      inputRef.current?.blur();
    }
  }

  function handleFocus() {
    setOpen(true);
  }

  function selectOption(opt) {
    addTag(opt);
    inputRef.current?.focus();
  }

  // Strip the base input class parts we'll replicate in the wrapper
  const wrapperClass =
    "flex flex-wrap items-center gap-1 px-2 py-1 border border-gray-300 rounded text-sm " +
    "focus-within:ring-2 focus-within:ring-green-500 focus-within:border-transparent min-h-[34px]";

  return (
    <div ref={wrapperRef} className="relative">
      <div className={wrapperClass}>
        {tags.map((tag, i) => (
          <span
            key={tag + i}
            className="inline-flex items-center gap-0.5 bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded-full"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(i)}
              className="text-green-600 hover:text-green-900 leading-none ml-0.5"
            >
              &times;
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputVal}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[80px] outline-none bg-transparent text-sm py-0.5"
        />
      </div>
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 max-h-48 overflow-y-auto bg-white border border-gray-300 rounded shadow-lg text-sm">
          {filtered.map((opt) => (
            <li
              key={opt}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectOption(opt)}
              className="px-3 py-1.5 cursor-pointer hover:bg-green-50"
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
