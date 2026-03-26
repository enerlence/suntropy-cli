Crea elementos en el inventario de Suntropy usando la CLI. El inventario incluye: paneles solares, inversores, baterías, cargadores VE, aerotermias, equipos personalizados (custom assets) y kits.

## Parámetros de entrada

Pregunta al usuario qué tipo de elemento quiere crear. Si no especifica, pregunta.

## Tipos de elementos y sus campos

### Paneles solares (`suntropy inventory panels create`)
| Campo | Tipo | Obligatorio | Ejemplo |
|-------|------|-------------|---------|
| name | string | Sí | "JA Solar 450W" |
| peakPower | number | Sí | 450 (Wp) |
| efficiency | number | No | 21.3 (%) |
| manufacturer | object | No | {"idManufacturer": N} |
| panelDegradation | number | No | 0.55 (%) |
| width | number | No | 1134 (mm) |
| heigth | number | No | 1762 (mm) |
| costPerUnit | number | No | 120 (€) |
| active | boolean | No | true |
| referenceId | string | No | "JAM72S30-450" |
| description | string | No | - |

```bash
suntropy inventory panels create --data '{"name":"JA Solar 450W","peakPower":450,"efficiency":21.3,"costPerUnit":120,"active":true}'
```

### Inversores (`suntropy inventory inverters create`)
| Campo | Tipo | Obligatorio | Ejemplo |
|-------|------|-------------|---------|
| name | string | Sí | "Huawei SUN2000-5KTL" |
| nominalPower | number | Sí | 5000 (W) |
| efficiency | number | No | 98.4 (%) |
| manufacturer | object | No | {"idManufacturer": N} |
| phaseNumber | string | No | "single_phase" o "three_phase" |
| isMicroinverter | boolean | No | false |
| isHybrid | boolean | No | false |
| maxCapacityOfBattery | number | No | 15 (kWh) |
| costPerUnit | number | No | 800 (€) |
| active | boolean | No | true |

```bash
suntropy inventory inverters create --data '{"name":"Huawei SUN2000-5KTL","nominalPower":5000,"efficiency":98.4,"phaseNumber":"single_phase","costPerUnit":800}'
```

### Baterías (`suntropy inventory batteries create`)
| Campo | Tipo | Obligatorio | Ejemplo |
|-------|------|-------------|---------|
| name | string | Sí | "Huawei LUNA2000-5" |
| capacity | number | Sí | 5 (kWh) |
| manufacturer | object | No | {"idManufacturer": N} |
| isModular | boolean | No | true |
| maxNumberOfModules | number | No | 3 |
| availableCapacities | string | No | "5,10,15" |
| price | number | No | 2500 (€) |
| costPerUnit | number | No | 2500 (€) |
| active | boolean | No | true |

```bash
suntropy inventory batteries create --data '{"name":"Huawei LUNA2000-5","capacity":5,"isModular":true,"costPerUnit":2500}'
```

### Cargadores VE (`suntropy inventory chargers create`)
| Campo | Tipo | Obligatorio | Ejemplo |
|-------|------|-------------|---------|
| name | string | Sí | "Wallbox Pulsar Plus" |
| maxPower | number | Sí | 7400 (W) |
| connectorType | string | No | TYPE_1, TYPE_2, CCS1, CCS2, GBT, CHAdeMO |
| phaseNumber | number | No | 1 |
| includedPlug | boolean | No | true |
| price | number | No | 650 (€) |
| costPerUnit | number | No | 650 (€) |
| active | boolean | No | true |

```bash
suntropy inventory chargers create --data '{"name":"Wallbox Pulsar Plus","maxPower":7400,"connectorType":"TYPE_2","costPerUnit":650}'
```

### Aerotermias (`suntropy inventory heatpumps create`)
| Campo | Tipo | Obligatorio | Ejemplo |
|-------|------|-------------|---------|
| identifier | string | Sí | "Daikin Altherma 3 8kW" |
| lowerPower | number | No | 4000 (W) |
| upperPower | number | No | 8000 (W) |
| scop | number | No | 4.5 |
| phases_number | number | No | 1 |
| manufacturer | object | No | {"idManufacturer": N} |
| price | number | No | 4500 (€) |
| costPerUnit | number | No | 4500 (€) |
| active | boolean | No | true |

```bash
suntropy inventory heatpumps create --data '{"identifier":"Daikin Altherma 3 8kW","lowerPower":4000,"upperPower":8000,"scop":4.5,"costPerUnit":4500}'
```

### Equipos personalizados (Custom Assets)

Los custom assets tienen una estructura jerárquica: **Tipo → Campos → Asset**

#### Paso 1: Buscar o crear un tipo

Primero busca si ya existe un tipo adecuado:
```bash
suntropy inventory custom-asset-types list
```

Si necesitas crear uno nuevo:
```bash
suntropy inventory custom-asset-types create --data '{
  "label": "Nombre del tipo",
  "image": "wrench",
  "isMaterialConcept": true,
  "panelsQuantity": false,
  "uniqueCustomAssetSelection": false,
  "customFields": [
    {"label": "Campo texto", "type": "text"},
    {"label": "Campo numérico", "type": "number"},
    {"label": "Campo opciones", "type": "options", "customFieldOptions": [
      {"label": "Opción A", "value": "a"},
      {"label": "Opción B", "value": "b"}
    ]}
  ]
}'
```

**Flags del tipo:**
- `isMaterialConcept`: true = aparece como material en presupuestos
- `panelsQuantity`: true = la cantidad se iguala automáticamente al número de paneles
- `uniqueCustomAssetSelection`: true = solo se puede seleccionar un asset de este tipo por estudio

**Tipos de campo soportados:**
text, number, date, datetime, time, email, phonenumber, website, options, labels, currency, large_text, user

#### Paso 2: Obtener IDs de los campos del tipo

```bash
suntropy inventory custom-asset-types get <typeId>
```
Anota los `idCustomField` de cada campo en `customFields`.

#### Paso 3: Crear el asset

```bash
suntropy inventory custom-assets create --data '{
  "label": "Nombre del equipo",
  "identifier": "REF-001",
  "costPerUnit": 100,
  "isMaterial": true,
  "hideOnBudget": false,
  "description": "Descripción del equipo",
  "customAssetType": {"idCustomAssetType": <typeId>},
  "customAssetCustomField": [
    {"customField": {"idCustomField": <fieldId1>}, "value": "valor1"},
    {"customField": {"idCustomField": <fieldId2>}, "value": "42"},
    {"customField": {"idCustomField": <fieldId3>}, "value": "a"}
  ]
}'
```

**Campos del asset:**
- `label`: Nombre visible
- `identifier`: Referencia interna
- `costPerUnit`: Precio unitario (€)
- `isMaterial`: Es un concepto material
- `hideOnBudget`: Ocultar en presupuesto (pero incluir en coste)
- `customAssetType`: Referencia al tipo por ID
- `customAssetCustomField`: Array de valores para los campos del tipo. Para campos tipo `options`, el value es el `value` de la opción (no el label)

### Manufacturers

Si necesitas referenciar un fabricante, primero búscalo o créalo:

```bash
# Buscar fabricantes existentes
suntropy inventory manufacturers list

# Crear nuevo fabricante
suntropy inventory manufacturers create --data '{"name": "JA Solar"}'
```

Luego referéncialo en el equipo: `"manufacturer": {"idManufacturer": <id>}`

### Kits (solar, cargador VE, aerotermia)

Para crear kits con todos sus componentes y equipos personalizados asociados, consulta la guía detallada:

**[Crear kits y asociar componentes](inventory-create-kit.md)**

Resumen rápido de un kit solar básico:
```bash
# 1. Crear panel y inversor del kit
suntropy inventory kits panels create --data '{"name":"Panel Kit","peakPower":450,"efficiency":21}'
suntropy inventory kits inverters create --data '{"name":"Inversor Kit","nominalPower":5000}'

# 2. Ensamblar el kit (método recomendado)
suntropy inventory kits assemble \
  --name "Kit Solar 5kW" \
  --panel <panelId> --inverter <inverterId> \
  --panels-count 12 --peak-power 5.4 --price 3500 \
  --custom-asset <assetId>:12
```

## Notas

- Todos los comandos devuelven JSON con el elemento creado (incluido su ID)
- Para actualizar: `suntropy inventory <tipo> update <id> --data '{"campo": "nuevo_valor"}'`
- Para eliminar: `suntropy inventory <tipo> delete <id>`
- Para listar con filtros: `suntropy inventory <tipo> list --limit 10 --active-only`
- Usa `--fields campo1,campo2` para seleccionar campos en el output
- Usa `--format human` para vista legible en tabla
