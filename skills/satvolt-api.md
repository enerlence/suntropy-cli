Referencia de la API pública HTTP de Satvolt (`/api/v1`), la misma que usa `suntropy satvolt`. Úsala para integrar Satvolt desde código o `curl`: crear y configurar campañas, seguirlas, ampliarlas, leer y exportar leads, gestionar plantillas y consultar el consumo de créditos. Si tienes la CLI a mano, es más cómodo `satvolt-cli`.

## Base, autenticación y formato

| Entorno | Base URL |
|---|---|
| Producción | `https://api.enerlence.com/satvolt/api/v1` |
| Local | `http://localhost:8099/api/v1` |

- **Autenticación:** `Authorization: Bearer <JWT>`, el mismo token de Suntropy. Se verifican la firma y la caducidad, y todo queda acotado al `clientUID` del token.
  - `401 MISSING_TOKEN`: falta la cabecera.
  - `401 INVALID_TOKEN`: el token no es válido.
  - `401 TOKEN_EXPIRED`: el token ha caducado.
  - `401 MISSING_CLIENT`: el token no trae `clientUID`.
- **Respuestas:** con el código HTTP real y un sobre:
  - éxito: `{ "code": 200, "data": ... }`
  - error: `{ "code": 422, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }`
- **Paginación:** `?limit=` (25 por defecto, 200 como máximo; 500 en `export-tables/:id/data`) y `?offset=`. La respuesta trae `{ items, total, limit, offset, hasMore }`.
- **Campañas de otra empresa:** devuelven `404 CAMPAIGN_NOT_FOUND`, igual que un id inexistente.

```bash
API=https://api.enerlence.com/satvolt/api/v1
curl -s -H "Authorization: Bearer $TOKEN" "$API/campaigns?state=completed&limit=10"
```

## Catálogo

| Método | Ruta | Devuelve |
|---|---|---|
| GET | `/catalog/actions` | Acciones LEAD visibles: `action`, `name`, `description`, `multiple`, `isAsync`, `creditCost`, `finalLeadState`, `dependencies`, `resultsPropertyKeys`, `configSchema` (JSON Schema) |
| GET | `/catalog/ai-agents` | Agentes válidos para `AI_AGENT.config.agentId` |
| GET | `/catalog/business-groups` | Grupos para `businessGroups` |
| GET | `/catalog/states` | Estados de campaña y de lead |

## Campañas

| Método | Ruta | Parámetros / body |
|---|---|---|
| GET | `/campaigns` | `?limit&offset&search&state=a,b&source=maps\|excel\|campaign` |
| POST | `/campaigns` | Crear (ver abajo) |
| GET | `/campaigns/:id` | Detalle con `leadStates`, `sectorSearch` y `configuration` |
| DELETE | `/campaigns/:id` | Borra la campaña con sectores, leads, ejecuciones, configuración y jobs |
| POST | `/campaigns/:id/start` | Arranca una campaña `queued` (`409 INVALID_CAMPAIGN_STATE` si no lo está) |
| POST | `/campaigns/:id/reset` | `?start=true` para relanzarla. Borra leads y resultados |
| POST | `/campaigns/:id/extend` | `{ "maxLeads": 500 }` o `{ "maxLeads": null }` para quitar el límite |
| POST | `/campaigns/:id/resume` | `{ "step": { "action": "AI_AGENT", "config": {...} } }`: lo añade al final y lo ejecuta sobre los leads |
| GET | `/campaigns/:id/usage` | `?include=leads`: créditos totales, por paso y, opcionalmente, por lead |
| GET | `/campaigns/:id/logs` | `?limit&sinceTs&level=debug\|log\|warn\|error` → `{ entries, lastTs }` |
| GET | `/campaigns/:id/funnel` | Por paso LEAD: `reached`, `success`, `failure`, `skipped`, `processing` y `pending`, más `leadStates` |

### Crear campaña

```json
POST /campaigns
{
  "name": "Sonda Huévar",
  "area": { "type": "circle", "center": { "lat": 37.3509, "lng": -6.2757 }, "radiusMeters": 5000 },
  "templateId": "Greenvolt industria",
  "maxLeads": 50,
  "start": false
}
```

- **`area`** admite tres formas:
  - `{type:"circle", center, radiusMeters}`, de 100 m a 50 km;
  - `{type:"bounds", northWest, southEast}`;
  - `{type:"polygon", coordinates:[[lat,lng],...]}`, que se busca en su rectángulo envolvente (con aviso).

  Los puntos pueden ir como `{lat,lng}` o `[lat,lng]`.
- **Base opcional:** `templateId` (id o nombre) o `fromCampaignId` (una campaña de Maps). Aporta `steps`, `businessGroups`, `description`, `searchQuery` y `maxLeads`; lo que se envía explícitamente tiene prioridad. No se pueden usar las dos a la vez.
- **Resto de campos:**
  - `steps` son solo los pasos LEAD `[{action, config?, uid?, disable?}]`. Se validan contra `configSchema`, se rellenan los `default` y se añaden las dependencias que falten, con aviso.
  - `businessGroups` es `["businesses"]` por defecto si no hay base.
  - Opcionales: `searchQuery`, `description`, `inputAddress` y `region`.
- **Respuesta:** `{ campaign, area, configuration, estimatedCreditsPerLead, basedOn, started, warnings }`.
- **Errores:** `422 VALIDATION_ERROR` trae en `details[]` el `index`, `uid`, `action`, `field` y `message` de cada problema. Otros: `400 INVALID_AREA`, `404 TEMPLATE_NOT_FOUND`, `400 UNSUPPORTED_SOURCE`.

### Ampliar (`extend`)

- **Qué hace:** guarda el nuevo límite y vuelve a buscar solo en los sectores cuya búsqueda no se agotó. Solo los leads nuevos pasan por el pipeline.
- **Respuesta:** `{ campaignId, previousMaxLeads, maxLeads, currentLeads, sectors: {total, queued, exhausted}, started, campaign }`.
- **Si no queda nada que buscar:** `sectors.queued = 0`. El límite se guarda, pero no se busca nada.
- **Errores:**
  - `409 CAMPAIGN_RUNNING`: la campaña está en marcha o tiene búsquedas en cola.
  - `409 CAMPAIGN_NOT_STARTED`: todavía está `queued`.
  - `400 UNSUPPORTED_SOURCE`: no es de Maps.
  - `400 VALIDATION_ERROR`: el límite no es mayor que los leads actuales.
- **Cuándo tiene sentido:** en `GET /campaigns/:id`, `sectorSearch` da `{ total, exhausted, incomplete, queued, unknown }`. Con `incomplete + unknown > 0` todavía puede aparecer algo.

## Pipeline

| Método | Ruta | Body |
|---|---|---|
| GET | `/campaigns/:id/configuration` | → `{ campaignId, source, businessGroups, description, updatedAtMs, steps[{uid, action, target, disable, structural, config}] }` |
| PUT | `/campaigns/:id/configuration` | `{ steps: [...lista completa de pasos LEAD...], businessGroups?, description? }`. Los estructurales se ignoran, así que se puede reenviar lo que devuelve el GET |
| PATCH | `/campaigns/:id/configuration` | `{ steps: [parche, ...], businessGroups?, description? }` |
| GET | `/campaigns/:id/steps` | Pasos con `name`, `creditCost`, `isAsync`, `executedLeads`, `neverExecuted`, `runnable` y `reason` |
| POST | `/campaigns/:id/steps/:uid/run` | Ejecuta sobre los leads existentes un paso que ningún lead ha ejecutado |

**Formas de parche** (en `PATCH configuration` y `PATCH campaign-templates`):

| Parche | Efecto |
|---|---|
| `{ "uid": "…", "config": { "k": "v", "otra": null } }` | Fusiona (JSON Merge Patch); `null` devuelve la clave a su default |
| `{ "uid": "…", "replaceConfig": true, "config": {...} }` | Sustituye la config entera |
| `{ "uid": "…", "disable": true }` | Desactiva el paso |
| `{ "uid": "…", "before": "<uid>" }` / `"after"` | Mueve el paso |
| `{ "uid": "…", "remove": true }` | Lo quita |
| `{ "action": "QUALIFY", "config": {...} }` (sin uid) | Lo añade antes de COMPLETE, o donde indiquen `before`/`after` |

La `action` de un paso existente no se puede cambiar. Si la campaña está en marcha, cambiar el orden o quitar pasos devuelve un aviso.

## Leads

| Método | Ruta | Parámetros |
|---|---|---|
| GET | `/campaigns/:id/leads` | `?limit&offset&name&search&state=a,b&step=<uid\|ACCIÓN>&stepStatus=reached\|success\|failure\|skipped\|processing\|pending&include=steps` |
| GET | `/campaigns/:id/leads/:leadId` | `?fullData=true` (todo) o `?fullData=clave1,clave2` |
| POST | `/campaigns/:id/leads/:leadId/steps/:step/run` | `{ "mode": "only" \| "continue", "force": false }` → 202 |
| GET | `/campaigns/:id/fields` | `?sample=100`: rutas para columnas de exportación, con tipo, cobertura y ejemplo |

**Cada lead de la lista** trae `idLead`, `commercialName`, `state`, `stateError`, `lastAction`, `lastStepUid`, `address`, `phone`, `url`, `googlePlacesType`, `coordinates`, `qualifications` y, con `include=steps`, `steps`.

**Ejecutar un paso en un lead:**
- **`step`:** el uid, o la acción si aparece una vez (`400 AMBIGUOUS_STEP` lista los uids).
- **`mode: "only"`:** solo ese paso. No encola los siguientes, y un lead `completed` o `unQualified` conserva su estado salvo que cambie el resultado del filtro.
- **`mode: "continue"`:** sigue el pipeline desde ese paso y vuelve a ejecutar los posteriores.
- **Respuesta:** `{ campaignId, leadId, stepUid, action, mode, jobId, isAsync, name, creditCost }`.
- **Errores:**
  - `409 DEPENDENCY_NOT_MET` (con `details.missing`): faltan dependencias; `force: true` las ignora.
  - `409 STEP_IN_PROGRESS`: un paso asíncrono sigue esperando su webhook.
  - `400 STEP_NOT_RUNNABLE`: COMPLETE, paso desactivado o que no es LEAD.
  - `404 LEAD_NOT_FOUND`.
  - `409 CAMPAIGN_NOT_STARTED`.

## Tablas de exportación

| Método | Ruta | Body / parámetros |
|---|---|---|
| GET | `/campaigns/:id/export-tables` | Tablas de la campaña |
| POST | `/campaigns/:id/export-tables` | `{ name, description?, columns: [{ id?, label, path, type }] }` |
| GET | `/export-tables/:tableId` | Definición |
| PUT | `/export-tables/:tableId` | `{ name, description?, columns }` (lista completa; conserva los `id`) |
| PATCH | `/export-tables/:tableId` | `{ name?, description?, columns? }` |
| DELETE | `/export-tables/:tableId` | Borra la tabla |
| POST | `/export-tables/:tableId/duplicate` | `{ targetCampaignId, name? }` |
| GET | `/export-tables/:tableId/data` | `?limit(≤500)&offset&search` → `{ columns, items, total, ... }` |
| GET | `/export-tables/:tableId/export` | `?format=xlsx\|csv` → fichero; cabeceras `Content-Disposition` y `X-Row-Count` |

- **Rutas de columna:** `lead.<columna>`, `synthetic.<clave>` y `fullData.<ruta.anidada>`. Las válidas salen de `/campaigns/:id/fields`.
- **Tipos:** `string`, `number`, `boolean`, `date` y `url`.
- **Errores:** `404 EXPORT_TABLE_NOT_FOUND` si el id no existe (o no es un ObjectId) y `400 VALIDATION_ERROR` si alguna ruta es inválida.

## Plantillas de campaña

| Método | Ruta | Body |
|---|---|---|
| GET | `/campaign-templates` | `?search=` |
| GET | `/campaign-templates/:idOrName` | Detalle |
| POST | `/campaign-templates` | `{ name, description?, steps, businessGroups?, configurationDescription?, searchQuery?, maxLeads? }` o `{ fromCampaignId, name, description? }` |
| PUT | `/campaign-templates/:idOrName` | Plantilla completa (`steps` obligatorio; lo que no se envía se borra) |
| PATCH | `/campaign-templates/:idOrName` | Campos sueltos; `steps` son parches por uid; `maxLeads: null` o `searchQuery: null` quitan el valor |
| DELETE | `/campaign-templates/:idOrName` | Borra la plantilla |

- **Vista:** `{ id, name, description, source, steps[{uid, action, target, disable, config}], businessGroups, configurationDescription, searchQuery, maxLeads, sourceCampaignId, createdAtMs, updatedAtMs }`.
- **Errores:** `409 TEMPLATE_NAME_TAKEN` y `404 TEMPLATE_NOT_FOUND`.
- **uids compartidos:** las campañas creadas desde la misma plantilla comparten uids de pasos.

## Ejemplo de principio a fin con curl

```bash
H="Authorization: Bearer $TOKEN"; J="Content-Type: application/json"
# 1. Plantilla desde una campaña validada
curl -s -X POST "$API/campaign-templates" -H "$H" -H "$J" -d '{"fromCampaignId":62,"name":"Greenvolt industria"}'
# 2. Sonda de 50 leads y arranque
ID=$(curl -s -X POST "$API/campaigns" -H "$H" -H "$J" -d '{"name":"Sonda Elche","templateId":"Greenvolt industria","maxLeads":50,
  "area":{"type":"circle","center":{"lat":38.293,"lng":-0.617},"radiusMeters":3000},"start":true}' | jq -r .data.campaign.idCampaign)
# 3. Seguimiento
curl -s -H "$H" "$API/campaigns/$ID/funnel" | jq '.data.steps[] | {name, success, failure, pending}'
# 4. Ampliar cuando termine y quede área por buscar
curl -s -X POST "$API/campaigns/$ID/extend" -H "$H" -H "$J" -d '{"maxLeads":null}'
# 5. Créditos consumidos
curl -s -H "$H" "$API/campaigns/$ID/usage" | jq '.data | {totalCredits, avgCreditsPerLead, byStep}'
```
