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
| Pasos del pipeline (acciones y su config) | No | ninguno: solo descubre leads |
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
```

La respuesta trae `campaign.idCampaign`, `estimatedCreditsPerLead` y `warnings`. La campaña queda en `queued`.

Coste estimado ≈ `estimatedCreditsPerLead × maxLeads` (sin contar FIND_LEADS). Enséñalo antes de arrancar.

### Paso 3: Arrancar y seguir

```bash
suntropy satvolt campaigns start <campaignId>
suntropy satvolt campaigns logs <campaignId> --follow --format human   # termina solo al acabar la campaña
suntropy satvolt campaigns funnel <campaignId> --format human           # alcanzados/success/failure/processing por paso
```

### Paso 4: Revisar leads

```bash
suntropy satvolt leads list <campaignId> --limit 50 --format human
suntropy satvolt leads list <campaignId> --name "logística"
suntropy satvolt leads list <campaignId> --step QUALIFY --step-status failure   # uid del paso si la acción se repite
suntropy satvolt leads list <campaignId> --step <uid> --step-status pending
suntropy satvolt leads get <campaignId> <leadId> --full-data consumptionEstimate,qualification_<uid>
```

`--step-status`: `reached` (por defecto), `success`, `failure`, `skipped`, `processing` o `pending`.

### Paso 5: Tabla de exportación

Descubre qué datos hay antes de definir columnas:

```bash
suntropy satvolt leads fields <campaignId> --format human    # path, tipo, cobertura y ejemplo
```

```bash
suntropy satvolt export-tables create <campaignId> --name "CRM" \
  --columns "Empresa=lead.commercialName;Teléfono=lead.phone;Web=lead.url:url;Consumo anual kWh=fullData.consumptionEstimate.annualKwh:number;Maps=synthetic.googleMapsUrl:url"

suntropy satvolt export-tables data <tableId> --limit 20 --format human
suntropy satvolt export-tables export <tableId> --file-format xlsx --out campaña.xlsx
suntropy satvolt export-tables export <tableId> --file-format csv --out campaña.csv
```

Tipos de columna: `string`, `number`, `boolean`, `date`, `url`.

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
suntropy satvolt campaigns resume <campaignId> --action AI_AGENT --config @agent.json
```

Si se añadió antes un paso con `steps add` y nunca se ejecutó, `steps list` lo marca con `runnable: true`. Se lanza con:

```bash
suntropy satvolt steps run <campaignId> <uid>
```

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

### Consumo y reinicio

```bash
suntropy satvolt campaigns usage <campaignId> --format human   # créditos totales, por lead y por paso
suntropy satvolt campaigns reset <campaignId> --yes [--start]  # BORRA leads y resultados; pide confirmación explícita al usuario
```

## Errores

Los errores salen por stderr como `{ error, status, message, details }`:

| status / código | Significado |
|---|---|
| 422 `VALIDATION_ERROR` | pasos o config inválidos. `details` lista `index`, `uid`, `action`, `field` y `message` de cada problema. |
| 400 `INVALID_AREA` | área mal formada o fuera de límites. |
| 409 `INVALID_CAMPAIGN_STATE` | `start` sobre una campaña que no está en cola: hay que hacer `reset` antes. |
| 409 `PENDING_STEP`, `STEP_NOT_RUNNABLE` | no se puede reanudar; `message` explica por qué. |
| 401 `TOKEN_EXPIRED` | renueva el token con `suntropy auth refresh`. |
