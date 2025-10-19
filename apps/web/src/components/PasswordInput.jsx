import { useState } from "react";

export default function PasswordInput({
  value,
  onChange,
  name = "password",
  placeholder = "Enter password",
  required = true,
  autoComplete = "new-password",
  className = "",
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={
          "w-full rounded-lg border border-zinc-800 bg-black px-3 py-2 pr-12 focus:outline-none focus:ring-1 focus:ring-amber-400 " +
          className
        }
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-amber-300"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}
