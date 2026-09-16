Crea, configura y explota una campaña de Satvolt (captación de leads B2B desde Google Maps con un pipeline de enriquecimiento) usando `suntropy satvolt`. Todo lo que aquí se hace es lo mismo que permite la web de Satvolt; la CLI habla con la API pública `/satvolt/api/v1` con el mismo token de `suntropy auth`.

Cada acción del pipeline gasta créditos por lead (1 crédito = 0,005 €). Antes de arrancar o reanudar una campaña, enseña al usuario el coste estimado y pide confirmación.

## Parámetros de entrada

| Parámetro | Obligatorio | Default |
|-----------|-------------|---------|
| Nombre de la campaña | Sí | - |
| Área: centro + radio, rectángulo o polígono | Sí | - |
| Consulta de texto (en vez de búsqueda por cercanía) | No | - |
| Máximo de leads | No | sin límite |
| Grupos de negocio | No | `businesses` |
| Plantilla o campaña base (pasos, grupos, límite) | No | - |
| Pasos del pipeline (acciones y su config) | No | los de la base; sin base, ninguno (solo descubre leads) |
| Arrancar al crear | No | no (queda en cola) |

## Ejecución

### Paso 0: Catálogo

```bash
suntropy satvolt catalog actions            # acciones, créditos por lead, dependencias y JSON Schema de config
suntropy satvolt catalog business-groups
suntropy satvolt catalog ai-agents          # ids válidos para AI_AGENT config.agentId
```

Reglas del catálogo:
- `configSchema.required` son obligatorios en pasos activos; los `default` se rellenan solos.
- Solo las acciones con `multiple: true` (QUALIFY, AI_AGENT, CUSTOM_WEBHOOK) pueden repetirse.
- Si falta una dependencia (p. ej. ESTIMATE_CONSUMPTION necesita FIND_ROOFTOP), el backend la añade y lo avisa en `warnings`.

### Paso 1: Pasos del pipeline

Si ya hay una plantilla o una campaña con el pipeline que se quiere, úsala como base y sáltate este paso (`templates list`, `--template` o `--from-campaign` en el paso 2). Si el pipeline es nuevo y se va a repetir, guárdalo como plantilla: `templates create --name ... --steps @steps.json`.

Escribe los pasos LEAD en orden en un fichero. SECTORIZE, FIND_LEADS y COMPLETE los pone el backend:

```bash
cat > steps.json <<'EOF'
[
  { "action": "FIND_ROOFTOP" },
  { "action": "QUALIFY", "config": { "qualificationDefinition": "Nave industrial con cubierta > 1000 m2 y actividad con consumo diurno" } },
  { "action": "AI_AGENT", "config": { "customName": "Buscador de CIF y Facturacion", "agentId": "<id>", "outputKey": "cif" } },
  { "action": "ESTIMATE_CONSUMPTION", "config": { "tariffTemplate": "3.0TD", "cnaeTemplate": "{{fullData.cif.response.extras.cnae}}" } }
]
EOF
```

ESTIMATE_CONSUMPTION usa la superficie construida del Catastro, el código postal y, si se le pasa, el CNAE. Sin CNAE la confianza no pasa de "media" y la estimación anual de los fabricantes sale muy por debajo. Colócalo después del paso que obtiene el CNAE y referencia su salida en `cnaeTemplate`.

### Paso 2: Crear la campaña

```bash
# Círculo (100 m – 50 km)
suntropy satvolt campaigns create --name "<nombre>" \
  --circle <lat>,<lng> --radius <metros> \
  --max-leads 300 --steps @steps.json

# Rectángulo
suntropy satvolt campaigns create --name "<nombre>" --bounds <nwLat>,<nwLng>,<seLat>,<seLng> --steps @steps.json

# Polígono ([[lat,lng],...] o GeoJSON). Se busca en su rectángulo envolvente: avisa al usuario.
suntropy satvolt campaigns create --name "<nombre>" --polygon @area.geojson --steps @steps.json

# Desde una plantilla o copiando otra campaña (los flags explícitos tienen prioridad)
suntropy satvolt campaigns create --name "<nombre>" --template "<plantilla>" --circle <lat>,<lng> --radius <m>
suntropy satvolt campaigns create --name "<nombre>" --from-campaign <id> --bounds <nwLat>,<nwLng>,<seLat>,<seLng> --max-leads 100
```

La respuesta trae `campaign.idCampaign`, `estimatedCreditsPerLead` y `warnings`. La campaña queda en `queued`.

Coste estimado, antes de arrancar:
- **Máximo:** `estimatedCreditsPerLead × maxLeads` (sin contar FIND_LEADS), como si todos los leads pasaran todos los pasos.
- **Realista:** si hay una campaña anterior con la misma configuración, `campaigns usage <id>` → `avgCreditsPerLead × maxLeads`. Los filtros (QUALIFY) hacen que la mayoría de leads no pague los pasos caros.

Enséñale al usuario el rango y pide confirmación. Las ejecuciones fallidas o saltadas no cobran.

### Paso 3: Arrancar y seguir

```bash
suntropy satvolt campaigns start <campaignId>
suntropy satvolt campaigns logs <campaignId> --follow --format human   # termina solo al acabar la campaña
suntropy satvolt campaigns funnel <campaignId> --format human           # alcanzados/success/failure/processing por paso
suntropy satvolt campaigns funnel <campaignId> --mode success           # en cuántos leads el paso trajo el dato
```

**Ejecutar ≠ acertar.** Un agente puede terminar sin error respondiendo que no encontró
nada: el paso cuenta como `success` y la columna se queda vacía. Para medirlo, cada paso
admite dos claves de config comunes:

| Clave | Qué hace |
|---|---|
| `successIf` | Rutas que el paso debe rellenar para contar como útil. Relativas a lo que escribe el paso (en un agente, a su respuesta: `response.linkedinUrl`) o absolutas con `fullData.`/`lead.`. Al ser relativas, sobreviven a copiar la campaña o guardarla como plantilla. |
| `maxRetries` | 0-5. Repite el paso mientras no se cumpla `successIf`. Para pasos no deterministas (agentes, identificación de paneles). Los créditos se cobran una vez por paso, no por intento; agotados los intentos el lead continúa al paso siguiente. |

```bash
suntropy satvolt steps set <campaignId> <stepUid> \
  --config '{"successIf":["response.linkedinUrl"],"maxRetries":2}'
```

El criterio se evalúa sobre los datos actuales del lead, así que se puede cambiar y volver
a medir una campaña ya terminada sin re-ejecutar nada.

### Paso 4: Revisar leads

```bash
suntropy satvolt leads list <campaignId> --limit 50 --format human
suntropy satvolt leads list <campaignId> --name "logística"
suntropy satvolt leads list <campaignId> --step QUALIFY --step-status failure   # uid del paso si la acción se repite
suntropy satvolt leads list <campaignId> --step <uid> --step-status pending
suntropy satvolt leads get <campaignId> <leadId> --full-data consumptionEstimate,qualification_<uid>
suntropy satvolt leads full-data <campaignId> <leadId> --path cif.response.extras.cnae
```

`--step-status`: `reached` (por defecto), `success`, `failure`, `skipped`, `processing` o `pending`.

### Paso 5: Tabla de exportación

Descubre qué campos hay y en qué ruta de `fullData` los deja cada paso. Funciona antes de lanzar la campaña: cada paso lista los campos que declara, y los de un agente se deducen de otra campaña con el mismo agente si esta aún no tiene respuestas.

```bash
suntropy satvolt export-tables fields <campaignId> --format human                # todos, agrupados por paso
suntropy satvolt export-tables fields <campaignId> --step <uid|ACCIÓN> --format human
suntropy satvolt export-tables fields <campaignId> --search cnae --format human   # dónde está un dato
```

Columnas que salen: `group` (paso), `path` (ruta para la columna), `label`, `type`, `source` (`catalog`, `observed`, `otherCampaign`, `dynamic`), `coverage` (leads de la muestra con el dato) y `example`.

```bash
suntropy satvolt export-tables create <campaignId> --name "CRM" \
  --columns "Empresa=lead.commercialName;Teléfono=lead.phone;Web=lead.url;Consumo anual kWh=fullData.consumptionEstimate.annualKwh;Maps=synthetic.googleMapsUrl"

# Ajustar columnas sueltas (por id o etiqueta; posiciones desde 0)
suntropy satvolt export-tables columns add <tableId> --label CIF --path fullData.cif.response.cif --after Empresa
suntropy satvolt export-tables columns set <tableId> "Consumo anual kWh" --label "Consumo (kWh/año)"
suntropy satvolt export-tables columns move <tableId> Maps --position 0
suntropy satvolt export-tables columns remove <tableId> Teléfono
suntropy satvolt export-tables columns list <tableId> --format human

suntropy satvolt export-tables data <tableId> --limit 20 --format human
suntropy satvolt export-tables export <tableId> --file-format xlsx --out campaña.xlsx
suntropy satvolt export-tables export <tableId> --file-format csv --out campaña.csv
```

- **Tipos de columna:** `string`, `number`, `boolean`, `date`, `url`. Sin tipo, se usa el que declara el paso para esa ruta.
- **`warnings` con `UNKNOWN_FULLDATA_KEY`:** ningún paso de la campaña escribe esa clave; revisa la ruta con `export-tables fields`.

### Paso 6: Cambiar el pipeline

```bash
suntropy satvolt steps list <campaignId> --format human
suntropy satvolt steps set <campaignId> <uid> --config '{"enableWebSearch": true}'   # fusiona; null devuelve la clave a su valor por defecto
suntropy satvolt steps add <campaignId> --action AI_AGENT --config @agent.json
suntropy satvolt steps remove <campaignId> <uid>

# JSON completo
suntropy satvolt config get <campaignId> --save pipeline.json
suntropy satvolt config update <campaignId> --data @pipeline.json
```

### Paso 7: Reanudar con un paso nuevo

Para añadir una acción a una campaña terminada sin reprocesarla, usa `resume`. Añade el paso al final y lo lanza sobre los leads que llegaron al paso anterior:

```bash
suntropy satvolt catalog ai-agents --format human     # id, nombre y descripción de cada agente
suntropy satvolt campaigns funnel <campaignId>         # leads que llegaron al último paso: los que pagarán el nuevo
suntropy satvolt campaigns resume <campaignId> --action AI_AGENT \
  --config '{"customName":"Web corporativa","agentId":"<id>","outputKey":"web"}'
```

`--config` es solo el objeto de configuración del paso (el `configSchema` de `catalog actions`), no `{ action, config }`. Coste ≈ leads que llegaron al último paso × `creditCost` de la acción.

Si el `agentId` sale de una variable de shell, no lo metas entre comillas simples (no se expande); usa un fichero:

```bash
cat > agent.json <<EOF
{ "customName": "Web corporativa", "agentId": "$AGENT_ID", "outputKey": "web" }
EOF
suntropy satvolt campaigns resume <campaignId> --action AI_AGENT --config @agent.json
```

Para guardar el pipeline con el paso nuevo en una plantilla, haz `templates create --from-campaign` después del `resume`: la plantilla copia la configuración que tenga la campaña en ese momento.

Si se añadió antes un paso con `steps add` y nunca se ejecutó, `steps list` lo marca con `runnable: true`. Se lanza con:

```bash
suntropy satvolt steps run <campaignId> <uid>
```

Para repetir un paso en leads concretos (p. ej. tras un fallo) usa `leads run-step <campaignId> <leadId> <uid|ACCIÓN>`: solo ese paso, o `--continue` para seguir el pipeline. La skill `satvolt-lead-troubleshooting` detalla cuándo usar cada uno.

### Ampliar una campaña con más leads

Para sacar más leads de una campaña de Maps ya terminada (típico tras una sonda) usa `extend`, no `reset`. `reset` borra los leads y vuelve a pagarlos todos. `extend` sube el límite, o lo quita con `--no-limit`, y vuelve a buscar solo en los sectores que se quedaron a medias. Los leads que ya existen no se reprocesan; solo los nuevos pasan por el pipeline.

```bash
suntropy satvolt campaigns get <campaignId>                  # sectorSearch: incomplete + unknown > 0 → quedan leads por buscar
suntropy satvolt campaigns extend <campaignId> --max-leads 500
suntropy satvolt campaigns extend <campaignId> --no-limit     # barre entero cada sector pendiente
```

- El nuevo límite tiene que ser mayor que los leads actuales. La campaña no puede estar en ejecución (409 `CAMPAIGN_RUNNING`) ni sin arrancar (409 `CAMPAIGN_NOT_STARTED`).
- Coste ≈ leads nuevos × créditos por lead de la campaña (míralo con `campaigns usage`). Enséñaselo al usuario y pide confirmación antes de ampliar.
- En las campañas creadas antes de esta función, los sectores salen como `unknown` y cuentan como pendientes: se repiten sus primeras peticiones a Places, pero los duplicados no se crean.

### Consumo, reinicio y borrado

```bash
suntropy satvolt campaigns usage <campaignId> --format human   # créditos totales, por lead y por paso
suntropy satvolt campaigns reset <campaignId> --yes [--start]  # BORRA leads y resultados; pide confirmación explícita al usuario
suntropy satvolt campaigns delete <campaignId> --yes           # borra la campaña entera; pide confirmación explícita al usuario
```

Para sacar más leads de una campaña ya terminada, usa `extend` (sección anterior), nunca `reset`.

## Errores

Los errores salen por stderr como `{ error, status, message, details }`:

| status / código | Significado |
|---|---|
| 422 `VALIDATION_ERROR` | pasos o config inválidos. `details` lista `index`, `uid`, `action`, `field` y `message` de cada problema. |
| 400 `INVALID_AREA` | área mal formada o fuera de límites. |
| 409 `INVALID_CAMPAIGN_STATE` | `start` sobre una campaña que no está en cola: hay que hacer `reset` antes. |
| 409 `PENDING_STEP`, `STEP_NOT_RUNNABLE` | no se puede reanudar; `message` explica por qué. |
| 401 `TOKEN_EXPIRED` | renueva el token con `suntropy auth refresh`. |
