// apps/api/scripts/migrate-pro-services.js
// run with: cd apps/api && node scripts/migrate-pro-services.js

import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import mongoose from "mongoose";
import { Pro } from "../models.js";

const MONGO_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/kpocha";

function toMoneyString(v) {
  if (v === undefined || v === null) return "";
  return v.toString().replace(/,/g, "").trim();
}

(async () => {
  try {
    console.log("[migrate] connecting to", MONGO_URI);
    await mongoose.connect(MONGO_URI);

    const cursor = Pro.find({}).cursor();
    let changedCount = 0;

    for (
      let pro = await cursor.next();
      pro != null;
      pro = await cursor.next()
    ) {
      let changed = false;

      if (Array.isArray(pro.servicesDetailed) && pro.servicesDetailed.length) {
        const names = pro.servicesDetailed
          .map((s) => s && s.name)
          .filter(Boolean);

        // only set if different
        pro.professional = pro.professional || {};
        pro.professional.services = names;
        changed = true;
      } else {
        let source = [];

        if (Array.isArray(pro.services) && pro.services.length) {
          source = pro.services;
        } else if (
          pro.professional &&
          Array.isArray(pro.professional.services) &&
          pro.professional.services.length
        ) {
          source = pro.professional.services;
        }

        const detailed = source
          .map((item) => {
            if (!item) return null;

            if (typeof item === "string") {
              return { id: item, name: item, price: "0" };
            }

            const name = item.name || item.id || "";
            if (!name) return null;

            const price = item.price ? toMoneyString(item.price) : "0";
            const promo = item.promoPrice ? toMoneyString(item.promoPrice) : "";

            return {
              id: item.id || name,
              name,
              price,
              ...(promo ? { promoPrice: promo } : {}),
            };
          })
          .filter(Boolean);

        pro.servicesDetailed = detailed;
        pro.professional = pro.professional || {};
        pro.professional.services = detailed.map((d) => d.name);

        changed = true;
      }

      if (changed) {
        await pro.save();
        changedCount++;
      }
    }

    console.log("[migrate] done. pros updated:", changedCount);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("[migrate] error:", err);
    process.exit(1);
  }
})();
