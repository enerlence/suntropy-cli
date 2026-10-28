# CLI → API v2: qué ruta usa cada comando

Estado final de la fase 2 (paridad v1 ↔ v2). Cada comando declara su ruta en las dos versiones y la CLI elige en cada petición según la credencial:

- **clave `sun_`** → API v2, `<gateway>/api/v2/…`;
- **JWT o API key antigua** → v1, `<server>/<servicio>/…` (en local, un puerto por servicio: `LOCAL_PORTS` de `src/config.ts`).

Si el comando no tiene ruta para la versión de la credencial, falla antes de llamar con `V2_KEY_NOT_SUPPORTED` o `V1_AUTH_NOT_SUPPORTED`.

El código está en `src/api/`:

- `core.ts`: `operation({ v1, v2 })`, `invoke(op, opts, input)` y los constructores `v1(…)`, `v2(…)` y `custom(…)`;
- `translate.ts`: traducciones comunes (desenvolver `data`, `v2Range`/`v2All` para paginar, borrados, referencias `{ idX }` → `xId`, `identifier` ↔ `name`, `clientId` del JWT);
- `ops/studies.ts`, `ops/reference.ts`, `ops/inventory.ts` y `ops/settings.ts`: las rutas por dominio. `ops/index.ts` (`allOperations()`) las lista todas: 138 operaciones, 135 con v1 y v2 y 3 sólo v1.

Las rutas v1 son relativas al servicio; las v2, a `/api/v2`. El contrato de referencia es `contrato-v2-paridad-cli.md` (fase 1); los números de fila (A1, B-7, C13…) son los suyos.

## Reglas comunes de traducción (§3.0)

| Regla | Qué hace la CLI |
|---|---|
| Sobre | Con la v2 desenvuelve `data`. Los errores v2 salen por stderr con `code`, `message`, `status` y, en 4xx, `details`. Stdout queda vacío. |
| Listados paginados | `outputPaginated` imprime `{ data, total, limit, offset, hasMore }` en los dos caminos. Con la v2, un `--limit` de más de 100 se pide en varias páginas (`v2Range`). |
| Colecciones enteras en v1 | La v2 recorre `nextOffset` con `limit=100` (`v2All`) y emite el array completo. |
| Borrados | `{ "success": true, "deleted": "<id>" }`; en lote, `{ "success": true, "deleted": <n> }` (`affected` en v1, `data.deleted` en v2). |
| Escrituras de inventario | `PATCH /:id` en v2 (el id sale del body). Referencias: `manufacturer: { idManufacturer }` → `manufacturerId`, y las de cada recurso (abajo). |
| Bombas de calor | En v2, `identifier` → `name` en bodies y en el `--query` de `filter`; la CLI borra el alias `name` de las respuestas. |

## Correcciones del camino v1 (§3.0.6)

| Comando | v1 antes | v1 ahora |
|---|---|---|
| `studies list` | `limit`, `offset`, `state`, `fromDate`, `toDate` en el body: devolvía todo | `limit`/`offset` en la query; `--state` → `states: [{ idSolarStudyMetadataState }]` (resuelto con `GET /solar-study/states`, sin distinguir mayúsculas; si no existe, lista vacía); `--from` → `creationTimestamp: { date, operator: 'after' }`; `--to` → se cuentan los estudios posteriores (`after <to> 23:59:59.999`) y se desplaza el `offset` (el orden es `creationTimestamp DESC`), así `total` y la paginación son exactos; siempre `closed=false` y `won=false` |
| `inventory <recurso> filter` | `limit`/`offset` en el body | En la query. La respuesta `[items, total]` se lee bien (antes se imprimía la tupla) |
| `inventory inverters list` | `limit` (ignorado) | `size` |
| `inventory chargers list` sin `--active-only` | `unactive=true` = sólo inactivos | Dos llamadas (activos e inactivos), mezcla por id y corte del rango |
| `inventory kits list`, `custom-assets list`, `custom-asset-types list` | La v1 devuelve la colección entera | Paginación en cliente (`total` real) |
| `inventory kits get`, `studies set kit` | Lista entera y búsqueda | Igual en v1; `GET /inventory/kits/:id` en v2 |
| `inventory kits assemble` | Batería validada contra las baterías de kit | Contra el inventario (`GET /solar-battery/:id`), que es lo que el kit referencia |
| `studies set tariff --market` | `market` a `/tarifas-atr` (siempre España) | `pais` |
| `consumption custom-tags`, `custom-profile-info` | Sin `clientId`; `id` ignorado | `clientId` del JWT (o del perfil) y filtro por id en cliente (array de 0 o 1) |
| `config theme get\|edit` | `--client-uid` obligatorio | Opcional: por defecto, la cuenta de la sesión |

## Rutas por comando

### Estudios, cálculo y PPA (dominio A)

| Comando | v1 | v2 | Contrato |
|---|---|---|---|
| `studies list` | POST `/solar/solar-study/findWithPaginationAndFilters` (+ GET `/solar-study/states`) | GET `/studies/solar?limit&offset&clientName&state&from&to&closed=false&won=false` | A1 |
| `studies metadata <id>` | GET `/solar/solar-study/findSolarStudyMetadataById/:id` | GET `/study-metadata/:id` | A2 |
| `studies metadata <id> --by-study-id` | GET `/solar/solar-study/metadata/solar-study-id/:id` | GET `/studies/solar/:id/metadata` | A3 |
| `studies get`, `curves`, `pull`, `ppa calculate --study` | GET `/solar/solar-study/findById/:id` | GET `/studies/solar/:id` | A4 |
| `studies calculate-production`, `studies calculate production` | POST `/solar/solar-study/calculateProduction` | POST `/calculations/solar-production` | A5 |
| `studies optimize-surfaces` | GET `/solar/solar-study/optimizeSurfaces?lat&lon` | GET `/calculations/optimal-angles?lat&lon` | A6 |
| `ppa templates list` | GET `/solar/solar-study/ppa-templates` | GET `/ppa-templates` (todas las páginas) | A7 |
| `ppa templates get` | GET `/solar/solar-study/ppa-templates/:id` | GET `/ppa-templates/:id` | A8 |
| `ppa calculate` | POST `/solar/solar-study/calculate-ppa-on-study` `{ data, ppaTemplateId }` | POST `/calculations/ppa` `{ study, ppaTemplateId }` | A9 |
| `studies save` | POST `/solar/solar-study?idSolarStudyState&creditAmount&saveAsNew` | Con `_id` y sin `--save-as-new`: PUT `/studies/solar/:_id?stateId`. Si no: POST `/studies/solar?idSolarStudyState[&saveAsNew=true]` sin `_id`. `--credit-amount` se ignora con aviso | A10 |
| `studies comment` | POST `/solar/solar-study/addSolarStudyComment/:id` | POST `/studies/solar/:id/comments` (sin `creationUserUID` si el perfil no tiene persona) | A11 |
| `consumption periods`, `studies set consumption` (periodos/meses), `studies calculate-results` | GET `/periods/periodos?idTarifa&idZona&fechaInicio&fechaFin&market` | GET `/reference/periods?tariffId&zoneId&startDate&endDate&market` | A12 |
| `studies set tariff` | GET `/periods/tarifas-atr?pais` y `/periods/zonas?market` | GET `/reference/tariffs?market` y `/reference/zones?market` | A13, A14 |
| `consumption ree-profiles`, `studies set consumption` | GET `/profiles/ree-profiles` | GET `/reference/ree-profiles` | A15 |
| `consumption estimate`, `studies set consumption --annual --pattern` | POST `/profiles/consumption-estimation?<query>` + body | POST `/calculations/consumption-estimation` (un body; `annualConsumption` numérico) | A16 |
| `consumption custom-tags` | GET `/profiles/custom-profiles/getTags?clientId` | GET `/reference/custom-profiles/tags` | A17 |
| `consumption custom-profile-info` | GET `/profiles/custom-profiles/getInfo?clientId` + filtro | GET `/reference/custom-profiles?id` | A18 |
| `consumption from-file --eredes-zip` | POST `/profiles/consumption-files-processor/portugal/eredes-zip` (multipart) | POST `/calculations/consumption-files/eredes-zip` (multipart) | A19 |
| `notifications send` | POST `/notifications/notifications` | POST `/notifications`. 422 `NOTIFICATIONS_DISABLED_FOR_CLIENT`/`NOTIFICATION_TYPE_DISABLED` → `{ sent: false, reason }` con salida 0, como el string de la v1 | A20 |

### Inventario (dominio B)

Recursos de `RESOURCES` (`src/commands/inventory/resources.ts`), con `list|get|create|update|delete|delete-batch|filter`:

| Recurso CLI | v1 | v2 (`/inventory/…`) | Orden v2 (`sort`) | Particularidades |
|---|---|---|---|---|
| `panels` | `/solar/solar-panels` | `panels` | `-creationTimestamp` | |
| `inverters` | `/solar/solar-inverter` (update con el id en el body) | `inverters` | `id` | v1 `size` |
| `batteries` | `/solar/solar-battery` | `batteries` | `id` | |
| `chargers` | `/solar/charger` (update con id en body) | `chargers` | `id` | v1 en dos llamadas |
| `heatpumps` | `/solar/heat-pump` (update con id en body) | `heat-pumps` | `id` | `identifier` ↔ `name` |
| `custom-assets` | `/solar/custom-asset` (get: `/custom-asset/id/:id`) | `custom-assets` | `-creationTimestamp` | `customAssetType` → `customAssetTypeId`; `customAssetCustomField[{ customField, value }]` → `customFields[{ customFieldId, value }]`. Sin `delete-batch` |
| `custom-asset-types` | `/solar/custom-asset/type` (get: `/type/id/:id`) | `custom-asset-types` | `id` | `filter` sin `active`. Sin `delete-batch` |
| `charger-kits` | `/solar/charger/ve-charger-kits` | `charger-kits` | `id` | `charger` → `chargerId`; `veChargerKitCustomAssets` → `customAssets[{ customAssetId, units }]` |
| `heatpump-kits` | `/solar/heat-pump/heatpump-kits` | `heat-pump-kits` | `id` | `heatpump` → `heatpumpId`; `heatpumpKitCustomAssets` → `customAssets` |
| `kits` | `/solar/solar-kits` (filter: `/solar-kits/filters`) | `kits` | `id` | Sin `create` (se usa `assemble`). Referencias de B-70 |

Operaciones de cada recurso:

| Subcomando | v1 | v2 |
|---|---|---|
| `list [--active-only]` | GET `<base>?limit&offset[&unactive=true]` | GET `/inventory/<r>?limit&offset&sort[&active=true]` (B-1…) |
| `get <id>` | GET `<base>/:id` (o su ruta propia) | GET `/inventory/<r>/:id` |
| `create` | POST `<base>` | POST `/inventory/<r>` |
| `update <id>` | PUT `<base>/:id` o PUT `<base>` con el id | PATCH `/inventory/<r>/:id` |
| `delete <id>` | DELETE `<base>/:id` | DELETE `/inventory/<r>/:id` (204) |
| `delete-batch --ids` | POST `<base>/<delete-batch-…>` `[ids]` | POST `/inventory/<r>/batch-delete` `{ ids }` |
| `filter --query` | POST `<base>/filter?limit&offset` | POST `/inventory/<r>/search?limit&offset&active=true` |

Resto del inventario:

| Comando | v1 | v2 | Contrato |
|---|---|---|---|
| `inventory manufacturers list` | GET `/solar/manufacturers` | GET `/inventory/manufacturers` (todas las páginas) | B-62 |
| `inventory manufacturers create` | POST `/solar/manufacturers` | POST `/inventory/manufacturers` | B-63 |
| `inventory custom-fields list\|get\|create\|update\|delete` | `/solar/custom-asset/custom-field/{all, id/:id, , :id, :id}` | `/inventory/custom-fields[/:id]` (list: todas las páginas; update: PATCH) | B-64…B-68 |
| `inventory kits archive` | PUT `/solar/solar-kits/archive/:id` | POST `/inventory/kits/:id/archive`. Salida `{ idSolarKit, active: false }` | B-75 |
| `inventory kits assemble` | Validación: POST `/solar-kits/solar-panels/filter`, GET `/solar-kits/inverters`, GET `/solar-battery/:id`; alta: POST `/solar-kits` | Validación: GET `/inventory/kit-panels/:id`, `/kit-inverters/:id`, `/batteries/:id`; alta: POST `/inventory/kits` con ids | B-74 |
| `studies optimize-peakpower` (modo kits) | GET `/solar/solar-kits` | GET `/inventory/kits?active=true&sort=id` (todas las páginas) | B-69 |
| `inventory kits panels list\|get\|create\|update\|delete\|featured` | `/solar/solar-kits/solar-panels…` (get por `filter`) | `/inventory/kit-panels…`; featured: GET `/inventory/kit-panels/:id/kits` | B-76…B-81 |
| `inventory kits inverters list\|create\|update\|delete\|featured` | `/solar/solar-kits/inverters…` | `/inventory/kit-inverters…` | B-82…B-86 |
| `inventory kits batteries list\|create\|delete` | `/solar/solar-kits/batteries…` | `/inventory/kit-batteries…` | B-87…B-89 |

### Proyectos, SolarForm, ajustes, shares (dominio C) y lo que ya estaba en v2

| Comando | v1 | v2 | Contrato |
|---|---|---|---|
| `config theme get` | GET `/security/clients/config/clientThemeByClientUID/:uid` | GET `/settings/theme` (con `--client-uid` ajeno: `CLIENT_UID_MISMATCH` tras GET `/me`) | 1 |
| `config theme set\|edit` | POST `/security/clients/config/updateTheme` | PATCH `/settings/theme` sin `idClientThemeConfig`, `customURL` ni `client` | 2 |
| `projects list` | GET `/solar/api/alexandria-projects` | GET `/projects` (todas las páginas) | C1 |
| `projects get`, `files list`, `files download` | GET `/solar/api/alexandria-projects/:id` | GET `/projects/:id` | C2 |
| `projects create\|update\|delete` | POST/PUT/DELETE `/solar/api/alexandria-projects[/:id]` | POST/PATCH/DELETE `/projects[/:id]` | C3–C5 |
| `projects files add\|remove` | POST/DELETE `/solar/api/alexandria-projects/:id/files[/:fileId]` | POST/DELETE `/projects/:id/files[/:fileId]` (JSON en los dos) | C6, C7 |
| `solarform simple` | POST `/solar/api/solar-form/simple?save&email&solarKitId&excessesCompensationMode` | POST `/solar-form/estimates/simple?…` (201) | C8 |
| `solarform calculate` | POST `/solar/api/solar-form?save&email` | POST `/solar-form/estimates?…` (201) | C9 |
| `solarform config` | GET `/solar/solar-form/solar-form-config` (por `Origin`: desde la CLI no encuentra nada) | GET `/settings/solar-form/public-view` | C10 |
| `config solarform get` | GET `/solar/solar-form/get-solar-form-config?getParameters` | GET `/settings/solar-form?includeParameters` | C11 |
| `config solarform create` | POST `/solar/solar-form/solar-form-config?getParameters` | POST `/settings/solar-form?includeParameters` sin `idSolarFormConfig`/`clientUID` | C12 |
| `config solarform update <id>`, `edit` | PUT `/solar/solar-form/solar-form-config/:id` | PATCH `/settings/solar-form` con `idSolarFormConfig` en el body (comprobación de identidad) | C13 |
| `config solarform advanced get`, `<sección> get` | GET `/solar/solar-form/config/advanced` | GET `/settings/solar-form/advanced` | C14 |
| `config solarform advanced update`, `<sección> set\|edit` | PUT `/solar/solar-form/config/advanced` (objeto fusionado) | PATCH `/settings/solar-form/advanced` (objeto fusionado) | C15 |
| `config solarform advanced delete` | DELETE `/solar/solar-form/config/advanced` | DELETE `/settings/solar-form/advanced`. Salida `{ success: true }` | C16 |
| `shareables create` | POST `/templates/shareable?<link-params>` | POST `/shares` con `linkParams: { … }` | C17 |
| `templates list` | GET `/solar/api/templates?templateIdentifier` | GET `/templates?templateIdentifier` | ya existía |
| `geocode resolve` / `reverse` | GET `/solar/api/geocode` / `/api/reverse-geocode` | GET `/reference/geocode` / `/reference/reverse-geocode` | ya existía |
| `satvolt …`, `satvolt credits …` | `/satvolt/api/v1/…`, `/payments/…` | `/leadgen/…`, `/leadgen/credit-packs…` | PR #47 |
| `auth status` | GET `/security/…` | GET `/me` | PR #47 |

### Exclusiones: sólo v1 (§4)

Con una clave `sun_` responden `V2_KEY_NOT_SUPPORTED` antes de llamar.

| Comando | v1 | Por qué |
|---|---|---|
| `config solarform advanced init-default` | POST `/solar/solar-form/config/default/advanced/:clientUid` (cabecera `suntropy-auth`) | Superadministración sobre otro tenant |
| `solarform statistics --create` | POST `/solar/solar-form/solar-form-statistics?statsId` | Telemetría anónima del widget |
| `solarform statistics --update` | PUT `/solar/solar-form/solar-form-statistics` | Ídem, y el tenant sale del body |

Sin llamadas HTTP (iguales con cualquier credencial): `curves *`, `config set|get|list|create-profile|use`, `studies init|validate|set name|market|client|prices|phase|economics|batteries|data|add surface|remove surface|add-comment` y `command-profile`.

## Diferencias permitidas en la salida (§1.8)

La prueba de paridad (`npm run parity`) las ignora: autoría de lo creado con la clave (`creationUserUID`, `lastEditUserUID`, `ownerUserUID`, `uploadedByUserUID`, `assignedUserUID`, `isOwner`, `canEdit`), `password`/`passwordConfirm` de los shareables, el registro `client` del tema, los proyectos `PRIVATE` de personas (no se ven con una clave), `--credit-amount` y los valores numéricos de `solar-production` hasta que A5 esté desplegado.

## Pruebas

- `test/parity-*.test.ts`: cada grupo de comandos con un servidor falso que responde a las dos versiones (respuestas en `test/fixtures/*.json`). Comprueban método, ruta, query y body de cada versión, y que la salida JSON es la misma.
- `scripts/parity/`: el arnés contra un backend real (ver su README).
