Realiza un estudio solar completo usando la CLI de Suntropy. El estudio calcula consumo, producción, autoconsumo, excedentes, ahorro económico por periodo tarifario y proyección ROI.

## Parámetros de entrada

Pregunta al usuario los siguientes datos. Usa los valores por defecto si no los proporciona:

| Parámetro | Obligatorio | Default |
|-----------|-------------|---------|
| Ubicación (lat, lon) o (región, subregión) | Sí | - |
| Consumo anual (kWh) | Sí | - |
| Patrón consumo | No | Domestic |
| Potencia instalada (Wp) | No | Auto-optimizado via solarform |
| Inclinación (°) | No | 30 |
| Azimuth (°) | No | 180 (sur) |
| Pérdidas (%) | No | 14 |
| Coste instalación (€) | No | Obtener del solarform |
| Precios energía P1-P6 (€/kWh) | No | [0.25, 0.22, 0.19, 0.17, 0.16, 0.14] |
| Precio excedentes (€/kWh) | No | 0.06 |
| Tarifa ATR ID | No | 14 (3.0TD) |
| Zona geográfica ID | No | 1 (Península) |
| Mercado | No | es |
| Vida útil (años) | No | 25 |
| Degradación (%/año) | No | 0.6 |

## Ejecución

Ejecuta los siguientes pasos secuencialmente. Crea un directorio temporal para archivos intermedios.

### Paso 0: Preparar
```bash
STUDY_DIR=$(mktemp -d /tmp/suntropy_study_XXXXXX)
```

### Paso 1: Obtener distribución de periodos
```bash
suntropy consumption periods \
  --tariff-id <tariffId> --zone-id <zoneId> \
  --start <year>-01-01 --end <year>-12-31 --market <market> \
  --save $STUDY_DIR/periods.json
```

### Paso 2: Generar curva de consumo
```bash
suntropy consumption estimate \
  --annual <consumo_kWh> --pattern <patron> \
  --tariff <tariffCode> --market <market> \
  --save $STUDY_DIR/consumo.json
```
Verificar: `suntropy curves total --input $STUDY_DIR/consumo.json`

### Paso 3: Obtener potencia y coste (si no los proporcionó el usuario)

Ejecutar solarform para obtener la configuración óptima:
```bash
suntropy solarform simple \
  --region <region> --sub-region <subregion> \
  --consumption <kWh> --pattern <patron> \
  --fields solarKit.peakPower,solarKit.panelNumber,economicResults.totalCost,solarKit.identifier
```
Usar peakPower (en kW, multiplicar por 1000 para Wp) y totalCost para los siguientes pasos.

Si el usuario proporcionó coordenadas en vez de región, puede usarse calculate con locationMode:
```bash
suntropy solarform calculate --data '{"center":{"lat":<lat>,"lng":<lon>},"consumptionMode":"consumptionPatterns","locationMode":"locationOnly","consumptionPatternViewMode":"consumptionPattern","selectedConsumptionPattern":"<patron>","consumptionQuantity":<kWh>,"consumptionQuantityIntroductionMode":"monthlyConsumption"}' \
  --fields solarKit.peakPower,solarKit.panelNumber,economicResults.totalCost
```

### Paso 4: Calcular producción solar
```bash
suntropy studies calculate-production \
  --lat <lat> --lon <lon> --power <Wp> \
  --angle <inclinacion> --azimuth <azimuth> --losses <perdidas> \
  --save $STUDY_DIR/produccion.json
```
Verificar: `suntropy curves total --input $STUDY_DIR/produccion.json`

### Paso 5: Calcular curvas derivadas
```bash
# Consumo neto (consumo - producción): negativo = excedente, positivo = importa de red
suntropy curves subtract --a $STUDY_DIR/consumo.json --b $STUDY_DIR/produccion.json \
  --save $STUDY_DIR/neto.json > /dev/null

# Excedentes (producción que sobra tras cubrir consumo)
suntropy curves subtract --a $STUDY_DIR/produccion.json --b $STUDY_DIR/consumo.json \
  | suntropy curves filter-positive --input - --save $STUDY_DIR/excedentes.json > /dev/null

# Consumo de red (consumo no cubierto por producción)
suntropy curves filter-positive --input $STUDY_DIR/neto.json \
  --save $STUDY_DIR/consumo_red.json > /dev/null
```

### Paso 6: Obtener totales
```bash
suntropy curves total --input $STUDY_DIR/consumo.json
suntropy curves total --input $STUDY_DIR/produccion.json
suntropy curves total --input $STUDY_DIR/excedentes.json
suntropy curves total --input $STUDY_DIR/consumo_red.json
```
Validar integridad:
- autoconsumo = produccion_total - excedentes_total
- autoconsumo + consumo_red ≈ consumo_total
- autoconsumo + excedentes ≈ produccion_total

### Paso 7: Agregar por periodos tarifarios
```bash
suntropy curves by-period --input $STUDY_DIR/consumo.json --periods $STUDY_DIR/periods.json
suntropy curves by-period --input $STUDY_DIR/consumo_red.json --periods $STUDY_DIR/periods.json
suntropy curves by-period --input $STUDY_DIR/excedentes.json --periods $STUDY_DIR/periods.json
```

### Paso 8: Calcular ahorro y ROI

Con los datos de los pasos 6 y 7, calcula:

```
Factura sin solar = Σ(P1..P6) consumo_periodo × precio_periodo
Factura con solar = Σ(P1..P6) consumo_red_periodo × precio_periodo
Compensación excedentes = excedentes_total × precio_excedentes
Ahorro anual = factura_sin_solar - factura_con_solar + compensación

ROI (con degradación anual):
  Para cada año y = 1..vida_util:
    factor = (1 - degradación)^y
    ahorro_año = ahorro_anual × factor
    acumulado += ahorro_año
    cash_flow = acumulado - coste_instalación
  payback = primer año con cash_flow >= 0
  roi = (acumulado - coste) / coste × 100
```

## Presentación de resultados

```
═══════════════════════════════════════════════════════════
  ESTUDIO SOLAR - <ubicación>
═══════════════════════════════════════════════════════════

  CONFIGURACIÓN
    Ubicación:           <lat>, <lon> (<región>)
    Consumo anual:       <X> kWh (patrón <patron>)
    Potencia instalada:  <X> kWp (<N> paneles)
    Inclinación/Azimuth: <X>° / <X>°
    Coste instalación:   <X> €

  BALANCE ENERGÉTICO
    Producción anual:    <X> kWh
    Autoconsumo:         <X> kWh (<X>% de producción)
    Excedentes:          <X> kWh (<X>% de producción)
    Consumo de red:      <X> kWh (<X>% de consumo)
    Autosuficiencia:     <X>% (consumo cubierto por solar)

  DESGLOSE POR PERIODO TARIFARIO
    Periodo  Precio    Consumo     Red        Excedente   Ahorro
    P1       <X> €     <X> kWh     <X> kWh    <X> kWh     <X> €
    P2       <X> €     <X> kWh     <X> kWh    <X> kWh     <X> €
    P3       <X> €     <X> kWh     <X> kWh    <X> kWh     <X> €
    P4       <X> €     <X> kWh     <X> kWh    <X> kWh     <X> €
    P5       <X> €     <X> kWh     <X> kWh    <X> kWh     <X> €
    P6       <X> €     <X> kWh     <X> kWh    <X> kWh     <X> €
    ─────────────────────────────────────────────────────────────
    TOTAL              <X> kWh     <X> kWh    <X> kWh     <X> €

  RESULTADO ECONÓMICO
    Factura sin solar:        <X> €/año
    Factura con solar:        <X> €/año
    Compensación excedentes: -<X> €/año
    Factura neta:             <X> €/año
    ──────────────────────────────────────
    AHORRO ANUAL:             <X> €/año (<X>% reducción)

  PROYECCIÓN ROI (<vida_util> años, degradación <X>%/año)
    Año   Ahorro €   Acumulado €   Cash Flow €
      1     <X>         <X>           <X>
      2     <X>         <X>           <X>
      ...
     25     <X>         <X>           <X>

    Payback:          año <X>
    Ahorro 25 años:   <X> €
    ROI:              <X>%
═══════════════════════════════════════════════════════════
```

## Notas

- Los archivos intermedios quedan en el directorio temporal para trazabilidad y reutilización con `suntropy curves`
- Si algún paso falla, muestra el error y pregunta al usuario cómo proceder
- Las verificaciones de totales sirven como validación de integridad del cálculo
- El precio de excedentes se aplica al total (no por periodo) siguiendo el modelo de compensación simplificada española
- Para una comparación rápida, se puede ejecutar `suntropy solarform simple` que hace el cálculo completo en el backend (pero no desglosa por periodo ni permite personalizar precios)
