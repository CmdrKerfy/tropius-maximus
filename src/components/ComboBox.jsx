import { useState, useRef, useEffect } from "react";

export default function ComboBox({ value, onChange, options = [], placeholder = "", className = "" }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  const opts = Array.isArray(options) ? options : [];
  const currentValue = value == null ? "" : String(value);
  const inputValue = isFocused ? draft : currentValue;
  const filtered = opts.filter(
    (opt) => opt.toLowerCase().includes((filter || inputValue || "").toLowerCase())
  );

  useEffect(() => {
    if (!isFocused) {
      setDraft(currentValue);
    }
  }, [currentValue, isFocused]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setIsFocused(false);
        setFilter("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleInputChange(e) {
    const v = e.target.value;
    setDraft(v);
    onChange(v);
    setFilter(v);
    if (!open) setOpen(true);
  }

  function handleFocus() {
    setIsFocused(true);
    setDraft(currentValue);
    setOpen(true);
    setFilter("");
  }

  function handleBlur() {
    setIsFocused(false);
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      setOpen(false);
      setIsFocused(false);
      setFilter("");
      inputRef.current?.blur();
    }
  }

  function selectOption(opt) {
    setDraft(opt);
    onChange(opt);
    setOpen(false);
    setIsFocused(false);
    setFilter("");
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 max-h-48 overflow-y-auto bg-white border border-gray-300 rounded shadow-lg text-sm">
          {filtered.map((opt) => (
            <li
              key={opt}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectOption(opt)}
              className={`px-3 py-1.5 cursor-pointer hover:bg-green-50 ${
                opt === inputValue ? "bg-green-100 font-medium" : ""
              }`}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
