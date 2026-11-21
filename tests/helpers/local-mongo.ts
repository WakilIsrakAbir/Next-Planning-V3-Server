import mongoose, { Model } from 'mongoose';

/**
 * The only MongoDB server the tests may use: the local test server. Never the live database.
 * Test files write only to their own `v3t_*` database and drop it at the end. `abir_test` (a restored copy of
 * live) is only ever read, to copy real orders into a test database.
 */
export const LOCAL_MONGO = 'mongodb://127.0.0.1:27099';
export const LOCAL_HOST = '127.0.0.1';
export const LOCAL_PORT = 27099;

/** Throws unless the URI points at the local test server. */
export function assertLocalUri(uri: string): void {
  if (!/^mongodb:\/\/127\.0\.0\.1:27099(\/[A-Za-z0-9_]*)?$/.test(uri)) {
    throw new Error(`Refusing to run: "${uri}" is not the local test MongoDB (${LOCAL_MONGO}).`);
  }
}

/** URI of a test database; the name must start with v3t_. */
export function testDbUri(dbName: string): string {
  if (!/^v3t_[a-z0-9_]+$/.test(dbName)) {
    throw new Error(`Test databases must be named v3t_<something> (lower case); got "${dbName}".`);
  }
  const uri = `${LOCAL_MONGO}/${dbName}`;
  assertLocalUri(uri);
  return uri;
}

/** Throws unless mongoose is connected to a v3t_* database on the local test server. */
export function assertOnTestDb(): void {
  const c = mongoose.connection;
  if (c.host !== LOCAL_HOST || Number(c.port) !== LOCAL_PORT || !String(c.name || '').startsWith('v3t_')) {
    throw new Error(`Refusing to continue: mongoose is connected to ${c.host}:${c.port}/${c.name}, not a local v3t_* database.`);
  }
}

/**
 * Connects mongoose to a fresh (dropped) test database and builds the indexes of the given models, such as the
 * unique orderNo index, the way a local server run builds them.
 */
export async function openTestDb(dbName: string, models: Model<any>[]): Promise<void> {
  await mongoose.connect(testDbUri(dbName), { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
  assertOnTestDb();
  await mongoose.connection.dropDatabase();
  for (const model of models) {
    await model.createIndexes();
  }
}

/** Drops the test database and disconnects. */
export async function closeTestDb(): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  assertOnTestDb();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

/** Deletes every document of the given collections (between scenarios). */
export async function clearCollections(names: string[]): Promise<void> {
  assertOnTestDb();
  for (const name of names) {
    await mongoose.connection.db!.collection(name).deleteMany({});
  }
}

/** The raw native-driver collection of the test database. */
export function rawCollection(name: string) {
  assertOnTestDb();
  return mongoose.connection.db!.collection(name);
}
