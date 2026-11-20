import type { Express } from 'express';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { rawCollection } from './local-mongo.js';
import { TEST_JWT_SECRET } from './test-env.js';

export interface RunningApp {
  baseUrl: string;
  close: () => Promise<void>;
}

/** Starts the Express app on a free local port. */
export async function startApp(app: Express): Promise<RunningApp> {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

/** Inserts an active user into the test database and returns a bearer token for it (signed with the test secret). */
export async function createTestUser(
  role: 'Admin' | 'Approver' | 'Planner' | 'Viewer' = 'Admin',
  username = 'v3t_admin'
): Promise<string> {
  const _id = new mongoose.Types.ObjectId();
  await rawCollection('users').insertOne({ _id, username, password: 'not-used', role, status: 'active', permissions: {} });
  return jwt.sign({ userId: String(_id), username, role }, TEST_JWT_SECRET, { expiresIn: '1h' });
}

export interface JsonResponse {
  status: number;
  body: any;
}

/** Sends a JSON request and parses the JSON answer. */
export async function requestJson(
  baseUrl: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  token: string,
  body?: unknown
): Promise<JsonResponse> {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not JSON; keep the text
  }
  return { status: res.status, body: parsed };
}
