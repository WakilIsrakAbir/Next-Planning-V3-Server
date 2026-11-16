/* Restore a backup downloaded from Data Management > Atlas Monitor (GET /api/monitor/backup).
   Reads files made by this app and by the old app (same 'abir-backup' v1 format).

   Check a file (no database needed):
     npm run restore-backup -- <backup.jsonl.gz> --verify

   Restore into a database (a new or empty one by default):
     npm run restore-backup -- <backup.jsonl.gz> --uri "<mongodb uri>" --db <database name>
       --drop            replace collections that already have documents in the target database
       --overwrite-live  also needed when the target is the live database (MONGO_URI in .env)

   Nothing is written before the whole file has been checked (header, every line, end line, counts). */
import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const { MongoClient, BSON } = mongoose.mongo;
const { EJSON } = BSON;
const FORMAT = 'abir-backup';
const BATCH = 500;

interface Args {
  file: string;
  verify: boolean;
  uri: string | null;
  db: string | null;
  drop: boolean;
  overwriteLive: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { file: '', verify: false, uri: null, db: null, drop: false, overwriteLive: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--verify') args.verify = true;
    else if (a === '--drop') args.drop = true;
    else if (a === '--overwrite-live') args.overwriteLive = true;
    else if (a === '--uri') args.uri = argv[++i];
    else if (a === '--db') args.db = argv[++i];
    else if (!a.startsWith('--') && !args.file) args.file = a;
    else throw new Error('Unknown argument: ' + a);
  }
  if (!args.file) throw new Error('Give the backup file as the first argument.');
  if (!args.verify && (!args.uri || !args.db)) throw new Error('Give --verify, or both --uri and --db.');
  return args;
}

interface Header {
  type: 'header';
  format: string;
  database: string;
  createdAt: string;
  createdBy?: string;
  collections: { name: string; indexes?: Record<string, any>[] }[];
}

/** Reads the file line by line. onDoc(collection, document) is called for every document line. */
export async function readBackup(
  file: string,
  onDoc?: (collection: string, doc: Record<string, any>) => Promise<void>
): Promise<{ header: Header; counts: Record<string, number> }> {
  const lines = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let header: Header | null = null;
  let end: { counts: Record<string, number> } | null = null;
  let lineNo = 0;
  const counts: Record<string, number> = {};
  for await (const line of lines) {
    lineNo++;
    if (!line.trim()) continue;
    if (end) throw new Error(`Line ${lineNo}: data after the end line`);
    if (!header) {
      header = JSON.parse(line) as Header;
      if (header.type !== 'header' || header.format !== FORMAT) throw new Error('Not an Atlas Monitor backup file (no header line).');
      header.collections.forEach((c) => {
        counts[c.name] = 0;
      });
      continue;
    }
    if (line.startsWith('{"type":')) {
      const rec = JSON.parse(line);
      if (rec.type === 'end') {
        end = rec;
        continue;
      }
      throw new Error(`Line ${lineNo}: unexpected record type ${rec.type}`);
    }
    const rec = EJSON.parse(line, { relaxed: false }) as { c: string; d: Record<string, any> };
    if (!Object.prototype.hasOwnProperty.call(counts, rec.c)) throw new Error(`Line ${lineNo}: collection ${rec.c} is not in the header`);
    counts[rec.c]++;
    if (onDoc) await onDoc(rec.c, rec.d);
  }
  if (!header) throw new Error('Empty file.');
  if (!end) throw new Error('The file has no end line: the download did not finish. Do not use this file.');
  for (const [name, n] of Object.entries(end.counts)) {
    if (counts[name] !== n) throw new Error(`Count mismatch in ${name}: end line says ${n}, file has ${counts[name]}`);
  }
  return { header, counts };
}

const hostOf = (uri: string): string => {
  try {
    return new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).host.toLowerCase();
  } catch {
    return uri;
  }
};

async function main(): Promise<void> {
  dotenv.config();
  const args = parseArgs(process.argv.slice(2));

  // 1. Check the whole file before touching any database.
  const checked = await readBackup(args.file);
  console.log(`File OK: database "${checked.header.database}", made ${checked.header.createdAt} by ${checked.header.createdBy || '-'}`);
  for (const [name, n] of Object.entries(checked.counts)) console.log(`  ${name}: ${n}`);
  if (args.verify) return;

  // 2. Guard the live database.
  const live = process.env.MONGO_URI;
  if (live && hostOf(live) === hostOf(args.uri!) && args.db === checked.header.database && !args.overwriteLive) {
    throw new Error(`"${args.db}" on this server is the live database. Add --overwrite-live (and --drop) only if you really mean to replace live data.`);
  }

  const client = new MongoClient(args.uri!);
  await client.connect();
  try {
    const db = client.db(args.db!);
    const names = checked.header.collections.map((c) => c.name);
    const existing: string[] = [];
    for (const name of names) if ((await db.collection(name).estimatedDocumentCount()) > 0) existing.push(name);
    if (existing.length && !args.drop) throw new Error(`Target already has data in: ${existing.join(', ')}. Use --drop to replace these collections.`);
    for (const name of existing) await db.collection(name).drop();

    // 3. Insert documents in batches.
    const buffers = new Map<string, Record<string, any>[]>(names.map((n) => [n, []]));
    const flush = async (name: string) => {
      const docs = buffers.get(name)!;
      if (!docs.length) return;
      await db.collection(name).insertMany(docs, { ordered: true });
      buffers.set(name, []);
    };
    const restored = await readBackup(args.file, async (name, doc) => {
      buffers.get(name)!.push(doc);
      if (buffers.get(name)!.length >= BATCH) await flush(name);
    });
    for (const name of names) await flush(name);

    // 4. Indexes, then compare counts.
    for (const c of checked.header.collections) {
      const specs = (c.indexes || []).map(({ v, ns, ...spec }) => spec) as any[];
      if (specs.length) await db.collection(c.name).createIndexes(specs);
    }
    let ok = true;
    for (const name of names) {
      const n = await db.collection(name).countDocuments();
      if (n !== restored.counts[name]) {
        ok = false;
        console.error(`  ${name}: expected ${restored.counts[name]}, found ${n}`);
      }
    }
    if (!ok) throw new Error('Restore finished but counts do not match.');
    console.log(`Restored into "${args.db}": ${names.length} collections, all counts match.`);
  } finally {
    await client.close();
  }
}

if (process.argv[1] && /restore-backup\.(ts|js)$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error('ERROR:', error.message);
    process.exit(1);
  });
}
