# CLI → API v2: inventario de llamadas y huecos (brief de la fase 2)

## Propósito

Hoy la CLI (`@enerlence/suntropy-cli`) llama a las rutas **internas** de cada microservicio con un JWT de usuario o una API key antigua. Los clientes se construyen con `createServiceClient(service, opts)` (`src/client.ts`). La URL base es `<server>/<service>` (`security`, `solar`, `templates`, `profiles`, `periods`, `notifications`). En local (`localhost` o `host:puerto`) se sustituye por un puerto por servicio (`LOCAL_PORTS` en `src/config.ts`).

En esta PR sólo funcionan con una clave v2 (`sun_…`):

- `satvolt *`: `/api/v2/leadgen/<ruta>` → Satvolt `/api/v1/<ruta>`, más `GET /api/v2/leadgen/credit-packs` y `POST /api/v2/leadgen/credit-packs/:packId/checkout` → payments.
- `auth status`: `GET /api/v2/me`.

El resto de comandos rechaza una clave `sun_` con un mensaje claro. Este documento recoge **todas** las llamadas HTTP que hace la CLI fuera de `src/commands/satvolt/` y `src/commands/auth.ts`. Para cada una indica si existe un equivalente en el catálogo v2 (`suntropy-api-gateway/src/routes.js`).

Diferencias de contrato que afectan a cualquier migración:

- **Envoltorio**: la v2 responde `{ data, pagination?, warning?, requestId }`. Los errores llegan como `{ error: { code, message }, requestId }`.
- **Paginación**: los listados nativos usan **`limit` (1–100, 25 por defecto) / `offset`**. Devuelven `pagination: { limit, offset, total, hasMore, nextOffset }`. Sólo `/management/requests` usa cursor. La CLI hoy espera la tupla `[items[], total]`, `{ data, total }` o un array (`factory.ts`, `studies list`). Hay que adaptar el parser y `outputPaginated`.
- **Nombres de recurso distintos**: `solar-panels` → `panels`, `solar-inverter` → `inverters`, `heat-pump` → `heat-pumps`, `solar-kits/solar-panels` → `kit-panels`, etc. Los campos de los recursos nativos también pueden cambiar.
- **Escrituras distintas**: la v2 usa `PATCH /:id` parcial en lugar de `PUT` (ni por id ni con el id en el body), y `DELETE` responde 204.
- **Salida JSON**: la salida `--format json` que consumen Alexandria y las skills cambiaría de forma. Hay que decidir si la CLI desenvuelve `data` y normaliza los campos, o si se versiona la salida y se actualizan las skills.

Leyenda de la columna «Equivalente v2»:

- **Sí**: ruta v2 equivalente con el mismo contrato de fondo; la v2 llama al mismo endpoint de Solar.
- **Parcial**: hay una ruta v2, pero el contrato cambia (recurso nativo con otra forma o paginación, otros parámetros o body, un upsert en vez de un update, otro controlador).
- **No**: no hay ruta v2.

## Resumen por grupo de comandos

Rutas distintas que usa cada grupo. Algunas se repiten entre grupos (p. ej. `studies set kit` usa `GET /solar-kits` de inventario); el total global las cuenta una sola vez.

| Grupo | Servicios | Rutas | Sí | Parcial | No |
|---|---|---:|---:|---:|---:|
| `studies` (incl. builder: `set`, `save`, `pull`, `calculate`, …) | solar, profiles, periods | 17 | 0 | 8 | 9 |
| `ppa` | solar | 4 | 0 | 1 | 3 |
| `inventory` (9 recursos de factory + manufacturers + custom-fields + kits) | solar | 89 | 0 | 45 | 44 |
| `templates` | solar | 1 | 1 | 0 | 0 |
| `geocode` | solar | 2 | 2 | 0 | 0 |
| `shareables` | templates | 1 | 0 | 1 | 0 |
| `projects` | solar | 7 | 0 | 0 | 7 |
| `solarform` | solar | 5 | 0 | 0 | 5 |
| `config theme` / `config solarform` (+ `advanced`) | security, solar | 9 | 0 | 0 | 9 |
| `consumption` | profiles, periods | 6 | 0 | 1 | 5 |
| `notifications` | notifications | 1 | 0 | 0 | 1 |
| **Total (rutas únicas)** | | **134** | **3** | **51** | **80** |

Sin llamadas HTTP: `curves *` (cálculo local con `energy-types`), `config set|get|list|create-profile|use` (fichero local), `studies init|validate|set name|market|client|prices|phase|economics|batteries|data|add surface|remove surface|add-comment` (sólo editan el JSON local) y `command-profile`.

## Inventario completo por servicio

Las rutas son relativas al servicio (`<server>/<service><ruta>`). En la columna «Equivalente v2», el prefijo `/api/v2` se omite.

### security (2)

| Método | Ruta | Comando(s) | Equivalente v2 | Scope |
|---|---|---|---|---|
| GET | `/clients/config/clientThemeByClientUID/:clientUid` | `config theme get`, `config theme edit` | No | — |
| POST | `/clients/config/updateTheme` | `config theme set`, `config theme edit` | No | — |

### solar — estudios y PPA (11)

| Método | Ruta | Comando(s) | Equivalente v2 | Scope |
|---|---|---|---|---|
| POST | `/solar-study/findWithPaginationAndFilters` | `studies list` | Parcial: `GET /studies/solar` (nativo: `name`, `clientName`, `closed`, `won`; sin `state` ni rango de fechas) o `POST /studies/solar/search` → `/api/solar-study/filters` | studies:read |
| GET | `/solar-study/findSolarStudyMetadataById/:id` | `studies metadata` | No (no hay get de metadata por id) | — |
| GET | `/solar-study/metadata/solar-study-id/:id` | `studies metadata --by-study-id` | No | — |
| GET | `/solar-study/findById/:id` | `studies get`, `studies curves`, `studies pull`, `ppa calculate --study` | Parcial: `GET /studies/solar/:id` (nativo). Para curvas: `GET /studies/solar/:id/curves` y `/curve?path=` | studies:read |
| POST | `/solar-study?idSolarStudyState&creditAmount&saveAsNew` | `studies save` | Parcial: `POST /studies/solar` (crear, `idSolarStudyState`) + `PUT /studies/solar/:id?stateId` (actualizar). Sin `creditAmount` ni `saveAsNew` | studies:write |
| POST | `/solar-study/addSolarStudyComment/:id` | `studies comment` | No | — |
| POST | `/solar-study/calculateProduction` | `studies calculate-production`, `studies calculate production` | Parcial: `POST /calculations/solar-production` → `/api/calculate-solar-production` (mismo DTO `CalculateProductionDto`, pero envuelto en `{data, code, error}` y llama a `calculateStimateProduction`, no al controlador interno con fallback PVGIS→PVWatts) | calculations:write |
| GET | `/solar-study/optimizeSurfaces?lat&lon` | `studies optimize-surfaces` | No | — |
| GET | `/solar-study/ppa-templates` | `ppa templates list` | No | — |
| GET | `/solar-study/ppa-templates/:id` | `ppa templates get` | No | — |
| POST | `/solar-study/calculate-ppa-on-study` | `ppa calculate` | No | — |

### solar — inventario: recursos de `factory.ts` (61)

Cada recurso de `RESOURCES` (`src/commands/inventory/index.ts`) genera los mismos subcomandos `inventory <recurso> list|get|create|update|delete|delete-batch|filter`. Las llamadas que hacen:

- `list` → `GET <base>?limit&offset[&unactive=true]`
- `get` → `GET <base>/:id` (o `getPath`)
- `create` → `POST <base>`
- `update` → `PUT <base>/:id`, o `PUT <base>` con el id en el body si el recurso tiene `putBodyOnly`
- `delete` → `DELETE <base>/:id`
- `delete-batch` → `POST <base>/<batchDeletePath>`, sólo si el recurso lo define
- `filter` → `POST <filterPath | base/filter>`

| Método | Ruta | Comando(s) | Equivalente v2 | Scope |
|---|---|---|---|---|
| GET | `/solar-panels` | `inventory panels list` | Parcial: `GET /inventory/panels` (nativo; `active` en lugar de `unactive`) | inventory:read |
| GET | `/solar-panels/:id` | `inventory panels get`, `studies set panel` | Parcial: `GET /inventory/panels/:id` | inventory:read |
| POST | `/solar-panels` | `inventory panels create` | Parcial: `POST /inventory/panels` (nativo, valida campos) | inventory:write |
| PUT | `/solar-panels/:id` | `inventory panels update` | Parcial: `PATCH /inventory/panels/:id` | inventory:write |
| DELETE | `/solar-panels/:id` | `inventory panels delete` | Parcial: `DELETE /inventory/panels/:id` (204) | inventory:write |
| POST | `/solar-panels/delete-batch-solar-panels` | `inventory panels delete-batch` | No | — |
| POST | `/solar-panels/filter` | `inventory panels filter` | No | — |
| GET | `/solar-inverter` | `inventory inverters list` | Parcial: `GET /inventory/inverters` | inventory:read |
| GET | `/solar-inverter/:id` | `inventory inverters get`, `studies set inverter` | Parcial: `GET /inventory/inverters/:id` | inventory:read |
| POST | `/solar-inverter` | `inventory inverters create` | Parcial: `POST /inventory/inverters` | inventory:write |
| PUT | `/solar-inverter` (id en body) | `inventory inverters update` | Parcial: `PATCH /inventory/inverters/:id` | inventory:write |
| DELETE | `/solar-inverter/:id` | `inventory inverters delete` | Parcial: `DELETE /inventory/inverters/:id` | inventory:write |
| POST | `/solar-inverter/delete-batch-solar-inverters` | `inventory inverters delete-batch` | No | — |
| POST | `/solar-inverter/filter` | `inventory inverters filter` | No | — |
| GET | `/solar-battery` | `inventory batteries list` | Parcial: `GET /inventory/batteries` | inventory:read |
| GET | `/solar-battery/:id` | `inventory batteries get` | Parcial: `GET /inventory/batteries/:id` | inventory:read |
| POST | `/solar-battery` | `inventory batteries create` | Parcial: `POST /inventory/batteries` | inventory:write |
| PUT | `/solar-battery/:id` | `inventory batteries update` | Parcial: `PATCH /inventory/batteries/:id` | inventory:write |
| DELETE | `/solar-battery/:id` | `inventory batteries delete` | Parcial: `DELETE /inventory/batteries/:id` | inventory:write |
| POST | `/solar-battery/delete-batch-solar-batteries` | `inventory batteries delete-batch` | No | — |
| POST | `/solar-battery/filter` | `inventory batteries filter` | No | — |
| GET | `/charger` | `inventory chargers list` | Parcial: `GET /inventory/chargers` | inventory:read |
| GET | `/charger/:id` | `inventory chargers get` | Parcial: `GET /inventory/chargers/:id` | inventory:read |
| POST | `/charger` | `inventory chargers create` | Parcial: `POST /inventory/chargers` | inventory:write |
| PUT | `/charger` (id en body) | `inventory chargers update` | Parcial: `PATCH /inventory/chargers/:id` | inventory:write |
| DELETE | `/charger/:id` | `inventory chargers delete` | Parcial: `DELETE /inventory/chargers/:id` | inventory:write |
| POST | `/charger/delete-batch-chargers` | `inventory chargers delete-batch` | No | — |
| POST | `/charger/filter` | `inventory chargers filter` | No | — |
| GET | `/heat-pump` | `inventory heatpumps list` | Parcial: `GET /inventory/heat-pumps` | inventory:read |
| GET | `/heat-pump/:id` | `inventory heatpumps get` | Parcial: `GET /inventory/heat-pumps/:id` | inventory:read |
| POST | `/heat-pump` | `inventory heatpumps create` | Parcial: `POST /inventory/heat-pumps` | inventory:write |
| PUT | `/heat-pump` (id en body) | `inventory heatpumps update` | Parcial: `PATCH /inventory/heat-pumps/:id` | inventory:write |
| DELETE | `/heat-pump/:id` | `inventory heatpumps delete` | Parcial: `DELETE /inventory/heat-pumps/:id` | inventory:write |
| POST | `/heat-pump/delete-batch-heatpumps` | `inventory heatpumps delete-batch` | No | — |
| POST | `/heat-pump/filter` | `inventory heatpumps filter` | No | — |
| GET | `/custom-asset` | `inventory custom-assets list` | No | — |
| GET | `/custom-asset/id/:id` | `inventory custom-assets get`, `studies set custom-assets` | No | — |
| POST | `/custom-asset` | `inventory custom-assets create` | No | — |
| PUT | `/custom-asset/:id` | `inventory custom-assets update` | No | — |
| DELETE | `/custom-asset/:id` | `inventory custom-assets delete` | No | — |
| POST | `/custom-asset/filter` | `inventory custom-assets filter` | No | — |
| GET | `/custom-asset/type` | `inventory custom-asset-types list` | No | — |
| GET | `/custom-asset/type/id/:id` | `inventory custom-asset-types get` | Parcial: `GET /inventory/custom-asset-types/:id` → `/api/custom-asset/type/id/:id` (controlador público; añade `customFields`/`customAssets`) | inventory:read |
| POST | `/custom-asset/type` | `inventory custom-asset-types create` | No | — |
| PUT | `/custom-asset/type/:id` | `inventory custom-asset-types update` | No | — |
| DELETE | `/custom-asset/type/:id` | `inventory custom-asset-types delete` | No | — |
| POST | `/custom-asset/type/filter` | `inventory custom-asset-types filter` | No | — |
| GET | `/charger/ve-charger-kits` | `inventory charger-kits list` | No | — |
| GET | `/charger/ve-charger-kits/:id` | `inventory charger-kits get` | No | — |
| POST | `/charger/ve-charger-kits` | `inventory charger-kits create` | No | — |
| PUT | `/charger/ve-charger-kits` (id en body) | `inventory charger-kits update` | No | — |
| DELETE | `/charger/ve-charger-kits/:id` | `inventory charger-kits delete` | No | — |
| POST | `/charger/ve-charger-kits/delete-batch-ve-charger-kits` | `inventory charger-kits delete-batch` | No | — |
| POST | `/charger/ve-charger-kits/filter` | `inventory charger-kits filter` | No | — |
| GET | `/heat-pump/heatpump-kits` | `inventory heatpump-kits list` | No | — |
| GET | `/heat-pump/heatpump-kits/:id` | `inventory heatpump-kits get` | No | — |
| POST | `/heat-pump/heatpump-kits` | `inventory heatpump-kits create` | No | — |
| PUT | `/heat-pump/heatpump-kits` (id en body) | `inventory heatpump-kits update` | No | — |
| DELETE | `/heat-pump/heatpump-kits/:id` | `inventory heatpump-kits delete` | No | — |
| POST | `/heat-pump/heatpump-kits/delete-batch-heatpump-kits` | `inventory heatpump-kits delete-batch` | No | — |
| POST | `/heat-pump/heatpump-kits/filter` | `inventory heatpump-kits filter` | No | — |

### solar — inventario: fabricantes, campos personalizados y kits (28)

| Método | Ruta | Comando(s) | Equivalente v2 | Scope |
|---|---|---|---|---|
| GET | `/manufacturers` | `inventory manufacturers list` | Parcial: `GET /inventory/manufacturers` (nativo, paginado) | inventory:read |
| POST | `/manufacturers` | `inventory manufacturers create` | Parcial: `POST /inventory/manufacturers` → `/api/manufacturer` | inventory:write |
| GET | `/custom-asset/custom-field/all` | `inventory custom-fields list` | No | — |
| GET | `/custom-asset/custom-field/id/:id` | `inventory custom-fields get` | No | — |
| POST | `/custom-asset/custom-field` | `inventory custom-fields create` | No | — |
| PUT | `/custom-asset/custom-field/:id` | `inventory custom-fields update` | No | — |
| DELETE | `/custom-asset/custom-field/:id` | `inventory custom-fields delete` | No | — |
| GET | `/solar-kits?unactive=true` / `?limit=500` | `inventory kits list`, `inventory kits get` (lista todo y filtra en cliente), `studies set kit`, `studies optimize-peakpower` | Parcial: `GET /inventory/kits` (nativo; máximo 100 por página) o `GET /inventory/kits/:id` | inventory:read |
| PUT | `/solar-kits/:id` | `inventory kits update` | Parcial: `POST /inventory/kits` (upsert → `/api/solar-kits`) | inventory:write |
| DELETE | `/solar-kits/:id` | `inventory kits delete` | Parcial: `DELETE /inventory/kits/:id` → `/api/solar-kits/:id` | inventory:write |
| POST | `/solar-kits/delete-batch-solar-kits` | `inventory kits delete-batch` | No | — |
| POST | `/solar-kits/filters` | `inventory kits filter` | Parcial: `POST /inventory/kits/search` → `/api/solar-kits/filter` (otro endpoint de Solar: `filter` ≠ `filters`) | inventory:read |
| POST | `/solar-kits` | `inventory kits assemble` | Parcial: `POST /inventory/kits` → `/api/solar-kits` | inventory:write |
| PUT | `/solar-kits/archive/:kitId` | `inventory kits archive` | No | — |
| GET | `/solar-kits/solar-panels?limit&offset` | `inventory kits panels list` | Parcial: `GET /inventory/kit-panels` | inventory:read |
| POST | `/solar-kits/solar-panels/filter` `{idKitSolarPanel}` | `inventory kits panels get`, `inventory kits assemble` | Parcial: `GET /inventory/kit-panels/:id` | inventory:read |
| POST | `/solar-kits/solar-panels` | `inventory kits panels create` | Parcial: `POST /inventory/kit-panels` (upsert → `/api/kitSolarPanel`) | inventory:write |
| PUT | `/solar-kits/solar-panels/:id` | `inventory kits panels update` | Parcial: `POST /inventory/kit-panels` (upsert; sin PATCH) | inventory:write |
| DELETE | `/solar-kits/solar-panels/:id` | `inventory kits panels delete` | Parcial: `DELETE /inventory/kit-panels/:id` | inventory:write |
| GET | `/solar-kits/solar-panels/findFeaturedSolarKits/:id` | `inventory kits panels featured` | No | — |
| GET | `/solar-kits/inverters?limit&offset` | `inventory kits inverters list`, `inventory kits assemble` (`limit=200`) | Parcial: `GET /inventory/kit-inverters` | inventory:read |
| POST | `/solar-kits/inverters` | `inventory kits inverters create` | Parcial: `POST /inventory/kit-inverters` (upsert) | inventory:write |
| PUT | `/solar-kits/inverters/:id` | `inventory kits inverters update` | Parcial: `POST /inventory/kit-inverters` (upsert) | inventory:write |
| DELETE | `/solar-kits/inverters/:id` | `inventory kits inverters delete` | Parcial: `DELETE /inventory/kit-inverters/:id` | inventory:write |
| GET | `/solar-kits/inverters/findFeaturedSolarKits/:id` | `inventory kits inverters featured` | No | — |
| GET | `/solar-kits/batteries?limit&offset` | `inventory kits batteries list`, `inventory kits assemble` (`limit=200`) | Parcial: `GET /inventory/kit-batteries` | inventory:read |
| POST | `/solar-kits/batteries` | `inventory kits batteries create` | Parcial: `POST /inventory/kit-batteries` (upsert) | inventory:write |
| DELETE | `/solar-kits/batteries/:id` | `inventory kits batteries delete` | Parcial: `DELETE /inventory/kit-batteries/:id` | inventory:write |

### solar — rutas `/api/*` (controlador público de Solar) (12)

| Método | Ruta | Comando(s) | Equivalente v2 | Scope |
|---|---|---|---|---|
| GET | `/api/templates?templateIdentifier` | `templates list` | **Sí**: `GET /templates` → `/api/templates` | documents:read |
| GET | `/api/geocode?address&country` | `geocode resolve` | **Sí**: `GET /reference/geocode` | reference:read |
| GET | `/api/reverse-geocode?lat&lng` | `geocode reverse` | **Sí**: `GET /reference/reverse-geocode` | reference:read |
| GET | `/api/alexandria-projects` | `projects list` | No | — |
| GET | `/api/alexandria-projects/:id` | `projects get`, `projects files list`, `projects files download` | No | — |
| POST | `/api/alexandria-projects` | `projects create` | No | — |
| PUT | `/api/alexandria-projects/:id` | `projects update` | No | — |
| DELETE | `/api/alexandria-projects/:id` | `projects delete` | No | — |
| POST | `/api/alexandria-projects/:id/files` | `projects files add` | No | — |
| DELETE | `/api/alexandria-projects/:id/files/:fileId` | `projects files remove` | No | — |
| POST | `/api/solar-form/simple?save&email&solarKitId&excessesCompensationMode` | `solarform simple` | No (`/studies/solar/simple` es `solar-study/simple`, otro flujo) | — |
| POST | `/api/solar-form?save&email` | `solarform calculate` | No | — |

### solar — configuración de SolarForm (10)

| Método | Ruta | Comando(s) | Equivalente v2 | Scope |
|---|---|---|---|---|
| GET | `/solar-form/solar-form-config` | `solarform config` | No | — |
| PUT | `/solar-form/solar-form-statistics` | `solarform statistics --update` | No | — |
| POST | `/solar-form/solar-form-statistics?statsId` | `solarform statistics --create` | No | — |
| GET | `/solar-form/get-solar-form-config` | `config solarform get`, `config solarform edit` | No | — |
| POST | `/solar-form/solar-form-config` | `config solarform create` | No | — |
| PUT | `/solar-form/solar-form-config/:id` | `config solarform update`, `config solarform edit` | No | — |
| GET | `/solar-form/config/advanced` | `config solarform advanced get|update`, `config solarform advanced <sección> get|set|edit` | No | — |
| PUT | `/solar-form/config/advanced` | `config solarform advanced update`, `config solarform advanced <sección> set|edit` | No | — |
| DELETE | `/solar-form/config/advanced` | `config solarform advanced delete` | No | — |
| POST | `/solar-form/config/default/advanced/:clientUid?email&url` | `config solarform advanced init-default` | No | — |

Las secciones de `advanced` son `general`, `cover`, `surfaces`, `consumer`, `inclination`, `orientation`, `panels`, `consumption`, `results` y `custom-fields`.

> Las tablas de solar suman 11 + 61 + 28 + 12 + 10 = 122 filas.

### templates (sharing) (1)

| Método | Ruta | Comando(s) | Equivalente v2 | Scope |
|---|---|---|---|---|
| POST | `/shareable[?<linkParams>]` | `shareables create` | Parcial: `POST /studies/solar/:id/shares?templateId` → `/api/share/:id` (sólo estudios solares; sin `elementType`, `shareableType`, `privacy`, `password` ni fechas) | documents:write |

### profiles (5)

| Método | Ruta | Comando(s) | Equivalente v2 | Scope |
|---|---|---|---|---|
| POST | `/consumption-estimation?<query>` | `consumption estimate`, `studies set consumption --annual --pattern` | No | — |
| GET | `/ree-profiles` | `consumption ree-profiles`, `studies set consumption` (modos por periodo o mes) | No | — |
| GET | `/custom-profiles/getTags` | `consumption custom-tags` | No | — |
| GET | `/custom-profiles/getInfo` | `consumption custom-profile-info` | No | — |
| POST | `/consumption-files-processor/portugal/eredes-zip` (multipart) | `consumption from-file --eredes-zip` | No | — |

### periods (3)

| Método | Ruta | Comando(s) | Equivalente v2 | Scope |
|---|---|---|---|---|
| GET | `/periodos?idTarifa&idZona&fechaInicio&fechaFin[&market]` | `consumption periods`, `studies set consumption` (modos por periodo o mes), `studies calculate-results` | Parcial: `GET /reference/periods?tariffId&zoneId&startDate&endDate` (vía Solar, sin `market`) | reference:read |
| GET | `/tarifas-atr` | `studies set tariff` | No | — |
| GET | `/zonas` | `studies set tariff` | No | — |

### notifications (1)

| Método | Ruta | Comando(s) | Equivalente v2 | Scope |
|---|---|---|---|---|
| POST | `/notifications` | `notifications send` | No | — |

## Rutas que faltan en la v2 (por prioridad sugerida)

**P1: estudios (el núcleo de lo que hacen Alexandria y las skills)**

- Metadata de estudio: `GET` por id de metadata y por `solarStudyId` (`studies metadata`).
- `studies list` con filtro por estado y por rango de fechas: el `GET /studies/solar` nativo sólo filtra por `name`, `clientName`, `closed` y `won`.
- Guardar con `creditAmount` y `saveAsNew` (`studies save`), o decidir que `saveAsNew` sea crear sin `_id` en el cliente.
- Comentarios de estudio: `POST .../comments` (`studies comment`; además genera la notificación al usuario).
- `optimizeSurfaces` (ángulo y azimut óptimos).
- Referencias de tarifa: `tarifas-atr` y `zonas`. Sin ellas, `studies set tariff` no funciona.
- Perfiles de consumo: `consumption-estimation` y `ree-profiles`. `studies set consumption` depende de ellos.
- Confirmar la paridad de `POST /calculations/solar-production` con el `calculateProduction` interno (forma de la respuesta y fallback PVGIS→PVWatts).

**P1: inventario**

- `custom-assets` (CRUD completo), que usa `studies set custom-assets`.
- `custom-asset-types`: list, create, update y delete (hoy sólo hay get).
- `custom-fields` (CRUD).
- Búsqueda avanzada (`filter`) de paneles, inversores, baterías, cargadores y bombas de calor.
- `delete-batch` de todos los recursos.
- Kits: `archive` y `findFeaturedSolarKits` (paneles e inversores de kit). Además, `PATCH` en kit-panels, kit-inverters y kits; hoy sólo hay upsert por `POST`.
- `charger-kits` y `heatpump-kits` (CRUD completo).

**P1: plantillas y documentos**

- Shareables genéricos (`POST /shareable` con `elementType`, `shareableType`, privacidad, contraseña y fechas). La v2 sólo comparte estudios solares.
- PPA: `ppa-templates` (list y get) y `calculate-ppa-on-study`.

**P2**

- Proyectos de Alexandria (`/api/alexandria-projects`, 7 operaciones). Están en el catálogo v1 (`legacy-routes.js`), pero no en el v2.
- Perfiles personalizados: `custom-profiles/getTags` y `getInfo`. Importación de EREDES (multipart).
- SolarForm: `/api/solar-form` y `/api/solar-form/simple` (cálculo), `solar-form-config`, `solar-form-statistics`.
- Notificaciones (`notifications send`). Exige decidir quién es el remitente con una clave de cliente; hoy la CLI envía «desde Alexandria».

**P3: probablemente fuera de la API pública**

- `config theme set` (requiere rol admin), `config solarform *` y `config solarform advanced *`.
- `advanced init-default` (superadmin o localhost con la cabecera `suntropy-auth`).

## Notas y trampas

- **Las claves `sun_` no sirven en v1.** El gateway intercepta `/solar/api/*` y `/api/v1/*` (rutas legacy) y responde `403 V2_REQUIRED` a una clave `sun_` (`app.js`). La CLI ya llama a `/solar/api/...` para `geocode`, `templates list`, `projects` y `solarform simple|calculate`. Esas llamadas pasan por el gateway como v1. Para usarlas con `sun_` hay que reescribirlas a `/api/v2/...` (geocode y templates ya existen), no basta con cambiar el token. A la inversa, una ruta `/api/v2` exige una clave `sun_` y rechaza JWT y claves antiguas con `401 API_KEY_REQUIRED`. La CLI tendrá que elegir la ruta según el tipo de credencial (`kind` en `client.ts`) mientras convivan ambas.
- **Enrutado local por puertos**: con `localhost` o `host:puerto`, `getServiceUrl` sustituye el servicio por un puerto (`security` 8080, `solar` 8086, `templates` 8090, `profiles` 8085, `periods` 8084, `notifications` 8093, `satvolt` 8099). La v2 necesita en cambio la URL del gateway (`resolveGatewayUrl`). Las pruebas locales de la fase 2 deben levantar el gateway.
- **Límite de página 100**: `studies optimize-peakpower` pide `GET /solar-kits?limit=500`, `inventory kits assemble` pide `limit=200` y `kits get` / `studies set kit` piden la lista entera (`unactive=true`) para filtrar en cliente. Con la v2 hay que paginar con `nextOffset`, o usar `GET /inventory/kits/:id` para el get.
- **Inactivos**: la CLI pide `unactive=true` para incluir los inactivos salvo con `--active-only`. Los listados nativos usan `active`; hay que comprobar qué devuelven por defecto.
- **Update por body**: inversores, cargadores, bombas de calor y sus kits actualizan con `PUT <base>` y el id en el body (`putBodyOnly`). En la v2 es `PATCH /:id`. Los kits y sus componentes no tienen `PATCH`: su `POST` es un upsert («Create or update»).
- **`filter` ≠ `filters`**: `inventory kits filter` usa `POST /solar-kits/filters` (interno). `POST /inventory/kits/search` apunta a `/api/solar-kits/filter`, que es otro endpoint y además era anónimo en v1.
- **`kits get` sin endpoint por id**: el comando usa `getViaFilter`, que lista todo y filtra en cliente. La v2 sí tiene `GET /inventory/kits/:id` y simplificaría el comando.
- **`studies get` / `pull` / `curves`** esperan el documento Mongo completo de `findById`. Hay que comprobar que el `GET /studies/solar/:id` nativo devuelve lo mismo, porque el README del gateway dice que los listados de estudios devuelven metadatos y no documentos completos. Para `studies curves`, la v2 ofrece `GET /studies/solar/:id/curve?path=`, que evita bajar el estudio entero.
- **Respuestas vacías**: `assertFound` cubre el `200` con body vacío de `findById` y `addSolarStudyComment`. La v2 envuelve en `data`, así que la comprobación debe mirar `data` (o un 404).
- **Periodos**: la CLI llama directamente al servicio `periods` con parámetros en español (`idTarifa`, `fechaInicio`, …) y `market`. La v2 pasa por Solar (`/api/periods`) con `tariffId`, `zoneId`, `startDate` y `endDate`, sin `market`. Hay que verificar los mercados distintos de ES.
- **`config theme get`** es un endpoint público de security (lectura sin auth) y **`updateTheme`** exige rol admin. Ninguno de los dos encaja con una clave de cliente sin decidir antes los scopes.
- **`advanced init-default`** envía la cabecera `suntropy-auth: <clientUID>` y sólo funciona como superadmin o en localhost. No debe exponerse en la v2.
- **`notifications send`** es una llamada entre servicios en nombre de Alexandria (remitente fijo). Con una clave de cliente habría que restringir los destinatarios a los usuarios del tenant.
- **`projects files download`** hace además un `GET` con axios a `file.url` (host de documentos), sin token a propósito. No es una ruta de Suntropy y no cambia con la v2.
- **Multipart**: el gateway reenvía el body en bruto (`express.raw`), así que una futura ruta v2 para EREDES (`consumption from-file`) mantendría el `multipart/form-data`.
- **Scopes**: para cubrir lo que tiene equivalente, la clave que use Alexandria necesitaría `studies:read`, `studies:write`, `inventory:read`, `inventory:write`, `calculations:write`, `reference:read`, `documents:read` y `documents:write`, además de los de LeadGen (`leadgen:*`, `credits:read`).
