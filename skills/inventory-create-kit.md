Guía detallada para crear kits solares, kits de cargadores VE y kits de aerotermia, incluyendo la asociación de componentes y equipos personalizados (custom assets).

## Conceptos clave

Un kit agrupa componentes en un producto comercializable. Existen tres tipos:

| Tipo | Comando | Componente principal | Custom assets |
|------|---------|---------------------|---------------|
| Kit solar | `suntropy inventory kits` | KitSolarPanel + KitInverter + Battery | SolarKitCustomAsset |
| Kit cargador VE | `suntropy inventory charger-kits` | Charger | VEChargerKitCustomAsset |
| Kit aerotermia | `suntropy inventory heatpump-kits` | Heatpump | HeatpumpKitCustomAsset |

**Importante:** Los componentes de un kit solar (KitSolarPanel, KitInverter) son entidades **separadas** de los paneles e inversores del inventario general. Tienen sus propios IDs y campos. Esto permite que un kit defina su panel/inversor específico sin modificar el inventario.

## Flujo completo: Kit solar

### Paso 1: Crear componentes del kit

#### Panel del kit
```bash
suntropy inventory kits panels create --data '{
  "name": "Panel Kit 450W",
  "peakPower": 450,
  "efficiency": 21.3,
  "panelDegradation": 0.55,
  "width": 1134,
  "heigth": 1762,
  "costPerUnit": 120,
  "manufacturer": {"idManufacturer": <id>}
}'
```
Guarda el `idKitSolarPanel` del resultado.

Campos disponibles: name, peakPower, efficiency, panelDegradation, technology, width, heigth, depth, costPerUnit, referenceId, imageUrl, manufacturer, manufacturingWarranty, materialsWarranty, description

#### Inversor del kit
```bash
suntropy inventory kits inverters create --data '{
  "name": "Inversor Kit 5kW",
  "nominalPower": 5000,
  "efficiency": 98.4,
  "isMicroinverter": false,
  "costPerUnit": 800,
  "manufacturer": {"idManufacturer": <id>}
}'
```
Guarda el `idKitInverter` del resultado.

Campos disponibles: name, nominalPower, efficiency, isMicroinverter, costPerUnit, referenceId, imageUrl, manufacturer, manufacturingWarranty, materialsWarranty, description

#### Batería (opcional)
Los kits referencian baterías del inventario general directamente (no tienen entidad separada):
```bash
# Buscar baterías existentes
suntropy inventory batteries list --fields batteryId,name,capacity,costPerUnit

# O crear una nueva
suntropy inventory batteries create --data '{"name":"LUNA2000-5","capacity":5,"costPerUnit":2500}'
```
Guarda el `batteryId`.

### Paso 2: Preparar custom assets (opcional)

Los custom assets del kit referencian equipos personalizados existentes del inventario. Cada asociación incluye un campo `units` (cantidad).

```bash
# Buscar custom assets existentes
suntropy inventory custom-assets list --fields idCustomAsset,label,costPerUnit,customAssetType
```

Si no existe el asset que necesitas, créalo primero siguiendo la guía de [equipos personalizados](inventory-create.md).

### Paso 3: Ensamblar el kit (método recomendado)

Usa el comando `assemble` para crear el kit referenciando componentes por ID con flags explícitos. Esto evita construir JSON anidado y hace el comando autoexplicativo:

```bash
suntropy inventory kits assemble \
  --name "Kit Solar Premium 5kW" \
  --panel <kitPanelId> \
  --inverter <kitInverterId> \
  --battery <batteryId> \
  --panels-count 12 \
  --inverters-count 1 \
  --batteries-count 1 \
  --peak-power 5.4 \
  --price 6500 \
  --phase single_phase \
  --coplanar \
  --taxes 21 \
  --custom-asset <assetId1>:12 \
  --custom-asset <assetId2>:1
```

**Opciones de `assemble`:**

| Flag | Default | Descripción |
|------|---------|-------------|
| `--name` | (obligatorio) | Nombre/identificador del kit |
| `--panel` | - | ID del panel del kit (idKitSolarPanel) |
| `--inverter` | - | ID del inversor del kit (idKitInverter) |
| `--battery` | - | ID de batería del inventario (batteryId) |
| `--panels-count` | 12 | Cantidad de paneles |
| `--inverters-count` | 1 | Cantidad de inversores |
| `--batteries-count` | 0 | Cantidad de baterías |
| `--peak-power` | - | Potencia pico total (kW) |
| `--price` | - | Precio del kit (€) |
| `--phase` | single_phase | single_phase o three_phase |
| `--coplanar` | false | Montaje coplanar |
| `--taxes` | 21 | IVA por defecto (%) |
| `--custom-asset` | - | Equipo personalizado como `<id>:<unidades>` (repetible) |

**Ejemplo completo:**
```bash
suntropy inventory kits assemble \
  --name "Kit Residencial 5.4kW" \
  --panel 57532 --inverter 23359 \
  --panels-count 12 --peak-power 5.4 --price 6500 \
  --coplanar \
  --custom-asset 2281:12 --custom-asset 2282:1
```

For advanced fields (warranties, useTotalKitCostAsPrice, etc.) use `update` after assembling:

```bash
suntropy inventory kits update <kitId> --data '{
  "manufacturingWarranty": 10,
  "materialsWarranty": 5,
  "useTotalKitCostAsPrice": false
}'
```

### Paso 4: Verificar el kit creado

```bash
suntropy inventory kits get <kitId>
```

## Gestión de custom assets en un kit existente

### Añadir custom assets
Actualiza el kit incluyendo los custom assets existentes MÁS los nuevos:

```bash
# Primero obtén los custom assets actuales
suntropy inventory kits get <kitId> --fields solarKitCustomAssets

# Luego actualiza incluyendo todos (existentes + nuevos)
suntropy inventory kits update <kitId> --data '{
  "solarKitCustomAssets": [
    {"idSolarKitCustomAsset": <existente1>, "customAsset": {"idCustomAsset": <id>}, "units": 12},
    {"idSolarKitCustomAsset": <existente2>, "customAsset": {"idCustomAsset": <id>}, "units": 1},
    {"customAsset": {"idCustomAsset": <nuevoAssetId>}, "units": 3}
  ]
}'
```

**Lógica del backend en update:**
- Elementos CON `idSolarKitCustomAsset` → se actualizan (solo `units`)
- Elementos SIN `idSolarKitCustomAsset` → se crean nuevos
- Elementos existentes NO incluidos en el array → se eliminan

Esto significa que para eliminar un custom asset de un kit, simplemente lo omites del array en el update.

### Cambiar cantidad
```bash
suntropy inventory kits update <kitId> --data '{
  "solarKitCustomAssets": [
    {"idSolarKitCustomAsset": <id>, "customAsset": {"idCustomAsset": <id>}, "units": 20}
  ]
}'
```

## Kit de cargador VE

```bash
# Crear el kit referenciando un cargador existente
suntropy inventory charger-kits create --data '{
  "identifier": "Kit Wallbox Premium",
  "charger": {"idCharger": <chargerId>},
  "price": 1200,
  "phaseNumber": 1,
  "defaultTaxesPercentage": 21,
  "useTotalKitCostAsPrice": false,
  "active": true,
  "veChargerKitCustomAssets": [
    {"customAsset": {"idCustomAsset": <assetId>}, "units": 1}
  ]
}'
```

## Kit de aerotermia

```bash
# Crear el kit referenciando una aerotermia existente
suntropy inventory heatpump-kits create --data '{
  "identifier": "Kit Aerotermia Daikin 8kW",
  "heatpump": {"idHeatpump": <heatpumpId>},
  "price": 8500,
  "phaseNumber": 1,
  "defaultTaxesPercentage": 21,
  "useTotalKitCostAsPrice": false,
  "active": true,
  "heatpumpKitCustomAssets": [
    {"customAsset": {"idCustomAsset": <assetId>}, "units": 1}
  ]
}'
```

## Otros comandos útiles

```bash
# Listar componentes del kit
suntropy inventory kits panels list
suntropy inventory kits inverters list
suntropy inventory kits batteries list

# Archivar kit (soft delete)
suntropy inventory kits archive <kitId>

# Marcar panel/inversor como destacado
suntropy inventory kits panels featured <kitPanelId>
suntropy inventory kits inverters featured <kitInverterId>

# Buscar fabricantes para los componentes
suntropy inventory manufacturers list
```
