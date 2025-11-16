#!/usr/bin/env node
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set in env');
    process.exit(1);
  }
  await mongoose.connect(uri, {});

  const db = mongoose.connection.db;
  try {
    console.log('Creating indexes...');

    await db.collection('posts').createIndex({ isPublic: 1, hidden: 1, deleted: 1, createdAt: -1 });
    await db.collection('posts').createIndex({ lga: 1, isPublic: 1, createdAt: -1 });
    await db.collection('poststats').createIndex({ postId: 1 });
    await db.collection('notifications').createIndex({ toUid: 1, read: 1, createdAt: -1 });
    await db.collection('follows').createIndex({ toUid: 1, fromUid: 1, createdAt: -1 });
    await db.collection('bookings').createIndex({ proOwnerUid: 1, status: 1, createdAt: -1 });

    console.log('Indexes created.');
  } catch (e) {
    console.error('index creation failed', e);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
