import { useEffect } from "react";

export default function PaymentMethodPicker({
  amount = 0,
  value = "wallet",
  methods = ["wallet", "card"],
  onChange = () => {},
  context = {},
}) {
  useEffect(() => {
    function onCharge() {
      if (value !== "card") return;
      // The parent handles Paystack popup; this component only signals readiness.
      // If you want this component to run Paystack inline, move that logic here.
      const reference = "CARD-" + Date.now();
      document.dispatchEvent(
        new CustomEvent("paymentpicker:success", { detail: { reference } }),
      );
    }
    document.addEventListener("paymentpicker:charge", onCharge);
    return () => document.removeEventListener("paymentpicker:charge", onCharge);
  }, [value]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        {methods.includes("wallet") && (
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="pay"
              value="wallet"
              checked={value === "wallet"}
              onChange={() => onChange("wallet")}
            />
            <span>Wallet</span>
          </label>
        )}
        {methods.includes("card") && (
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="pay"
              value="card"
              checked={value === "card"}
              onChange={() => onChange("card")}
            />
            <span>Saved Card / Card</span>
          </label>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        Total: ₦{Number(amount || 0).toLocaleString()}
      </p>
    </div>
  );
}
