Diagnostica y corrige pasos del pipeline que fallan o se quedan colgados en una campaña de Satvolt, sin relanzarla: localiza qué paso y qué leads están afectados, entiende la causa y vuelve a ejecutar solo lo necesario con `suntropy satvolt`.

## Parámetros de entrada

| Parámetro | Obligatorio | Default |
|---|---|---|
| Id de la campaña | Sí | - |
| Paso o leads concretos que fallan | No | se detectan en el paso 1 |

Relanzar pasos gasta los créditos de ese paso por lead (y con `--continue`, también los de los pasos posteriores). Una ejecución que vuelve a fallar no cobra. Enséñale al usuario cuántos leads y cuántos créditos implica, y pide confirmación.

## Paso 1: Localizar el fallo

```bash
suntropy satvolt campaigns get <id>                          # estado de la campaña y leads por estado
suntropy satvolt campaigns funnel <id> --format human        # failure / processing / pending por paso
suntropy satvolt campaigns logs <id> --level error --limit 50 --format human
```

- **`failure` > 0 en un paso:** saca sus leads con `leads list <id> --step <uid|ACCIÓN> --step-status failure`.
- **`processing` que no baja:** son pasos asíncronos esperando su webhook. Lístalos con `--step-status processing`.
- **Leads con `state: failed` y `stateError`:** `leads list <id> --state failed --format human` muestra el motivo.

Detalle de un lead: estado de cada paso, historial con `errorMessage` y claves de fullData:

```bash
suntropy satvolt leads get <id> <leadId> --format json
```

## Paso 2: Identificar la causa

| Síntoma (logs o `stateError`) | Causa | Solución |
|---|---|---|
| FIND_ROOFTOP: `ECONNREFUSED ...:8090` | En local, falta el servicio `sharing` de Suntropy, donde se suben las imágenes | Levántalo y relanza el paso |
| ESTIMATE_CONSUMPTION: `ECONNREFUSED ...:8765` o `Consumption model returned 5xx` | Modelo de consumo caído | Levántalo y relanza el paso |
| ESTIMATE_CONSUMPTION: `Catastral parcel with reference is required` | El lead no tiene parcela (FIND_ROOFTOP falló o no la encontró) | Arregla antes FIND_ROOFTOP en ese lead |
| QUALIFY o AI_AGENT se quedan en `processing` | El agente no llamó al webhook (Suntropy AI o Devic caídos, o no alcanzan la URL del backend) | Comprueba los servicios; cuando lleguen, relanza el paso |
| AI_AGENT `skipped` en muchos leads | `skipIfEmpty` apunta a un dato vacío (p. ej. LinkedIn de empresa no encontrado) | No es un error: no se cobra y el lead sigue |
| El paso sale `success` pero la columna llega vacía | El agente terminó sin error respondiendo que no encontró el dato | Mídelo con `campaigns funnel <id> --mode success`; define `successIf` en el paso y, si no es determinista, `maxRetries` |
| Paso con config inválida (`VALIDATION_ERROR` al editar) | Falta un campo obligatorio de `configSchema` | Corrígelo con `steps set <id> <uid> --config ...` |
| Resultados raros en todos los leads (p. ej. consumo con confianza "baja") | Configuración mejorable, no un fallo: `cnaeTemplate` vacío, orden de pasos… | Ver `satvolt-probe-to-full-campaign`, paso 5 |

Si trabajas contra el backend local, comprueba los servicios que usa el pipeline:

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(8099|8090|8765|8500|8033) '
```

## Paso 3: Elegir cómo relanzar

| Situación | Comando | Qué hace |
|---|---|---|
| Un paso falló en algunos leads y el resto del pipeline de esos leads está bien | `leads run-step <id> <leadId> <uid\|ACCIÓN>` | Solo ese paso; no encola los siguientes |
| El fallo cortó la cadena del lead (los pasos siguientes nunca se ejecutaron) | `leads run-step <id> <leadId> <uid> --continue` | Ese paso y el resto del pipeline |
| Un paso nuevo que ningún lead ha ejecutado, sobre todos los leads | `steps run <id> <uid>` | Se lanza en todos los leads que el pipeline habría alcanzado y continúa |
| Quieres añadir un paso al final y ejecutarlo | `campaigns resume <id> --action A --config @c.json` | Lo añade antes de COMPLETE y lo ejecuta |
| La configuración invalida la campaña entera | `campaigns reset <id> --yes --start` | Borra leads y resultados y vuelve a pagarlo todo (último recurso) |

**Reglas de `leads run-step`:**
- El paso se indica por uid, por acción si aparece una sola vez, por nombre (`"Decisor LinkedIn"`) o por su clave de fullData (`AMBIGUOUS_STEP` lista los uids).
- **Modo por defecto:** un lead `completed` o `unQualified` conserva su estado. Solo cambia si el paso cambia el resultado del filtro: QUALIFY puede rescatar un lead descartado, y un paso que ahora lo descarta lo deja en `unQualified`.
- **`--continue`:** vuelve a ejecutar y cobrar todos los pasos siguientes.
- **`DEPENDENCY_NOT_MET`:** el lead no completó la dependencia (p. ej. FIND_ROOFTOP antes de ESTIMATE_CONSUMPTION). Relanza primero la dependencia; `--force` solo si sabes que el dato existe.
- **`STEP_IN_PROGRESS`:** el paso asíncrono aún espera su webhook. Espera o investiga ese servicio.
- **Registro:** la ejecución queda marcada como `manual` y cobra los créditos del paso.

**Muchos leads.** Recorre la lista y relanza uno a uno. Si falló la primera ejecución de un paso en casi todos los leads, comprueba antes con `steps list <id>` si el paso sale `runnable`: entonces `steps run` lo lanza en bloque.

```bash
suntropy satvolt leads list <id> --step FIND_ROOFTOP --step-status failure --limit 200 --fields idLead --format csv \
  | tail -n +2 | while read lead; do
      suntropy satvolt leads run-step <id> "$lead" FIND_ROOFTOP --continue
    done
```

## Paso 4: Verificar

```bash
suntropy satvolt campaigns funnel <id> --format human            # failure del paso debe bajar
suntropy satvolt leads get <id> <leadId>                         # estado del paso: success
suntropy satvolt leads full-data <id> <leadId> --keys consumptionEstimate
suntropy satvolt campaigns logs <id> --since <lastTs> --level error
```

- **Pasos síncronos** (FIND_ROOFTOP, ESTIMATE_CONSUMPTION): el resultado está en segundos.
- **Pasos asíncronos** (QUALIFY, AI_AGENT): tardan lo que el agente, de uno a varios minutos.
- **Cierre de la campaña:** vuelve a `completed` cuando todos sus leads llegan a un estado final.

Resume al usuario: causa, leads afectados, qué se relanzó y con qué modo, créditos consumidos (`campaigns usage <id>`) y leads que siguen fallando.
