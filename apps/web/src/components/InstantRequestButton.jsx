import React from "react";
import { useNavigate } from "react-router-dom";

export default function InstantRequestButton({
  mode = "service",
  service,
  amountNaira,
  stateName,
  lga,
  className = "",
}) {
  const navigate = useNavigate();

  function handleClick() {
    // SERVICE MODE requires service + state + lga
    if (mode === "service") {
      if (!service) {
        return alert(
          "Please choose a service before requesting an instant booking.",
        );
      }
      if (!stateName || !lga) {
        return alert(
          "Please choose a state and LGA (service location) before requesting.",
        );
      }

      return navigate("/instant-request", {
        state: {
          mode: "service",
          serviceName: service,
          amountNaira: amountNaira,
          stateName: stateName.toUpperCase(),
          lga: lga.toUpperCase(),
        },
      });
    }

    // WILDCARD MODE requires nothing (Instant → My LGA)
    return navigate("/instant-request", {
      state: {
        mode: "wildcard",
      },
    });
  }

  return (
    <button
      onClick={handleClick}
      className={
        className ||
        "rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-500 transition"
      }
    >
      Instant Request
    </button>
  );
}
