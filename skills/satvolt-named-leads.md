Analiza con Satvolt de 1 a 10 empresas concretas, dadas por su nombre, en vez de buscar los negocios de una zona: un lead inbound que acaba de entrar, una oportunidad sobre la que el cliente tiene una duda, o una lista corta que te pasan. Se crea la campaña con esas empresas y se ejecutan los pasos uno a uno, lead a lead, leyendo el resultado de cada uno antes del siguiente. No se lanza la campaña entera ni se espera a que termine.

Ten a mano `satvolt-cli` para las opciones, `satvolt-campaign` para la configuración de cada paso (plantillas de mensaje, agentes) y `satvolt-lead-troubleshooting` si un paso falla.

## Cuándo usar esta skill (y cuándo no)

**Úsala** cuando el usuario nombra empresas concretas y quiere saber algo de ellas:

- «Analiza Geesol Instalaciones Fotovoltaicas, en Camas: ¿tiene paneles?»
- «Me ha entrado este lead: Talleres Pérez SL, Polígono La Isla. Cualifícalo y búscame el decisor.»
- «¿Qué consumo tendrían estas tres naves?», con nombres o direcciones.
- «Mira si estas cinco empresas cumplen el criterio de la campaña 59.»

**No la uses** si el usuario da una zona (un radio, un polígono, un municipio o «las empresas de este polígono») o quiere más de 25 empresas. Entonces es una campaña de Maps (`satvolt-campaign`, `satvolt-probe-to-full-campaign`) o un Excel (`campaigns create-from-excel`).

Si duda entre las dos, pregunta: «¿Quieres analizar estas empresas en concreto, o todas las de la zona?».

## Parámetros de entrada

| Parámetro | Obligatorio | Default |
|---|---|---|
| Empresas: nombre y, si se sabe, dirección, web, teléfono o email | Sí (1–10; la API admite hasta 25) | - |
| Qué quiere saber el usuario (paneles, cubierta, consumo, cualificación, decisor…) | Sí | - |
| Región que acota la búsqueda por nombre («Sevilla, España») | Si alguna empresa no trae dirección | - |
| Campaña existente donde añadirlas (inbound) | No | se crea una nueva |
| Plantilla o campaña base para la configuración de los pasos | No | - |

## Ejecución

### Paso 0: Traducir la pregunta a pasos

Elige solo los pasos que responden a la pregunta. Cada uno cuesta créditos por lead (`satvolt catalog actions` → `creditCost`, `dependencies`).

| Pregunta | Pasos, en orden |
|---|---|
| ¿Dónde está y cuál es su ficha de Google? | `GEOCODE_ADDRESS` (se añade solo si falta alguna coordenada) |
| Parcela y cubierta | `FIND_ROOFTOP` (añade `ROOFTOP_LIDAR` si hace falta la superficie medida) |
| ¿Tiene paneles? | `FIND_ROOFTOP` → `IDENTIFY_SOLAR_PANELS` |
| Potencial solar | `FIND_ROOFTOP` → `SOLAR_ANALYSIS` |
| Consumo estimado | `FIND_ROOFTOP` → `AI_AGENT` de CIF y CNAE → `ESTIMATE_CONSUMPTION` con `cnaeTemplate` apuntando al CNAE del agente. Sin CNAE la confianza no pasa de media y los fabricantes salen muy por debajo |
| ¿Cumple un criterio? | `QUALIFY` con `qualificationDefinition` y **siempre** `messageTemplate` |
| LinkedIn, CIF o decisor | `AI_AGENT` con el `agentId` de `satvolt catalog ai-agents` y su `messageTemplate` |

Si ya hay una campaña o una plantilla con esos pasos bien configurados, reutilízala con `--template` o `--from-campaign` en vez de escribirlos.

Las dependencias de cada paso están en `satvolt catalog actions` (`dependencies`): ordénalos según eso, no de memoria.

Si el usuario no ha dicho qué considera bueno (un consumo, un criterio de cualificación, el producto que ofrece para buscar al decisor), pregúntaselo. Si no, da el dato tal cual, sin veredicto.

### Paso 1: Confirmar el coste

Suma el `creditCost` de los pasos elegidos y multiplícalo por el número de empresas, más 10 por empresa si hay que geocodificar. Enséñalo en créditos, nunca en euros, y **pide confirmación una vez para el plan entero** antes de crear y ejecutar nada. Esa confirmación cubre todos los `run-step` del plan. Si por el camino el plan cambia (más pasos, más empresas, relanzar uno que falló), vuelve a preguntar.

### Paso 2: Crear la campaña con las empresas

```bash
suntropy satvolt campaigns create-from-leads --name "Geesol · paneles" --region "Sevilla, España" \
  --company "Geesol Instalaciones Fotovoltaicas | C. Mansíos 5, Camas" \
  --steps '[{"action":"FIND_ROOFTOP","config":{"captureImage":true}},{"action":"IDENTIFY_SOLAR_PANELS"}]'
```

- **Empresas:** `--company "Nombre | dirección"` es repetible y la dirección es opcional. Para varias, o con web, email o notas, usa `--leads @empresas.json`, con `[{"name","address","coordinates","url","phone","email","notes"}]`.
- **La campaña no arranca:** queda en `leads_found`, lista para ejecutar pasos. No uses `--start` ni `campaigns start`, porque lanzarían el pipeline entero sobre todos los leads.
- **Qué devuelve:** el id de la campaña y `leads: [{ idLead, name }]`. Guarda los `idLead`.

**Lead inbound en una campaña que ya existe** (por ejemplo una «Inbound · <cliente>» que vas reutilizando):

```bash
suntropy satvolt campaigns list --search "Inbound" --format human
suntropy satvolt leads add <campaignId> --company "Talleres Pérez SL | Polígono La Isla, Dos Hermanas"
```

Si una empresa no trae coordenadas, la campaña tiene que tener `GEOCODE_ADDRESS`. Si no lo tiene, el error es `GEOCODE_STEP_REQUIRED`. Las campañas creadas con `create-from-leads` sin coordenadas ya lo tienen.

`leads add` no añade pasos: el lead solo puede ejecutar los que ya tiene la campaña (`config get <campaignId>`). Si falta alguno de los que necesitas, tienes dos opciones:

- añádelo con `steps add <campaignId> --action … --config …`, sabiendo que cambia el pipeline para todos los leads de esa campaña;
- crea una campaña nueva con `create-from-leads`.

### Paso 3: Localizar cada empresa

Si hay `GEOCODE_ADDRESS`, va antes que todo lo demás:

```bash
suntropy satvolt leads run-step <campaignId> <idLead> GEOCODE_ADDRESS --wait
```

Mira `matchStatus` y el nombre y la dirección encontrados. **Si la ficha no es la empresa** (otro negocio con nombre parecido, otra sede), no sigas con ese lead: díselo al usuario y pídele la dirección o las coordenadas. Después, añádela otra vez con `leads add`, con `"coordinates": "lat,lng"`.

### Paso 4: Ejecutar los pasos uno a uno

Por cada lead, y en el orden de las dependencias:

```bash
suntropy satvolt leads run-step <campaignId> <idLead> FIND_ROOFTOP --wait
suntropy satvolt leads run-step <campaignId> <idLead> IDENTIFY_SOLAR_PANELS --wait
```

- **`--wait`:** espera a que el paso termine y devuelve su estado (`step.status`) y lo que escribió en fullData. Los agentes (`AI_AGENT`, `QUALIFY`) tardan minutos; `--timeout <s>` sube la espera (900 s por defecto). Si se agota, el paso sigue en marcha: consúltalo después con `leads get`.
- **Sin `--continue`:** con `--continue` se encolan los pasos siguientes y se cobran sin que puedas leer el resultado entre medias.
- **Si un paso falla o queda `skipped`/`unsatisfied`:** mira `step.error` y el fullData antes de seguir. Muchas veces no tiene sentido ejecutar el siguiente; por ejemplo, sin parcela no hay paneles que buscar. Un paso fallido no se cobra.
- **Si son varios leads:** puedes ejecutar el mismo paso en todos antes de pasar al siguiente.
- **Cómo nombrar el paso:** la acción (`FIND_ROOFTOP`) solo vale si aparece una vez en el pipeline. `AI_AGENT` y `QUALIFY` suelen repetirse: nómbralos por su `outputKey` o `resultKey` (`companyLinkedin`, `cif`), por su nombre («LinkedIn de empresa») o por su uid. Si no, el error es `AMBIGUOUS_STEP`.
- **Si QUALIFY dice que no cualifica:** avisa al usuario antes de gastar en los agentes que vienen detrás.

### Paso 5: Responder

Lee lo necesario y contesta a la pregunta del usuario con el dato y su fuente: qué imagen o qué paso lo dice, y con qué confianza.

```bash
suntropy satvolt leads get <campaignId> <idLead> --full-data solarPanelAnalysis,catastralParcel
suntropy satvolt leads full-data <campaignId> <idLead> --path qualification_<uid>.explanation
```

| Pregunta | Dónde está la respuesta |
|---|---|
| Paneles | `solarPanelAnalysis.finalResult` (`solar_panels`, `confidence`), `providerUsed` y `providerResults` (qué vio cada imagen) |
| Cubierta | `catastralParcel.area`, `roofSurface`, `rooftopLidar` |
| Consumo | `consumptionEstimate.annualKwh` y su confianza |
| Cualificación | `qualification_<uid>` (`qualifies`, `explanation`) |
| Agentes | `<outputKey>.response` |

Si el usuario quiere el resultado en una tabla o en un Excel, crea una tabla de exportación (`export-tables create`) con esas columnas.

## Errores frecuentes

| Error | Qué hacer |
|---|---|
| `DEPENDENCY_NOT_MET` | Falta un paso previo en ese lead: ejecútalo antes. No uses `--force` para saltártelo |
| `STEP_IN_PROGRESS` | Un agente de ese paso sigue trabajando: espera con `leads get`, no lo relances |
| `CAMPAIGN_NOT_STARTED` | La campaña se creó en cola por otra vía. Las de `create-from-leads` no lo dan |
| `GEOCODE_STEP_REQUIRED` | Añade coordenadas a la empresa o `GEOCODE_ADDRESS` al pipeline |
| `CREDIT_LIMIT_REACHED` | `campaigns credit-limit <id> <créditos>`, con confirmación del usuario |
| QUALIFY o un agente responden sin datos de la empresa | Falta `messageTemplate`: ponle nombre, web y dirección |

## Requisitos

- CLI con `campaigns create-from-leads`, `leads add` y `leads run-step --wait`.
- Backend de Satvolt con `POST /campaigns/from-leads` y `POST /campaigns/:id/leads`.
