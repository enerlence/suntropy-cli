Referencia de `suntropy satvolt`, los comandos de la CLI de Suntropy para las campañas de captación de leads de Satvolt. Úsala para saber qué comando hace qué, con qué opciones y qué devuelve. Para procesos completos, usa las skills de workflow: `satvolt-campaign`, `satvolt-probe-to-full-campaign` y `satvolt-lead-troubleshooting`.

## Conexión

`suntropy satvolt` llama a la API pública de Satvolt con el mismo token que el resto de la CLI.

| Entorno | `--server` (o perfil) | URL a la que llama |
|---|---|---|
| Producción | `https://api.enerlence.com` | `https://api.enerlence.com/satvolt/api/v1` |
| Local | `http://localhost` | `http://localhost:8099/api/v1` (el puerto del servidor se ignora) |

```bash
suntropy auth set-key --key <jwt>            # o SUNTROPY_API_KEY=<jwt>, o --token <jwt>
suntropy --profile dev satvolt campaigns list
```

El token es un JWT con `clientUID`. Todo queda acotado a la empresa del token. Con `401 TOKEN_EXPIRED` hay que renovar el token.

## Opciones globales y formato

| Opción | Uso |
|---|---|
| `--format json\|human\|csv` | `json` por defecto (lo mejor para agentes); `human` imprime tablas y resúmenes |
| `--fields a,b` | Selecciona campos del resultado |
| `--save <fichero>` | Guarda la salida (útil con `config get`, `templates get`, `export-tables get`) |
| `--server`, `--profile`, `--token` | Destino y credenciales |

- **Argumentos JSON** (`--steps`, `--config`, `--data`, `--columns`, `--polygon`): aceptan JSON en línea, `@fichero.json` o `-` para leer de stdin.
- **Errores:** salen por stderr como `{"error":true,"message","status","code","details"}` y el comando termina con código ≠ 0. Decide qué hacer según el `code`, no según el texto.
- **Permisos:** la CLI puede estar limitada a un nivel (`SUNTROPY_COMMAND_PROFILE`). En `read` no aparecen los comandos que cambian datos. `write` añade `create`, `update`, `patch`, `set`, `add`, `remove`, `start`, `resume`, `run`, `run-step`, `extend` y `duplicate`. `delete` añade `delete` y `reset`.

## Conceptos que hay que tener claros

- **Pasos del pipeline:**
  - Solo se definen los pasos LEAD. SECTORIZE, FIND_LEADS y COMPLETE los pone el backend; en `config get` salen con `structural: true`.
  - Cada paso tiene un `uid`, que es su identidad: los parches, `steps set`, `leads run-step` y las claves de fullData (`qualification_<uid>`, `aiAgent_<uid>`) lo usan.
  - Una acción puede ir en lugar del uid solo si aparece una vez en el pipeline. Si no, el error es `AMBIGUOUS_STEP` y lista los uids.
  - `catalog actions` da de cada acción los créditos por lead, las dependencias, si admite repetirse (`multiple`) y el JSON Schema de su `config`.
  - Los valores `default` se rellenan solos. Las dependencias que falten se añaden y se avisa en `warnings`.
- **Créditos:** 1 crédito = 0,005 €. `estimatedCreditsPerLead` al crear es el máximo, como si todos los leads pasaran todos los pasos; los filtros (QUALIFY) lo reducen. El consumo real por lead lo da `campaigns usage`.
- **Estados:** consulta `catalog states`.
  - Campaña: `queued` → `inProgress` → `completed`, `failed`, `paused` o `canceled`.
  - Lead: `pending` → estados intermedios (`rooftopFound`, `qualified`, `consumptionEstimated`…) → `completed`, `unQualified` o `failed`.
- **Área:** círculo de 100 m a 50 km, rectángulo o polígono. El polígono se busca en su rectángulo envolvente y devuelve un aviso.

## Catálogo

| Comando | Devuelve |
|---|---|
| `catalog actions` | Acciones LEAD: `creditCost`, `isAsync`, `multiple`, `dependencies`, `resultsPropertyKeys`, `configSchema` |
| `catalog ai-agents` | Agentes válidos para `AI_AGENT.config.agentId` |
| `catalog business-groups` | Grupos de negocio para `--business-groups` (`businesses` = solo negocios) |
| `catalog states` | Estados de campaña y de lead |

## Plantillas (`templates`)

Una plantilla guarda todo lo que define una campaña salvo el nombre y el área: los pasos con sus uids, los grupos de negocio, la descripción de la configuración, la consulta de texto y el límite de leads. Se referencian por id o por nombre exacto.

| Comando | Qué hace |
|---|---|
| `templates list [--search t]` | Lista las plantillas |
| `templates get <id\|nombre>` | Detalle con pasos y config |
| `templates create --name N --from-campaign <id> [--description t]` | Guarda como plantilla la configuración de una campaña de Maps |
| `templates create --name N --steps @steps.json [--business-groups ids] [--max-leads n] [--search-query t] [--configuration-description t]` | Crea una plantilla desde JSON |
| `templates update <id\|nombre> --data @t.json` | PUT: la sustituye entera (los pasos son obligatorios) |
| `templates patch <id\|nombre> [--name] [--description] [--steps @parches] [--business-groups ids] [--max-leads n \| --no-max-leads] [--search-query t]` | Cambios sueltos; los pasos se modifican con parches por uid |
| `templates delete <id\|nombre> --yes` | Borra la plantilla (las campañas creadas desde ella no cambian) |

`TEMPLATE_NAME_TAKEN` (409) significa que ya existe una plantilla con ese nombre.

## Campañas (`campaigns`)

| Comando | Qué hace |
|---|---|
| `campaigns list [--state a,b] [--search t] [--source maps\|excel\|campaign] [--limit/--offset]` | Lista, las más recientes primero |
| `campaigns get <id>` | Detalle: área, leads por estado, `sectorSearch` y configuración |
| `campaigns create --name N <área> [base] [opciones]` | Crea una campaña de Maps en cola (`--start` la arranca) |
| `campaigns start <id>` | Arranca una campaña `queued` (gasta créditos) |
| `campaigns logs <id> [--level error] [--since ts] [--follow]` | Logs de procesamiento (30 días, 5.000 entradas); `--follow` termina solo |
| `campaigns funnel <id>` | Por paso: alcanzados, success, failure, skipped, processing y pending |
| `campaigns usage <id> [--by-lead]` | Créditos cobrados (regla de la pestaña Usage) |
| `campaigns extend <id> --max-leads N \| --no-limit` | Más leads sin relanzar: solo busca en los sectores pendientes |
| `campaigns resume <id> --action A [--config json]` | Añade un paso al final y lo ejecuta sobre los leads existentes |
| `campaigns reset <id> --yes [--start]` | Borra leads y resultados y vuelve a `queued` (se vuelve a pagar todo) |
| `campaigns delete <id> --yes` | Borra la campaña con todo lo que generó |

**Opciones de `create`:**

| Grupo | Opciones |
|---|---|
| Área (una) | `--circle lat,lng --radius m`, `--bounds nwLat,nwLng,seLat,seLng` o `--polygon json\|@geojson` |
| Base (opcional, una) | `--template <id\|nombre>` o `--from-campaign <id>`: aporta pasos, grupos, descripción, consulta y límite, y los flags explícitos tienen prioridad |
| Pipeline | `--steps @steps.json`, `--business-groups ids`, `--description t` |
| Búsqueda | `--search-query t` (búsqueda por texto en vez de por cercanía), `--max-leads n` |
| Otros | `--address t`, `--region t`, `--start`, `--data @body.json` |

La respuesta trae `campaign.idCampaign`, `configuration`, `estimatedCreditsPerLead`, `basedOn` y `warnings`.

**`extend`:**
- La campaña tiene que ser de Maps, estar ya ejecutada y no estar en marcha.
- El nuevo límite tiene que ser mayor que los leads actuales.
- Los sectores agotados no se vuelven a buscar; solo los leads nuevos pasan por el pipeline.
- En `campaigns get`, `sectorSearch.incomplete + unknown > 0` indica que todavía se pueden encontrar más leads.
- Errores: `CAMPAIGN_RUNNING`, `CAMPAIGN_NOT_STARTED`, `UNSUPPORTED_SOURCE`, `VALIDATION_ERROR`.

## Configuración del pipeline (`config`, `steps`)

| Comando | Qué hace |
|---|---|
| `config get <id> [--save f]` | `{campaignId, source, businessGroups, description, steps[]}` |
| `config update <id> --data @cfg.json` | PUT: lista completa de pasos editables (se puede reenviar lo que devuelve `config get`) |
| `config patch <id> --data @patch.json` | PATCH por uid: `{uid, config}` fusiona (`null` devuelve la clave a su default), `{uid, remove:true}` borra, `{action, config}` añade, `before`/`after` mueven, `disable` desactiva |
| `steps list <id>` | Pasos con créditos, `executedLeads`, `runnable` y `reason` |
| `steps add <id> --action A [--config j] [--before uid \| --after uid] [--disabled]` | Añade un paso (antes de COMPLETE por defecto) |
| `steps set <id> <uid> [--config j] [--replace-config] [--enable\|--disable] [--before\|--after uid]` | Edita o mueve un paso |
| `steps remove <id> <uid>` | Quita un paso |
| `steps run <id> <uid>` | Ejecuta sobre los leads existentes un paso que ningún lead ha ejecutado y continúa el pipeline |

Si la campaña está en marcha, cambiar el orden o quitar pasos devuelve un aviso: los leads que están a mitad podrían quedarse sin paso siguiente.

## Leads (`leads`)

| Comando | Qué hace |
|---|---|
| `leads list <id> [--name t] [--search t] [--state a,b] [--step uid\|ACCIÓN] [--step-status s] [--with-steps] [--limit/--offset/--page]` | Lista paginada con estado, `stateError`, última acción y veredictos de QUALIFY |
| `leads get <id> <leadId> [--full-data [claves]]` | Detalle: estado de cada paso, historial y claves de fullData |
| `leads full-data <id> <leadId> [--keys a,b] [--path a.b.c]` | Solo el fullData, o un valor concreto |
| `leads run-step <id> <leadId> <uid\|ACCIÓN> [--continue] [--force]` | Ejecuta un paso en un lead |
| `leads fields <id> [--sample n]` | Rutas disponibles para columnas de exportación, con tipo, cobertura y ejemplo |

`--step-status` admite `reached` (por defecto), `success`, `failure`, `skipped`, `processing` o `pending`.

**`run-step`:**
- Pasa por la misma cola que el pipeline y cobra los créditos del paso.
- **Modo por defecto (solo ese paso):** no encola los siguientes. Un lead `completed` o `unQualified` conserva su estado, salvo que el paso cambie el resultado del filtro.
- **`--continue`:** sigue el pipeline desde ese paso, así que vuelve a ejecutar y cobrar los pasos posteriores.
- **Dependencias:** sin `--force`, exige que el lead haya completado las dependencias del paso.
- Errores: `DEPENDENCY_NOT_MET`, `STEP_IN_PROGRESS` (un paso asíncrono aún esperando), `STEP_NOT_RUNNABLE`, `LEAD_NOT_FOUND`, `AMBIGUOUS_STEP`.

## Tablas de exportación (`export-tables`)

| Comando | Qué hace |
|---|---|
| `export-tables list <campaignId>` | Tablas de la campaña |
| `export-tables get <tableId>` | Definición con columnas |
| `export-tables create <campaignId> --name N --columns "Etiqueta=ruta[:tipo];..."` | Crea una tabla. Tipos: `string`, `number`, `boolean`, `date`, `url` |
| `export-tables update <tableId> --data @t.json` | PUT (conserva los `id` de las columnas) |
| `export-tables patch <tableId> [--name] [--columns] [--add-columns] [--remove-columns ids\|etiquetas]` | Cambios sueltos |
| `export-tables duplicate <tableId> --campaign <id> [--name]` | Copia la tabla a otra campaña |
| `export-tables data <tableId> [--limit ≤500] [--offset] [--search]` | Filas con los valores de las columnas |
| `export-tables export <tableId> --file-format xlsx\|csv [--out f]` | Descarga todas las filas (hasta 100.000) |
| `export-tables delete <tableId>` | Borra la tabla (sin confirmación: pregúntale antes al usuario) |

- **Rutas de columna:** `lead.<columna>`, `synthetic.<clave>` (por ejemplo `synthetic.googleMapsUrl`) y `fullData.<ruta>` (por ejemplo `fullData.consumptionEstimate.annualKwh`). Se descubren con `leads fields`.
- **Tablas entre campañas:** las campañas de una misma plantilla comparten uids, así que una tabla con `fullData.qualification_<uid>` se puede duplicar entre ellas.

## Códigos de error frecuentes

| Código | Qué hacer |
|---|---|
| `VALIDATION_ERROR` (400/422) | Corrige el cuerpo; `details[]` indica `index`, `uid`, `field` y `message` |
| `INVALID_AREA` | Área mal formada o fuera de límites |
| `CAMPAIGN_NOT_FOUND`, `LEAD_NOT_FOUND`, `TEMPLATE_NOT_FOUND`, `EXPORT_TABLE_NOT_FOUND` | Id inexistente o de otra empresa |
| `INVALID_CAMPAIGN_STATE` | `start` solo funciona sobre campañas `queued` |
| `CAMPAIGN_RUNNING` / `CAMPAIGN_NOT_STARTED` | Espera a que termine, o arráncala primero |
| `PENDING_STEP`, `NO_LEADS`, `STEP_NOT_RUNNABLE` | Condiciones de `resume` y `steps run` no cumplidas; lee `message` |
| `AMBIGUOUS_STEP` | Usa uno de los uids de `details` |
| `DEPENDENCY_NOT_MET` | Ejecuta antes la dependencia o usa `--force` |
| `STEP_IN_PROGRESS` | Espera a que llegue el webhook del paso asíncrono |
| `UNSUPPORTED_SOURCE` | La operación solo vale para campañas de Google Maps |
| `TOKEN_EXPIRED`, `INVALID_TOKEN`, `MISSING_TOKEN` | Renueva o configura el token |
