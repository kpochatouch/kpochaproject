// apps/web/src/utils/useFormAutofill.js
import { useEffect } from "react";
import { useAuth } from "../context/AuthContext";

export function useFormAutofill(setters) {
  // setters is an object of { fieldName: setStateFn }
  const { autofill } = useAuth();
  useEffect(() => {
    if (!autofill) return;
    Object.entries(setters).forEach(([k, set]) => {
      if (autofill[k] !== undefined && typeof set === "function") {
        set((prev) => prev || autofill[k]); // don’t overwrite user edits
      }
    });
  }, [autofill]); // run when profile/me hydrate
}
