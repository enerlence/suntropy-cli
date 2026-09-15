Lanza una campaña de Satvolt en dos fases: primero una sonda con pocos leads para validar que el pipeline funciona y da datos útiles, y después la ampliación a toda la zona sin repetir ni volver a pagar lo ya hecho. Todo con `suntropy satvolt`. Es el proceso seguido con la campaña 62 (Huévar del Aljarafe, círculo de 5 km): sonda de 50 leads, corrección de la configuración del consumo, ampliación a 100, verificación y ampliación sin límite.

Ten a mano `satvolt-cli` para las opciones y `satvolt-lead-troubleshooting` si algo falla.

## Parámetros de entrada

| Parámetro | Obligatorio | Default |
|---|---|---|
| Zona: centro y radio, rectángulo o polígono | Sí | - |
| Configuración base: plantilla, campaña anterior o pasos nuevos | Sí | - |
| Nombre de la campaña | No | `<base> Sonda - <municipio>` |
| Leads de la sonda | No | 50 (ver paso 2) |
| Grupos de negocio | No | los de la base |
| Si se amplía y hasta cuántos leads | No | se decide tras validar |

Pide confirmación explícita al usuario antes de cualquier comando que gaste créditos: `start`, `extend`, `steps run`, `leads run-step` y `reset`.

## Paso 1: Elegir la configuración base

```bash
suntropy satvolt templates list --format human
suntropy satvolt campaigns list --state completed --format human
```

- **Si existe una plantilla adecuada:** úsala con `--template "<nombre>"`.
- **Si hay una campaña ya validada:** conviértela en plantilla, para reutilizarla también en la campaña final y en otras zonas.

```bash
suntropy satvolt templates create --name "Greenvolt industria" --from-campaign 59 \
  --description "QUALIFY industria + CIF + LinkedIn + decisor, consumo con CNAE"
```

- **Si no hay base:** escribe los pasos consultando `catalog actions` y crea la plantilla con `--steps @steps.json`.

Revisa la base antes de usarla (`templates get "<nombre>"`). Estos son los fallos de configuración detectados en campañas reales:

| Revisa | Por qué |
|---|---|
| `ESTIMATE_CONSUMPTION` va **después** del paso que obtiene el CNAE y lo referencia en `cnaeTemplate` (p. ej. `{{fullData.cif.response.extras.cnae}}` del agente "Buscador de CIF") | Sin CNAE la confianza no pasa de "media" y el consumo de los fabricantes sale muy por debajo (mediana ×1,77 al añadirlo) |
| `businessGroups` no vacío (p. ej. `businesses`) | Con `[]` entran cementerios, iglesias, gasolineras…; QUALIFY los descarta, pero cada uno ya ha pagado FIND_ROOFTOP, consumo y QUALIFY |
| `qualificationDefinition` de QUALIFY acotada al objetivo | Si incluye "restaurantes, hoteles…", en los cascos urbanos cualifican bares sin CIF ni LinkedIn que después pasan por los agentes caros |
| Los agentes caros (55 créditos) van detrás de QUALIFY con `filterUnqualifiedLeads: true` | Así solo los pagan los leads cualificados |

Para corregir la plantilla: `templates patch "<nombre>" --steps '[{"uid":"<uid>","config":{...}}]'`, o `--business-groups businesses`.

## Paso 2: Dimensionar y crear la sonda

**Coste de la sonda.** Estímalo con una campaña anterior con la misma base (`campaigns usage <id>` → `avgCreditsPerLead`). Si no hay ninguna, usa `estimatedCreditsPerLead`, que es el máximo. Coste ≈ leads × créditos/lead × 0,005 €. Enséñale al usuario opciones con su coste:

| Leads | Para qué sirve |
|---|---|
| 20 | Comprobar que no falla nada; casi ningún lead llega a los agentes (cualifica un 25–35 %) |
| 50 | Recomendado: unos 15 leads cualificados recorren todo el pipeline |
| 100 | Estimar con más fiabilidad la tasa de cualificación y la cobertura de CIF y LinkedIn |

```bash
suntropy satvolt campaigns create --name "Greenvolt Sonda - Huévar" \
  --template "Greenvolt industria" \
  --circle 37.3509,-6.2757 --radius 5000 --max-leads 50 \
  --address "41830 Huévar del Aljarafe, Sevilla" --region "Andalucía"
```

- **Qué comprobar en la respuesta:** `basedOn`, que los pasos y uids son los de la base, `warnings` y `estimatedCreditsPerLead`. La campaña queda en `queued`.
- **Sesgo de la muestra:** el área se divide en sectores de 1 km que se buscan de norte a sur, y con `--max-leads` la búsqueda se corta al llenarse. La sonda sale de la franja norte del área, no de toda. Avísalo al usuario. Si lo que interesa es el centro, haz la sonda con un radio pequeño alrededor del punto de interés.

## Paso 3: Arrancar y seguir

```bash
suntropy satvolt campaigns start <id>
suntropy satvolt campaigns logs <id> --level error        # repítelo mientras avanza
suntropy satvolt campaigns funnel <id> --format human
```

- **`logs --follow`** termina solo cuando la campaña pasa a `completed`, `failed` o `canceled`. En un agente, sondea `funnel` o `get` cada 1–3 minutos.
- **Si un paso acumula `failure`:** para y sigue `satvolt-lead-troubleshooting`. Es típico FIND_ROOFTOP con `ECONNREFUSED` porque falta un servicio en local.
- **Pasos asíncronos** (QUALIFY, AI_AGENT): salen como `processing` hasta que llega su webhook. Si alguno se queda en `processing` durante horas, apúntalo: no bloquea al resto.

## Paso 4: Validar la sonda

Revísala con el usuario antes de ampliar. Comprueba:

```bash
suntropy satvolt campaigns get <id>                     # estado, leadStates, sectorSearch
suntropy satvolt campaigns funnel <id> --format human   # tasa de cualificación = QUALIFY success / reached
suntropy satvolt campaigns usage <id> --format human    # créditos reales por lead
suntropy satvolt leads list <id> --state completed --format human
suntropy satvolt leads list <id> --step <uid decisor> --step-status skipped   # cualificados sin LinkedIn de empresa
```

**Calidad del enriquecimiento.** Monta una tabla con las columnas clave y revísala entera:

```bash
suntropy satvolt leads fields <id> --format human
suntropy satvolt export-tables create <id> --name "Validación sonda" --columns \
"Empresa=lead.commercialName;Tipo=lead.googlePlacesType;Estado=lead.state;\
CIF=fullData.cif.response.cif;CNAE=fullData.cif.response.extras.cnae;\
LinkedIn=fullData.companyLinkedin.response.linkedinUrl;\
Consumo kWh=fullData.consumptionEstimate.annualKwh:number;\
Confianza=fullData.consumptionEstimate.confidence.label;\
Parcela=fullData.catastralParcel.catastralReference"
suntropy satvolt export-tables data <tableId> --limit 100 --format human
```

| Señal | Qué suele significar | Acción |
|---|---|---|
| Muchos tipos que no son negocio | `businessGroups` vacío | Pon `businesses` en la configuración o la plantilla |
| Cualifican bares y restaurantes sin CIF | La definición de QUALIFY incluye el terciario | Acótala antes de ampliar |
| Confianza "baja" con 56.431 kWh repetido | El paso no recibió ni CNAE ni superficie | Revisa `cnaeTemplate` y el orden. Las parcelas con varios inmuebles no tienen superficie: es lo esperado |
| Varios leads con la misma `Parcela` y el mismo consumo | FIND_ROOFTOP asignó a varias empresas de un polígono la misma parcela grande | Anótalo como limitación; no bloquea |
| CIF o LinkedIn muy bajos | Zona rural o negocios pequeños | Espera menos decisores por lead; ajusta el coste esperado |
| Consumo o QUALIFY en `failure` | Servicio caído o error de config | `satvolt-lead-troubleshooting` |

## Paso 5: Corregir sin relanzar

- **Cambios de configuración:** aplícalos en la campaña y también en la plantilla, para que la próxima campaña salga bien.

```bash
suntropy satvolt steps set <id> <uid consumo> --after <uid agente CIF> \
  --config '{"cnaeTemplate":"{{fullData.cif.response.extras.cnae}}"}'
suntropy satvolt templates patch "Greenvolt industria" --steps '[{"uid":"<uid consumo>","after":"<uid agente CIF>","config":{"cnaeTemplate":"{{fullData.cif.response.extras.cnae}}"}}]'
```

- **Leads sueltos afectados:** repite solo el paso sobre ellos (1 crédito por lead en el consumo):

```bash
suntropy satvolt leads run-step <id> <leadId> ESTIMATE_CONSUMPTION
```

- **Relanzar todo (`reset`):** solo si la configuración invalida la sonda entera. Borra los leads y los vuelve a pagar.

## Paso 6: Ampliar por etapas

Antes de cada ampliación, confirma con el usuario el coste estimado. Calcúlalo con los datos de la sonda, no con los del catálogo: leads nuevos × `avgCreditsPerLead` × 0,005 €.

```bash
suntropy satvolt campaigns get <id>            # sectorSearch: incomplete + unknown > 0 → queda área por buscar
suntropy satvolt campaigns extend <id> --max-leads 100
```

- **Qué hace:** solo busca en los sectores pendientes y solo los leads nuevos pasan por el pipeline.
- **Qué se repite:** las primeras peticiones a Places de los sectores pendientes (unos 0,025 $ por petición). En campañas antiguas los sectores salen como `unknown` y se buscan todos una vez.

Cuando termine, repite el paso 4 solo sobre los leads nuevos: compara la tasa de cualificación, los CIF, LinkedIn y decisores y los créditos por lead. En Huévar la primera ampliación salió mejor que la sonda (34 % frente a 24 % de cualificación) porque se acercó al centro.

**Comprueba que no se reprocesó nada.** En `campaigns usage <id> --by-lead`, los leads anteriores no deben tener ejecuciones nuevas, y en `funnel` los números de los pasos solo suben con los leads nuevos.

**Cuando esté validado, amplía a toda la zona:**

```bash
suntropy satvolt campaigns extend <id> --no-limit
```

Sin límite, cada sector se barre entero, con hasta 40 peticiones a Places por sector si es denso. Al terminar, `sectorSearch.exhausted = total`: la zona está agotada y otra ampliación no encontrará nada.

## Paso 7: Cierre

```bash
suntropy satvolt campaigns usage <id> --format human      # créditos consumidos: total, por lead y por paso
suntropy satvolt export-tables export <tableId> --file-format xlsx --out campaña.xlsx
suntropy satvolt templates patch "Greenvolt industria" --max-leads 50   # deja la plantilla lista para la próxima sonda
```

Resume al usuario:
- leads totales y cualificados por tanda;
- cobertura de CIF, LinkedIn y decisores;
- confianza del consumo;
- créditos consumidos (total y por lead) de cada tanda;
- incidencias (servicios caídos, parcelas repetidas, sesgo de la muestra);
- ajustes hechos en la plantilla.

## Si trabajas contra el backend local (desarrollo)

El pipeline completo necesita estos servicios levantados. Compruébalo con `lsof -iTCP -sTCP:LISTEN` antes de arrancar.

| Servicio | Puerto | Sin él |
|---|---|---|
| Backend Satvolt | 8099 | La CLI da `ECONNREFUSED` |
| `sharing` de Suntropy | 8090 | FIND_ROOFTOP falla con `ECONNREFUSED ...:8090` |
| Modelo de consumo | 8765 | ESTIMATE_CONSUMPTION falla |
| Suntropy AI | 8500 | QUALIFY no arranca |
| Devic | 8033 | AI_AGENT no arranca |

Con poca memoria, macOS mata procesos en segundo plano. Arranca backend y `sharing` desde build (`node dist/main`) en vez de en modo watch.
