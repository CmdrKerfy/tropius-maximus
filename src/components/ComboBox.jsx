import { useState, useRef, useEffect } from "react";

export default function ComboBox({ value, onChange, options = [], placeholder = "", className = "" }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  const filtered = options.filter(
    (opt) => opt.toLowerCase().includes((filter || value || "").toLowerCase())
  );

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setFilter("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleInputChange(e) {
    const v = e.target.value;
    onChange(v);
    setFilter(v);
    if (!open) setOpen(true);
  }

  function handleFocus() {
    setOpen(true);
    setFilter("");
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      setOpen(false);
      setFilter("");
      inputRef.current?.blur();
    }
  }

  function selectOption(opt) {
    onChange(opt);
    setOpen(false);
    setFilter("");
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleInputChange}
        onFocus={handleFocus}
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
                opt === value ? "bg-green-100 font-medium" : ""
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
