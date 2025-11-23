// apps/api/scripts/backfill_wallet_for_booking.js
import "dotenv/config";
import mongoose from "mongoose";
import { Booking } from "../models/Booking.js";
import { creditProPendingForBooking } from "../services/walletService.js";

async function main() {
  const bookingId = process.argv[2];

  if (!bookingId) {
    console.error("Usage: node scripts/backfill_wallet_for_booking.js <bookingId>");
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("MONGODB_URI not set in env.");
    process.exit(1);
  }

  try {
    console.log("[mongo] connecting…");
    await mongoose.connect(mongoUri);
    console.log("[mongo] connected.");

    const booking = await Booking.findById(bookingId).lean();
    if (!booking) {
      console.error("[error] Booking not found for id:", bookingId);
      process.exit(1);
    }

    console.log("[booking] found:", {
      _id: booking._id.toString(),
      amountKobo: booking.amountKobo,
      proId: booking.proId,
      proOwnerUid: booking.proOwnerUid,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
    });

    const res = await creditProPendingForBooking(booking, {
      source: "manual_backfill",
      note: "Backfilled from existing paid booking after wallet flow setup",
    });

    console.log("[wallet] creditProPendingForBooking result:", res);

    await mongoose.disconnect();
    console.log("[mongo] disconnected.");
    process.exit(0);
  } catch (err) {
    console.error("[error] backfill failed:", err);
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(1);
  }
}

main();
