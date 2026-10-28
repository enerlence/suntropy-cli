# @enerlence/suntropy-cli

Agent-first CLI for the Suntropy solar platform. JSON output by default, optimized for programmatic manipulation by AI agents and automation pipelines.

## Installation

```bash
npm install -g @enerlence/suntropy-cli
```

Or run directly:

```bash
npx @enerlence/suntropy-cli <command>
```

## Authentication

```bash
# Browser login (recommended, also for agents): prints a URL and a code; the
# user approves it in the Suntropy app and the CLI stores an API v2 key (sun_…)
suntropy auth login --web
suntropy auth login --web --device-name "Alexandria sandbox" --scopes leadgen:read,credits:read

# API key: an API v2 key (sun_…) or a legacy JWT API key
suntropy auth set-key --key sun_xxxxxxxx
suntropy auth set-key --key <jwt-api-key>

# Target a specific server / profile (global options — see "Global Options")
suntropy --server https://api-dev.example.cloud --profile dev auth set-key --key <jwt>
suntropy --profile dev auth status

# Email/password login
suntropy auth login --email user@co.com --password pass

# Check status
suntropy auth status
```

> `--server`, `--profile` and `--token` are **global** options: pass them on the
> root command (e.g. `suntropy --profile dev auth status`). They apply to every
> subcommand, including `auth`.

### Two kinds of credential, one command line

| Credential | From | Goes to |
|---|---|---|
| **API v2 key** (`sun_…`) | `auth login --web`, `auth set-key sun_…`, or the API v2 panel in Configuration | the API gateway, `<gateway>/api/v2/…` |
| **JWT** (user session or legacy API key) | `auth login --email --password`, `auth set-key <jwt>` | the internal routes, `<server>/<service>/…` |

Every command declares the route it uses in each API version, and the CLI
picks one per request from the credential: a `sun_` key goes to the v2, a JWT
or a legacy key to the v1. The JSON a command prints (`--format json`) is the
same in both: the CLI unwraps `data`, turns the v2 pagination into the usual
`{ data, total, limit, offset, hasMore }`, walks the pages where the v1 returns
the whole collection, and prints deletes as `{ "success": true, "deleted": … }`.
The only differences are the ones the contract allows: who appears as author
of what a key creates (`api-key:gateway-<id>`), no password hash in shareables,
no `client` record in the theme, no private projects of people with a key, and
`--credit-amount` ignored with a key (the licence decides the credits).

- Three commands stay on v1 and stop with `V2_KEY_NOT_SUPPORTED` when run with a
  `sun_` key: `config solarform advanced init-default` (superadmin, acts on
  another account) and `solarform statistics --create|--update` (anonymous
  widget telemetry).
- A v2 error is printed on stderr with the gateway's `code`, `message` and
  `status` (e.g. `{"error":true,"code":"INSUFFICIENT_SCOPE",…}`); stdout stays
  empty, as with v1.
- `auth login --web` asks for the 17 scopes the CLI uses (studies, inventory,
  calculations, documents, reference, settings, notifications, projects,
  leadgen and `credits:read`); `--scopes a,b` asks for fewer.
- `config theme get|edit`: `--client-uid` is optional (your account by
  default). With a key it can only be the key's own account
  (`CLIENT_UID_MISMATCH`).

The route of every command in each version is in
[`docs/v2-gaps.md`](docs/v2-gaps.md); the code lives in `src/api/` (`core.ts`
picks the version, `translate.ts` holds the translations, `ops/*.ts` the
routes). `npm run parity` compares both versions against a real backend
([`scripts/parity/README.md`](scripts/parity/README.md)).

- `auth status` shows `credential: "sun_"` or `"jwt"`; for a `sun_` key it asks
  the gateway (`GET /api/v2/me`) for its `label`, `scopes`, `clientUID` and
  `expiresAt`. A revoked key shows `authenticated: false` and `INVALID_KEY`.
- `auth refresh` only applies to JWTs. `auth logout` clears either kind.

### Browser login (`auth login --web`)

OAuth device authorization grant (RFC 8628) against the API gateway:

1. The CLI asks the gateway for a code (`POST /api-gateway/device/code`).
2. It prints the URL (`https://app.suntropy.ai/cli?code=XXXX-XXXX`) and the code,
   and opens the browser only when there is one (interactive terminal on macOS or
   Windows, or Linux with `DISPLAY`/`WAYLAND_DISPLAY`; never with `CI=true`;
   `--no-browser` to skip it).
3. A user **admin** of the account approves it with their own session.
4. The CLI polls `POST /api-gateway/device/token` (respecting `interval`, +5 s on
   `slow_down`) and stores the key in the active profile (or `--profile`).

With `--format json` (the default) the output is one JSON object per line, so
an agent can hand the URL to the user before the command ends:

```json
{"verification_uri":"https://app.suntropy.ai/cli","verification_uri_complete":"https://app.suntropy.ai/cli?code=BCDF-GHJK","user_code":"BCDF-GHJK","expires_in":600}
{"status":"approved","label":"CLI · my-laptop · 2026-10-28","clientUID":"…","scopes":["leadgen:read","leadgen:write","credits:read"]}
```

On failure the second line is `{"status":"denied"|"expired"|"error","message":"…"}`
and the exit code is 1. Agents never ask for or type passwords or codes: they
give the URL and the code to the user and wait.

### Gateway origin

The API v2 gateway is resolved in this order:

1. `SUNTROPY_GATEWAY_URL` environment variable;
2. `gatewayUrl` of the profile (`suntropy config set gatewayUrl http://localhost:8087`);
3. derived from the profile server: `api.enerlence.com` (prod) → `https://api.suntropy.ai`;
   `api-dev.enerlence.com` (dev) → `https://api-dev.enerlence.com`.

Any other server (localhost, a custom host) needs 1 or 2.

### Token resolution order

The auth token is resolved in this order (first non-empty wins):

1. `--token <jwt>` global flag
2. `SUNTROPY_API_KEY` environment variable
3. `token` stored in the active profile (`~/.suntropy/config.json`, written by
   `auth set-key` / `auth login`)

The `SUNTROPY_API_KEY` fallback (available since `0.11.3`) lets a host runtime
inject a just-in-time credential without a prior `auth login` / `auth set-key`:

```bash
SUNTROPY_API_KEY=<jwt> suntropy studies list
```

> ⚠️ The value must be a **JWT** or an **API v2 key** (`sun_…`), i.e. what you'd
> pass to `auth set-key --key`; the CLI sends it as `Authorization: Bearer <token>`.
> Every command works with both; see "Two kinds of credential".

## Global Options

| Option | Default | Description |
|--------|---------|-------------|
| `--format json\|human\|csv` | `json` | Output format |
| `--fields f1,f2,...` | all | Select specific fields |
| `--server <url>` | config | Override API server URL |
| `--token <jwt>` | `SUNTROPY_API_KEY` env / config | Override auth token (see "Token resolution order") |
| `--profile <name>` | default | Config profile |
| `--verbose` | false | Show HTTP details on stderr |
| `--quiet` | false | Suppress non-data output |
| `--save <file>` | - | Save output to file |

## Commands

### `suntropy studies` - Solar Studies

Progressive exploration and full study lifecycle management.

```bash
# Explore existing studies
suntropy studies list --limit 20 --state "En curso"
suntropy studies metadata <id>
suntropy studies get <studyId>
suntropy studies get <studyId> --expand surfaces,results
suntropy studies get <studyId> --expand all
suntropy studies curves <studyId> consumption --stats
suntropy studies curves <studyId> production --monthly

# Calculate production/optimization
suntropy studies calculate-production --lat 37.39 --lon -5.99 --power 5000
suntropy studies optimize-surfaces --lat 37.39 --lon -5.99
```

#### Study Builder (create/edit studies)

Build solar studies progressively in a local JSON file, with automatic step validation replicating the frontend's 6-step system.

```bash
# Initialize or pull existing study
suntropy studies init --file study.json --name "Residencial 5kW"
suntropy studies pull <studyId> --file study.json

# Configure step by step
suntropy studies set tariff --file study.json --tariff-id 13 --zone-id 1
suntropy studies set prices --file study.json --energy-p1 0.25 --energy-p2 0.17 --energy-p3 0.13
suntropy studies set client --file study.json --name "Juan Garcia" --email j@co.com
suntropy studies set consumption --file study.json --annual 4000 --pattern Domestic
suntropy studies set kit --file study.json --kit-id 2260
suntropy studies add surface --file study.json --lat 37.39 --lon -5.99 --angle 30 --azimuth 180 --power 6000

# Calculate production and results (SolarResultCalculator)
suntropy studies calculate production --file study.json --all-surfaces
suntropy studies calculate-results --file study.json

# Economics, validate, save
suntropy studies set economics --file study.json --margin 15 --total-cost 3990
suntropy studies validate --file study.json
suntropy studies save --file study.json

# Comments
suntropy studies add-comment --file study.json --content "Reviewed by agent"
suntropy studies comment <studyId> --content "Updated via CLI"
```

**Consumption modes:**
- `--annual 4000 --pattern Domestic` - Annual kWh + pattern (Balance, Nightly, Morning, Afternoon, Domestic, Commercial)
- `--by-period '{"p1":2500,"p2":1000,"p3":500}'` - Consumption per tariff period
- `--monthly '{"1":350,"2":320,...,"12":340}'` - Monthly consumption
- `--from-file /path/to/curve.json` - Raw PowerCurve JSON

**Equipment modes:**
- `suntropy studies set kit --kit-id <id>` - Solar kit (sets `peakPowerIntroductionMode: solarKit`)
- `suntropy studies set panel --panel-id <id> --panels-count 12` - Individual panel (sets `peakPowerIntroductionMode: solarPanel`)
- `suntropy studies set inverter --inverter-id <id>` - Inverter (panel mode)

**Auto-validation:** Every `set`/`add`/`calculate` command returns the current completion status:

```json
{
  "stepsProgress": {
    "clientDetails": true,
    "consumption": true,
    "surfacesSelector": true,
    "production": true,
    "results": true,
    "economicBalance": false
  },
  "completionPercentage": 83,
  "missing": {
    "economicBalance": "Needs: totalCost (use: studies set economics)"
  }
}
```

### `suntropy inventory` - Inventory Management

CRUD for all equipment types.

```bash
# List, get, create, update, delete — same pattern for all types
suntropy inventory panels list --active-only --fields solarPanelId,name,peakPower
suntropy inventory panels get <id>
suntropy inventory panels create --data '{"name":"JA Solar 450W","peakPower":450}'
suntropy inventory panels update <id> --data '{"peakPower":460}'
suntropy inventory panels delete <id>

# Available resource types:
#   panels, inverters, batteries, chargers, heatpumps,
#   custom-assets, custom-asset-types, custom-fields,
#   kits, charger-kits, heatpump-kits, manufacturers
```

**Kit assembly (create kit components first, then assemble):**

```bash
# 1. Create kit-specific panel and inverter
suntropy inventory kits panels create --data '{"name":"Panel Kit 450W","peakPower":450}'
suntropy inventory kits inverters create --data '{"name":"Inversor Kit 5kW","nominalPower":5000}'

# 2. Assemble kit referencing component IDs
suntropy inventory kits assemble \
  --name "Kit Solar 5kW" \
  --panel <kitPanelId> --inverter <kitInverterId> \
  --panels-count 12 --peak-power 5.4 --price 3500
```

### `suntropy curves` - PowerCurve Operations

Pipe-friendly operations on hourly energy curves (8760 values/year).

```bash
# Statistics and totals
suntropy curves stats --input production.json
suntropy curves total --input consumption.json

# Arithmetic
suntropy curves subtract --a production.json --b consumption.json --save net.json
suntropy curves aggregate --a curve1.json --b curve2.json
suntropy curves multiply 0.85 --input production.json

# Filtering
suntropy curves filter-positive --input net.json    # Keep positive values
suntropy curves filter-negative --input net.json    # Keep negative values
suntropy curves filter-dates --start 2024-06-01 --end 2024-08-31 --input curve.json

# Period aggregation
suntropy curves by-period --input consumption.json --periods periods.json

# Piping
suntropy curves subtract --a prod.json --b cons.json \
  | suntropy curves filter-positive --input - --save excesses.json
```

### `suntropy consumption` - Consumption Curves

Generate consumption curves from patterns, profiles, or files.

```bash
suntropy consumption estimate --annual 5000 --pattern Domestic --save consumption.json
suntropy consumption ree-profiles --start 2024-01-01 --end 2024-12-31 --tariff 3.0TD
suntropy consumption periods --tariff-id 14 --zone-id 1 --save periods.json
suntropy consumption from-file --eredes-zip /path/to/file.zip
```

### `suntropy solarform` - Solar Form API

Quick solar study creation via the simplified Solar Form API.

```bash
# Simple mode (auto-optimized)
suntropy solarform simple \
  --region "Andalucia" --sub-region "Sevilla" \
  --consumption 5000 --pattern Domestic

# Full control
suntropy solarform calculate --data '{"center":{"lat":37.39,"lng":-5.99},...}'

# Get form configuration
suntropy solarform config
```

### `suntropy ppa` - PPA Analysis

Read PPA (Power Purchase Agreement) templates and run PPA simulations on a solar study.

```bash
# Read-only templates
suntropy ppa templates list --fields _id,name,mode,ppaPrice,useInSolarForm
suntropy ppa templates get <ppaTemplateId>

# Run a PPA simulation on a study (read-only, does not persist)
suntropy ppa calculate --study <studyId>                       # uses client useInSolarForm templates
suntropy ppa calculate --study <studyId> --template <ppaTemplateId>   # uses a single template
cat study.json | suntropy ppa calculate --data -               # full SolarStudy via stdin
suntropy ppa calculate --study <studyId> --raw --save-file ppa.json
```

The response is the study with `economicResults.ppaAnalysis` populated
(`simulationResults[].profitabilityResults` → `irr`, `paybackYears`). Heavy
PowerCurve objects are summarized unless `--raw` is passed.

### `suntropy projects` - Alexandria Projects

Alexandria projects group conversations under shared instructions (agent.md style)
and documents. A project is `private` (only its owner) or `client` (everyone in the
account). Another user's private project looks like it does not exist (404).

```bash
suntropy projects list
suntropy projects get <id>                          # instructions + files
suntropy projects create --name "Casa García" --instructions-file ./agent.md --visibility client
suntropy projects update <id> --instructions "Responde siempre con kWh"
suntropy projects delete <id>

# Documents (add takes a link already in the document store: https, *.enerlence.com)
suntropy projects files list <id>
suntropy projects files add <id> --name factura.pdf --url https://documents.enerlence.com/f/<token>/?dl=1
suntropy projects files remove <id> <fileId>

# Pull the files into a local folder (e.g. the sandbox) to read them
suntropy projects files download <id> --all --out ./project-files
suntropy projects files download <id> --file <fileId>
```

Only the owner or an account admin can change a project or its files. `download`
never overwrites: a name already in the folder gets ` (2)`, ` (3)`… and file names
are stripped of any path. Note that an API key acts as its own user (`api-key:<n>`),
so it sees the shared projects and the private ones created with that same key.

### `suntropy shareables` - Shareable Links

Create shareable links for studies (sharing service, exposed under `/templates`).
The backend fills `uid`, `url`, `clientUID` and `idShareable` from the token.

```bash
# Public shareable for a solar study
suntropy shareables create --element-id <studyId>

# With template, name and expiration
suntropy shareables create --element-id <studyId> \
  --template-id <templateId> --name "Estudio Juan" --expiration-date 2026-12-31

# Private (password) + send to recipients
suntropy shareables create --element-id <studyId> \
  --privacy PRIVATE --password secret --email-list "a@x.com;b@y.com"

# Extra link query params / extra DTO fields
suntropy shareables create --element-id <studyId> --link-params "utm_source=cli"
suntropy shareables create --element-id <studyId> --data '{"customLayout":true}'
```

`--element-type` (default `solarStudy`): `solarStudy | colectiveSolarStudy | veChargerStudy | heatpumpStudy | billing`.
`--shareable-type` (default `TEMPLATE`): `TEMPLATE | CONTRACT`. The response includes the public `url` and `uid`.

### `suntropy templates` - Document Templates

List the client document templates (budget/document templates from the sharing
service), proxied via solar under `GET /api/templates`. Returns only `_id` and
`templateName`.

```bash
# Solar study templates (default --type solarStudy)
suntropy templates list

# Other template types
suntropy templates list --type colectiveSolarStudy
suntropy templates list --type veChargerStudy

# Generic (untyped) templates
suntropy templates list --type generic

# Pick fields / change format
suntropy templates list --fields _id,templateName --format csv
```

`--type` (default `solarStudy`): `solarStudy | colectiveSolarStudy | veChargerStudy | generic`.
`generic` lists the untyped templates (sends no `templateIdentifier` filter).

### `suntropy satvolt` - Satvolt Campaigns

Lead-generation campaigns on the Satvolt public API. The route depends on the
credential:

- API v2 key (`sun_…`): `<gateway>/api/v2/leadgen/…` (see "Gateway origin");
- JWT: `<server>/satvolt/api/v1/…`, like any other service (prod
  `https://api.enerlence.com/satvolt`, `localhost:8099` locally).

Satvolt is no longer pinned to the dev cluster: it follows the profile server
like the rest of the CLI. `SUNTROPY_SATVOLT_URL` still overrides the JWT route,
for local development. Every pipeline action spends credits per lead: check
`estimatedCreditsPerLead` before starting.

Error codes reach the output in `code`, with what to do in `message`:
`INVALID_KEY` (revoked or expired key: `auth login --web` again),
`INSUFFICIENT_SCOPE`, `SATVOLT_NOT_ENABLED` (LeadGen not enabled for the
account), `ACCESS_CHECK_UNAVAILABLE`…

```bash
# Reference data
suntropy satvolt catalog actions           # credits, dependencies and config JSON Schema
suntropy satvolt catalog business-groups

# Campaigns
suntropy satvolt campaigns list --state completed
suntropy satvolt campaigns create --name "Cobo Calleja" --circle 40.2597,-3.7545 --radius 1500 \
  --max-leads 300 --steps '[{"action":"FIND_ROOFTOP"},{"action":"SOLAR_ANALYSIS"}]'
suntropy satvolt campaigns create --name "Test" --polygon @area.geojson --steps @steps.json
suntropy satvolt campaigns create --name "Sonda" --template "Industria" --circle 37.35,-6.27 --radius 5000 --max-leads 50
suntropy satvolt campaigns create --name "Copia" --from-campaign 62 --bounds 40.45,-3.70,40.44,-3.68
suntropy satvolt campaigns start <id>
suntropy satvolt campaigns logs <id> --follow --format human
suntropy satvolt campaigns funnel <id>
suntropy satvolt campaigns usage <id>
suntropy satvolt campaigns extend <id> --max-leads 500       # more leads without relaunching
suntropy satvolt campaigns extend <id> --no-limit
suntropy satvolt campaigns reset <id> --yes --start
suntropy satvolt campaigns resume <id> --action AI_AGENT --config @agent-step.json
suntropy satvolt campaigns delete <id> --yes

# Campaign templates (pipeline + groups + description + query + lead limit)
suntropy satvolt templates create --name "Industria" --from-campaign 62
suntropy satvolt templates create --name "Solo tejados" --steps '[{"action":"FIND_ROOFTOP"}]'
suntropy satvolt templates list
suntropy satvolt templates patch "Industria" --max-leads 300 --business-groups businesses
suntropy satvolt templates delete "Industria" --yes

# Pipeline configuration (JSON)
suntropy satvolt config get <id> --save pipeline.json
suntropy satvolt config update <id> --data @pipeline.json      # full replace
suntropy satvolt config patch <id> --data @patch.json          # merge by step uid
suntropy satvolt steps list <id>
suntropy satvolt steps add <id> --action QUALIFY --config '{"qualificationDefinition":"..."}'
suntropy satvolt steps set <id> <uid> --config '{"enableWebSearch":true}'
suntropy satvolt steps remove <id> <uid>
suntropy satvolt steps run <id> <uid>

# Leads
suntropy satvolt leads list <id> --name "logistica" --page 2
suntropy satvolt leads list <id> --step QUALIFY --step-status failure
suntropy satvolt leads get <id> <leadId> --full-data consumptionEstimate
suntropy satvolt leads full-data <id> <leadId> --path cif.response.extras.cnae
suntropy satvolt leads run-step <id> <leadId> ESTIMATE_CONSUMPTION   # only that step
suntropy satvolt leads run-step <id> <leadId> <uid> --continue       # and the rest of the pipeline
suntropy satvolt export-tables fields <id> --format human      # column paths, grouped by pipeline step

# Export tables
suntropy satvolt export-tables create <id> --name "CRM" \
  --columns "Empresa=lead.commercialName;Consumo=fullData.consumptionEstimate.annualKwh:number"
suntropy satvolt export-tables columns add <tableId> --label Teléfono --path lead.phone --after Empresa
suntropy satvolt export-tables columns set <tableId> Consumo --label "Consumo (kWh/año)"
suntropy satvolt export-tables columns move <tableId> Teléfono --position 0
suntropy satvolt export-tables data <tableId> --format csv
suntropy satvolt export-tables export <tableId> --file-format xlsx --out leads.xlsx

# Credits (the agent never pays: it gives the Checkout URL to the user)
suntropy satvolt credits balance                     # balance, held, available, monthly cap
suntropy satvolt credits packs --format human        # id, credits, bonus, price
suntropy satvolt credits checkout credits-10k        # {"url":"https://checkout.stripe.com/…"}
```

`credits checkout` only prints the Stripe Checkout URL; it charges nothing. The
user opens it and pays in Stripe, and then `credits balance` confirms the
credits arrived. Only an admin of the account can buy. With a JWT, `balance`
goes to Satvolt (`<server>/satvolt/api/v1/credits`) and `packs`/`checkout` to
payments (`<server>/payments/payments/satvolt/credit-packs…`).

JSON arguments (`--steps`, `--config`, `--data`, `--columns`, `--polygon`) accept
inline JSON, `@file.json` or `-` for stdin. Errors keep the API `code` and
validation `details` (step index, uid and field). `reset` and `delete` are in the
`delete` permission tier; `start`, `resume`, `run`, `run-step`, `extend`, `patch`
and `duplicate` are `write`. Skills: [`satvolt-cli`](skills/satvolt-cli.md)
(command reference), [`satvolt-api`](skills/satvolt-api.md) (HTTP API) and the
workflows [`satvolt-campaign`](skills/satvolt-campaign.md),
[`satvolt-probe-to-full-campaign`](skills/satvolt-probe-to-full-campaign.md) and
[`satvolt-lead-troubleshooting`](skills/satvolt-lead-troubleshooting.md).

### `suntropy config` - Configuration

```bash
suntropy config set server https://api.enerlence.com
suntropy config get server
suntropy config list
suntropy config create-profile staging
suntropy config use staging
```

## Configuration

Config stored in `~/.suntropy/config.json`. Supports multiple profiles for different environments.

```json
{
  "activeProfile": "default",
  "profiles": {
    "default": {
      "server": "https://api.enerlence.com",
      "token": "eyJ...",
      "authMethod": "api-key",
      "clientUID": "...",
      "userUID": "..."
    },
    "local": {
      "server": "http://localhost"
    }
  }
}
```

Local development uses port-based routing: solar=8086, security=8080, profiles=8085, periods=8084, templates=8090, satvolt=8099.

## Skills

Agent skills (prompt templates) are available in the [`suntropy-cli-skills`](https://github.com/enerlence/suntropy-cli-skills) repo. Install them in your `.claude/skills/` or `.agents/skills/` directory to give AI agents knowledge of the CLI workflows.

Available skills:
- **suntropy-cli** - Complete CLI reference
- **solar-study** - End-to-end solar study creation workflow
- **inventory-create** - Create inventory items (panels, inverters, batteries, etc.)
- **inventory-create-kit** - Create kits with components and custom assets
- **satvolt-cli** - `suntropy satvolt` command reference
- **satvolt-api** - Satvolt public HTTP API (`/satvolt/api/v1`)
- **satvolt-campaign** - Create, configure, follow and export Satvolt campaigns
- **satvolt-probe-to-full-campaign** - Probe campaign from a template, validate, fix and extend to the whole area
- **satvolt-lead-troubleshooting** - Diagnose failing steps and re-run them on leads
