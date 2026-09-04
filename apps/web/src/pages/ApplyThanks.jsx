// apps/web/src/pages/ApplyThanks.jsx
import { Link } from "react-router-dom";

export default function ApplyThanks() {
  return (
    <div className="max-w-lg mx-auto px-4 py-16 text-center">
      <h2 className="text-2xl font-semibold mb-3">Application Submitted</h2>
      <p className="text-zinc-300">
        Thanks! Your professional application has been received and is now
        pending review. You’ll get an update once it’s approved or if we need
        more info.
      </p>
      <div className="mt-6 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 text-left">
        <h3 className="font-semibold text-yellow-300">Complete verification later</h3>
        <p className="mt-1 text-sm text-zinc-300">
          Face verification is not required to apply right now. We'll keep
          reminding you in the app until it is complete.
        </p>
        <Link
          to="/settings"
          className="mt-3 inline-block text-sm font-semibold text-yellow-300 underline"
        >
          Go to Settings
        </Link>
      </div>
    </div>
  );
}
