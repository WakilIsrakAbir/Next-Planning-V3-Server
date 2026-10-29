# Next Planning V3 Server

REST API of Epylion Next Planning V3: Excel uploads, orders and planning dates, reports and exports, Dropdown Master,
users and permissions, and the Batch Plan module. Express 4 + TypeScript (ES modules) + Mongoose 8.

> The database (`abir_group`) is shared with the old backend (Shimul Mama Project). Both apps read and write the same
> collections, so keep record shapes and validation rules compatible with the old backend.

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
  constants/            Static defaults (Batch Setup tables)
  routes/               URL -> middleware -> controller wiring only
  controllers/          Read the request, call a service, write the response
  services/             Business logic and database access
  middleware/           Auth (JWT), roles, buyer filter, Batch access, rate limits
  models/               Mongoose schemas
  utils/                Pure helpers (dates, normalising, item matching, Batch rules, HttpError)
  types/                Express request augmentation
  scripts/              CLI scripts (npm run seed)
```

Request flow: `routes/*.routes.ts` -> `middleware/*` -> `controllers/*.controller.ts` -> `services/*.service.ts` -> `models/*`.
Services throw `HttpError(status, message, code?)` (`src/utils/http-error.ts`) for expected failures; controllers turn it into
the response.

## API

All routes are under `/api` and, except login, need `Authorization: Bearer <token>`.

| Prefix           | Routes                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `/api/auth`      | `POST /login`, `POST /heartbeat`, `POST /register`, `GET /users`, `PUT /user/:id`, `DELETE /user/:id`    |
| `/api/files`     | Upload (`POST /upload`), file list/download/delete, planning dates (`save-dates`, `all-dates`, ...)       |
| `/api/orders`    | Buyers, order list, order detail, save dates, tracking, report and load-calculation views and downloads |
| `/api/dropdowns` | Dropdown Master CRUD                                                                                     |
| `/api/batch`     | `GET /units`, `GET /state`, `POST /commit` (Batch Plan module)                                           |

## Deployment (Vercel)

`vercel.json` rewrites every path to `api/index.ts` and runs the function in `sin1` (Singapore), next to the MongoDB
Atlas cluster (AWS ap-southeast-1): every query is a round trip to the database, so the function must run in the same
region. Production deploys from the `main` branch.
Vercel buffers at most 4.5 MB of a function response, so `GET /api/batch/state` streams its body in chunks
(`src/controllers/batch.controller.ts`).
