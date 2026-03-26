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
# API key (preferred for agents)
suntropy auth set-key --key <jwt-api-key>

# Email/password login
suntropy auth login --email user@co.com --password pass

# Check status
suntropy auth status
```

## Global Options

| Option | Default | Description |
|--------|---------|-------------|
| `--format json\|human\|csv` | `json` | Output format |
| `--fields f1,f2,...` | all | Select specific fields |
| `--server <url>` | config | Override API server URL |
| `--token <jwt>` | config | Override auth token |
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

**Kit assembly:**

```bash
suntropy inventory kits panels create --data '{"name":"Panel Kit","peakPower":450}'
suntropy inventory kits inverters create --data '{"name":"Inversor Kit","nominalPower":5000}'
suntropy inventory kits assemble \
  --name "Kit Solar 5kW" \
  --panel <panelId> --inverter <inverterId> \
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

Local development uses port-based routing: solar=8086, security=8080, profiles=8085, periods=8084, templates=8090.

## Skills

Agent skills (prompt templates) are available in the [`suntropy-cli-skills`](https://github.com/enerlence/suntropy-cli-skills) repo. Install them in your `.claude/skills/` or `.agents/skills/` directory to give AI agents knowledge of the CLI workflows.

Available skills:
- **suntropy-cli** - Complete CLI reference
- **solar-study** - End-to-end solar study creation workflow
- **inventory-create** - Create inventory items (panels, inverters, batteries, etc.)
- **inventory-create-kit** - Create kits with components and custom assets
