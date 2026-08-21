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

La sección 8 (heurísticas) no añade hallazgos: es la lente transversal. La
sección 9 es la hoja de ruta; nada de esto se implementa en esta rama.

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
`TopBar`. Los únicos enlaces contextuales entre pantallas de toda la app son:
hoy→movilidad, programa→ajustes (nota de 11 px), editor→generar y los backs.

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
  (`src/app/(app)/semana/week-nav.tsx:9-13`, docstring que lo reconoce).
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
  nada (`semana/page.tsx:304-334`).
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
- evidencia: 4 KPI + rejilla de constancia + leyenda de 7 colores + récords +
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
     (`src/app/api/sync/route.ts:143-162`, `:410-425`);
  6. `/semana` busca por `(scheduled_on, slot_id)` y pinta el lunes futuro
     como hecho. Nada en el esquema registra el día real del entrenamiento.
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
  `performed_on`. Las dos variantes exigen decidir la semántica (sección 9).

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
  (`settings-groups.tsx:819-854`).
- recomendación: zona de peligro separada al final, con espacio y color
  propios.

**ERR-05 · desplazar el plan a golpe de ±1 día — S3 · E1 · densidad**
- evidencia: mover el plan es un stepper de ±1 día (−90…+90): dos semanas son
  14 pulsaciones más confirmación (`settings-groups.tsx`).
- recomendación: entrada directa o selector de fecha destino («empezar el
  lunes X»), manteniendo la confirmación.

**ERR-06 · la carrera se puede corregir a posteriori; la fuerza no — S3 · E2 · capacidad ausente**
- evidencia: una carrera registrada ofrece «editar datos»
  (`src/app/(app)/carrera/[fecha]/log-run-form.tsx:280-293` — «los datos del
  reloj llegan en casa»); una sesión de fuerza `done` no tiene ninguna vía de
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
- evidencia: `clean` se calcula solo con repeticiones
  (`src/lib/engine/replay.ts:143-148`) y la comprobación de «¿se puso a
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
  `engine.test.ts` detrás. Decisión de producto en la sección 9.

## 5 · flexibilidad frente a rigidez deliberada

Qué es decisión y qué es bug: «la app funciona así a propósito»
(`PROGRAMA-maria.md:172`) cubre *no recuperar días perdidos*. No cubre fechar
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
- evidencia: los dos únicos puntos de arranque calculan ellos mismos el
  objetivo desde `placeDate` — hoy (`page.tsx:283-298`) y el shell offline —
  y `StartSessionButton` recibe un día fijo. No hay selector.
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
  «widget» de pantalla de bloqueo. Requiere decidir alcance (sección 9).

**PWA-02 · el temporizador de descanso solo existe en primer plano — S3**
- evidencia: interval de 250 ms con fecha límite de reloj
  (`src/components/session/rest-timer.tsx`); el vencimiento avisa con flash
  en página, vibración y pitido WebAudio — todo exige la página viva. El
  wake lock (si «mantener pantalla encendida» está activo) lo mitiga
  manteniendo la pantalla despierta.
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
| consistencia y estándares | NAV-07, ERR-06, kit | tres etiquetados para seis parámetros; carrera editable y fuerza no; `Segmented` sin usar |
| prevención de errores | ERR-01, ERR-03, ERR-04 | empezar una sesión futura sin fricción; terminar sin confirmar; borrar junto a exportar |
| reconocimiento > recuerdo | NAV-06, FLEX-02 | el porqué de cada fase y la prioridad de una semana rota hay que sabérselos |
| flexibilidad y eficiencia | ERR-05, NAV-03, FLEX-03 | ±1 día × 14; «+» × 18; el editor solo edita hoy |
| estética y minimalismo | DEN-01…DEN-06 | la spec promete un solo foco por pantalla; el runner, ajustes, historial y editor lo desbordan |
| recuperación de errores | ERR-01, ERR-02 | la sesión mal fechada no tiene arreglo desde la UI; la serie errónea tampoco |
| ayuda y documentación | FLEX-02, NAV-06 | la mejor documentación del producto (los PROGRAMA-*.md) no llega a la app |

## 8 · hoja de ruta recomendada

Nada de esto se implementa en esta rama. Orden dentro de cada ola ≈ ratio
valor/esfuerzo.

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
8. DEN-03 + DEN-06 — modo enfoque del runner; edición por ejercicio en el
   editor.

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
