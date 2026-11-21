# Next Planning V3 Server

REST API of Next Planning V3 (Textile Planning Solution): Excel uploads, orders and planning dates (including the order page's
multi-department save), the Plan Check List and the Checkpoint & Planning Guide, reports and exports, Dropdown Master, users and
permissions, and the Batch Plan module. Express 4 + TypeScript (ES modules) + Mongoose 8.

> The database (`abir_group`) is shared with the old backend (Shimul Mama Project). Both apps read and write the same
> collections, so keep record shapes and validation rules compatible with the old backend.
> The collections `planningsettings` (Plan Check List) and `orderplanguides` (Planning Guide) are V3 only; the old backend
> never reads them.

## Getting started

```bash
npm install
cp .env.example .env   # then fill in the values
npm run dev            # http://localhost:5000
```

| Script          | What it does                                                        |
| --------------- | ------------------------------------------------------------------- |
| `npm run dev`   | Start with hot reload (`tsx watch src/server.ts`)                   |
| `npm run build` | Compile to `dist/`                                                  |
| `npm start`     | Run the compiled server                                             |
| `npm run lint`  | Type-check (`tsc --noEmit`)                                         |
| `npm run seed`  | Create the default Super Admin if it is missing (also done at boot) |
| `npm test`      | Run the tests (vitest); they need the local test MongoDB, see Tests |

### Environment

| Variable     | Default                                       | Notes                       |
| ------------ | --------------------------------------------- | --------------------------- |
| `PORT`       | `5000`                                        |                             |
| `NODE_ENV`   | `development`                                 |                             |
| `MONGO_URI`  | `mongodb://localhost:27017/next_planning_v3`  | MongoDB connection string   |
| `JWT_SECRET` | (required)                                    | At least 10 characters      |
| `CLIENT_URL` | `http://localhost:3000`                       | Allowed CORS origin         |

The values are validated with zod in `src/config/env.ts`; the server exits on an invalid configuration.

## Project structure

```
api/index.ts            Vercel serverless entry (connects once, then hands requests to the Express app)
src/
  server.ts             Local entry: connect, seed the default admin, listen
  app.ts                Express app: security middleware, rate limit, routes, error handler
  config/               Environment, MongoDB connection, GridFS bucket
  constants/            Static defaults (Batch Setup tables, standard Plan Check List)
  routes/               URL -> middleware -> controller wiring only
  controllers/          Read the request, call a service, write the response
  services/             Business logic and database access
  middleware/           Auth (JWT), roles, buyer filter, Batch access, rate limits
  models/               Mongoose schemas
  utils/                Pure helpers (dates, normalising, item matching, Batch rules, HttpError, plan fingerprints,
                        Planning Guide dates)
  types/                Express request augmentation
  scripts/              CLI scripts (npm run seed)
tests/                  Vitest tests (npm test); outside src, so build and lint never compile them
```

Request flow: `routes/*.routes.ts` -> `middleware/*` -> `controllers/*.controller.ts` -> `services/*.service.ts` -> `models/*`.
Services throw `HttpError(status, message, code?, details?)` (`src/utils/http-error.ts`) for expected failures; controllers turn
it into the response (`details` adds fields to the body, e.g. the `departments` of a `save-plans` 409).

## API

All routes are under `/api` and, except login, need `Authorization: Bearer <token>`.

| Prefix                 | Routes                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth`            | `POST /login`, `POST /heartbeat`, `POST /register`, `GET /users`, `PUT /user/:id`, `DELETE /user/:id`                                                   |
| `/api/files`           | Upload (`POST /upload`), file list/download/delete, planning dates (`save-dates`, `all-dates`, ...)                                                     |
| `/api/orders`          | Buyers, order list, order detail, save dates, `POST /save-plans`, `PUT /:orderNo/plan-guide`, tracking, report and load-calculation views and downloads |
| `/api/dropdowns`       | Dropdown Master CRUD                                                                                                                                    |
| `/api/batch`           | `GET /units`, `GET /state`, `POST /commit` (Batch Plan module)                                                                                          |
| `/api/plan-check-list` | `GET /` (every signed-in user), `PUT /` (Admin or the Plan Check List permission)                                                                       |

### Order page, Plan Check List and Planning Guide

- `GET /api/orders/:orderNo` also returns `fingerprints` (one per department), `deptFlags` (`{ inLatestFile, hasItems }` per
  department) and `guide` (the saved Planning Guide, or `null`). `?fresh=1` skips reading the 60 s details cache.
- `POST /api/orders/save-plans` with `{ orderNo, plans: [{ department, fabricItems, orderStatus?, completedDate? }], base? }`
  (`src/services/plan-save.service.ts`): saves 1 to 5 departments of one order in one `OrderDate` write, each stored as
  `save-dates` stores it, and sets their plan statuses. `base` holds the fingerprints the page read; a department changed by
  someone else since is refused with 409 `{ code: 'CONFLICT', message, departments }` and nothing is written. Other errors:
  400 `{ code: 'INVALID', message }`, 404, 500. Answer: `{ message, planData, planStatuses, statusSynced, fingerprints }`.
  No role check, like `save-dates`, which stays unchanged for the old app and the Tracking pages.
- `PUT /api/orders/:orderNo/plan-guide` with `{ yesIds, dates, version? }` (`src/services/plan-guide.service.ts`): any
  signed-in user. Saves the order's Planning Guide with a version check (409 `CONFLICT`), 400 `INVALID`, 404. The server
  computes the lead from the current Plan Check List: the largest Start days and, separately, the largest End days of the
  criteria that are Yes and Active (`src/utils/plan-guide-dates.ts`). It never changes plan rows, T&A fields or statuses.
- `GET /api/plan-check-list`: every signed-in user, never 403, `Cache-Control: no-store`; the first read creates the standard
  list. `PUT /api/plan-check-list` with `{ items, version }`: Admin or `menus.dataManagement.planCheckList === true`, otherwise
  403 `{ code: 'PERMISSION' }`; 400 `INVALID` names the row; 409 `CONFLICT` when the version changed.

Bodies, rules and status codes in detail: `docs/routing.md` (sections 3.2b, 3.3 and 3.3a) in the workspace folder.

## Tests

`npm test` runs vitest over `tests/**/*.test.ts` (`vitest.config.mts`). The tests live outside `src`, so `npm run build` and
`npm run lint` never compile them.

- They need the **local test MongoDB** at `mongodb://127.0.0.1:27099`, never the live database. Each test file that uses it
  creates its own `v3t_*` database and drops it at the end; `tests/helpers/local-mongo.ts` refuses any other server.
  `tests/setup.ts` sets test values for `MONGO_URI` and `JWT_SECRET`, so the `.env` values are not used.
- **Golden tests** (`tests/golden/`) run `save-dates` and the order details read on real orders and compare the result with
  recordings made before the `save-plans` change. The orders are copied, read only, from `abir_test` (a restored copy of the
  live database on the local test server). Fixtures and recordings live in `tests/golden/local/`, which is gitignored because
  it holds real data. Without them and without `abir_test` the golden tests are skipped. A missing recording fails the test
  unless `GOLDEN_RECORD=1` is set, which records the current behaviour (`GOLDEN_RECORD=1 npx vitest run tests/golden`).

## Deployment (Vercel)

`vercel.json` rewrites every path to `api/index.ts` and runs the function in `sin1` (Singapore), next to the MongoDB
Atlas cluster (AWS ap-southeast-1): every query is a round trip to the database, so the function must run in the same
region. Production deploys from the `main` branch.
Vercel buffers at most 4.5 MB of a function response, so `GET /api/batch/state` streams its body in chunks
(`src/controllers/batch.controller.ts`).
