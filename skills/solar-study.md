Crea o edita un estudio solar completo usando el study builder de la CLI de Suntropy. El estudio se construye progresivamente en un fichero JSON local, y al final se guarda en el backend. El comando `calculate-results` replica el SolarResultCalculator del frontend para generar los resultados energeticos y economicos completos (spending/savings por periodo, excedentes, cobertura).

## Parametros de entrada

Pregunta al usuario los siguientes datos. Usa los valores por defecto si no los proporciona:

| Parametro | Obligatorio | Default |
|-----------|-------------|---------|
| Nombre del estudio | No | "Estudio Solar YYYY-MM-DD" |
| Ubicacion (lat, lon) | Si | - |
| Consumo anual (kWh) | Si | - |
| Patron consumo | No | Domestic |
| Modo consumo | No | annual+pattern (alternatives: by-period, monthly, monthly-by-period, from-file) |
| Tarifa ATR ID | No | 14 (3.0TD, 6 periodos) |
| Zona geografica ID | No | 1 (Peninsula) |
| Mercado | No | es |
| Precios energia P1-P6 (euros/kWh) | Si (o usar defaults) | 3.0TD: [0.18, 0.15, 0.11, 0.09, 0.08, 0.07] / 2.0TD: [0.25, 0.17, 0.13] |
| Equipo: panel ID o kit ID | No | Usar solarform para obtener kit recomendado |
| Potencia instalada (Wp) | No | Auto desde solarform o kit |
| Inclinacion (grados) | No | 30 |
| Azimuth (grados) | No | 180 (sur) |
| Perdidas (%) | No | 14 |
| Nombre del cliente | No | - |
| Coste total instalacion (euros) | No | Obtener del solarform |
| Margen (%) | No | 15 |
| Vida util (anos) | No | 25 |

## Ejecucion

Ejecuta los siguientes pasos secuencialmente. Cada paso que modifica el estudio actualiza automaticamente el progreso de completado.

### Paso 0: Preparar directorio e inicializar estudio

```bash
STUDY_DIR=$(mktemp -d /tmp/suntropy_study_XXXXXX)
STUDY_FILE=$STUDY_DIR/study.json

suntropy studies init --file $STUDY_FILE --name "<nombre>" --market <market>
```

Si se va a editar un estudio existente, usar `pull` en vez de `init`:
```bash
suntropy studies pull <studyId> --file $STUDY_FILE
```

Anade comentario indicando el inicio:
```bash
suntropy studies add-comment --file $STUDY_FILE --content "Inicio de estudio solar via CLI agent"
```

### Paso 1: Configurar tarifa y zona geografica

```bash
suntropy studies set tariff --file $STUDY_FILE --tariff-id <tariffId> --zone-id <zoneId> --market <market>
```

Esto auto-configura la fase electrica (>3 periodos -> three_phase).

Tarifas comunes (Espana):
- 13 = 2.0TD (3 periodos, residencial)
- 14 = 3.0TD (6 periodos, comercial/industrial)
- 15 = 6.1TD (6 periodos, gran consumo)

Zonas comunes (Espana):
- 1 = Peninsula
- 2 = Canarias
- 3 = Baleares

### Paso 2: Configurar precios de energia

```bash
suntropy studies set prices --file $STUDY_FILE \
  --energy '{"p1":<precio1>,"p2":<precio2>,"p3":<precio3>,"p4":<precio4>,"p5":<precio5>,"p6":<precio6>}'
```

O con flags individuales:
```bash
suntropy studies set prices --file $STUDY_FILE \
  --energy-p1 0.18 --energy-p2 0.15 --energy-p3 0.11 --energy-p4 0.09 --energy-p5 0.08 --energy-p6 0.07
```

Si el usuario proporciona potencia contratada y precios de potencia:
```bash
suntropy studies set prices --file $STUDY_FILE \
  --energy '{"p1":0.18,...}' \
  --power '{"p1":40,...}' \
  --contracted '{"p1":5.5,...}'
```

### Paso 3: Datos del cliente (opcional pero recomendado)

```bash
suntropy studies set client --file $STUDY_FILE \
  --name "Nombre Cliente" --email "email@example.com" \
  --address "Calle Ejemplo 1" --city "Madrid" --region "Madrid"
```

Anade comentario tras configurar cliente:
```bash
suntropy studies add-comment --file $STUDY_FILE --content "Datos del cliente configurados"
```

### Paso 4: Configurar consumo

Segun el modo:

**Modo annual + pattern (mas comun):**
```bash
suntropy studies set consumption --file $STUDY_FILE --annual <kWh> --pattern <patron>
```
Patrones disponibles: Balance, Nightly, Morning, Afternoon, Domestic, Commercial

**Modo por periodo:**
```bash
suntropy studies set consumption --file $STUDY_FILE --by-period '{"p1":2500,"p2":1000,"p3":500}'
```

**Modo mensual:**
```bash
suntropy studies set consumption --file $STUDY_FILE --monthly '{"1":350,"2":320,"3":300,"4":280,"5":260,"6":250,"7":300,"8":320,"9":290,"10":280,"11":310,"12":340}'
```

**Modo desde archivo (curva PowerCurve):**
```bash
suntropy studies set consumption --file $STUDY_FILE --from-file /ruta/a/consumo.json
```

Anade comentario indicando el consumo configurado:
```bash
suntropy studies add-comment --file $STUDY_FILE --content "Consumo configurado: <kWh> kWh/ano, patron <patron>"
```

### Paso 5: Obtener configuracion optima (si no la proporciono el usuario)

Si el usuario no especifico equipo ni potencia, usar solarform para obtener la configuracion recomendada:

```bash
suntropy solarform simple \
  --region <region> --sub-region <subregion> \
  --consumption <kWh> --pattern <patron> \
  --fields solarKit.peakPower,solarKit.panelNumber,economicResults.totalCost,solarKit.identifier,solarKit.idSolarKit
```

O con coordenadas:
```bash
suntropy solarform calculate --data '{"center":{"lat":<lat>,"lng":<lon>},"consumptionMode":"consumptionPatterns","locationMode":"locationOnly","consumptionPatternViewMode":"consumptionPattern","selectedConsumptionPattern":"<patron>","consumptionQuantity":<kWh>,"consumptionQuantityIntroductionMode":"monthlyConsumption"}' \
  --fields solarKit.peakPower,solarKit.panelNumber,economicResults.totalCost,solarKit.idSolarKit
```

De aqui extraer: `peakPower`, `panelNumber`, `totalCost`, `idSolarKit`.

### Paso 6: Configurar equipo (panel o kit)

**Opcion A: Kit solar (recomendado, modo por defecto):**
```bash
suntropy studies set kit --file $STUDY_FILE --kit-id <idSolarKit>
```

**Opcion B: Panel + inversor individuales:**
```bash
suntropy studies set panel --file $STUDY_FILE --panel-id <panelId> --panels-count <N>
suntropy studies set inverter --file $STUDY_FILE --inverter-id <inverterId>
```

Si no se conocen los IDs, listar inventario:
```bash
suntropy inventory kits list --active-only --fields idSolarKit,identifier,peakPower,price
suntropy inventory panels list --active-only --fields solarPanelId,name,peakPower,costPerUnit
suntropy inventory inverters list --active-only --fields idInverter,name,nominalPower
```

Anade comentario tras seleccionar equipo:
```bash
suntropy studies add-comment --file $STUDY_FILE --content "Equipo seleccionado: <nombre kit/panel>"
```

### Paso 7: Anadir superficie y calcular produccion

```bash
# Anadir superficie con coordenadas
suntropy studies add surface --file $STUDY_FILE \
  --lat <lat> --lon <lon> \
  --angle <inclinacion> --azimuth <azimuth> \
  --power <Wp> --panels-count <N>

# Calcular produccion para todas las superficies
suntropy studies calculate production --file $STUDY_FILE --all-surfaces
```

Si se necesitan multiples superficies (diferente orientacion/inclinacion):
```bash
suntropy studies add surface --file $STUDY_FILE --lat <lat> --lon <lon> --angle 30 --azimuth 180 --power 3000 --identifier "Tejado sur"
suntropy studies add surface --file $STUDY_FILE --lat <lat> --lon <lon> --angle 15 --azimuth 90 --power 2000 --identifier "Tejado este"
suntropy studies calculate production --file $STUDY_FILE --all-surfaces
```

### Paso 8: Calcular resultados (SolarResultCalculator)

Este es el paso clave. El comando `calculate-results` replica exactamente la logica del SolarResultCalculator del frontend:
- Calcula consumo neto, excedentes, cobertura
- Obtiene la distribucion de periodos del servicio de periodos
- Calcula gasto bruto y neto por periodo tarifario (con IVA si aplica)
- Calcula ahorro por periodo
- Soporta precios alternativos, mercado PT, descuentos energia/potencia

```bash
suntropy studies calculate-results --file $STUDY_FILE
```

**Resultado generado (propiedad `results` del estudio):**
- `totalProduction`: produccion total (kWh/ano)
- `totalConsumptionCoverage`: % de consumo cubierto por produccion
- `netConsumption`: curva PowerCurve de consumo neto
- `excessesCurve`: curva PowerCurve de excedentes
- `totalRawSpendingByPeriod`: gasto bruto por periodo (euros)
- `totalRawSpending`: gasto bruto total
- `totalNetSpendingByPeriod`: gasto neto por periodo (con solar)
- `totalNetSpending`: gasto neto total
- `totalSavingsByPeriod`: ahorro por periodo
- `totalSavings`: ahorro total anual
- `totalExcessesByPeriod`: excedentes por periodo (kWh)
- `totalExcesses`: excedentes totales (kWh)

Anade comentario tras calcular resultados:
```bash
suntropy studies add-comment --file $STUDY_FILE --content "Resultados calculados: produccion <X> kWh, ahorro <X> euros/ano, cobertura <X>%"
```

### Paso 9: Configurar parametros economicos

```bash
suntropy studies set economics --file $STUDY_FILE \
  --margin <margen%> --total-cost <costeTotal> \
  --lifetime 25 --inflation 3 --taxes-pct 21
```

Para compensacion de excedentes:
```bash
suntropy studies set economics --file $STUDY_FILE \
  --excesses-mode gridSelling --excesses-selling-price 0.06
```

Modos de excedentes disponibles: `gridSelling`, `PPA`, `noInjection`, `virtualBattery`

### Paso 10: Validar estudio completo

```bash
suntropy studies validate --file $STUDY_FILE
```

Debe devolver `completionPercentage: 100` y `missing: {}`. Si falta algo, el output indica que falta y que comando usar.

### Paso 11: Guardar en backend

```bash
suntropy studies save --file $STUDY_FILE
```

Esto automaticamente:
- Re-valida todos los pasos
- Anade un comentario auto-generado ("created" si es nuevo, "modified" si es edicion)
- Guarda en MongoDB + crea metadata en PostgreSQL
- Si es un estudio nuevo, actualiza el fichero local con el `_id` del backend

Con estado especifico:
```bash
suntropy studies save --file $STUDY_FILE --state-id 1
```

## Edicion de estudios existentes

Para editar un estudio que ya existe en el backend:

```bash
# 1. Descargar estudio
suntropy studies pull <studyId> --file $STUDY_FILE

# 2. Modificar lo necesario (los mismos comandos set/add/calculate)
suntropy studies set consumption --file $STUDY_FILE --annual 5000 --pattern Commercial
suntropy studies add-comment --file $STUDY_FILE --content "Consumo actualizado de 4000 a 5000 kWh"

# 3. Recalcular produccion y resultados (si cambio consumo o superficies)
suntropy studies calculate production --file $STUDY_FILE --all-surfaces
suntropy studies calculate-results --file $STUDY_FILE
suntropy studies add-comment --file $STUDY_FILE --content "Resultados recalculados tras cambio de consumo"

# 4. Guardar cambios
suntropy studies save --file $STUDY_FILE
```

## Comentarios via API (estudios ya guardados)

Para anadir comentarios a un estudio que ya existe en el backend sin descargarlo:
```bash
suntropy studies comment <studyId> --content "Revision completada por agente"
```

## Presentacion de resultados

Tras el paso 8 (calculate-results), presenta al usuario un resumen con los datos del `results`:

```
ESTUDIO SOLAR - <nombre>

CONFIGURACION
  Ubicacion:           <lat>, <lon>
  Consumo anual:       <X> kWh (patron <patron>)
  Potencia instalada:  <X> kWp
  Equipo:              <nombre kit/panel>
  Tarifa:              <nombre tarifa> (<N> periodos)
  Coste instalacion:   <X> euros

BALANCE ENERGETICO
  Produccion anual:    <totalProduction> kWh
  Cobertura:           <totalConsumptionCoverage>%
  Excedentes totales:  <totalExcesses> kWh

AHORRO POR PERIODO
  Periodo  Gasto sin solar  Gasto con solar  Ahorro
  P1       <rawP1> euros    <netP1> euros    <savP1> euros
  P2       <rawP2> euros    <netP2> euros    <savP2> euros
  ...
  TOTAL    <totalRawSpending> euros  <totalNetSpending> euros  <totalSavings> euros

RESULTADO
  Ahorro anual:  <totalSavings> euros/ano
  Reduccion:     <(1-totalNetSpending/totalRawSpending)*100>%
```

## Notas

- El fichero JSON local (`$STUDY_FILE`) contiene el estudio completo incluyendo curvas PowerCurve. Es el mismo formato que usa el frontend.
- `calculate-results` escribe los resultados en la propiedad `results` del estudio, exactamente igual que el SolarResultCalculator del frontend.
- Los comentarios quedan registrados en el estudio con tipo, timestamp y userUID para trazabilidad.
- Si algun paso falla, muestra el error y pregunta al usuario como proceder.
- Usa `suntropy studies validate` en cualquier momento para ver el estado de completado.
- Los cambios en consumo o superficies disparan cascade resets automaticos (se invalidan produccion, resultados y balance economico).
