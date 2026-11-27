# Correcciones QA de Shalendar — 27/11/2026

Resultado: **19 de 19 incidencias corregidas**, sin incidencias del encargo pendientes conocidas. El diseño móvil existente se conserva. No se han aplicado cambios por las observaciones transitorias T-01/T-02.

## Rama y aislamiento

- Rama de implementación: `t3/fix-shalendar-qa-issues`.
- Worktree: `C:\Users\muris\.t3\worktrees\shalendar\t3-6d403ded-d45aac642125e4b7`.
- Commit de partida: `0ee2259`, que contiene la base móvil `07fca8e` y el informe inicial.
- Se han utilizado únicamente bases de pruebas en memoria. No se ha usado ni modificado el plan `cena-navidad-0e2a`, el checkout principal, sus bases o sus servidores.
- No se ha hecho push, PR ni merge. El SHA definitivo se entrega junto con este documento en la respuesta del programador.

## Evidencia y validación

Los originales `INFORME-2026-11-27.md`, `browser-evidence.json` y `api-evidence.json` permanecen idénticos a la base. Se reprodujo el harness con los módulos originales de API/SQLite extraídos del commit de partida en archivos temporales, eliminados después: **18 correctas / 18 fallidas**, igual que la auditoría inicial. El resultado separado está en [api-evidence-baseline-reproduced.json](api-evidence-baseline-reproduced.json).

Tras las correcciones, el mismo harness devuelve **36/36 correctas**, con resultado en [api-evidence-corrections.json](api-evidence-corrections.json). Ahora `audit-probes.mts` escribe en ese archivo separado y devuelve un código de error si falla una comprobación; nunca sobrescribe la evidencia inicial.

Validación final:

| Comando | Resultado |
| --- | --- |
| `npm test` | 42/42 pruebas correctas: 13 existentes, 18 regresiones de servidor y 11 de interfaz |
| `npm run typecheck` | Correcto, cliente y servidor |
| `npm run build` | Correcto, cliente Vite y servidor TypeScript |
| `node --no-warnings --import tsx docs/qa/audit-probes.mts` | 36/36 comprobaciones correctas |
| `git diff --check` | Correcto |

Las regresiones de servidor se ejecutan **tanto contra SQLite `:memory:` como contra PostgreSQL mediante PGlite**, con la migración SQL real y `PostgresShalendarStore`. Las pruebas de interfaz montan los componentes React reales en JSDOM; los flujos de PlanView usan la API Hono y SQLite en memoria. Además hay pruebas de snapshots SSE reales de Hono, iniciales y posteriores a una actualización externa. El cliente EventSource se simula para verificar reapertura, descarte de eventos antiguos y cambios de sesión sin depender de un servidor externo.

## Resolución por incidencia

| ID | Estado | Corrección y regresión |
| --- | --- | --- |
| QA-01 | Corregida | La identidad de lectura procede exclusivamente de un token válido del plan. Se ignoran `X-Participant-Id` y `participantId` tanto en GET como en SSE. Se prueban visitantes, tokens inválidos, identidad de otro participante y snapshot inicial/externo del stream. |
| QA-02 | Corregida | Elegir o limpiar la ganadora requiere el token de organizador del plan. Se rechazan visitantes, participantes y organizadores de otro plan. |
| QA-03 | Corregida | PATCH/DELETE de tareas requieren sesión de miembro del plan o token de organizador. Cualquier miembro autenticado puede colaborar, completar, reasignar y eliminar tareas. Se prueban tanto el rechazo anónimo como la colaboración legítima. |
| QA-04 | Corregida | Borrar un coche requiere ser su conductor autenticado o el organizador. Se rechazan otros miembros, visitantes e IDs falsificados; ambos caminos autorizados se prueban. |
| QA-05 | Corregida | Crear encuestas, opciones, tareas y fechas candidatas requiere sesión del participante. La autoría se deriva del token; si se proporciona un ID debe coincidir con esa sesión. Ambos almacenes comprueban también la pertenencia de autores al plan. Se cubren las cuatro rutas, suplantación y tokens de otro plan. |
| QA-06 | Corregida | Ambos almacenes verifican que existen la encuesta y la opción, y que esta pertenece exactamente a esa encuesta y plan antes de guardar la ganadora. Se prueban ID inexistente, opción de otra encuesta, elección válida y borrado de elección mediante `null`. |
| QA-07 | Corregida | Ambos almacenes validan los responsables al crear y actualizar tareas. Se rechaza un participante de otro plan y se comprueba una reasignación válida. |
| QA-08 | Corregida | Validación real del calendario, incluyendo años bisiestos, para disponibilidad, votos, propuestas, comentarios y fechas de confirmación. Se rechazan días imposibles sin persistirlos; se acepta el 29/02/2028. |
| QA-09 | Corregida | Meses limitados a 01–12 y año válido; se comprueba el intervalo efectivo después de aplicar valores por defecto o actualizaciones parciales en ambos almacenes. Se prueba también modificar solamente uno de los extremos. |
| QA-10 | Corregida | Cada fecha, hora 00:00–23:59 y zona IANA se valida por separado. Ambos almacenes verifican que el final no preceda al inicio ni exista sin inicio, combinando el cambio parcial con los valores persistidos. Se conserva la eliminación coherente de confirmación con `null`. |
| QA-11 | Corregida | El deadline debe ser un timestamp interpretable con día real, hora válida y offset explícito. Validación en creación y actualización, permitiendo `null` para retirarlo. |
| QA-12 | Corregida | Se rechazan PIN de 1–3 caracteres y mayores de 12 antes de modificar el perfil, tanto por API como en ambos almacenes. Se demuestra que el PIN original sigue recuperando la sesión y que una cadena vacía elimina el PIN intencionalmente. |
| QA-13 | Corregida | Exportación reservada al organizador, sin caché y con todos los votos guardados, incluso durante voto oculto. El cliente realiza una descarga autenticada mediante fetch y Blob, muestra errores y libera la URL temporal. Se comprueba que no se exportan tokens ni hashes de PIN. Los visitantes y miembros sin token de organizador reciben 403. |
| QA-14 | Corregida | SQLite renueva actividad tras comentarios, altas/bajas, perfiles, votos/retirada de votos, RSVP, propuestas y operaciones de tareas, encuestas y coches. Las regresiones reinician el fixture a ayer y comprueban avance de actividad y caducidad para cada familia de mutaciones en ambos motores. |
| QA-15 | Corregida | SSE tiene su propio efecto dependiente de sesión/identidad; se cierra y reabre al unirse, recuperar o salir. Los callbacks de conexiones antiguas descartan eventos si las credenciales locales han cambiado. Se prueban los flujos reales de alta, recuperación, salida y conservación del contador de voto oculto después de un cambio externo, sin recargar. |
| QA-16 | Corregida | La comparativa actualiza las tres franjas en un único lote y elimina cualquier entrada antigua `all`. Se prueba el ciclo visible completo Sí → Quizá → No → sin respuesta → Sí desde PlanView, comprobando persistencia. Los accesos rápidos del inspector usan el mismo lote para evitar peticiones concurrentes por franja. |
| QA-17 | Corregida | Guardar una aclaración conserva el estado exacto de cada entrada existente, sin copiar el agregado a la mañana. La regresión reproduce mañana No / tarde No / noche Sí, guarda la nota por el formulario real y verifica las tres franjas. Una nota de disponibilidad requiere haber marcado algún estado; la interfaz lo explica y no inventa una disponibilidad al guardarla. |
| QA-18 | Corregida | Share, Settings e Identity comparten roles de diálogo, nombre accesible, foco inicial, bloqueo del fondo, ciclo de Tab/Shift+Tab, Escape y devolución de foco al disparador. Se prueban los tres componentes. Se retiró el autoFocus nativo de Identity para que no sustituya el disparador antes de capturar el foco de retorno. |
| QA-19 | Corregida | Ranking, recomendación inicial y bloques de varios días excluyen fechas de inicio anteriores a hoy. Se prueban los tres órdenes y los bloques; los resúmenes/calendario conservan el histórico y un plan confirmado del pasado sigue mostrando su fecha y hora. |

## Decisiones de permisos y compatibilidad

El enlace permite leer y unirse, pero las autorías y acciones de participantes requieren un token válido del mismo plan. Las tareas siguen siendo colaborativas. Elegir ganadora y descargar el backup completo son acciones del organizador; borrar coches corresponde al conductor o al organizador.

La excepción antigua que trataba cualquier visitante de un demo como organizador/participante se ha eliminado en ambos almacenes: tampoco puede usarse para obtener una copia completa anónima o suplantar un perfil. Los demos siguen siendo públicos para lectura y admiten altas normales con su propia sesión. La interfaz obtiene los permisos de la sesión verificada en lugar de inferirlos por el slug del demo.

No se cambia el esquema de almacenamiento ni se migran/corrigen datos históricos automáticamente. La edición completa de un día por franjas elimina la entrada `all` residual de ese día; no se reescriben otros datos del usuario.

## Límites reales

- Docker Desktop no estaba disponible. Se ejecutó el SQL de PostgreSQL con PGlite, sin validar en esta entrega el transporte `pg`, SSL, la infraestructura desplegada o carreras con múltiples conexiones.
- Las regresiones de lógica de interfaz y teclado se realizan en JSDOM; no se presentan como una nueva auditoría visual en Safari, Firefox, un dispositivo físico o el servidor principal del usuario. El diseño móvil no se ha rediseñado.
- La compilación mantiene el aviso de tamaño del bundle de Vite, aproximadamente 541 kB minificados. No impide la compilación y no era una de las 19 incidencias.
- Las comprobaciones cubren los casos descritos y regresiones relacionadas; no constituyen garantía de ausencia de cualquier otro error.

No quedan incidencias QA-01–QA-19 pendientes conocidas tras estas comprobaciones.
