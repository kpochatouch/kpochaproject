//apps/web/src/lib/loadPaystack.js
let paystackPromise = null;

export function loadPaystackScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("PAYSTACK_BROWSER_ONLY"));
  }

  if (window.PaystackPop) {
    return Promise.resolve(window.PaystackPop);
  }

  if (paystackPromise) {
    return paystackPromise;
  }

  paystackPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[data-paystack-script="true"]',
    );

    if (existing) {
      existing.addEventListener("load", () => {
        if (window.PaystackPop) resolve(window.PaystackPop);
        else reject(new Error("PAYSTACK_LOAD_FAILED"));
      });
      existing.addEventListener("error", () =>
        reject(new Error("PAYSTACK_LOAD_FAILED")),
      );
      return;
    }

    const s = document.createElement("script");
    s.src = "https://js.paystack.co/v1/inline.js";
    s.async = true;
    s.defer = true;
    s.dataset.paystackScript = "true";

    s.onload = () => {
      if (window.PaystackPop) resolve(window.PaystackPop);
      else reject(new Error("PAYSTACK_LOAD_FAILED"));
    };

    s.onerror = () => reject(new Error("PAYSTACK_LOAD_FAILED"));

    document.head.appendChild(s);
  });

  return paystackPromise;
}
