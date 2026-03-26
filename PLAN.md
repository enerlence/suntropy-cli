# Plan: Suntropy CLI - Agent-First Command Line Interface

## Context

Suntropy necesita una CLI optimizada para agentes de programacion (agent-first) que permita interactuar con los principales endpoints de la API. Los agentes necesitan manipular inventario, explorar estudios solares complejos y gestionar plantillas de manera eficiente en tokens. Actualmente toda interaccion es via el frontend web, lo que impide la automatizacion programatica.

## Decisiones de Arquitectura

### Stack Tecnologico
- **TypeScript + Node.js** - Consistente con todo el ecosistema Suntropy
- **Commander.js** - Framework CLI ligero y bien documentado
- **axios** - HTTP client (mismo que usa el frontend)
- **tsup** - Bundling para distribucion
- **chalk + cli-table3** - Solo para modo `--human`

### Principios Agent-First
1. **JSON por defecto** - Todo output es JSON parseable, `--human` para legibilidad
2. **Exploracion progresiva** - `list` muestra metadatos minimos, `get` muestra resumen, `--expand` para profundizar
3. **Eficiencia en tokens** - `--fields` para seleccionar solo propiedades necesarias
4. **Self-documenting** - `--help` exhaustivo con nombres de campos y ejemplos
5. **Piping** - stdin/stdout friendly para encadenar operaciones

### Configuracion
- Config persistente en `~/.suntropy/config.json`
- Soporta multiples perfiles/servidores

### URLs de los servicios
Base URL produccion: `https://api.enerlence.com`

| Servicio | Path produccion | Puerto local |
|----------|----------------|--------------|
| Security | `/security` | 8080 |
| Solar | `/solar` | 8086 |
| Templates | `/templates` | 8090 |
| Profiles | `/profiles` | 8085 |
| Periods | `/periods` | 8084 |

Config default apuntara a produccion. `--server` override o `suntropy config set server http://localhost` para local.

### Ubicacion del proyecto
`/Users/pablo.sanchez/code/Suntropy-Agents-Workspace/suntropy-cli/` - En la raiz del workspace, como proyecto independiente (no submodule).

---

## Estructura del Proyecto

```
suntropy-cli/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── bin/
│   └── suntropy.ts              # Entry point con shebang
├── src/
│   ├── index.ts                  # Main CLI setup con Commander
│   ├── config.ts                 # Config management (~/.suntropy/)
│   ├── client.ts                 # HTTP client con JWT auth
│   ├── output.ts                 # Output formatting (JSON/human/csv)
│   ├── commands/
│   │   ├── auth.ts               # login, status, refresh
│   │   ├── config.ts             # get, set, list
│   │   ├── inventory/
│   │   │   ├── index.ts          # Grupo inventory
│   │   │   ├── panels.ts         # CRUD paneles
│   │   │   ├── inverters.ts      # CRUD inversores
│   │   │   ├── batteries.ts      # CRUD baterias
│   │   │   ├── chargers.ts       # CRUD cargadores VE
│   │   │   ├── heatpumps.ts      # CRUD aerotermias
│   │   │   ├── custom-assets.ts  # CRUD equipos personalizados
│   │   │   └── kits.ts           # CRUD kits + componentes
│   │   ├── studies/
│   │   │   ├── index.ts          # Grupo studies
│   │   │   ├── list.ts           # Listado con filtros
│   │   │   ├── get.ts            # Get progresivo con --expand
│   │   │   ├── curves.ts         # Curvas horarias con stats
│   │   │   └── calculate.ts      # Calculo produccion
│   │   ├── curves/
│   │   │   └── index.ts          # Operaciones PowerCurve standalone
│   │   └── templates/
│   │       ├── index.ts          # Grupo templates
│   │       ├── crud.ts           # CRUD plantillas
│   │       ├── pages.ts          # Manipulacion de paginas (add/remove/move/copy)
│   │       ├── components.ts     # Manipulacion de componentes (add/move/remove/update)
│   │       └── defaults.ts       # Plantillas por defecto y condicionales
│   └── utils/
│       ├── power-curve.ts        # Helpers sobre PowerCurve (usa energy-types como dep)
│       ├── fields.ts             # Seleccion/proyeccion de campos
│       └── pagination.ts         # Helpers paginacion
```

## Opciones Globales

| Opcion | Default | Descripcion |
|--------|---------|-------------|
| `--format json\|human\|csv` | `json` | Formato de salida |
| `--fields f1,f2,...` | (todos) | Seleccionar campos especificos |
| `--server <url>` | config | URL del servidor API |
| `--token <jwt>` | config | Override token autenticacion |
| `--quiet` | false | Solo datos, sin decoracion |
| `--verbose` | false | Muestra request/response HTTP |
| `--profile <name>` | default | Perfil de configuracion |

---

## Fases de Implementacion

### FASE 0: Fundacion (Infraestructura compartida)

**Archivos a crear:**
- `package.json`, `tsconfig.json`, `tsup.config.ts`
- `bin/suntropy.ts` - Entry point
- `src/index.ts` - Setup Commander con opciones globales
- `src/config.ts` - CRUD de config en `~/.suntropy/config.json`
- `src/client.ts` - Wrapper axios con interceptors JWT, base URL, error handling
- `src/output.ts` - Formatter JSON/human/csv con soporte `--fields`
- `src/commands/auth.ts` - `login`, `status`, `refresh`
- `src/commands/config.ts` - `get`, `set`, `list`

**Endpoints consumidos:**
- `POST /auth/login` (security) - Login email/password
- `GET /auth/jwt/refreshToken` (security) - Refresh token
- `GET /auth/jwt/verifyToken` (security) - Verificar token

**Comportamiento auth:**
```bash
# Metodo 1: API Key (PREFERIDO para agentes)
# Los API keys son JWTs con la misma estructura que el token de login
suntropy auth set-key --key <jwt-api-key> [--server https://api.enerlence.com]
# Output: { "success": true, "method": "api-key", "clientUID": "..." }

# Metodo 2: Login interactivo (para humanos)
suntropy auth login --email user@co.com --password pass [--server https://api.enerlence.com]
# Output: { "success": true, "method": "login", "user": { "email": "...", "clientUID": "..." } }

suntropy auth status
# Output: { "authenticated": true, "method": "api-key"|"login", "clientUID": "...", "expiresAt": "..." }
```

---

### FASE 1: Inventario

**Patron comun para todos los recursos** (DRY - factory de comandos):

```bash
# Listar con paginacion y filtros
suntropy inventory panels list [--limit 20] [--offset 0] [--active-only] [--fields name,wattage,manufacturer]

# Obtener por ID
suntropy inventory panels get <id> [--fields name,wattage,efficiency]

# Crear desde JSON (stdin o argumento)
suntropy inventory panels create --data '{"name":"Panel 400W","wattage":400,...}'
echo '{"name":"Panel 400W"}' | suntropy inventory panels create --data -

# Actualizar
suntropy inventory panels update <id> --data '{"wattage":410}'

# Eliminar (individual y batch)
suntropy inventory panels delete <id>
suntropy inventory panels delete-batch --ids id1,id2,id3

# Filtrado avanzado (POST /filter)
suntropy inventory panels filter --query '{"manufacturer":"JA Solar","wattage":{"$gte":400}}'
```

**Manufacturers (entidad transversal a todo el inventario):**

La entidad Manufacturer es referenciada via ManyToOne por: SolarPanel, SolarInverter, Battery, Charger, Heatpump, KitSolarPanel, KitInverter, KitBattery. Al crear/actualizar cualquier dispositivo, se referencia su manufacturer por ID.

```bash
suntropy inventory manufacturers list
suntropy inventory manufacturers get <id>
suntropy inventory manufacturers create --data '{"name":"JA Solar"}'
# No hay PUT ni DELETE en el controller actual (solo GET y POST)
```

**Manufacturer entity** — `/manufacturers`
Campos: idManufacturer, name, imageUrl, clientUID + audit fields
Relaciones: solarPanels[], solarInverter[], batteries[], charger[], heatPump[], kitSolarPanels[], kitInverters[], kitBatteries[]

---

**Recursos de inventario, endpoints y campos (de entidades TypeORM):**

**panels** — `/solar-panels`
Campos: solarPanelId, name, manufacturer(rel), efficiency, peakPower, panelDegradation, width, heigth, depth, active, imageUrl, referenceId, manufacturingWarranty, materialsWarranty, costPerUnit, description, technicalSheetDocumentURL, clientUID + audit fields

**inverters** — `/solar-inverter`
Campos: idInverter, name, manufacturer(rel), efficiency, nominalPower, phaseNumber(single_phase|three_phase), isMicroinverter, isHybrid, maxCapacityOfBattery, active, imageUrl, referenceId, manufacturingWarranty, materialsWarranty, costPerUnit, description, technicalSheetDocumentURL, clientUID + audit fields

**batteries** — `/solar-battery`
Campos: batteryId, name, manufacturer(rel), capacity, price, isModular, maxNumberOfModules, availableCapacities, active, imageUrl, referenceId, manufacturingWarranty, materialsWarranty, costPerUnit, description, technicalSheetDocumentURL, clientUID + audit fields

**chargers** — `/charger`
Campos: idCharger, name, manufacturer(rel), maxPower, connectorType(TYPE_1|TYPE_2|CCS1|CCS2|GBT|CHAdeMO), includedPlug, protectionType, phaseNumber, width, height, depth, price, active, imageUrl, referenceId, manufacturingWarranty, materialsWarranty, costPerUnit, description, technicalSheetDocumentURL, clientUID + audit fields

**heatpumps** — `/heat-pump`
Campos: idHeatpump, identifier, manufacturer(rel), lowerPower, upperPower, scop, phases_number, width, height, depth, price, active, imageUrl, referenceId, manufacturingWarranty, materialsWarranty, costPerUnit, description, technicalSheetDocumentURL, clientUID + audit fields

**custom-assets** — `/custom-asset`
Campos: idCustomAsset, label, customAssetType(rel), customAssetCustomField(rel[]), identifier, isMaterial, costPerUnit, hideOnBudget, active, imageUrl, referenceUrl, referenceId, description, technicalSheetDocumentURL, clientUID + audit fields
Sub-recursos: custom-asset-types (label, image, panelsQuantity, isMaterialConcept, uniqueCustomAssetSelection), custom-fields (label, type, options)

**kits** — `/solar-kits`
Campos: idSolarKit, identifier, kitSolarPanel(rel), kitInverter(rel), battery(rel), batteriesNumber, panelNumber, inverterNumber, peakPower, price, totalPrice, useTotalKitCostAsPrice, defaultTaxesPercentage, phaseNumber, coplanar, isBasicSolarKit, buyUrl, active, imageUrl, referenceId, manufacturingWarranty, materialsWarranty, solarKitCustomAssets(rel[]), kitCategories(rel[]), clientUID + audit fields

Sub-entidades de kit:
- **KitSolarPanel**: idKitSolarPanel, name, manufacturer(rel), peakPower, efficiency, panelDegradation, width, heigth, depth, technology, costPerUnit, referenceId, imageUrl, warranties, description
- **KitInverter**: idKitInverter, name, manufacturer(rel), nominalPower, efficiency, isMicroinverter, costPerUnit, referenceId, imageUrl, warranties, description
- **KitBattery**: idKitBattery, name, manufacturer(rel), capacity, costPerUnit, referenceId

Kits adicionales:
- **VEChargerKit** (`/charger/ve-charger-kits`): idVEChargerKit, charger(rel), identifier, price, phaseNumber, defaultTaxesPercentage, useTotalKitCostAsPrice, veChargerKitCustomAssets(rel[]), active, warranties, referenceId
- **HeatpumpKit** (`/heat-pump/heatpump-kits`): idHeatpumpKit, heatpump(rel), identifier, price, phaseNumber, defaultTaxesPercentage, useTotalKitCostAsPrice, heatpumpKitCustomAssets(rel[]), active, warranties, referenceId

```bash
suntropy inventory kits list [--limit] [--active-only]
suntropy inventory kits get <kitId>
suntropy inventory kits create --data '{...}'
suntropy inventory kits update <kitId> --data '{...}'
suntropy inventory kits delete <kitId>
suntropy inventory kits archive <kitId>

# Sub-recursos de un kit solar
suntropy inventory kits panels <kitId>
suntropy inventory kits panels add <kitId> --panel-id <id> --quantity 10
suntropy inventory kits panels remove <kitId> <kitPanelId>
suntropy inventory kits inverters <kitId>
suntropy inventory kits inverters add <kitId> --inverter-id <id> --quantity 2
suntropy inventory kits inverters remove <kitId> <kitInverterId>
suntropy inventory kits batteries <kitId>
suntropy inventory kits batteries add <kitId> --battery-id <id> --quantity 1
suntropy inventory kits batteries remove <kitId> <kitBatteryId>

# Kits de VE charger y heatpump
suntropy inventory charger-kits list/get/create/update/delete
suntropy inventory heatpump-kits list/get/create/update/delete
```

**Endpoints kits:**
- Base: `/solar-kits`
- Paneles kit: `/solar-kits/solar-panels`
- Inversores kit: `/solar-kits/inverters`
- Baterias kit: `/solar-kits/batteries`

**Implementacion DRY:** Crear una factory `createResourceCommands(name, basePath, fields)` que genere automaticamente los 5 comandos CRUD para cada recurso, evitando duplicacion.

---

### FASE 2: Estudios Solares

**Exploracion progresiva (clave para eficiencia en tokens):**

```bash
# Nivel 1: Lista de metadata (minimo - solo IDs y campos clave)
suntropy studies list [--limit 20] [--offset 0] [--state "En curso"]
# Output: array de { id, solarStudyId, name, clientName, peakPower, state, createdAt }

# Nivel 2: Metadata completa de un estudio
suntropy studies metadata <metadataId>
# Output: todos los campos de SolarStudyMetadata (MySQL)

# Nivel 3: Estudio resumido (sin curvas horarias)
suntropy studies get <studyId>
# Output: campos principales sin PowerCurve objects
# Reemplaza PowerCurves con { _type: "PowerCurve", days: <count>, identifier: "..." }

# Nivel 4: Expandir secciones especificas
suntropy studies get <studyId> --expand surfaces
suntropy studies get <studyId> --expand results
suntropy studies get <studyId> --expand economics
suntropy studies get <studyId> --expand batteries
suntropy studies get <studyId> --expand surfaces,results,economics
suntropy studies get <studyId> --expand all    # Todo el objeto

# Nivel 5: Curvas horarias (datos pesados)
suntropy studies curves <studyId> consumption [--stats] [--monthly] [--daily] [--period] [--raw]
suntropy studies curves <studyId> production [--surface-index 0] [--stats]
suntropy studies curves <studyId> net-consumption [--stats]
suntropy studies curves <studyId> excesses [--stats]
```

**Detalle de `--stats` vs `--raw`:**
- `--stats` → Ejecuta `calculateStatistics()` de PowerCurve: promedios mensuales, maximos, minimos, por periodo
- `--monthly` → Acumulados mensuales
- `--daily` → Promedios diarios
- `--period` → Agregado por periodo tarifario (requiere distribucion de periodos)
- `--raw` → Array completo de DayCurve[] (8760 valores horarios)

**Endpoints estudios:**
- `POST /solar-study/findWithPaginationAndFilters` - Listar con filtros
- `GET /solar-study/findById/:_id` - Obtener estudio completo (MongoDB)
- `GET /solar-study/metadata/solar-study-id/:studyId` - Metadata
- `GET /solar-study/findSolarStudyMetadataById/:id` - Metadata por ID relacional
- `POST /solar-study/calculateProduction` - Calcular produccion
- `GET /solar-study/optimizeSurfaces` - Optimizar angulos

**Comandos de calculo:**

```bash
# Calcular produccion para unas coordenadas y configuracion
suntropy studies calculate-production \
  --lat 37.39 --lon -5.99 \
  --power 5000 --angle 30 --azimuth 180 \
  --losses 14 [--year 2024]
# Output: PowerCurve con produccion horaria estimada

# Optimizar angulo e inclinacion
suntropy studies optimize-surfaces --lat 37.39 --lon -5.99
# Output: { optimalAngle, optimalAzimuth, maxProduction }
```

**Operaciones PowerCurve standalone (pipe-friendly):**

Todas las operaciones de curvas aceptan input via `--input <file>` o stdin (pipe). Las que devuelven curvas son encadenables. Flag global `--save <file>` para persistir resultado a disco y reutilizar despues.

```bash
# Operaciones disponibles (usa energy-types PowerCurve directamente)
suntropy curves stats [--input <file|->]           # calculateStatistics()
suntropy curves multiply <factor> [--input <->]    # applyMultiplier()
suntropy curves aggregate --a <file> --b <file>    # aggregatePowerCurve() (suma)
suntropy curves subtract --a <file> --b <file>     # a - b (multiply b por -1 + aggregate)
suntropy curves filter-positive [--input <->]      # filterPositiveValues()
suntropy curves filter-negative [--input <->]      # filterNegativeValues()
suntropy curves total [--input <->]                # getTotalAcumulate()
suntropy curves to-serie [--input <->]             # convertoToSerie()
suntropy curves sort [--input <->]                 # sortByDate()
suntropy curves filter-dates --start X --end Y     # filterByDates()
```

**Ejemplo: calcular excedentes como un agente de programacion:**
```bash
# 1. Obtener curvas del estudio y guardar a disco
suntropy studies curves abc123 production --raw --save /tmp/prod.json
suntropy studies curves abc123 consumption --raw --save /tmp/cons.json

# 2. Restar consumo de produccion y filtrar positivos = excedentes
suntropy curves subtract --a /tmp/prod.json --b /tmp/cons.json | suntropy curves filter-positive --save /tmp/excesses.json

# 3. Reutilizar la curva de excedentes
suntropy curves total --input /tmp/excesses.json
# Output: { "total": 4523.7 }

suntropy curves stats --input /tmp/excesses.json
# Output: { "dailyAccumulate": {...}, "anualMonthAccumulate": {...}, "max": {...}, "min": {...} }

# 4. Agregar excedentes con otra curva
suntropy curves aggregate --a /tmp/excesses.json --b /tmp/other_curve.json
```

**Patron para agentes:** `--save <file>` escribe el resultado a disco Y lo emite a stdout simultaneamente (como `tee`), permitiendo encadenar pipes y guardar intermedios al mismo tiempo.

**PowerCurve - Reutilizacion de energy-types:**
- Se instala `energy-types` como dependencia npm directa
- `src/utils/power-curve.ts` solo contiene helpers de entrada/salida (parseo stdin, formateo output)
- Estructura DayCurve: `{ date: "YYYY-MM-DD", valuesList: { "1": n, "2": n, ..., "24": n } }`
- Los comandos `curves` instancian PowerCurve directamente y llaman sus metodos nativos

---

### FASE 2b: Consumo y SolarForm

**Generacion de curvas de consumo (servicio profiles - puerto 8085):**

El servicio de profiles genera curvas de consumo (PowerCurve) a partir de diferentes inputs:
- Patrones predefinidos: Balance, Nightly, Morning, Afternoon, Domestic, Commercial
- Perfiles REE (Red Electrica) como base horaria
- Consumo mensual personalizado
- Perfiles de consumo custom (patron mensual + semanal + horario)
- Archivos (EREDES ZIP para Portugal)

```bash
# Estimar consumo con patron predefinido
suntropy consumption estimate --annual 5000 --pattern Balance
suntropy consumption estimate --annual 8000 --pattern Domestic --tariff 3.0TD --market es

# Estimar con datos mensuales
suntropy consumption estimate --annual 5000 --monthly-data '{"1":500,"2":450,...,"12":400}'

# Estimar con perfil custom
suntropy consumption estimate --annual 6000 --custom-profile-id abc123

# Obtener perfiles REE base
suntropy consumption ree-profiles --start 2025-01-01 --end 2025-12-31 --tariff 3.0TD

# Tags de perfiles custom del cliente
suntropy consumption custom-tags
suntropy consumption custom-profile-info --id <profileId>

# Desde archivo (EREDES ZIP)
suntropy consumption from-file --eredes-zip /path/to/file.zip
```

**Endpoints profiles:**
- `POST /consumption-estimation` - Generar PowerCurve (query: startDate, endDate, tariff, type, anualConsumption, consumptionType, customProfileId, market; body: dailyCurve, consumptionByMonth, customProfile)
- `GET /ree-profiles` - Obtener perfiles REE (query: startDate, endDate, tariff, type, market)
- `GET /custom-profiles/getTags` - Tags de perfiles custom
- `GET /custom-profiles/getInfo` - Detalle de perfil custom
- `POST /consumption-files-processor/portugal/eredes-zip` - Procesar ZIP EREDES

**Creacion de estudios via SolarForm:**

Dos modos para crear estudios solares:
- **simple**: Parametros minimos (region, consumo, patron) → el backend optimiza kit, resuelve coordenadas, calcula todo
- **calculate**: Control completo con body JSON (coordenadas, superficies, consumo, cliente, tarifa)

```bash
# Modo simple (minimo input, maximo autocompletado)
suntropy solarform simple --region "Andalucía" --sub-region "Sevilla" --consumption 5000
suntropy solarform simple --region "Madrid" --sub-region "Madrid" --consumption 8000 --pattern Domestic --save
suntropy solarform simple --region "Cataluña" --sub-region "Barcelona" --consumption 300 --consumption-mode monthlySpending --kit-id abc123

# Modo calculate (control total)
suntropy solarform calculate --data '{"center":{"lat":37.39,"lng":-5.99},"consumptionMode":"consumptionPatterns",...}' --save
cat study-input.json | suntropy solarform calculate --data - --save --email client@co.com

# Config del formulario solar
suntropy solarform config

# Estadisticas de formularios
suntropy solarform statistics --create --data '{"email":"test@co.com"}'
suntropy solarform statistics --update --data '{"idSolarFormStatistics":"abc","completed":true}'
```

**Endpoints solarform:**
- `POST /api/solar-form` - Calculo completo (auth, query: save, email; body: SimplifiedSolarStudyClass)
- `POST /api/solar-form/simple` - Calculo simplificado (auth, query: save, email, solarKitId, excessesCompensationMode; body: region, subRegion, selectedConsumptionPattern, consumptionQuantity, consumptionQuantityIntroductionMode)
- `GET /solar-form/solar-form-config` - Configuracion del formulario
- `POST /solar-form/solar-form-statistics` - Crear estadistica
- `PUT /solar-form/solar-form-statistics` - Actualizar estadistica

**Ejemplo flujo agente: generar consumo y crear estudio:**
```bash
# 1. Generar curva de consumo domestico
suntropy consumption estimate --annual 5000 --pattern Domestic --save /tmp/cons.json

# 2. Verificar total
suntropy curves total --input /tmp/cons.json

# 3. Crear estudio con solarform simple
suntropy solarform simple --region "Andalucía" --sub-region "Sevilla" --consumption 5000 --pattern Domestic --save

# 4. O usar el flujo completo con calculate
suntropy solarform calculate --data '{"center":{"lat":37.39,"lng":-5.99},...}' --save
```

---

### FASE 3: Plantillas

**NOTA: El endpoint renderTemplate (PDF) no funciona actualmente. No se implementa.**

```bash
# --- CRUD de plantillas ---
suntropy templates list [--identifier solarStudy|colectiveSolarStudy|veChargerStudy|...] [--limit] [--offset]
suntropy templates get <id> [--fields] [--include-pages]
suntropy templates create --data '{...}'
suntropy templates update <id> --data '{...}'
suntropy templates delete <id>

# --- Manipulacion de paginas ---
# Listar paginas de una plantilla (resumen: uuid, indice, numero de componentes, grid config)
suntropy templates pages <templateId>

# Obtener detalle de una pagina (layout completo con componentes)
suntropy templates pages get <templateId> --page <uuid|index>

# Anadir pagina (al final o en posicion especifica)
suntropy templates pages add <templateId> [--at-index N] [--copy-from <uuid>]

# Eliminar pagina
suntropy templates pages remove <templateId> --page <uuid|index>

# Reordenar paginas
suntropy templates pages move <templateId> --page <uuid|index> --to-index N

# Duplicar pagina (nuevos UUIDs para componentes)
suntropy templates pages copy <templateId> --page <uuid|index>

# --- Manipulacion de componentes en una pagina ---
# Listar componentes de una pagina
suntropy templates components <templateId> --page <uuid|index>

# Anadir componente al layout
suntropy templates components add <templateId> --page <uuid|index> \
  --type editableText|image|divider|blankSpace|logo|groupComponent|... \
  --x 0 --y 0 --w 4 --h 2 [--content '{...}'] [--config '{...}']

# Mover/redimensionar componente
suntropy templates components move <templateId> --page <uuid|index> \
  --component <componentUuid> --x N --y N [--w N] [--h N]

# Eliminar componente
suntropy templates components remove <templateId> --page <uuid|index> \
  --component <componentUuid>

# Duplicar componente
suntropy templates components copy <templateId> --page <uuid|index> \
  --component <componentUuid>

# Actualizar contenido/config de componente
suntropy templates components update <templateId> --page <uuid|index> \
  --component <componentUuid> --data '{...}'

# --- Guardar cambios de paginas ---
# Tras manipular paginas/componentes localmente, guardar al backend
suntropy templates pages save <templateId>
# PUT /templates/content/:_id

# --- Plantillas por defecto ---
suntropy templates defaults list
suntropy templates defaults set <templateIdentifier> <templateId>
suntropy templates defaults user-list --user-uid <uid>
suntropy templates defaults user-set <templateIdentifier> <templateId> --user-uid <uid>

# --- Plantillas condicionales ---
suntropy templates conditionals list <templateIdentifier>
suntropy templates conditionals set <templateIdentifier> --conditions '[...]'
suntropy templates conditionals delete <configId>
```

**Grid system (react-grid-layout):**
- Portrait: 950px, 8 columnas, rowHeight 50px (~22 filas)
- Landscape: 1370px, 22 columnas (~16 filas)
- Cada componente tiene: x, y (posicion), w, h (dimensiones en celdas)
- Opciones de pagina: compactType (vertical|horizontal), preventCollision, allowOverlap

**Tipos de componentes (componentIdentifier):**
editableText, divider, dividerV, blankSpace, logo, image, imageV2, imageV3, video, groupComponent, note, y componentes especializados (ParametricString, DigitalSign, etc.)

**PageContentLayoutElement:**
uuid, x, y, w, h, componentIdentifier, isEditable, content(EditorState), componentConfiguration, componentLayout(estilos: background, margins, border, opacity), styles

**Endpoints plantillas (sharing service):**
- `GET /templates` - Listar con paginacion
- `POST /templates/filters` - Listar con filtros
- `GET /templates/findTemplate/:_id` - Obtener por ID
- `POST /templates/saveTemplate` - Crear
- `PUT /templates/updateTemplate/:_id` - Actualizar metadata
- `PUT /templates/content/:_id` - Actualizar paginas/layout
- `DELETE /templates/:_id` - Eliminar
- `GET /templates/defaultTemplates` - Defaults cliente
- `POST /templates/defaultTemplates` - Set default
- Condicionales: GET/POST/PUT/DELETE `/templates/conditionalTemplatesConfiguration`

---

## Output Examples

### JSON (default - agent-first)
```json
{
  "data": [
    { "id": 1, "name": "JA Solar 400W", "wattage": 400, "manufacturer": "JA Solar" },
    { "id": 2, "name": "Longi 410W", "wattage": 410, "manufacturer": "Longi" }
  ],
  "total": 45,
  "limit": 20,
  "offset": 0,
  "hasMore": true
}
```

### Human (--human)
```
Solar Panels (showing 1-20 of 45)
 ID  Name            Wattage  Manufacturer
  1  JA Solar 400W   400W     JA Solar
  2  Longi 410W      410W     Longi
...
```

### Fields (--fields name,wattage)
```json
[
  { "name": "JA Solar 400W", "wattage": 400 },
  { "name": "Longi 410W", "wattage": 410 }
]
```

---

## Verificacion

1. **Build**: `npm run build` compila sin errores
2. **Auth**: `suntropy auth login` obtiene y persiste token
3. **Inventory**: CRUD completo contra backend solar local/staging
4. **Studies**: Exploracion progresiva de un estudio existente
5. **Curves**: Operaciones PowerCurve con pipe entre comandos
6. **Templates**: Listar y obtener plantillas del servicio sharing

---

## Estado de implementacion

1. **Fase 0** - Foundation - COMPLETADA (2026-03-25)
   - Config profiles, HTTP client, output formatter (JSON/human/csv), auth (set-key, login, status, refresh), config CRUD
   - Nota: API devuelve tuplas `[items[], total, ...]` - detectado y manejado en factory

2. **Fase 1** - Inventory - COMPLETADA (2026-03-25, actualizada 2026-03-26)
   - Factory CRUD generica (list, get, create, update, delete, delete-batch, filter)
   - Factory soporta: `getPath` (rutas custom), `getViaFilter` (cuando no hay GET :id), `putBodyOnly`
   - 9 recursos: panels, inverters, batteries, chargers, heatpumps, custom-assets, custom-asset-types, charger-kits, heatpump-kits
   - Manufacturers (list, create)
   - Kits con sub-recursos (panels, inverters, batteries) + archive + **assemble** (ensamblaje por flags)
   - Custom fields: CRUD completo (`/custom-asset/custom-field`)
   - Custom assets: flujo completo Tipo→Campos→Asset probado (create con campos inline y opciones)
   - Kits assemble con `--custom-asset <id>:<units>` repetible
   - Fix: custom-assets/types usan `/custom-asset/id/:id` y `/custom-asset/type/id/:id`
   - Fix: kits GET usa getViaFilter (no hay GET /:id en el controller)
   - Testeado contra API produccion: CRUD completo + kit con custom assets asociados

3. **Fase 2** - Studies + Curves - COMPLETADA (2026-03-25, actualizada 2026-03-26)
   - Studies: list (con filtros), metadata, get (exploracion progresiva con --expand), curves (stats/monthly/daily/total/raw)
   - calculate-production, optimize-surfaces
   - PowerCurve standalone: stats, total, multiply, aggregate, subtract, filter-positive, filter-negative, sort, filter-dates, to-serie, **by-period**
   - `by-period`: usa `PowerCurve.aggregateByPeriod(periodDistribution)` para agregar kWh por periodo tarifario P1-P6
   - Piping via stdin y --input verificado. --save funciona como tee
   - energy-types importado como dependencia directa (PowerCurve.calculateStatistics() devuelve {identifier, statistics})

4. **Fase 2b** - Consumption + SolarForm - COMPLETADA (2026-03-25, actualizada 2026-03-26)
   - Consumption: estimate (patrones REE + datos mensuales + custom profiles), ree-profiles, custom-tags, custom-profile-info, from-file (EREDES ZIP), **periods**
   - `periods`: obtiene distribucion horaria de periodos (P1-P6) del servicio periods (GET /periodos, puerto 8084)
   - SolarForm: simple (region/subregion + consumo → estudio optimizado), calculate (full body JSON con locationMode), config, statistics
   - Output compactado: PowerCurves reemplazadas con `{_type, days, identifier}` en resultados de solarform
   - Fix: unwrap PublicApiResponse `{code, data, error}` — prioriza data sobre error cuando ambos presentes
   - Fix: calculate con body incompleto muestra error descriptivo sugiriendo usar simple
   - Pipe compatible: consumo estimado → curves stats/total/by-period
   - Servicio profiles (puerto 8085) y periods (puerto 8084) integrados en client.ts
   - Flujo completo validado: precios por periodo → consumo → produccion → excedentes → ahorro → ROI

5. **Skills** - `skills/` directory (2026-03-26)
   - `solar-study.md`: estudio solar completo paso a paso (consumo → produccion → curvas → ahorro por periodo → ROI)
   - `inventory-create.md`: guia de creacion de cualquier elemento de inventario, con wikilink a kit
   - `inventory-create-kit.md`: guia detallada de ensamblaje de kits con componentes y custom assets

6. **Fase 3** - Templates - PENDIENTE
   - CRUD plantillas, manipulacion de paginas y componentes, defaults, condicionales
