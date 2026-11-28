# auditoría de usabilidad — bloques

Fecha: 2026-08-21 · commit auditado: `462d567` · método: auditoría de código y
del spec de diseño (`docs/DESIGN.md`), sin sesión instrumentada en vivo. El
estado del despliegue no es observable desde el repo; todo lo dicho aquí
describe el código en HEAD.

## cómo leer esto

Cada hallazgo lleva: **ID · título — severidad · esfuerzo · tipo**, y debajo
evidencia (`fichero:línea` en `462d567`), mecanismo y recomendación.

- Severidad: **S1** bloqueante · **S2** grave · **S3** molesto · **S4** pulido.
- Esfuerzo de arreglo: **E1** barato (UI/enlaces) · **E2** medio (nueva op,
  columna o reestructura) · **E3** profundo (motor, protocolo, decisión de
  producto).
- Tipo: bug · capacidad ausente · descubribilidad · densidad · decisión de
  producto.

La sección 7 (heurísticas) no añade hallazgos: es la lente transversal. La
sección 8 es la hoja de ruta; nada de esto se implementa en esta rama.

## 1 · lo que reportaste

| # | dolor | veredicto | hallazgos |
|---|---|---|---|
| 1 | mucha información, texto, botones y secciones | confirmado — medido pantalla a pantalla | DEN-03, DEN-04, DEN-05, DEN-06, NAV-07 |
| 2a | hice una sesión de la semana que viene y quedó marcada como hecha | **bug confirmado**, con traza completa | ERR-01, ERR-03 |
| 2b | no se pueden ver las sesiones de fuerza futuras | confirmado — el dato existe y se descarta | NAV-01 |
| 3a | reps y discos por lado se ven muy pequeños | confirmado — 12,5 px junto a un número de 88 px | DEN-01, DEN-02 |
| 3b | no se puede cambiar el peso que estás usando | **resuelto en el código desde ayer** — ver nota | ERR-07, ERR-08 |
| 3c | no se puede deshacer una serie marcada | confirmado — no existe la operación de borrado | ERR-02 |
| 4 | revisar semanas futuras y fases es incómodo | confirmado | NAV-02, NAV-03, NAV-06, FLEX-03 |
| 5 | no se puede mover una sesión a otro día | confirmado — no hay dónde guardarlo | FLEX-01, FLEX-02, FLEX-04 |
| 6 | ajustes y ajustes del programa son demasiada información | confirmado | DEN-04, DEN-07, NAV-07, ERR-04 |
| 7 | notificación persistente durante la sesión | no existe nada de esa infraestructura | PWA-01, PWA-02 |

Dos reencuadres importantes:

- **El peso ya se puede cambiar.** El stepper de peso del runner entró en
  `12c7e57` («Log the weight actually moved, not just the prescribed one»),
  fusionado el 2026-08-20 a las 19:48 — ayer por la tarde. Tu sesión
  accidental fue ayer, casi seguro antes de que ese cambio llegara a
  producción. En HEAD: stepper bajo el número grande, ajusta en saltos que tu
  material puede montar, muestra «programado 50» al desviarte, y el peso real
  viaja con cada serie. Quedan matices reales: ERR-07 y ERR-08.
- **La rigidez es mitad decisión, mitad bug.** «Un día perdido está perdido…
  La app funciona así a propósito» (`docs/PROGRAMA-maria.md:172`) y el
  innegociable 5 (`docs/DESIGN.md:142-145`) son una decisión de producto
  consciente. Pero esa decisión habla de días *pasados*: fechar y cerrar una
  sesión en un lunes *futuro* sin avisar (ERR-01) no está amparado por ella.

## 2 · navegación y arquitectura de la información

Mapa actual (móvil): 4 pestañas — **hoy · semana · progreso · programa** —
(`src/components/app-shell.tsx:9-14`); **historial · editar · ajustes**
cuelgan de programa como píldoras (`SecondaryNav`, `app-shell.tsx:127`), a 2
toques. `/generar` está a 4 interacciones (único enlace: el pie de `/editor`).
El runner suprime la barra de pestañas; su única salida es la flecha del
`TopBar`. Fuera de las filas de `/semana` — el único índice navegable de la
app — los únicos enlaces contextuales entre pantallas son: hoy→movilidad,
programa→ajustes (nota de 11 px), editor→generar y los backs.

**NAV-01 · los días de fuerza futuros son invisibles — S2 · E1 · capacidad ausente**
- evidencia: `src/app/(app)/semana/page.tsx:43-56` (`hrefFor`) devuelve
  `undefined` para un día de fuerza futuro → la fila se pinta como `<div>`
  inerte (`:273-279`). `resolveWeek()` ya resuelve cada ejercicio de cualquier
  semana con peso, series y discos (`src/lib/domain/plan.ts:339-345`,
  `:397-399`) y `/semana` lo descarta: solo lee el peso del básico.
- mecanismo: no existe ninguna ruta de fuerza direccionable por fecha
  (`/carrera/[fecha]` es la única pantalla por fecha de la app). El dato está
  calculado; falta la puerta.
- recomendación: enlazar los días futuros a una vista de solo lectura por
  fecha que reutilice `resolveDay` (ejercicios, esquema, peso previsto,
  descansos). También resuelve la mitad del dolor 4.

**NAV-02 · dos numeraciones de semana en la misma línea — S3 · E1 · descubribilidad**
- evidencia: el título dice «Semana 3 de 8» (semana local de fase) y el
  stepper de al lado muestra `{semanaAbsoluta}/{semanasTemporada}`
  (`src/app/(app)/semana/week-nav.tsx:57`; el docstring en `:9-13` reconoce
  la discrepancia).
- mecanismo: dos «semana 6» distintas conviven sin etiqueta que las distinga.
- recomendación: una sola numeración visible (la de fase, que es la que habla
  el motor) y la absoluta como subtítulo, o etiquetar ambas.

**NAV-03 · hojear semanas es pulsar «+» n veces — S3 · E2 · densidad**
- evidencia: cada pulsación del stepper es una navegación completa de
  servidor (`week-nav.tsx:32`). Ver la semana 20 desde la 2 son 18 idas al
  servidor.
- recomendación: un selector de semana/fase (lista o barra de fases tocable)
  que salte directo.

**NAV-04 · el historial no enlaza al resumen de la sesión — S3 · E1 · capacidad ausente**
- evidencia: las filas del registro se expanden en línea pero nunca llevan
  `href` (`src/app/(app)/historial/history-log.tsx:90-100`). El relato
  completo del motor de una sesión pasada solo se alcanza retrocediendo
  semanas en `/semana`.
- recomendación: enlazar cada sesión del registro a `/sesion/[id]/resumen`.

**NAV-05 · el resumen de hoy es inalcanzable desde hoy — S3 · E1 · capacidad ausente**
- evidencia: con la sesión hecha, la barra de acción de hoy se vuelve un
  `<div>` inerte «✓ Registrada»
  (`src/components/session/start-session-button.tsx:49-54`).
- recomendación: que «✓ Registrada» enlace al resumen.

**NAV-06 · la intención de cada fase es invisible — S2 · E1 · capacidad ausente**
- evidencia: `program_phases.emphasis` y `notes` existen, se siembran en cada
  plantilla y solo los lee el prompt de la IA (`src/lib/ai/prompt.ts:129`).
  La barra de fases de `/semana` es presentacional: tocar una fase no hace
  nada (`semana/page.tsx:304-322`).
- mecanismo: «qué se hace en cada fase» está en la base de datos y no lo ve
  nadie más que el modelo.
- recomendación: barra de fases tocable → nombre, énfasis, notas, semanas y
  rango de fechas de cada fase. Es el arreglo más barato del dolor 4.

**NAV-07 · los parámetros del motor están triplicados — S3 · E2 · densidad**
- evidencia: los mismos 5-6 parámetros (RIR, redondeo, barra, incrementos,
  regla de regresión) se pintan en `/programa`
  (`src/app/(app)/programa/page.tsx:190-197`), en `/editor`
  (`src/app/(app)/editor/program-editor.tsx:732-771`) y en `/ajustes` — tres
  juegos de etiquetas, una sola vía de escritura, y dos notas al pie de
  «se cambian en Ajustes».
- recomendación: una sola casa para los parámetros del motor (programa o
  ajustes), y en las demás pantallas un enlace, no una copia.

**NAV-08 · /generar está enterrado — S4 · E1 · descubribilidad**
- evidencia: único enlace en el pie de `/editor`
  (`program-editor.tsx:774-790`); en móvil: programa → editar → scroll →
  toque.
- recomendación: enlace desde `/programa`, que es donde se piensa en el plan.

**NAV-09 · el runner solo tiene una salida — S4 · decisión de producto**
- evidencia: la barra de pestañas se suprime en `/sesion/*` a propósito
  (`app-shell.tsx:40-42`: una tira de pestañas bajo «Hecho» es superficie de
  toque errado en mitad de una serie).
- veredicto: decisión razonable; se anota para que el coste (volver a
  cualquier sitio = 2 saltos) sea consciente.

## 3 · densidad, tipografía y ergonomía táctil

La tesis del spec es «one thing is lit per screen» (`docs/DESIGN.md:3`).
Varias pantallas la incumplen por acumulación; y en el runner, los dos datos
que más se leen en mitad de una serie son los más pequeños de la pantalla.

**DEN-01 · objetivo de reps y discos por lado a 12,5 px — S2 · E1 · densidad**
- evidencia: ambos viven en el slot `lines` del `HeroNumber`
  (`src/components/session/session-runner.tsx:558-594`), estilado
  `text-[12.5px] text-mid` alineado a la derecha
  (`src/components/ui/kit.tsx:189`), junto a un peso a 88-108 px.
- mecanismo: son los dos datos que se consultan con la barra cargada y las
  manos con magnesio, y comparten el rincón menos legible de la jerarquía.
- recomendación: fila propia para «objetivo 6-8 · RIR 2» y para
  «por lado 20 + 10 + 2,5», a tamaño de fila (15-17 px) o superior; el
  desglose de discos merece dígitos `num` grandes.

**DEN-02 · micro-tipos en controles del runner — S3 · E1 · densidad**
- evidencia: leyendas de píldora (hecha/ahora/queda) a 9 px
  (`session-runner.tsx:665-678`), valor del stepper a 12 px
  (`kit.tsx:491-498`), «programado 50» a 11,5 px (`session-runner.tsx:611-615`).
- recomendación: mínimo 11-12 px en leyendas y 14-15 px en el valor del
  stepper de peso, que ahora es un control de primera clase.

**DEN-03 · el runner es la pantalla más densa de la app — S3 · E2 · densidad**
- evidencia: ~12 bloques distintos y 30-50 objetivos táctiles en mitad de una
  serie (`session-runner.tsx`, 939 líneas): héroe + stepper + píldoras +
  descanso + siguiente + banner de regresión + selector reps/RIR + notas +
  lista «Después» + terminar + barra inferior.
- recomendación: modo enfoque — durante una serie solo héroe, objetivo,
  píldoras y «Hecho»; el resto plegado o tras «más».

**DEN-04 · ajustes es un scroll plano de ~29 filas — S2 · E2 · densidad**
- evidencia: 7 secciones, ~29 filas, ~64 objetivos táctiles sin anclas,
  búsqueda ni pliegues (`src/app/(app)/ajustes/settings-groups.tsx`, 972
  líneas). El propio código lo admite: el indicador «GUARDANDO…» se repite en
  cada sección porque «la lista es mucho más larga que una pantalla».
- recomendación: índice de secciones arriba (chips-ancla) o secciones
  plegadas por defecto; separar «Datos» (export, programas, desplazar,
  borrar) en su propia pantalla.

**DEN-05 · historial: ~90 datos de una vez — S3 · densidad**
- evidencia: 4 KPI + rejilla de constancia + leyenda de 7 entradas + récords +
  registro filtrable de 30 filas expandibles + línea de tiempo del motor de
  hasta 40 eventos, en un scroll (`src/app/(app)/historial/page.tsx`, 721
  líneas).
- recomendación: pestañas o pliegues (constancia / récords / registro /
  motor); la leyenda de colores como tooltip o pie plegado.

**DEN-06 · el editor en modo edición: ~55 botones — S3 · E2 · densidad**
- evidencia: 4 steppers + ↑ ↓ × por ejercicio → un slot de 5 ejercicios
  expone ~55 objetivos, más banco de chips, catálogo, avisos, panel de IA y
  el pliegue del motor (`program-editor.tsx`, 827 líneas).
- recomendación: editar un ejercicio cada vez (fila → hoja de edición), no
  todos los steppers de todos los ejercicios a la vez.

**DEN-07 · filas inertes en ajustes — S4 · E1 · densidad**
- evidencia: «Altura» declara «Solo registro: no entra en ningún cálculo»;
  «Correo» es solo lectura (`settings-groups.tsx`).
- recomendación: moverlas al final o a un pliegue «cuenta y registro»; una
  pantalla saturada no puede permitirse filas que no hacen nada.

Nota de deriva del kit (S4): `Segmented` está definido y sin usar
(`kit.tsx:429`) — cada control de pestañas se refabrica con chips — y
`StatGrid` se duplica a mano en historial y resumen. No es dolor de usuario,
pero es la misma enfermedad: cada pantalla resuelve lo suyo a su manera.

## 4 · tolerancia a errores y reversibilidad

**ERR-01 · una sesión antes de temporada se fecha en el futuro y queda hecha — S1 · E1/E2 · bug**
- evidencia, traza completa:
  1. el plan empieza el lunes que viene; hoy es antes → `placeDate` fija la
     colocación a semana 1 · lunes de la primera fase
     (`src/lib/domain/calendar.ts:164-173`; comportamiento afirmado por
     `src/lib/domain/calendar.test.ts:76-80`);
  2. hoy resuelve ese día y su fecha sale de la fase, no del calendario:
     `dateForPhaseDay(...)` → el lunes futuro (`src/lib/domain/plan.ts:331`);
     la pantalla incluso muestra esa fecha futura como eyebrow sin ningún
     aviso de «el plan aún no ha empezado» (`src/app/(app)/page.tsx:102`);
  3. el botón de empezar recibe `scheduledOn: day.date` — la fecha futura
     (`page.tsx:283-298`);
  4. la identidad de la sesión es `unique (user_id, scheduled_on, slot_id)`
     (`supabase/migrations/20260729000300_training.sql:50`);
  5. `/api/sync` inserta y al terminar cierra esa fila
     (`src/app/api/sync/route.ts:143-162`, `:410-455`);
  6. `/semana` busca por `(scheduled_on, slot_id)` y pinta el lunes futuro
     como hecho. Ninguna columna de *fecha* registra el día real:
     `scheduled_on` es la del plan, y `started_at`/`completed_at` son
     instantes que ninguna pantalla usa para colocar la sesión.
- mecanismo: el clamp de `placeDate` es intencionado (colocación de
  *pantalla*, fijado por test); el bug es aguas abajo — permitir empezar y
  cerrar una sesión bajo esa fecha clampada sin avisar. La única defensa que
  existe es el idioma `placement.date !== fecha` de la pantalla de carrera
  (`src/app/(app)/carrera/[fecha]/page.tsx:68-71`), que no se usa en ningún
  otro sitio.
- recomendación: (E1) banner en hoy cuando `today < starts_on` — «el plan
  empieza el lunes X» — y confirmación explícita antes de empezar una sesión
  cuya fecha no es hoy; (E2, de raíz) separar «qué día del plan» de «cuándo
  ocurrió»: `scheduledOn: today` manteniendo fase/slot/semana, o una columna
  `performed_on`. Las dos variantes exigen decidir la semántica (sección 8).

**ERR-02 · ninguna serie se puede borrar — S2 · E2 · capacidad ausente**
- evidencia: `QueueOp` tiene exactamente 6 tipos y ninguno elimina
  (`src/lib/offline/queue.ts:21-74`); los reducers locales solo añaden
  (`src/lib/offline/local-session.ts:60-102`); no hay ningún `delete` sobre
  `set_logs` en todo `src/`; las píldoras de serie solo reabren el selector
  para *sobrescribir* (`session-runner.tsx:628-638`); el «deshacer» del
  runner deshace una penalización del motor, no una serie
  (`session-runner.tsx:718-727`).
- mecanismo: marcaste una serie por error → puedes cambiarle las reps, pero
  sigue contando como hecha. El motor ya es tolerante a correcciones (el
  sync revierte eventos de fallo huérfanos, `route.ts:356-371`); lo único no
  borrable es la fila de la serie.
- recomendación: nueva op `set_unlog` de punta a punta (cola + clave + sobre +
  esquema zod + delete en el route + reducer local). Ojo con el orden: un
  `set_unlog` y un `set_log` de la misma serie deben compartir clave o llevar
  marca de tiempo.

**ERR-03 · la última serie cierra la sesión sin preguntar — S2 · E1 · bug**
- evidencia: al registrar la última serie del último ejercicio, `advance()`
  llama a `finish()` sin confirmación (`session-runner.tsx:319-326`).
- mecanismo: es lo que selló como «hecha» la sesión mal fechada de ERR-01; y
  convierte cualquier toque de más en un cierre de sesión.
- recomendación: hoja de confirmación («terminar y registrar») reutilizando
  la tarjeta de terminar que ya existe.

**ERR-04 · destructivo junto a cotidiano en ajustes — S3 · E1 · densidad**
- evidencia: «Desplazar el plan» (irreversible en bloque) y «Borrar
  historial» conviven en la misma tarjeta «Datos» que «Exportar copia»
  (`settings-groups.tsx:754-885`).
- recomendación: zona de peligro separada al final, con espacio y color
  propios.

**ERR-05 · desplazar el plan a golpe de ±1 día — S3 · E1 · densidad**
- evidencia: mover el plan es un stepper de ±1 día por toque (−90…+90,
  saltando el 0 y partiendo de +7; `settings-groups.tsx:844-853`): cada
  semana extra son 7 pulsaciones, más confirmación.
- recomendación: entrada directa o selector de fecha destino («empezar el
  lunes X»), manteniendo la confirmación.

**ERR-06 · la carrera se puede corregir a posteriori; la fuerza no — S3 · E2 · capacidad ausente**
- evidencia: una carrera registrada ofrece «editar datos»
  (`src/app/(app)/carrera/[fecha]/log-run-form.tsx:280-293`; el comentario en
  `:171-173` explica el porqué — los datos del reloj llegan en casa, después
  de marcar «hecha»); una sesión de fuerza `done` no tiene ninguna vía de
  reapertura (la barra de hoy queda inerte, `start-session-button.tsx:49-54`).
- recomendación: «corregir sesión» desde el resumen, reutilizando el mismo
  camino idempotente de `set_log` (y `set_unlog` cuando exista).

**ERR-07 · el peso cambiado no persiste hasta la primera serie — S3 · E2 · bug**
- evidencia: el override vive en un `useState` local
  (`session-runner.tsx:126`); `LocalSessionState` no tiene campo para él
  (`src/lib/offline/local-session.ts:25-36`). Si bajas 50 → 45 y la pestaña
  muere antes de registrar la primera serie, vuelve a 50. Tras una serie sí
  sobrevive, porque `weightAt` cae al peso de la última serie registrada
  (`session-runner.tsx:260-269`). Además: solo ±1 muesca por toque, sin
  entrada directa, y los ejercicios en modo RPE no tienen control
  (`session-runner.tsx:596-617`).
- recomendación: persistir el override en `LocalSessionState` (sin cambio de
  servidor: el peso real ya viaja por serie) y permitir entrada directa.

**ERR-08 · el motor libera un hold que nunca llegaste a mover — S2 · E3 · bug**
- evidencia: `clean` se calcula solo con repeticiones (o segundos) y número
  de series (`src/lib/engine/replay.ts:143-148`) y la comprobación de «¿se puso a
  prueba el peso retenido?» lee la prescripción, no el peso registrado:
  `tested = !lift.hold || workingWeight(lift, week, config).isHeld`
  (`replay.ts:151-163`); en ningún punto se compara `log.weightKg` con
  `holdAtKg`.
- mecanismo: tienes un hold a 50; bajas con el stepper a 45 y cumples el
  rango → sesión limpia → el hold a 50 se libera y el contador de fallos se
  reinicia, aunque el peso retenido nunca se probó. Contradice la promesa del
  propio innegociable 1 («the regression holds at the weight actually
  missed»): el fallo sí congela al peso real (`replay.ts:118`), pero la
  absolución no lo mira.
- recomendación: exigir además `log.weightKg >= holdAtKg` (con tolerancia de
  redondeo) para liberar el hold. Toca el núcleo determinista que corre
  idéntico en cliente y servidor: cambio pequeño, pero con `replay.test.ts` y
  `engine.test.ts` detrás. Decisión de producto en la sección 8.

## 5 · flexibilidad frente a rigidez deliberada

Qué es decisión y qué es bug: «la app funciona así a propósito»
(`docs/PROGRAMA-maria.md:172`) cubre *no recuperar días perdidos*. No cubre fechar
sesiones en el futuro sin avisar (ERR-01), ni impide ofrecer movimientos de
día *hacia delante* dentro de la semana. Los hallazgos de esta sección son en
parte decisiones a re-examinar, y se marcan como tales.

**FLEX-01 · mover un día «solo esta semana» no tiene dónde vivir — S2 · E3 · decisión de producto**
- evidencia: la disposición semanal es `program_days (phase_id, day_index,
  slot_id)` — sin dimensión de semana ni tabla de excepciones por fecha
  (`supabase/migrations/20260729000200_programs.sql:79-86`). Lo único que
  existe: `setDaySlot` (reapunta ese día de la semana para *toda la fase*,
  `src/lib/actions/program.ts:224-243`, y no es un intercambio — puede dejar
  slots huérfanos, que el editor ya gestiona), «Saltar», o desplazar la
  temporada entera (`shiftProgram`, `program.ts:245-267`).
- mecanismo: «el lunes no puedo, lo paso al martes» no es expresable en el
  modelo de datos.
- recomendación: tres salidas posibles, a decidir — (a) intercambio de dos
  días para toda la fase (dos escrituras atómicas sobre `setDaySlot`, la IA
  ya tiene la op `set_day_slot`, `src/lib/ai/schema.ts:17-28`); (b) tabla de
  overrides por fecha (o usar la fila de `sessions` como override
  materializado — `setSessionStatus` ya sabe crear una fila en cualquier
  fecha, `src/lib/actions/session.ts:38-57`); (c) enmendar el innegociable 5.
  Cualquiera debe pasar por `planWarnings`
  (`src/lib/domain/plan-rules.ts:26-102`): sin movilidad, >3 días de fuerza
  con ≥2 de carrera, o fuerza la víspera de la tirada larga son exactamente
  lo que esas reglas vigilan.

**FLEX-02 · el orden de prioridad para semanas rotas vive en papel — S3 · E1 · capacidad ausente**
- evidencia: los programas traen instrucciones explícitas para semanas
  incompletas — «F2: Fuerza A > Fuerza B > Z2 sábado > Fuerza C > Z2 martes»
  (`docs/PROGRAMA-juanlu.md:71-74`) — y la app no las enseña en ningún sitio.
- recomendación: al pulsar «Saltar» (o en la semana con días perdidos),
  mostrar la prioridad de lo que queda. Barato y muy alineado con la
  filosofía «la app decide por ti».

**FLEX-03 · el editor y la IA están clavados a la fase de hoy — S3 · E2/E3 · capacidad ausente**
- evidencia: `/editor` toma fase y semana de `placement`
  (`src/app/(app)/editor/page.tsx:26`) sin selector; `proposeChanges` hereda
  el mismo anclaje (`src/lib/actions/ai.ts:341-343`).
- mecanismo: no hay camino a «mira la semana 20 y cámbiala»; `/semana` puede
  mirarla pero es de solo lectura.
- recomendación: selector de fase en el editor (la resolución ya es pura:
  `resolveWeek` sirve cualquier fase/semana).

**FLEX-04 · no existe «entrenar la sesión de otro día» — S3 · E3 · decisión de producto**
- evidencia: los dos únicos puntos de arranque parten de la colocación de
  `placeDate` — hoy consume `athlete.placement`
  (`src/lib/data/athlete.ts:82`) y pasa un día fijo a `StartSessionButton`
  (`page.tsx:283-298`); el shell offline hace el mismo cálculo
  (`src/app/~offline/offline-shell.tsx:72`, arranque en `:228`). No hay
  selector.
- mecanismo: si hoy no toca (o toca otra cosa), la única puerta es esperar o
  saltar.
- recomendación: si se quiere, un «entrenar esta» en la vista de día futuro
  de NAV-01, con la semántica de fechas de ERR-01 resuelta primero. Depende
  por entero de la decisión de producto de la sección 9.

## 6 · capacidades de plataforma (pwa)

**PWA-01 · la notificación persistente de sesión es terreno virgen — S3 · E3 · capacidad ausente**
- evidencia: el service worker es artesanal, emitido como string desde
  `src/app/sw.js/route.ts`, y escucha exactamente tres eventos: install,
  activate, fetch. En todo `src/` no hay Notification API, ni push, ni Media
  Session, ni App Badge; Background Sync está descartado a propósito
  (`src/lib/offline/syncer.ts:8`, iOS no lo soporta).
- mecanismo: lo que pides — descanso restante y serie en curso en una
  notificación — necesita: permiso de notificaciones, `showNotification` con
  `tag` (para actualizar en sitio, no apilar), un handler `notificationclick`
  en el SW, y decidir el patrón de cuenta atrás. En Android una notificación
  silenciosa actualizable funciona bien; en iOS las notificaciones web exigen
  la PWA instalada en la pantalla de inicio (16.4+) y no permiten
  actualización continua de contenido — allí el camino realista es Live
  Activities-like vía web push puntual («descanso terminado») o nada.
- recomendación: por fases — 1) notificación al terminar el descanso (un
  push local al expirar, útil con la pantalla apagada); 2) notificación
  persistente con serie/descanso en Android; 3) evaluar Media Session como
  «widget» de pantalla de bloqueo. Requiere decidir alcance (sección 8).

**PWA-02 · el temporizador de descanso solo existe en primer plano — S3 · capacidad ausente**
- evidencia: interval de 250 ms con fecha límite de reloj
  (`src/components/session/rest-timer.tsx:135-155`); el vencimiento avisa con
  flash en página, vibración y pitido WebAudio — todo exige la página viva.
  El wake lock (`:212-254`, si «mantener la pantalla encendida» está activo)
  lo mitiga manteniendo la pantalla despierta.
- mecanismo: con la pantalla apagada o en otra app, el final del descanso
  pasa en silencio; al volver, el número es correcto (fecha límite de reloj),
  pero el aviso ya no llegó.
- recomendación: es la mitad del valor de PWA-01: el primer entregable
  debería ser «avísame aunque la pantalla esté apagada».

## 7 · evaluación heurística (nielsen, aplicada)

| heurística | hallazgos | en una línea |
|---|---|---|
| visibilidad del estado | ERR-01, PWA-02, DEN-04 | hoy no dice que el plan no ha empezado; el descanso termina en silencio; «GUARDANDO…» se repite porque no se ve |
| sistema ↔ mundo real | NAV-02, ERR-01 | dos «semana 6» distintas; una fecha futura como eyebrow sin explicación |
| control y libertad | ERR-02, ERR-03, ERR-06, FLEX-01, FLEX-04 | sin borrar serie, cierre automático, fuerza incorregible, días inamovibles |
| consistencia y estándares | NAV-07, ERR-06 | tres etiquetados para seis parámetros; carrera editable y fuerza no; `Segmented` sin usar |
| prevención de errores | ERR-01, ERR-03, ERR-04 | empezar una sesión futura sin fricción; terminar sin confirmar; borrar junto a exportar |
| reconocimiento > recuerdo | NAV-06, FLEX-02 | el porqué de cada fase y la prioridad de una semana rota hay que sabérselos |
| flexibilidad y eficiencia | ERR-05, NAV-03, FLEX-03 | ±1 día × 14; «+» × 18; el editor solo edita hoy |
| estética y minimalismo | DEN-01…DEN-06 | la spec promete un solo foco por pantalla; el runner, ajustes, historial y editor lo desbordan |
| recuperación de errores | ERR-01, ERR-02 | la sesión mal fechada no tiene arreglo desde la UI; la serie errónea tampoco |
| ayuda y documentación | FLEX-02, NAV-06 | la mejor documentación del producto (los PROGRAMA-*.md) no llega a la app |

## 8 · hoja de ruta recomendada

Orden dentro de cada ola ≈ ratio valor/esfuerzo.

Estado (2026-08-21, misma rama, tras las 4 decisiones de producto): ola 1
completa; ERR-01 de raíz (decisión 1: fecha real, plan sin marcar), FLEX-01
en su variante semanal (decisión 2: recuperar dentro de la semana desde
`/fuerza/[fecha]`), ERR-08 (decisión 4: liberar un hold exige el peso
retenido), ERR-02 (`set_unlog`), ERR-07 (peso persistido + entrada directa)
y PWA-01/02 v1 (decisión 3: aviso de descanso con hora absoluta, capa
persistente solo Android) implementados; DEN-04 parcial (zona de peligro y
reorden hechos; faltan las anclas).

Estado (segunda tanda, misma fecha): todo lo restante implementado —
NAV-03 (chips de semana en la barra de fases), NAV-07 (parámetros del motor
solo en ajustes), DEN-03 (pliegue «toda la sesión» en el runner), DEN-04
(índice de secciones en ajustes), DEN-05 (historial en cuatro pestañas),
DEN-06 (editor con acordeón por ejercicio), FLEX-03 (`/editor?fase=`),
FLEX-04 (cualquier día de la semana en curso entrenable desde
`/fuerza/[fecha]`) y ERR-06 (corregir una sesión cerrada desde el resumen,
con re-evaluación de duración, tonelaje y bumps de accesorios). La hoja de
ruta de esta auditoría queda completa.

Estado (2026-09-25, tercera ronda, rama `claude/friendly-wozniak-if2ydk`):
con la hoja de ruta completa la app seguía abrumando y costando entender,
porque cada arreglo había *añadido* superficie. Esta ronda resta: cuatro
pestañas por pregunta (hoy · semana · progreso · plan; historial dentro de
progreso, `/motor` como única casa del porqué), un solo diseño de día de
fuerza, palabras llanas en vez de las del motor, hoy consciente de la semana
(qué recuperar según la prioridad de la fase), «Hecho» que ya no registra
el tope del rango por defecto, texto mínimo de 11 px, `faint` a ≥ 4:1 y un
presupuesto de densidad por pantalla en `scripts/walkthrough.ts`.

**ola 1 — victorias rápidas (E1)**
1. DEN-01 + DEN-02 — reps objetivo y discos por lado a tamaño legible.
2. ERR-01 (mitigación) — banner pre-temporada en hoy + confirmación al
   empezar una sesión cuya fecha no es hoy.
3. ERR-03 — confirmar antes del cierre automático de sesión.
4. NAV-01 — vista de solo lectura por fecha para días de fuerza futuros
   (reutiliza `resolveDay`; abre también los días pasados nunca empezados).
5. NAV-06 — barra de fases tocable con énfasis y notas.
6. NAV-04 + NAV-05 — historial → resumen; «✓ Registrada» → resumen.
7. FLEX-02 — enseñar la prioridad de la semana rota al saltar un día.
8. ERR-04 + ERR-05 + DEN-07 — zona de peligro, selector de fecha para
   desplazar, filas inertes al fondo.
9. NAV-02 + NAV-08 — una sola numeración de semana visible; enlace a
   `/generar` desde `/programa`.

**ola 2 — estructural (E2)**
1. ERR-02 — op `set_unlog` de punta a punta (deshacer serie).
2. ERR-07 — persistir el override de peso en `LocalSessionState`; entrada
   directa de peso.
3. ERR-01 (raíz) — separar fecha del plan y fecha real (`performed_on` o
   `scheduledOn: today`); exige la decisión de producto 1.
4. DEN-04 — reestructurar ajustes (anclas o pliegues; «Datos» aparte).
5. NAV-07 — una sola casa para los parámetros del motor.
6. NAV-03 — selector de semana/fase en `/semana`.
7. ERR-06 — corregir una sesión de fuerza registrada.
8. DEN-03 + DEN-05 + DEN-06 — modo enfoque del runner; pliegues en
   historial; edición por ejercicio en el editor.

**ola 3 — profundo (E3)**
1. FLEX-01 — mover días (la salida que elija la decisión 2).
2. PWA-01 + PWA-02 — aviso de fin de descanso con pantalla apagada; después
   la notificación persistente (Android primero).
3. ERR-08 — que liberar un hold exija haber movido el peso retenido
   (decisión 4; núcleo del motor + tests).
4. FLEX-03 + FLEX-04 — editar otras fases; entrenar la sesión de otro día.

**decisiones de producto pendientes** — son tuyas, no del código:
1. **Semántica fuera de temporada.** ¿Entrenar antes del inicio se bloquea,
   o se registra con su fecha real sin marcar el día del plan? (ERR-01)
2. **Mover días vs innegociable 5.** ¿Intercambio de fase completa, overrides
   por fecha, o enmendar la regla? (FLEX-01)
3. **Alcance de la notificación.** ¿Solo Android para la persistente, y en
   iOS únicamente el aviso de fin de descanso con la PWA instalada? (PWA-01)
4. **¿Debe el motor mirar el peso real?** Hoy el fallo congela al peso real
   pero la absolución no lo comprueba; exigirlo enmienda el matiz del
   innegociable 1. (ERR-08)

## 9 · cuarta ronda — features que faltan

Fecha: 2026-11-27 · commit auditado: `380d8e9` · método: lectura de código más
los datos reales de F2 semanas 1-5 (26 oct – 27 nov, leídos por `/api/mcp`).
Mismas escalas que arriba. Nada de esto se implementa en esta rama.

Estado (2026-11-27, misma rama, tras las 4 decisiones): HIST-01, ACC-01,
ACC-02 y ACC-04 implementados; ACC-03 solo en su mitad de editor — la IA sigue
sin op de peso (innegociable 1): con ACC-01 basta con mover el stepper una vez.
EXT-01 implementado en sus dos mitades: `/extra/[fecha]` para registrar a
posteriori (op `extra_log`, tipo `cross`) y huecos opcionales
(`program_slots.optional`, op `add_session` del entrenador), que no entran en
la adherencia. Las carreras que el plan ya llamaba opcionales con palabras
(F0-bis, F4, F0 del 10K) pasan a serlo de verdad. REG-01 (decisión 3: − / +
junto a «Hecho», y por defecto la misma serie de la última vez, nunca el tope
del rango), REG-02 (el RIR se pregunta una vez, tras la última serie de cada
ejercicio) y MOV-01 (decisión 4: cronómetro por lados en los isométricos, el
progreso del día en Hoy, los días de la semana en Progreso) implementados.
RM-01 (2026-11-28): la semana de re-test vive en el plan
(`program_phases.retest_week`, F2 sem 8 como dice `PROGRAMA-juanlu.md`), se
anuncia en Semana, Hoy y el runner, y el resumen y la calculadora ofrecen la RM
que sale — `recordMeasurement` deja de ser código sin llamar. Quedan
RUN-01…06, REG-03…07, PROG-01, PROG-02 y DAT-01.

### 9.1 · lo que pediste

**HIST-01 · el runner no enseña lo que hiciste la última vez — S2 · E2 · capacidad ausente**
- evidencia: `SessionRunner` recibe solo los `set_logs` de la sesión abierta
  (`src/app/(app)/sesion/[id]/page.tsx:33-41`); ninguna consulta trae
  sesiones anteriores del mismo ejercicio. El dato existe y solo se lee
  abriendo el resumen de cada sesión pasada, una a una.
- recomendación: una línea bajo el peso — «la última vez · 20 nov · 22,5 kg ×
  8·8·8» — y al tocarla una hoja con las últimas 5-6 sesiones. Clave por
  ejercicio de catálogo (o nombre), no por `program_exercise_id`: cada fase
  tiene sus filas y `rename_exercise` conserva el id al sustituir
  (`src/lib/actions/ai.ts:552-567`: dominadas lastradas → supinas). Tiene que
  entrar en el snapshot offline (`src/lib/offline/snapshot.ts`).

**ACC-01 · el peso de un accesorio no recuerda lo que moviste — S2 · E2 · bug**
- evidencia: cada sesión arranca en el `fixed_weight_kg` del plan
  (`src/lib/domain/plan.ts:283-288`) y el stepper solo vale para esa sesión
  (`session-runner.tsx:323-332`). Datos: jalón 50 → 55 → 60 → 50; búlgara
  22,5 → 17,5 → 22,5; inclinado 25 → 20/22,5 → 25/22,5.
- recomendación: al cerrar una sesión (nunca en descarga), `/api/sync` deja
  `fixed_weight_kg` en el peso de la última serie registrada del accesorio,
  con su evento deshacible. El runner sigue leyendo `ResolvedExercise.weightKg`.

**ACC-02 · la doble progresión sube desde el peso del plan, no desde el levantado — S2 · E1 · bug**
- evidencia: `currentWeightKg: e.fixed_weight_kg`
  (`src/app/api/sync/route.ts:603-604`); `doubleProgression` no recibe los
  kilos de las series. Datos: face pull es 15-15 (`template_program.sql:168`),
  así que un toque de «Hecho» por serie ya es «todas al tope»: subió 27,5 →
  30 → 32,5 → 35 → 37,5 en cuatro sesiones. El 25 nov lo registraste a 15 kg
  y el motor lo subió de 35 a 37,5.
- mecanismo: el plan prescribe 37,5 y tú mueves 15. Contradice el innegociable
  1 («the load travels with the set»).
- recomendación: progresar desde el peso registrado, y exigir rango real
  (`rep_max > rep_min`) o RIR anotado para subir.

**ACC-03 · el peso prescrito de un accesorio no se puede editar — S2 · E1 · capacidad ausente**
- evidencia: el editor expone series, reps y descanso
  (`src/app/(app)/editor/program-editor.tsx:445-510`); `updateExercise` ya
  acepta `fixedWeightKg` y `loadMode` (`src/lib/actions/program.ts:48-58`) y
  ninguna pantalla los envía. La IA tampoco tiene op de peso
  (`src/lib/ai/schema.ts:17-29`): «abducción: sube a 10 kg» llegó tres veces
  como `note` (2, 16 y 22 nov) y el runner siguió enseñando 5 kg.
- recomendación: stepper de peso en el acordeón del ejercicio y op
  `set_weight` en `CHANGE_OPS`, solo accesorios.

**ACC-04 · «a sensación» no deja apuntar kilos — S3 · E1 · capacidad ausente**
- evidencia: `canStep = loadMode !== "rpe" && currentWeight != null`
  (`session-runner.tsx:724`). Curl de bíceps, tibialis y step-down se guardan
  sin `weight_kg`; el entrenador lo pide el 27 nov («apunta también los kilos
  del curl») y la app no tiene dónde.
- recomendación: en `rpe` el peso empieza vacío y es opcional; si se escribe,
  viaja con la serie y alimenta HIST-01.

**EXT-01 · no se puede registrar una sesión fuera del plan — S2 · E2 · capacidad ausente**
- evidencia: toda escritura lleva `SessionKey.slotId`
  (`src/lib/offline/queue.ts:11-19`); `/carrera/[fecha]` redirige si ese día
  no tiene hueco de carrera (`carrera/[fecha]/page.tsx:94`); un día de
  descanso pinta «Día libre» inerte (`start-session-button.tsx:43-50`);
  `program_days` es un hueco por día (`20260729000200_programs.sql:80-86`),
  así que tampoco cabe un doble; `session_type` no tiene bici ni cross
  (`20260729000100_core.sql:20-28`). El 27 nov el entrenador propuso «30-40′
  de Z2 en rodillo el domingo» — como `note`, porque no hay dónde ponerlo.
- recomendación: «Añadir sesión» en Hoy y en cada día de Semana: tipo (rodillo,
  carrera, caminata, otro), duración, FC media, RPE, nota. Fila en `sessions`
  con `slot_id` nulo y un valor nuevo de `session_type`; op `extra_log` con id
  propio como clave, por la misma cola. Suma a las horas aeróbicas de Progreso
  y sale en `get_sessions`; ni suma ni resta adherencia.

### 9.2 · mientras entrenas

**REG-01 · «Hecho» registra siempre el mínimo del rango — S2 · E1 · decisión de producto**
- evidencia: `quickValue` cae en `exercise.repMin`
  (`session-runner.tsx:666-676`); cualquier otra cifra son dos toques por
  «Otras». Datos: cinco semanas de accesorios a 8, 10 y 12 exactos. La doble
  progresión pide el tope en todas las series (`progression.ts:100-101`), así
  que nada sube salvo lo que tiene rango de un solo número (ACC-02).
- recomendación: − / + de reps junto a «Hecho»: la cifra real a un toque.

**REG-02 · el RIR no se registra nunca — S3 · E1 · descubribilidad**
- evidencia: el selector vive dentro de «Otras»
  (`session-runner.tsx:1205-1227`); cero series con RIR en cinco semanas. El
  plan se define por él («RIR 1-3 en básicos») y la progresión lo consulta
  (`progression.ts:104`).
- recomendación: pedirlo una vez, tras la última serie del básico.

**REG-03 · no se puede cambiar de ejercicio en el día — S3 · E2 · capacidad ausente**
- evidencia: el runner no sustituye; tres filas del plan son «A o B» con un
  solo peso (`template_program.sql:70`, `:183`, `:184`) y el historial mezcla
  dos movimientos bajo un nombre: «Fondos o press banca ligero» a 0 kg.
- recomendación: «Cambiar por hoy» desde la lista de la sesión: uno del
  catálogo con el mismo `tag`, y la serie guarda el nombre real
  (`set_logs.exercise_name` ya está desnormalizado). Nunca el básico. Partir
  las filas «A o B».

**REG-04 · ni una serie ni un ejercicio de más — S3 · E2 · capacidad ausente**
- evidencia: una píldora por serie prescrita (`session-runner.tsx:936`) y
  `record` corta en `exercise.sets` (`:420-423`).
- recomendación: «+ serie» tras la última píldora. Antes hay que decidir si
  una serie extra del básico entra en el fold del motor.

**REG-05 · las series de aproximación están calculadas y no se pintan — S3 · E1 · capacidad ausente**
- evidencia: `warmupSets()` (`src/lib/engine/index.ts:437-458`), con tests y
  sin un solo uso en `src/`.
- recomendación: pliegue «aproximación» en el básico, en el runner y en
  `StrengthDay`.

**REG-06 · una nota por sesión, y solo se lee en el resumen — S4 · E2 · capacidad ausente**
- evidencia: `finishNotes` (`session-runner.tsx:1106-1118`) se muestra en
  `resumen/page.tsx:423-427` y en ningún otro sitio; no hay nota por ejercicio.
- recomendación: nota por ejercicio (molestia, otra máquina), visible en
  HIST-01 y en `get_sessions`.

**REG-07 · el runner no dice cuánto llevas — S4 · E1 · capacidad ausente**
- evidencia: sin reloj de sesión; las reales duran 54-79′ y el plan pone el
  techo en ~70′.
- recomendación: minutos transcurridos junto a «n de m series».

### 9.3 · carrera

**RUN-01 · el test de umbral no tiene dónde apuntar el resultado — S2 · E1 · capacidad ausente**
- evidencia: `recordMeasurement` — actualiza `profiles.lthr`, escribe
  `measurements` y el evento `lthr_test` (`src/lib/actions/program.ts:359-398`)
  — no lo llama nadie; `LogRunForm` no tiene campo de LTHR. El único camino es
  el stepper de Ajustes → Carrera, sin fecha ni evento. `measurements` está
  vacía.
- recomendación: en un día de test, la tarjeta de datos pide «FC media de los
  últimos 20′» y llama a `recordMeasurement`.

**RUN-02 · la pestaña Carrera está vacía con diez carreras registradas — S3 · E1 · capacidad ausente**
- evidencia: solo pinta desacople y km por semana
  (`progreso/page.tsx:789-899`); el desacople se pide en tiradas de 60′ o más y
  las tuyas son de 30-41′. Duración, km y FC media están en las diez y no se
  cruzan: no hay ritmo en ninguna pantalla.
- recomendación: ritmo medio por carrera y la tendencia ritmo ↔ pulso en Z2
  (27 oct: 9:10 /km a 147 ppm). Es el indicador de base que sí dan las
  carreras cortas.

**RUN-03 · campos de carrera que existen y nadie rellena — S4 · E1 · capacidad ausente**
- evidencia: `notes: ""` fijo (`log-run-form.tsx:165`); `max_hr` y
  `dominant_zone` sin entrada; Progreso enseña «Zona dominante —» siempre
  (`progreso/page.tsx:481`).
- recomendación: nota en el formulario; quitar la fila de zona dominante.

**RUN-04 · la carrera no se puede tocar a mano — S3 · E2 · capacidad ausente**
- evidencia: «a run day's structure is not editable from here»
  (`program-editor.tsx:167-168`); solo `set_run` por IA. Pasar de 40′ a 45′
  exige una conversación.
- recomendación: minutos y zona de la carrera de la semana en el editor; los
  bloques tipados siguen siendo de la IA.

**RUN-05 · cuatro cifras tecleadas por carrera — S3 · E3 · capacidad ausente**
- evidencia: no hay importación de ningún tipo.
- recomendación: subir el `.fit`/`.gpx` del reloj → duración, km, FC media,
  desacople y tiempo en zona calculados. Strava/Garmin por API quedan fuera:
  OAuth y servidor para un atleta.

**RUN-06 · la carrera objetivo no se edita — S3 · E1 · capacidad ausente**
- evidencia: `race_on` y `race_name` solo se leen (`semana/page.tsx:209`,
  `programa/page.tsx:273`); ninguna acción de `src/` los escribe, y desplazar
  el plan no mueve la carrera (innegociable 5).
- recomendación: fecha y nombre en Ajustes, junto a desplazar el plan.

### 9.4 · plan y progreso

**RM-01 · el re-test de RM no tiene flujo — S2 · E1 · capacidad ausente**
- evidencia: el ajuste «Recalcular RM tras el re-test»
  (`settings-groups.tsx:811-820`) gobierna una rama de `recordMeasurement` que
  nadie llama; la calculadora «no guarda nada» (`programa/page.tsx:341`). El
  camino real es el stepper de RM, un evento `manual_rm` por toque
  (`rm-rows.tsx:54`): el 23 nov, banca 80 → 77,5 → 75 → 77,5 son tres eventos.
  El entrenador pide test de RMs esta misma semana.
- recomendación: «Usar como RM» en la calculadora → un `rm_retest` y su fila
  en `measurements`; el stepper confirma al soltar, no por toque.

**PROG-01 · no hay progresión por ejercicio — S3 · E2 · capacidad ausente**
- evidencia: récords = la serie más pesada de cada básico
  (`progreso/page.tsx:105-138`), sin línea temporal y sin accesorios; el
  registro son las últimas 30 sesiones del programa activo (`:172`, `:181`),
  así que F0-bis — que el entrenador cita — no se ve en la app.
- recomendación: tocar un récord (o el ejercicio en HIST-01) abre su serie
  histórica: mejor serie por sesión, todas las fases y programas.

**PROG-02 · el peso corporal es un número, no una serie — S4 · E1 · capacidad ausente**
- evidencia: `profiles.body_weight_kg` con stepper
  (`settings-groups.tsx:413-432`); `measurement_kind = 'body'` existe sin uso.
- recomendación: cada cambio a `measurements` y la tendencia en Progreso.

**MOV-01 · el bloque de movilidad no se ha registrado ni un día — S3 · decisión de producto**
- evidencia: cero `mobility_logs` en 33 días. Son 20′ de ítems a marcar uno a
  uno, sin cronómetro para los isométricos (la dosis es texto:
  `mobility-block.tsx:180-189`), sin GIF y sin versión corta; ocupa una fila
  fija de Hoy.
- recomendación: o gana utilidad — cronómetro en los ítems por tiempo, una
  activación de 5′ enganchada a «Empezar» en días de fuerza — o sale de Hoy.

**DAT-01 · dos atletas «Juanlu» activos — S4 · E1 · datos**
- evidencia: `list_athletes` devuelve dos con el mismo plan; uno va por
  «semana 10 de 12» sin una sola sesión y con otra fecha de carrera.
- recomendación: archivar la cuenta vacía; el entrenador hoy tiene que elegir
  por id.

No añadiría: intervalos guiados de carrera (lo hace el reloj), push de
recordatorio (exige servidor; `DESIGN.md` lo descarta), rachas o logros (contra
la voz del producto).

### 9.5 · orden recomendado

1. ACC-02 · ACC-03 · ACC-01 — que el peso de un accesorio diga la verdad.
2. HIST-01 · ACC-04 — la última vez, en el runner.
3. EXT-01 — sesiones fuera del plan.
4. REG-01 · REG-02 — reps y RIR reales a un toque.
5. RM-01 · RUN-01 — cablear `recordMeasurement`.
6. REG-05 · RUN-02 · RUN-03 · RUN-06 · REG-07 · PROG-02 — baratos.
7. REG-03 · REG-04 · REG-06 · PROG-01 · RUN-04.
8. RUN-05 · MOV-01.

**decisiones de producto** — resueltas el 2026-11-27: (1) las dos cosas,
registro a posteriori y huecos opcionales; (2) lo último que moviste pasa a
ser la prescripción; (3) a criterio de la implementación; (4) arreglarla y
mantenerla.
1. **Extras.** ¿Solo registro a posteriori, o también huecos opcionales que el
   entrenador pueda planificar (rodillo del domingo) y que no penalicen si no
   se hacen? (EXT-01)
2. **¿Quién fija el peso de un accesorio?** ¿Lo último que moviste pasa a ser
   la prescripción, o el plan manda y lo anterior es solo referencia? (ACC-01)
3. **El toque perezoso.** «Hecho» por defecto: el mínimo del rango (hoy), o
   las reps de esa serie la última vez. (REG-01)
4. **Movilidad.** Arreglarla o retirarla de Hoy. (MOV-01)
