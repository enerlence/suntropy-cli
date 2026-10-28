# Arnés de paridad v1 ↔ v2

Ejecuta todos los comandos de la CLI dos veces contra un backend real: una con un JWT (camino v1, rutas internas de cada servicio) y otra con una clave `sun_` (camino v2, por el gateway). Compara la salida `--format json` de los dos caminos y escribe un informe.

## Qué necesita

| Variable o flag | Obligatorio | Qué es |
|---|---|---|
| `--server <url>` (o `PARITY_SERVER`) | Sí | Servidor v1. En local, `http://localhost` (la CLI usa un puerto por servicio: solar 8086, security 8080, profiles 8085, periods 8084, notifications 8093, templates 8090, satvolt 8099, payments 8098). |
| `SUNTROPY_GATEWAY_URL` | Sí en local | Gateway de la v2 (p. ej. `http://localhost:8087`). En dev y prod se deriva de `--server`. |
| `PARITY_V1_TOKEN` | Sí | JWT de una persona **admin** de la cuenta de prueba (o API key antigua). |
| `PARITY_V2_TOKEN` | Sí | Clave `sun_…` **de la misma cuenta**, con los 17 scopes de la CLI (`suntropy auth login --web` sin `--scopes`). |
| `PARITY_NOTIFY_USER` | No | `userUID` de una persona de la cuenta para `notifications send`. Sin ella, el caso se salta. |
| `PARITY_CUSTOM_PROFILE_ID` | No | Id de un perfil de consumo personalizado (`consumption custom-profile-info`). |
| `PARITY_EREDES_ZIP` | No | Ruta a un ZIP de E-Redes (`consumption from-file`). |
| `PARITY_REGION`, `PARITY_SUBREGION` | No | Región para `solarform simple`: el `name` de periods, no la etiqueta (por defecto, `andalucia` / `sevilla`). |
| `PARITY_STUDY_STATE` | No | Nombre de un estado de estudio para `studies list --state` (por defecto, `Pendiente`). |
| `--out <dir>` | No | Carpeta del informe (por defecto, `./parity-out`). |
| `--only <regex>` | No | Sólo los casos cuyo id coincide. Ojo: los casos dependen de los anteriores (crear → leer…), así que filtrar puede dejar casos en `SKIP`. |
| `--dist` | No | Usa `dist/bin/suntropy.js` (tras `npm run build`) en lugar del código fuente con `tsx`. |
| `--timeout <ms>` | No | Tiempo máximo por comando (por defecto, 120000). |

La cuenta necesita créditos (`studies save`, `solarform simple|calculate`) y, para que los casos de lectura comparen algo, algo de inventario y plantillas. No se compra nada: `satvolt credits checkout` sólo comprueba que devuelve una URL https.

## Cómo se ejecuta

```bash
cd suntropy-cli
export PARITY_V1_TOKEN=<jwt>            # suntropy --server http://localhost auth login …; cat ~/.suntropy/config.json
export PARITY_V2_TOKEN=sun_…            # suntropy auth login --web
export SUNTROPY_GATEWAY_URL=http://localhost:8087
npm run parity -- --server http://localhost --out ./parity-out
```

Sale con código 0 si no hay ningún `FAIL` (los `ENV` no cuentan).

## Qué hace

1. Prepara un `HOME` temporal por camino con un perfil que lleva el servidor, el token y el gateway. No toca `~/.suntropy`.
2. Recorre la matriz de `cases.ts` **en orden**: crear → leer → actualizar → borrar. Cada caso se ejecuta primero con el JWT y después con la clave.
3. Cada camino crea sus propios datos con el nombre `parity-<run>-v1` o `parity-<run>-v2` (`<run>` es la fecha y hora UTC, `YYYYMMDDHHmm`): fabricante, dispositivos (dos de los que tienen borrado en lote), tipo, campo y activo personalizados, kits de cargador y de bomba, componentes de kit, dos kits, proyecto con un fichero y un estudio (cliente `parity-<run>`, con tarifa, consumo, superficie, panel, inversor, activos, producción y kit). Los ids de cada camino se guardan para los casos siguientes.
4. Al final borra lo que ningún caso de borrado haya quitado. Los fabricantes, los estudios y los shareables no tienen comando de borrado en la CLI: se quedan, con el prefijo `parity-<run>`.

Los ajustes de la cuenta (tema, SolarForm, SolarForm avanzado) son únicos por cuenta: se leen y se escriben **con el valor que ya tienen**. `config solarform create`, `advanced delete` y los `edit` (abren `$EDITOR`) se marcan como `SKIP`, igual que las tres exclusiones de §4.

## Cómo compara

Cada caso declara su comparación:

| Modo | Para | Qué se normaliza |
|---|---|---|
| `entity` | Lo que crea o lee un camino | Los ids que ha creado cada camino pasan a `<nombre>` (`<panel>`, `<kit>`, `<surface>`…), `parity-<run>-v1|v2` pasa a `parity-<run>`, las fechas ISO y los instantes en milisegundos (`…MomentMS`) a `<date>`, y se quitan las diferencias permitidas de §1.8. |
| `raw` | Listados y lecturas de la cuenta, que los dos caminos ven igual | Sólo se quitan las diferencias permitidas de §1.8. |
| `shape` | `calculate-production`, `calculate-results`, `optimize-peakpower` | Sólo claves y tipos (§1.8.6: los números de la producción cambian hasta que A5 esté desplegado). |
| `exit` | Pasos locales y lecturas tras un borrado | Sólo el código de salida. |
| `url` | `satvolt credits checkout` | Que los dos devuelvan `{ url: "https://…" }`. |

Diferencias permitidas (§1.8) que siempre se quitan: `creationUserUID`, `lastEditUserUID`, `ownerUserUID`, `uploadedByUserUID`, `assignedUserUID`, `isOwner`, `canEdit`, `password`, `passwordConfirm` y el `client` del tema.

## El informe

- `parity-report.json`: resumen, ids creados por cada camino, limpieza final y, por caso, los argumentos, el código de salida y la duración de cada camino, el estado y las diferencias (ruta JSON, valor v1 y valor v2).
- `parity-report.md`: la misma información en una tabla, con el detalle de cada caso que no es `OK`.

Estados:

- `OK`: misma salida (tras normalizar) y mismo código de salida.
- `FAIL`: códigos de salida distintos o JSON distinto.
- `V1_BUG`: la v1 falla (o responde vacío) por un fallo que el contrato documenta (§0.1: `custom-assets filter`, `custom-asset-types filter`, `heatpump-kits list`; C10: `solarform config` sin `Origin`) y la v2 funciona.
- `ENV`: los dos caminos fallan por la misma causa ajena a la CLI y a la API, y la v2 da el error esperado (`code`, `status` o `message` del caso). No cuenta como `FAIL`. Si sólo falla un camino, o la v2 da otro error, es `FAIL`. Cada caso declara su causa en `env.cause` y sale en el informe. Los de hoy, en local:

  | Caso | Causa | Error v2 esperado |
  |---|---|---|
  | `studies set consumption --monthly`, `studies calculate-results`, `ppa calculate --study` | profiles local no tiene perfiles REE de 2026 (año en curso, que la CLI usa fijo): la curva de consumo sale vacía | mensaje de la CLI / `UPSTREAM_ERROR` 500 |
  | `consumption estimate --monthly-data` (sin `--pattern`) | fallo de profiles: sin `consumptionType` lee `DayDistributionTypes[undefined]` (500). Con `--pattern` funciona y se compara en otro caso | `UPSTREAM_UNAVAILABLE` 502 |
  | `notifications send` | mailing (:8092) no se arranca: notifications responde 500 | `UPSTREAM_UNAVAILABLE` 502 |
  | `geocode resolve` y `reverse` | sin claves de Google en el Solar local | `MISSING_API_KEY` 500 |
  | `satvolt credits packs` | payments (Stripe) no se arranca | `UPSTREAM_NOT_CONFIGURED` 503 |
- `SKIP`: el caso no se ejecuta (falta un dato de un caso anterior o una variable, o se salta a propósito).

## Añadir un caso

En `cases.ts`, un objeto `ParityCase` en la fase que toque (`createCases`, `readCases`, `updateCases`, `deleteCases`) con `id`, `args(ctx)` (devuelve `undefined` para saltarlo), `compare` y, si crea algo, `capture` (guarda el id en `ctx.ids`) y `cleanup` (el borrado de reserva). Un caso de borrado declara `removes` con la clave de `cleanup` que resuelve.
