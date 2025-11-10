// apps/api/scripts/migrateProfiles.js
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("Missing MONGODB_URI");

await mongoose.connect(MONGODB_URI);
const col = mongoose.connection.db.collection("profiles");

// find docs that have ownerUid but no uid
const cursor = col.find({
  uid: { $exists: false },
  ownerUid: { $exists: true, $ne: null, $ne: "" },
});

let migrated = 0;
while (await cursor.hasNext()) {
  const doc = await cursor.next();

  await col.updateOne(
    { _id: doc._id },
    {
      // just add uid
      $set: { uid: doc.ownerUid },
      // ❌ do NOT $unset ownerUid here because of the unique index
    }
  );
  migrated++;
}

console.log(`✅ Migrated ${migrated} profiles (uid set from ownerUid).`);
await mongoose.disconnect();
process.exit(0);
