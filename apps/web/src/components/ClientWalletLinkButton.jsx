// apps/web/src/components/ClientWalletLinkButton.jsx

import { Link } from "react-router-dom";

/**
 * Reusable link button to open the user's Client Wallet page.
 * - Does NOT expose any other user’s wallet (always /client-wallet).
 */
export default function ClientWalletLinkButton({
  to = "/client-wallet",
  label = "View Client Wallet",
  className = "",
  title = "Open your client wallet (credits & refunds)",
}) {
  return (
    <Link
      to={to}
      title={title}
      className={
        className ||
        "px-3 py-2 rounded-lg border border-zinc-800 text-sm hover:bg-zinc-900"
      }
    >
      {label}
    </Link>
  );
}