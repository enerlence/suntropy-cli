# Paridad v1 ↔ v2 de la CLI · 202610281428

- Servidor v1: `http://localhost`
- Gateway v2: `http://localhost:8110`
- Resultado: OK 185 · FAIL 0 · ENV 8 · V1_BUG 5 · SKIP 9
- manufacturers, studies and shareables have no delete command: they stay named parity-202610281428-v1/-v2 (studies: parity-202610281428).

| Caso | Estado | Comparación | v1 | v2 | Motivo |
|---|---|---|---|---|---|
| inventory manufacturers create | OK | entity | 0 · 77 ms | 0 · 73 ms |  |
| inventory panels create | OK | entity | 0 · 71 ms | 0 · 74 ms |  |
| inventory panels create-2 | OK | entity | 0 · 71 ms | 0 · 74 ms |  |
| inventory inverters create | OK | entity | 0 · 72 ms | 0 · 80 ms |  |
| inventory inverters create-2 | OK | entity | 0 · 71 ms | 0 · 74 ms |  |
| inventory batteries create | OK | entity | 0 · 72 ms | 0 · 73 ms |  |
| inventory batteries create-2 | OK | entity | 0 · 71 ms | 0 · 73 ms |  |
| inventory chargers create | OK | entity | 0 · 72 ms | 0 · 75 ms |  |
| inventory chargers create-2 | OK | entity | 0 · 73 ms | 0 · 78 ms |  |
| inventory heatpumps create | OK | entity | 0 · 77 ms | 0 · 70 ms |  |
| inventory heatpumps create-2 | OK | entity | 0 · 75 ms | 0 · 78 ms |  |
| inventory custom-asset-types create | OK | entity | 0 · 72 ms | 0 · 73 ms |  |
| inventory custom-assets create | OK | entity | 0 · 76 ms | 0 · 72 ms |  |
| inventory charger-kits create | OK | entity | 0 · 74 ms | 0 · 76 ms |  |
| inventory charger-kits create-2 | OK | entity | 0 · 75 ms | 0 · 74 ms |  |
| inventory heatpump-kits create | OK | entity | 0 · 73 ms | 0 · 78 ms |  |
| inventory heatpump-kits create-2 | OK | entity | 0 · 72 ms | 0 · 78 ms |  |
| inventory custom-fields create | OK | entity | 0 · 71 ms | 0 · 74 ms |  |
| inventory kits panels create | OK | entity | 0 · 72 ms | 0 · 73 ms |  |
| inventory kits inverters create | OK | entity | 0 · 71 ms | 0 · 72 ms |  |
| inventory kits batteries create | OK | entity | 0 · 71 ms | 0 · 72 ms |  |
| inventory kits assemble | OK | entity | 0 · 111 ms | 0 · 86 ms |  |
| inventory kits assemble (second kit, for delete-batch) | OK | entity | 0 · 106 ms | 0 · 82 ms |  |
| projects create | OK | entity | 0 · 71 ms | 0 · 72 ms |  |
| projects files add | OK | entity | 0 · 74 ms | 0 · 75 ms |  |
| studies init (local) | OK | exit | 0 · 60 ms | 0 · 61 ms |  |
| studies set client (local) | OK | exit | 0 · 61 ms | 0 · 60 ms |  |
| studies set market (local) | OK | exit | 0 · 62 ms | 0 · 60 ms |  |
| studies set tariff | OK | raw | 0 · 70 ms | 0 · 77 ms |  |
| studies set prices (local) | OK | exit | 0 · 60 ms | 0 · 60 ms |  |
| studies set consumption --annual --pattern | OK | raw | 0 · 72 ms | 0 · 74 ms |  |
| studies set consumption --monthly (REE profiles) | ENV | raw | 1 · 75 ms | 1 · 84 ms | profiles local sin perfiles REE de 2026: la curva de consumo del estudio sale vacía en los dos caminos (en dev y prod hay datos del año en curso) |
| studies add surface (local) | OK | exit | 0 · 63 ms | 0 · 62 ms |  |
| studies set panel | OK | raw | 0 · 71 ms | 0 · 72 ms |  |
| studies set inverter | OK | raw | 0 · 70 ms | 0 · 73 ms |  |
| studies set custom-assets | OK | raw | 0 · 73 ms | 0 · 74 ms |  |
| studies calculate production | OK | raw | 0 · 86 ms | 0 · 78 ms |  |
| studies calculate-results | ENV | shape | 1 · 62 ms | 1 · 60 ms | profiles local sin perfiles REE de 2026: la curva de consumo del estudio sale vacía en los dos caminos (en dev y prod hay datos del año en curso) |
| studies optimize-peakpower --use-kits | OK | shape | 0 · 124 ms | 0 · 126 ms |  |
| studies set kit | OK | raw | 0 · 112 ms | 0 · 82 ms |  |
| studies save (create) | OK | entity | 0 · 109 ms | 0 · 107 ms |  |
| inventory panels list | OK | raw | 0 · 91 ms | 0 · 90 ms |  |
| inventory panels list --active-only --limit 120 | OK | raw | 0 · 89 ms | 0 · 91 ms |  |
| inventory panels get | OK | entity | 0 · 70 ms | 0 · 70 ms |  |
| inventory panels filter | OK | entity | 0 · 92 ms | 0 · 92 ms |  |
| inventory inverters list | OK | raw | 0 · 94 ms | 0 · 79 ms |  |
| inventory inverters list --active-only --limit 120 | OK | raw | 0 · 90 ms | 0 · 87 ms |  |
| inventory inverters get | OK | entity | 0 · 72 ms | 0 · 73 ms |  |
| inventory inverters filter | OK | entity | 0 · 89 ms | 0 · 90 ms |  |
| inventory batteries list | OK | raw | 0 · 76 ms | 0 · 77 ms |  |
| inventory batteries list --active-only --limit 120 | OK | raw | 0 · 77 ms | 0 · 74 ms |  |
| inventory batteries get | OK | entity | 0 · 73 ms | 0 · 71 ms |  |
| inventory batteries filter | OK | entity | 0 · 77 ms | 0 · 77 ms |  |
| inventory chargers list | OK | raw | 0 · 73 ms | 0 · 79 ms |  |
| inventory chargers list --active-only --limit 120 | OK | raw | 0 · 75 ms | 0 · 78 ms |  |
| inventory chargers get | OK | entity | 0 · 78 ms | 0 · 80 ms |  |
| inventory chargers filter | OK | entity | 0 · 75 ms | 0 · 74 ms |  |
| inventory heatpumps list | OK | raw | 0 · 73 ms | 0 · 75 ms |  |
| inventory heatpumps list --active-only --limit 120 | OK | raw | 0 · 74 ms | 0 · 77 ms |  |
| inventory heatpumps get | OK | entity | 0 · 69 ms | 0 · 72 ms |  |
| inventory heatpumps filter | OK | entity | 0 · 75 ms | 0 · 73 ms |  |
| inventory custom-asset-types list | OK | raw | 0 · 72 ms | 0 · 72 ms |  |
| inventory custom-asset-types list --active-only --limit 120 | OK | raw | 0 · 70 ms | 0 · 73 ms |  |
| inventory custom-asset-types get | OK | entity | 0 · 71 ms | 0 · 102 ms |  |
| inventory custom-asset-types filter | V1_BUG | entity | 1 · 72 ms | 0 · 81 ms | §0.1: POST /custom-asset/type/filter does not exist in v1 (404) |
| inventory custom-assets list | OK | raw | 0 · 75 ms | 0 · 76 ms |  |
| inventory custom-assets list --active-only --limit 120 | OK | raw | 0 · 73 ms | 0 · 80 ms |  |
| inventory custom-assets get | OK | entity | 0 · 75 ms | 0 · 75 ms |  |
| inventory custom-assets filter | V1_BUG | entity | 1 · 72 ms | 0 · 76 ms | §0.1: POST /custom-asset/filter does not exist in v1 (404) |
| inventory charger-kits list | OK | raw | 0 · 75 ms | 0 · 77 ms |  |
| inventory charger-kits list --active-only --limit 120 | OK | raw | 0 · 79 ms | 0 · 78 ms |  |
| inventory charger-kits get | OK | entity | 0 · 70 ms | 0 · 72 ms |  |
| inventory charger-kits filter | OK | entity | 0 · 75 ms | 0 · 78 ms |  |
| inventory heatpump-kits list | V1_BUG | raw | 1 · 74 ms | 0 · 77 ms | §0.1: GET /heat-pump/heatpump-kits is shadowed by @Get(":id") and asks for missing relations |
| inventory heatpump-kits list --active-only --limit 120 | V1_BUG | raw | 1 · 79 ms | 0 · 76 ms | §0.1: GET /heat-pump/heatpump-kits is shadowed by @Get(":id") and asks for missing relations |
| inventory heatpump-kits get | OK | entity | 0 · 70 ms | 0 · 71 ms |  |
| inventory heatpump-kits filter | OK | entity | 0 · 73 ms | 0 · 77 ms |  |
| inventory manufacturers list | OK | raw | 0 · 84 ms | 0 · 92 ms |  |
| inventory custom-fields list | OK | raw | 0 · 70 ms | 0 · 73 ms |  |
| inventory custom-fields get | OK | entity | 0 · 70 ms | 0 · 71 ms |  |
| inventory kits list | OK | raw | 0 · 115 ms | 0 · 105 ms |  |
| inventory kits get | OK | entity | 0 · 113 ms | 0 · 84 ms |  |
| inventory kits filter | OK | entity | 0 · 114 ms | 0 · 114 ms |  |
| inventory kits panels list | OK | raw | 0 · 86 ms | 0 · 85 ms |  |
| inventory kits panels get | OK | entity | 0 · 71 ms | 0 · 73 ms |  |
| inventory kits panels featured | OK | entity | 0 · 72 ms | 0 · 74 ms |  |
| inventory kits inverters list | OK | raw | 0 · 102 ms | 0 · 100 ms |  |
| inventory kits inverters featured | OK | entity | 0 · 72 ms | 0 · 74 ms |  |
| inventory kits batteries list | OK | raw | 0 · 75 ms | 0 · 76 ms |  |
| studies list --client-name | OK | raw | 0 · 170 ms | 0 · 145 ms |  |
| studies list --limit 3 --offset 1 | OK | raw | 0 · 133 ms | 0 · 131 ms |  |
| studies list --from --to | OK | raw | 0 · 188 ms | 0 · 137 ms |  |
| studies list --state (first state of the account) | OK | raw | 0 · 89 ms | 0 · 79 ms |  |
| studies metadata | OK | entity | 0 · 70 ms | 0 · 74 ms |  |
| studies metadata --by-study-id | OK | entity | 0 · 163 ms | 0 · 141 ms |  |
| studies get | OK | entity | 0 · 79 ms | 0 · 79 ms |  |
| studies get --expand all | OK | entity | 0 · 77 ms | 0 · 81 ms |  |
| studies curves consumption --total | OK | entity | 0 · 93 ms | 0 · 92 ms |  |
| studies pull | OK | entity | 0 · 77 ms | 0 · 80 ms |  |
| studies comment | OK | entity | 0 · 102 ms | 0 · 108 ms |  |
| studies comment --as-alexandria | OK | entity | 0 · 109 ms | 0 · 105 ms |  |
| studies calculate-production | OK | shape | 0 · 75 ms | 0 · 77 ms |  |
| studies optimize-surfaces | OK | raw | 0 · 26016 ms | 0 · 15668 ms |  |
| studies save (update, with _id) | OK | entity | 0 · 260 ms | 0 · 209 ms |  |
| shareables create | OK | entity | 0 · 95 ms | 0 · 94 ms |  |
| ppa templates list | OK | raw | 0 · 71 ms | 0 · 70 ms |  |
| ppa templates get | SKIP |  |  |  | missing data from an earlier case or an env var |
| ppa calculate --study | ENV | entity | 1 · 79 ms | 1 · 83 ms | profiles local sin perfiles REE de 2026: la curva de consumo del estudio sale vacía en los dos caminos (en dev y prod hay datos del año en curso) |
| consumption estimate | OK | raw | 0 · 128 ms | 0 · 120 ms |  |
| consumption estimate --monthly-data | ENV | raw | 1 · 111 ms | 1 · 110 ms | profiles: sin --pattern no llega consumptionType y calculatedProfile lee DayDistributionTypes[undefined] (TypeError, 500) en los dos caminos; fallo del servicio profiles, no de v1/v2 |
| consumption estimate --monthly-data --pattern | OK | raw | 0 · 114 ms | 0 · 118 ms |  |
| consumption ree-profiles | OK | raw | 0 · 106 ms | 0 · 109 ms |  |
| consumption periods | OK | raw | 0 · 78 ms | 0 · 72 ms |  |
| consumption periods --market pt | OK | raw | 0 · 69 ms | 0 · 73 ms |  |
| consumption custom-tags | OK | raw | 0 · 69 ms | 0 · 71 ms |  |
| consumption custom-profile-info | SKIP |  |  |  | missing data from an earlier case or an env var |
| consumption from-file --eredes-zip | SKIP |  |  |  | missing data from an earlier case or an env var |
| notifications send | ENV | entity | 1 · 76 ms | 1 · 92 ms | mailing (:8092) no se arranca en local: notifications responde 500 (ECONNREFUSED) en los dos caminos |
| config theme get | OK | raw | 0 · 74 ms | 0 · 73 ms |  |
| config solarform get | OK | raw | 0 · 71 ms | 0 · 73 ms |  |
| config solarform get --with-parameters | OK | raw | 0 · 79 ms | 0 · 78 ms |  |
| config solarform advanced get | OK | raw | 0 · 76 ms | 0 · 74 ms |  |
| config solarform advanced general get | OK | raw | 0 · 74 ms | 0 · 73 ms |  |
| config solarform advanced cover get | OK | raw | 0 · 76 ms | 0 · 74 ms |  |
| config solarform advanced surfaces get | OK | raw | 0 · 72 ms | 0 · 74 ms |  |
| config solarform advanced consumer get | OK | raw | 0 · 84 ms | 0 · 78 ms |  |
| config solarform advanced inclination get | OK | raw | 0 · 73 ms | 0 · 74 ms |  |
| config solarform advanced orientation get | OK | raw | 0 · 74 ms | 0 · 75 ms |  |
| config solarform advanced panels get | OK | raw | 0 · 72 ms | 0 · 74 ms |  |
| config solarform advanced consumption get | OK | raw | 0 · 75 ms | 0 · 73 ms |  |
| config solarform advanced results get | OK | raw | 0 · 74 ms | 0 · 73 ms |  |
| config solarform advanced custom-fields get | OK | raw | 0 · 73 ms | 0 · 74 ms |  |
| solarform config (public view) | V1_BUG | raw | 0 · 73 ms | 0 · 77 ms | C10: the v1 route resolves the form by Origin, which the CLI does not send |
| solarform simple | OK | entity | 0 · 761 ms | 0 · 761 ms |  |
| solarform calculate | OK | entity | 0 · 739 ms | 0 · 754 ms |  |
| projects list | OK | raw | 0 · 72 ms | 0 · 72 ms |  |
| projects get | OK | entity | 0 · 73 ms | 0 · 72 ms |  |
| projects files list | OK | entity | 0 · 70 ms | 0 · 71 ms |  |
| templates list | OK | raw | 0 · 74 ms | 0 · 73 ms |  |
| templates list --type generic | OK | raw | 0 · 71 ms | 0 · 73 ms |  |
| geocode resolve | ENV | raw | 1 · 70 ms | 1 · 71 ms | sin GOOGLE_GEOCODING_API_KEY ni GOOGLE_SOLAR_API_KEY en el Solar local: los dos caminos fallan con MISSING_API_KEY |
| geocode reverse | ENV | raw | 1 · 68 ms | 1 · 71 ms | sin GOOGLE_GEOCODING_API_KEY ni GOOGLE_SOLAR_API_KEY en el Solar local: los dos caminos fallan con MISSING_API_KEY |
| satvolt credits balance | OK | raw | 0 · 73 ms | 0 · 73 ms |  |
| satvolt credits packs | ENV | raw | 1 · 68 ms | 1 · 69 ms | payments (:8098, Stripe) no se arranca en local: la v1 no conecta y el gateway no tiene PAYMENTS_URL |
| satvolt credits checkout (URL only, nothing is paid) | SKIP |  |  |  | missing data from an earlier case or an env var |
| satvolt usage | OK | raw | 0 · 157 ms | 0 · 143 ms |  |
| satvolt campaigns list | OK | raw | 0 · 98 ms | 0 · 98 ms |  |
| satvolt templates list | OK | raw | 0 · 73 ms | 0 · 71 ms |  |
| inventory panels update | OK | entity | 0 · 73 ms | 0 · 74 ms |  |
| inventory inverters update | OK | entity | 0 · 73 ms | 0 · 76 ms |  |
| inventory batteries update | OK | entity | 0 · 72 ms | 0 · 74 ms |  |
| inventory chargers update | OK | entity | 0 · 73 ms | 0 · 75 ms |  |
| inventory heatpumps update | OK | entity | 0 · 73 ms | 0 · 73 ms |  |
| inventory custom-asset-types update | OK | entity | 0 · 74 ms | 0 · 72 ms |  |
| inventory custom-assets update | OK | entity | 0 · 71 ms | 0 · 77 ms |  |
| inventory charger-kits update | OK | entity | 0 · 76 ms | 0 · 76 ms |  |
| inventory heatpump-kits update | OK | entity | 0 · 75 ms | 0 · 75 ms |  |
| inventory custom-fields update | OK | entity | 0 · 71 ms | 0 · 75 ms |  |
| inventory kits update | OK | entity | 0 · 85 ms | 0 · 89 ms |  |
| inventory kits panels update | OK | entity | 0 · 73 ms | 0 · 107 ms |  |
| inventory kits inverters update | OK | entity | 0 · 83 ms | 0 · 80 ms |  |
| inventory kits archive | OK | entity | 0 · 82 ms | 0 · 88 ms |  |
| projects update | OK | entity | 0 · 76 ms | 0 · 75 ms |  |
| config theme set (same value) | OK | raw | 0 · 74 ms | 0 · 75 ms |  |
| config solarform update (same title) | OK | raw | 0 · 77 ms | 0 · 77 ms |  |
| config solarform advanced update (same cover title) | OK | raw | 0 · 84 ms | 0 · 91 ms |  |
| config solarform advanced cover set (same cover title) | OK | raw | 0 · 77 ms | 0 · 91 ms |  |
| config solarform create | SKIP |  |  |  | singleton of the tenant: the second path would get 409 CONFLICT |
| config solarform advanced delete | SKIP |  |  |  | deletes the tenant advanced configuration |
| config theme edit / config solarform edit / advanced <section> edit | SKIP |  |  |  | opens $EDITOR |
| config solarform advanced init-default | SKIP |  |  |  | §4: v1 only (V2_KEY_NOT_SUPPORTED) |
| solarform statistics --create/--update | SKIP |  |  |  | §4: v1 only (V2_KEY_NOT_SUPPORTED) |
| projects files remove | OK | entity | 0 · 76 ms | 0 · 74 ms |  |
| projects delete | OK | entity | 0 · 71 ms | 0 · 73 ms |  |
| projects get after delete | OK | exit | 1 · 71 ms | 1 · 72 ms |  |
| inventory kits delete-batch | OK | raw | 0 · 70 ms | 0 · 74 ms |  |
| inventory kits delete | OK | entity | 0 · 78 ms | 0 · 84 ms |  |
| inventory kits get after delete | OK | exit | 1 · 114 ms | 1 · 73 ms |  |
| inventory kits panels delete | OK | entity | 0 · 71 ms | 0 · 73 ms |  |
| inventory kits inverters delete | OK | entity | 0 · 69 ms | 0 · 74 ms |  |
| inventory kits batteries delete | OK | entity | 0 · 72 ms | 0 · 75 ms |  |
| inventory custom-fields delete | OK | entity | 0 · 74 ms | 0 · 72 ms |  |
| inventory charger-kits delete-batch | OK | raw | 0 · 70 ms | 0 · 72 ms |  |
| inventory charger-kits delete | OK | entity | 0 · 73 ms | 0 · 74 ms |  |
| inventory charger-kits get after delete | OK | exit | 1 · 69 ms | 1 · 73 ms |  |
| inventory heatpump-kits delete-batch | OK | raw | 0 · 72 ms | 0 · 72 ms |  |
| inventory heatpump-kits delete | OK | entity | 0 · 71 ms | 0 · 74 ms |  |
| inventory heatpump-kits get after delete | OK | exit | 1 · 70 ms | 1 · 73 ms |  |
| inventory custom-assets delete | OK | entity | 0 · 71 ms | 0 · 75 ms |  |
| inventory custom-assets get after delete | OK | exit | 1 · 69 ms | 1 · 71 ms |  |
| inventory custom-asset-types delete | OK | entity | 0 · 70 ms | 0 · 72 ms |  |
| inventory custom-asset-types get after delete | OK | exit | 1 · 69 ms | 1 · 72 ms |  |
| inventory panels delete-batch | OK | raw | 0 · 83 ms | 0 · 72 ms |  |
| inventory panels delete | OK | entity | 0 · 74 ms | 0 · 79 ms |  |
| inventory panels get after delete | OK | exit | 1 · 70 ms | 1 · 73 ms |  |
| inventory inverters delete-batch | OK | raw | 0 · 71 ms | 0 · 74 ms |  |
| inventory inverters delete | OK | entity | 0 · 69 ms | 0 · 74 ms |  |
| inventory inverters get after delete | OK | exit | 1 · 69 ms | 1 · 78 ms |  |
| inventory batteries delete-batch | OK | raw | 0 · 72 ms | 0 · 72 ms |  |
| inventory batteries delete | OK | entity | 0 · 72 ms | 0 · 73 ms |  |
| inventory batteries get after delete | OK | exit | 1 · 70 ms | 1 · 71 ms |  |
| inventory chargers delete-batch | OK | raw | 0 · 73 ms | 0 · 77 ms |  |
| inventory chargers delete | OK | entity | 0 · 75 ms | 0 · 72 ms |  |
| inventory chargers get after delete | OK | exit | 1 · 68 ms | 1 · 71 ms |  |
| inventory heatpumps delete-batch | OK | raw | 0 · 80 ms | 0 · 80 ms |  |
| inventory heatpumps delete | OK | entity | 0 · 73 ms | 0 · 74 ms |  |
| inventory heatpumps get after delete | OK | exit | 1 · 71 ms | 1 · 70 ms |  |

## Detalle

### studies set consumption --monthly (REE profiles) · ENV

profiles local sin perfiles REE de 2026: la curva de consumo del estudio sale vacía en los dos caminos (en dev y prod hay datos del año en curso)

```
v1: suntropy studies set consumption --file /var/folders/v4/vd4796n93t9b_ky321k_91qr0000gn/T/parity-v1-dCcZkP/study.json --monthly {"1":330,"2":330,"3":330,"4":330,"5":330,"6":330,"7":330,"8":330,"9":330,"10":330,"11":330,"12":330} --tariff 2.0TD
v2: suntropy studies set consumption --file /var/folders/v4/vd4796n93t9b_ky321k_91qr0000gn/T/parity-v2-upezbP/study.json --monthly {"1":330,"2":330,"3":330,"4":330,"5":330,"6":330,"7":330,"8":330,"9":330,"10":330,"11":330,"12":330} --tariff 2.0TD
```

v1 stderr:
```
{"error":true,"message":"Failed to fetch REE profiles"}
```

v2 stderr:
```
{"error":true,"message":"Failed to fetch REE profiles"}
```

### studies calculate-results · ENV

profiles local sin perfiles REE de 2026: la curva de consumo del estudio sale vacía en los dos caminos (en dev y prod hay datos del año en curso)

```
v1: suntropy studies calculate-results --file /var/folders/v4/vd4796n93t9b_ky321k_91qr0000gn/T/parity-v1-dCcZkP/study.json
v2: suntropy studies calculate-results --file /var/folders/v4/vd4796n93t9b_ky321k_91qr0000gn/T/parity-v2-upezbP/study.json
```

v1 stderr:
```
{"error":true,"message":"No consumption curve. Use: studies set consumption"}
```

v2 stderr:
```
{"error":true,"message":"No consumption curve. Use: studies set consumption"}
```

### inventory custom-asset-types filter · V1_BUG

§0.1: POST /custom-asset/type/filter does not exist in v1 (404)

```
v1: suntropy inventory custom-asset-types filter --query {"label":"parity-202610281428-v1"}
v2: suntropy inventory custom-asset-types filter --query {"label":"parity-202610281428-v2"}
```

v1 stderr:
```
{"error":true,"message":"Not Found","status":404,"details":{"statusCode":404,"message":"Cannot POST /custom-asset/type/filter?limit=20&offset=0","error":"Not Found"}}
```

### inventory custom-assets filter · V1_BUG

§0.1: POST /custom-asset/filter does not exist in v1 (404)

```
v1: suntropy inventory custom-assets filter --query {"label":"parity-202610281428-v1"}
v2: suntropy inventory custom-assets filter --query {"label":"parity-202610281428-v2"}
```

v1 stderr:
```
{"error":true,"message":"Not Found","status":404,"details":{"statusCode":404,"message":"Cannot POST /custom-asset/filter?limit=20&offset=0","error":"Not Found"}}
```

### inventory heatpump-kits list · V1_BUG

§0.1: GET /heat-pump/heatpump-kits is shadowed by @Get(":id") and asks for missing relations

```
v1: suntropy inventory heatpump-kits list --limit 5
v2: suntropy inventory heatpump-kits list --limit 5
```

v1 stderr:
```
{"error":true,"message":"Internal Server Error","status":500,"details":{"statusCode":500,"message":"Internal server error"}}
```

### inventory heatpump-kits list --active-only --limit 120 · V1_BUG

§0.1: GET /heat-pump/heatpump-kits is shadowed by @Get(":id") and asks for missing relations

```
v1: suntropy inventory heatpump-kits list --active-only --limit 120
v2: suntropy inventory heatpump-kits list --active-only --limit 120
```

v1 stderr:
```
{"error":true,"message":"Internal Server Error","status":500,"details":{"statusCode":500,"message":"Internal server error"}}
```

### ppa calculate --study · ENV

profiles local sin perfiles REE de 2026: la curva de consumo del estudio sale vacía en los dos caminos (en dev y prod hay datos del año en curso)

```
v1: suntropy ppa calculate --study 6ae206a8b75fbc1484055a51
v2: suntropy ppa calculate --study 6ae206a8b75fbc1484055a53
```

v1 stderr:
```
{"error":true,"message":"Internal Server Error","status":500,"details":{"statusCode":500,"message":"Internal server error"}}
```

v2 stderr:
```
{"error":true,"message":"Solar could not complete the request","status":500,"code":"UPSTREAM_ERROR"}
```

### consumption estimate --monthly-data · ENV

profiles: sin --pattern no llega consumptionType y calculatedProfile lee DayDistributionTypes[undefined] (TypeError, 500) en los dos caminos; fallo del servicio profiles, no de v1/v2

```
v1: suntropy consumption estimate --annual 3600 --monthly-data {"1":300,"2":300,"3":300,"4":300,"5":300,"6":300,"7":300,"8":300,"9":300,"10":300,"11":300,"12":300} --start-date 2025-01-01 --end-date 2025-12-31
v2: suntropy consumption estimate --annual 3600 --monthly-data {"1":300,"2":300,"3":300,"4":300,"5":300,"6":300,"7":300,"8":300,"9":300,"10":300,"11":300,"12":300} --start-date 2025-01-01 --end-date 2025-12-31
```

v1 stderr:
```
{"error":true,"message":"Internal Server Error","status":500,"details":{"statusCode":500,"message":"Internal server error"}}
```

v2 stderr:
```
{"error":true,"message":"Solar could not complete the request","status":502,"code":"UPSTREAM_UNAVAILABLE"}
```

### notifications send · ENV

mailing (:8092) no se arranca en local: notifications responde 500 (ECONNREFUSED) en los dos caminos

```
v1: suntropy notifications send --to-user d28e84ec-8b34-4497-b78f-8936f2330939 --title Parity --message parity parity-202610281428 --as-alexandria
v2: suntropy notifications send --to-user d28e84ec-8b34-4497-b78f-8936f2330939 --title Parity --message parity parity-202610281428 --as-alexandria
```

v1 stderr:
```
{"error":true,"message":"Internal Server Error","status":500,"details":{"statusCode":500,"message":"Internal server error"}}
```

v2 stderr:
```
{"error":true,"message":"Solar could not complete the request","status":502,"code":"UPSTREAM_UNAVAILABLE"}
```

### solarform config (public view) · V1_BUG

C10: the v1 route resolves the form by Origin, which the CLI does not send

```
v1: suntropy solarform config
v2: suntropy solarform config
```

### geocode resolve · ENV

sin GOOGLE_GEOCODING_API_KEY ni GOOGLE_SOLAR_API_KEY en el Solar local: los dos caminos fallan con MISSING_API_KEY

```
v1: suntropy geocode resolve --address Avenida de la Constitución 1, Sevilla --country es
v2: suntropy geocode resolve --address Avenida de la Constitución 1, Sevilla --country es
```

v1 stderr:
```
{"error":true,"message":"Neither GOOGLE_GEOCODING_API_KEY nor GOOGLE_SOLAR_API_KEY is configured on the solar service environment","status":500,"details":{"code":"MISSING_API_KEY","message":"Neither GOOGLE_GEOCODING_API_KEY nor GOOGLE_SOLAR_API_KEY is configured on the solar service environment"}}
```

v2 stderr:
```
{"error":true,"message":"Solar could not complete the request","status":500,"code":"MISSING_API_KEY"}
```

### geocode reverse · ENV

sin GOOGLE_GEOCODING_API_KEY ni GOOGLE_SOLAR_API_KEY en el Solar local: los dos caminos fallan con MISSING_API_KEY

```
v1: suntropy geocode reverse --lat 37.3861 --lng -5.9926
v2: suntropy geocode reverse --lat 37.3861 --lng -5.9926
```

v1 stderr:
```
{"error":true,"message":"Neither GOOGLE_GEOCODING_API_KEY nor GOOGLE_SOLAR_API_KEY is configured on the solar service environment","status":500,"details":{"code":"MISSING_API_KEY","message":"Neither GOOGLE_GEOCODING_API_KEY nor GOOGLE_SOLAR_API_KEY is configured on the solar service environment"}}
```

v2 stderr:
```
{"error":true,"message":"Solar could not complete the request","status":500,"code":"MISSING_API_KEY"}
```

### satvolt credits packs · ENV

payments (:8098, Stripe) no se arranca en local: la v1 no conecta y el gateway no tiene PAYMENTS_URL

```
v1: suntropy satvolt credits packs
v2: suntropy satvolt credits packs
```

v1 stderr:
```
{"error":true,"message":"Unknown error"}
```

v2 stderr:
```
{"error":true,"message":"This API is not available in this environment","status":503,"code":"UPSTREAM_NOT_CONFIGURED","details":{"requestId":"6158d8a4-ede2-4568-b478-af6a5a44e480"}}
```
