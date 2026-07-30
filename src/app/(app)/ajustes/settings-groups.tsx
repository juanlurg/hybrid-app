"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { TONE } from "@/components/day-accents";
import {
  Chip,
  Footnote,
  Row,
  RowStack,
  RuleNote,
  SectionLabel,
  Stepper,
  Toggle,
} from "@/components/ui/kit";
import { signOut } from "@/lib/actions/auth";
import {
  clearHistory,
  togglePlate,
  updateProfile,
} from "@/lib/actions/profile";
import { cn } from "@/lib/cn";
import { formatWeight, round2 } from "@/lib/engine";
import type { Database } from "@/lib/supabase/database.types";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

/** The knobs this screen owns — the same set `updateProfile` accepts. */
export type SettingsProfile = Pick<
  ProfileRow,
  | "display_name"
  | "body_weight_kg"
  | "height_cm"
  | "units"
  | "bar_kg"
  | "plates_kg"
  | "dumbbell_step_kg"
  | "pulley_step_kg"
  | "kettlebells_kg"
  | "available_equipment"
  | "rounding_kg"
  | "regression_rule"
  | "auto_deload"
  | "sync_rm_after_retest"
  | "inc_lower_kg"
  | "inc_upper_kg"
  | "target_rir"
  | "auto_rest_timer"
  | "rest_sound"
  | "rest_vibration"
  | "keep_screen_awake"
  | "show_plate_breakdown"
  | "lthr"
  | "zone_model"
  | "distance_unit"
  | "notify_session"
  | "notify_deload"
  | "notify_weekly_summary"
>;

export interface SettingsLift {
  id: string;
  name: string;
  kind: Database["public"]["Enums"]["lift_kind"];
}

/** The plates the shop sells, heaviest first. Anything else the athlete
 *  already owns gets a chip too — see `plateOptions` below. */
const PLATE_STEPS = [25, 20, 15, 10, 5, 2.5, 1.25];

/** The bells the shop sells; owned odd sizes get a chip via the same trick. */
const KETTLEBELL_STEPS = [8, 12, 16, 20, 24];

type EquipmentKind = Database["public"]["Enums"]["equipment_kind"];

/** What can be toggled off. Bodyweight is always available by definition. */
const EQUIPMENT_OPTIONS: Array<{ value: EquipmentKind; label: string }> = [
  { value: "barbell", label: "Barra" },
  { value: "dumbbell", label: "Mancuernas" },
  { value: "kettlebell", label: "Kettlebells" },
  { value: "pulley", label: "Polea" },
  { value: "dip_bars", label: "Paralelas" },
  { value: "band", label: "Bandas" },
  { value: "machine", label: "Máquinas" },
];

/**
 * What the run screens fall back to while `lthr` is null — the same 168 ppm
 * `resolveDay()` feeds to `runBlocks()` in `src/lib/domain/plan.ts`. Stated
 * here so the empty stepper is honest about the number already in use.
 */
const LTHR_FALLBACK = 168;

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/**
 * Chip options for a value the database does not constrain to this list.
 * A profile written by onboarding, a migration or the AI can hold a bar or a
 * rounding step that is not one of the presets; appending it keeps the screen
 * showing what is actually stored instead of leaving every chip dark.
 */
function optionsWith<T extends string | number>(
  values: readonly T[],
  current: T,
  label: (value: T) => string,
): Array<{ value: T; label: string }> {
  const all = values.includes(current) ? values : [...values, current];
  return all.map((value) => ({ value, label: label(value) }));
}

/**
 * Step a nullable number.
 *
 * `seed` is where the control starts, not a value the app assumes: while the
 * column is null the stepper reads "—" and nothing is stored. The first press
 * writes the seed, so the number in the database is always one the athlete
 * chose to put there.
 */
function bump(
  current: number | null,
  delta: number,
  seed: number,
  min: number,
  max: number,
): number {
  if (current == null) return clamp(seed, min, max);
  return clamp(round2(Number(current) + delta), min, max);
}

export function SettingsGroups({
  profile: initialProfile,
  lifts,
  email,
}: {
  profile: SettingsProfile;
  lifts: SettingsLift[];
  email: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [profile, setProfile] = useState(initialProfile);
  const [name, setName] = useState(initialProfile.display_name);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [cleared, setCleared] = useState(false);

  const plates = (profile.plates_kg ?? [])
    .map(Number)
    .filter((n) => n > 0)
    .sort((a, b) => b - a);
  // A plate the athlete owns but that is off the preset list would otherwise
  // be invisible here while still driving the engine's breakdown.
  const plateOptions = Array.from(new Set([...PLATE_STEPS, ...plates])).sort(
    (a, b) => b - a,
  );
  const rounding = Number(profile.rounding_kg);
  const smallestPlate = plates.length ? plates[plates.length - 1] : null;
  const realStep = smallestPlate == null ? null : round2(smallestPlate * 2);
  const plateWarning =
    realStep == null
      ? "Sin discos marcados el motor solo puede prescribir la barra vacía"
      : realStep > rounding + 0.001
        ? `Con estos discos el salto real es de ${formatWeight(realStep)} kg`
        : null;

  /** Optimistic write: paint it now, roll back if the server says no. */
  function save(patch: Partial<SettingsProfile>, revert?: () => void) {
    const previous = profile;
    setProfile({ ...previous, ...patch });
    setError(null);
    startTransition(async () => {
      const res = await updateProfile(patch);
      if (!res.ok) {
        setProfile(previous);
        revert?.();
        setError(res.error ?? "No se ha podido guardar el cambio.");
      }
    });
  }

  function commitName() {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(profile.display_name);
      return;
    }
    if (trimmed === profile.display_name) return;
    const previousName = profile.display_name;
    save({ display_name: trimmed }, () => setName(previousName));
  }

  function toggleOnePlate(plate: number) {
    const previous = plates;
    const next = previous.includes(plate)
      ? previous.filter((p) => p !== plate)
      : [...previous, plate].sort((a, b) => b - a);
    setProfile((p) => ({ ...p, plates_kg: next }));
    setError(null);
    startTransition(async () => {
      const res = await togglePlate(plate);
      if (!res.ok) {
        setProfile((p) => ({ ...p, plates_kg: previous }));
        setError(res.error ?? "No se han podido guardar los discos.");
      }
    });
  }

  const bells = (profile.kettlebells_kg ?? [])
    .map(Number)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const bellOptions = Array.from(new Set([...KETTLEBELL_STEPS, ...bells])).sort(
    (a, b) => a - b,
  );
  const equipment = (profile.available_equipment ?? []) as EquipmentKind[];

  function toggleKettlebell(kg: number) {
    const next = bells.includes(kg)
      ? bells.filter((k) => k !== kg)
      : [...bells, kg].sort((a, b) => a - b);
    save({ kettlebells_kg: next });
  }

  function toggleEquipment(kind: EquipmentKind) {
    const next = equipment.includes(kind)
      ? equipment.filter((e) => e !== kind)
      : [...equipment, kind];
    // Bodyweight is not a chip: it can never be toggled away.
    if (!next.includes("bodyweight")) next.push("bodyweight");
    save({ available_equipment: next });
  }

  function wipeHistory() {
    setConfirmClear(false);
    setError(null);
    startTransition(async () => {
      const res = await clearHistory();
      if (!res.ok) {
        setError(res.error ?? "No se ha podido borrar el historial.");
        return;
      }
      setCleared(true);
      router.refresh();
    });
  }

  const namesOf = (kind: SettingsLift["kind"], fallback: string) => {
    const list = lifts.filter((l) => l.kind === kind).map((l) => l.name);
    return list.length ? list.join(" · ") : fallback;
  };

  /**
   * The save indicator rides every section label rather than only the first:
   * the list is far longer than a screen, and a status you have to scroll to
   * the top to read is not a status. It replaces the label's static hint, so
   * showing it shifts nothing.
   */
  const status = (hint?: string) => (pending ? "GUARDANDO…" : hint);

  return (
    <div className="pb-2">
      {/* Sticky: a failed save at the bottom of the list has to be readable
          from wherever the athlete was standing when it failed. */}
      {error ? (
        <div className="sticky top-0 z-10 border-b-2 border-ink bg-paper px-4 py-3">
          <RuleNote tone={TONE.fail} title="No se ha guardado">
            {error}
          </RuleNote>
        </div>
      ) : null}

      {/* ── atleta ─────────────────────────────────────────────── */}
      <SectionLabel right={status()}>Atleta</SectionLabel>
      <RowStack className="mt-2.5">
        <SettingRow name="Nombre" sub="Encabeza esta pantalla y los resúmenes">
          <input
            type="text"
            value={name}
            aria-label="Nombre"
            maxLength={40}
            autoComplete="name"
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="h-8 w-[130px] border-2 border-ink bg-transparent px-2 text-right text-[13px] leading-none font-bold"
          />
        </SettingRow>

        <SettingRow
          name="Peso corporal"
          sub="Referencia de los ejercicios con peso corporal"
        >
          <Stepper
            label="peso corporal"
            value={
              profile.body_weight_kg == null
                ? "—"
                : `${formatWeight(Number(profile.body_weight_kg))} kg`
            }
            onDecrement={() =>
              save({
                body_weight_kg: bump(
                  profile.body_weight_kg,
                  -0.5,
                  75,
                  35,
                  250,
                ),
              })
            }
            onIncrement={() =>
              save({
                body_weight_kg: bump(profile.body_weight_kg, 0.5, 75, 35, 250),
              })
            }
          />
        </SettingRow>

        <SettingRow name="Altura" sub="Solo registro: no entra en ningún cálculo">
          <Stepper
            label="altura"
            value={
              profile.height_cm == null ? "—" : `${profile.height_cm} cm`
            }
            onDecrement={() =>
              save({ height_cm: bump(profile.height_cm, -1, 175, 120, 230) })
            }
            onIncrement={() =>
              save({ height_cm: bump(profile.height_cm, 1, 175, 120, 230) })
            }
          />
        </SettingRow>

        <SettingRow name="Unidades" sub="El motor calcula siempre en kilos">
          <ChipRow
            value={profile.units}
            options={[
              { value: "kg", label: "KG" },
              { value: "lb", label: "LB" },
            ]}
            onChange={(units) => save({ units })}
          />
        </SettingRow>
      </RowStack>

      {/* ── equipo ─────────────────────────────────────────────── */}
      <SectionLabel right={status("GIMNASIO DE CASA")}>Equipo</SectionLabel>
      <RowStack className="mt-2.5">
        <SettingRow name="Barra" sub="La barra con la que levantas en casa">
          <ChipRow
            className="num"
            value={round2(Number(profile.bar_kg))}
            options={optionsWith(
              [20, 15, 10],
              round2(Number(profile.bar_kg)),
              (kg) => `${formatWeight(kg)} KG`,
            )}
            onChange={(bar_kg) => save({ bar_kg })}
          />
        </SettingRow>

        <Row>
          <div className="text-[13px] leading-[1.2] font-bold">
            Discos disponibles
          </div>
          <div className="mt-1 text-[10.5px] leading-[1.35] text-faint">
            Pares, no unidades. Marca solo los que puedas montar.
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {plateOptions.map((plate) => (
              <Chip
                key={plate}
                active={plates.includes(plate)}
                aria-pressed={plates.includes(plate)}
                onClick={() => toggleOnePlate(plate)}
                className="num min-w-11"
              >
                {formatWeight(plate)}
              </Chip>
            ))}
          </div>
          {plateWarning ? (
            <div className="num mt-2.5 text-[10.5px] leading-[1.35] font-semibold text-fail">
              {plateWarning}
            </div>
          ) : null}
        </Row>

        <SettingRow
          name="Salto de mancuernas"
          sub="El escalón mínimo entre dos mancuernas"
        >
          <Stepper
            label="salto de mancuernas"
            value={`${formatWeight(Number(profile.dumbbell_step_kg))} kg`}
            onDecrement={() =>
              save({
                dumbbell_step_kg: bump(
                  Number(profile.dumbbell_step_kg),
                  -0.5,
                  2.5,
                  0.5,
                  10,
                ),
              })
            }
            onIncrement={() =>
              save({
                dumbbell_step_kg: bump(
                  Number(profile.dumbbell_step_kg),
                  0.5,
                  2.5,
                  0.5,
                  10,
                ),
              })
            }
          />
        </SettingRow>

        <SettingRow
          name="Salto de polea"
          sub="Lo que separa dos clavijas del stack"
        >
          <Stepper
            label="salto de polea"
            value={`${formatWeight(Number(profile.pulley_step_kg))} kg`}
            onDecrement={() =>
              save({
                pulley_step_kg: bump(
                  Number(profile.pulley_step_kg),
                  -2.5,
                  5,
                  1,
                  10,
                ),
              })
            }
            onIncrement={() =>
              save({
                pulley_step_kg: bump(
                  Number(profile.pulley_step_kg),
                  2.5,
                  5,
                  1,
                  10,
                ),
              })
            }
          />
        </SettingRow>

        <Row>
          <div className="text-[13px] leading-[1.2] font-bold">Kettlebells</div>
          <div className="mt-1 text-[10.5px] leading-[1.35] text-faint">
            Las cargas de kettlebell se ajustan a una de estas, no a un salto.
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {bellOptions.map((kg) => (
              <Chip
                key={kg}
                active={bells.includes(kg)}
                aria-pressed={bells.includes(kg)}
                onClick={() => toggleKettlebell(kg)}
                className="num min-w-11"
              >
                {formatWeight(kg)}
              </Chip>
            ))}
          </div>
        </Row>

        <Row>
          <div className="text-[13px] leading-[1.2] font-bold">
            Material disponible
          </div>
          <div className="mt-1 text-[10.5px] leading-[1.35] text-faint">
            El editor y la IA solo proponen ejercicios que puedas montar.
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {EQUIPMENT_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                active={equipment.includes(opt.value)}
                aria-pressed={equipment.includes(opt.value)}
                onClick={() => toggleEquipment(opt.value)}
              >
                {opt.label}
              </Chip>
            ))}
          </div>
        </Row>
      </RowStack>

      {/* ── motor de pesos ─────────────────────────────────────── */}
      <SectionLabel right={status("AFECTA A LOS CÁLCULOS")}>
        Motor de pesos
      </SectionLabel>
      <RowStack className="mt-2.5">
        <SettingRow
          name="Regla de regresión"
          sub="Qué hace el motor cuando fallas el rango del básico"
        >
          <ChipRow
            value={profile.regression_rule}
            options={[
              { value: "conservative", label: "CONS." },
              { value: "standard", label: "EST." },
              { value: "aggressive", label: "AGR." },
            ]}
            onChange={(regression_rule) => save({ regression_rule })}
          />
        </SettingRow>

        <SettingRow
          name="Redondeo"
          sub="Todo peso prescrito cae en un múltiplo de esta cifra"
        >
          <ChipRow
            className="num"
            value={rounding}
            options={optionsWith([1.25, 2.5, 5], rounding, formatWeight)}
            onChange={(rounding_kg) => save({ rounding_kg })}
          />
        </SettingRow>

        <SettingRow
          name="Incremento por ciclo · piernas"
          sub={namesOf("lower", "sin básicos de tren inferior")}
        >
          <Stepper
            label="incremento de piernas"
            value={`${formatWeight(Number(profile.inc_lower_kg))} kg`}
            onDecrement={() =>
              save({
                inc_lower_kg: bump(Number(profile.inc_lower_kg), -2.5, 5, 0, 20),
              })
            }
            onIncrement={() =>
              save({
                inc_lower_kg: bump(Number(profile.inc_lower_kg), 2.5, 5, 0, 20),
              })
            }
          />
        </SettingRow>

        <SettingRow
          name="Incremento por ciclo · torso"
          sub={namesOf("upper", "sin básicos de tren superior")}
        >
          <Stepper
            label="incremento de torso"
            value={`${formatWeight(Number(profile.inc_upper_kg))} kg`}
            onDecrement={() =>
              save({
                inc_upper_kg: bump(
                  Number(profile.inc_upper_kg),
                  -1.25,
                  2.5,
                  0,
                  10,
                ),
              })
            }
            onIncrement={() =>
              save({
                inc_upper_kg: bump(
                  Number(profile.inc_upper_kg),
                  1.25,
                  2.5,
                  0,
                  10,
                ),
              })
            }
          />
        </SettingRow>

        <SettingRow
          name="RIR objetivo"
          sub="Repeticiones en reserva al cerrar cada serie del básico"
        >
          <ChipRow
            className="num"
            value={profile.target_rir}
            options={optionsWith(
              ["0-1", "1-3", "2-4"],
              profile.target_rir,
              (rir) => rir,
            )}
            onChange={(target_rir) => save({ target_rir })}
          />
        </SettingRow>

        <SettingRow
          name="Descarga automática"
          sub="La última semana del ciclo va a mitad de series"
        >
          <Toggle
            label="Descarga automática"
            checked={profile.auto_deload}
            onChange={(auto_deload) => save({ auto_deload })}
          />
        </SettingRow>

        <SettingRow
          name="Recalcular RM tras el re-test"
          sub="El resultado del re-test sustituye a la RM estimada"
        >
          <Toggle
            label="Recalcular RM tras el re-test"
            checked={profile.sync_rm_after_retest}
            onChange={(sync_rm_after_retest) => save({ sync_rm_after_retest })}
          />
        </SettingRow>
      </RowStack>

      {/* ── sesión ─────────────────────────────────────────────── */}
      <SectionLabel right={status()}>Sesión</SectionLabel>
      <RowStack className="mt-2.5">
        <SettingRow
          name="Cronómetro automático"
          sub="Arranca el descanso al registrar cada serie"
        >
          <Toggle
            label="Cronómetro automático"
            checked={profile.auto_rest_timer}
            onChange={(auto_rest_timer) => save({ auto_rest_timer })}
          />
        </SettingRow>
        <SettingRow name="Aviso sonoro" sub="Un pitido al terminar el descanso">
          <Toggle
            label="Aviso sonoro"
            checked={profile.rest_sound}
            onChange={(rest_sound) => save({ rest_sound })}
          />
        </SettingRow>
        <SettingRow name="Vibración" sub="El móvil vibra al terminar el descanso">
          <Toggle
            label="Vibración"
            checked={profile.rest_vibration}
            onChange={(rest_vibration) => save({ rest_vibration })}
          />
        </SettingRow>
        <SettingRow
          name="Mantener la pantalla encendida"
          sub="Mientras la sesión esté abierta"
        >
          <Toggle
            label="Mantener la pantalla encendida"
            checked={profile.keep_screen_awake}
            onChange={(keep_screen_awake) => save({ keep_screen_awake })}
          />
        </SettingRow>
        <SettingRow
          name="Mostrar discos por lado"
          sub="El desglose de discos bajo el peso del día"
        >
          <Toggle
            label="Mostrar discos por lado"
            checked={profile.show_plate_breakdown}
            onChange={(show_plate_breakdown) => save({ show_plate_breakdown })}
          />
        </SettingRow>
      </RowStack>

      {/* ── carrera ────────────────────────────────────────────── */}
      <SectionLabel right={status("ZONAS Y DATOS")}>Carrera</SectionLabel>
      <RowStack className="mt-2.5">
        <SettingRow
          name="LTHR"
          sub={
            profile.lthr == null ? (
              <>
                Sin test: las zonas de carrera van con{" "}
                <span className="num">{LTHR_FALLBACK}</span> ppm
              </>
            ) : (
              "Pulso umbral: de aquí salen las cinco zonas"
            )
          }
        >
          <Stepper
            label="LTHR"
            value={profile.lthr == null ? "—" : `${profile.lthr} ppm`}
            onDecrement={() =>
              save({ lthr: bump(profile.lthr, -1, LTHR_FALLBACK, 100, 230) })
            }
            onIncrement={() =>
              save({ lthr: bump(profile.lthr, 1, LTHR_FALLBACK, 100, 230) })
            }
          />
        </SettingRow>
        <SettingRow
          name="Modelo de zonas"
          sub="Hoy las cinco zonas se calculan siempre desde el LTHR"
        >
          <ChipRow
            value={profile.zone_model}
            options={[
              { value: "lthr", label: "LTHR" },
              { value: "hrmax", label: "FC MÁX" },
            ]}
            onChange={(zone_model) => save({ zone_model })}
          />
        </SettingRow>
        <SettingRow name="Distancia" sub="Solo cambia cómo se muestran los kilómetros">
          <ChipRow
            value={profile.distance_unit}
            options={[
              { value: "km", label: "KM" },
              { value: "mi", label: "MI" },
            ]}
            onChange={(distance_unit) => save({ distance_unit })}
          />
        </SettingRow>
      </RowStack>

      {/* ── avisos ─────────────────────────────────────────────── */}
      <SectionLabel right={status()}>Avisos</SectionLabel>
      <RowStack className="mt-2.5">
        <SettingRow
          name="Recordatorio de sesión"
          sub="El día que toca entrenar, por la mañana"
        >
          <Toggle
            label="Recordatorio de sesión"
            checked={profile.notify_session}
            onChange={(notify_session) => save({ notify_session })}
          />
        </SettingRow>
        <SettingRow
          name="Aviso de semana de descarga"
          sub="Al empezar la última semana del ciclo"
        >
          <Toggle
            label="Aviso de semana de descarga"
            checked={profile.notify_deload}
            onChange={(notify_deload) => save({ notify_deload })}
          />
        </SettingRow>
        <SettingRow
          name="Resumen semanal"
          sub="Domingo por la noche, con tonelaje y kilómetros"
        >
          <Toggle
            label="Resumen semanal"
            checked={profile.notify_weekly_summary}
            onChange={(notify_weekly_summary) => save({ notify_weekly_summary })}
          />
        </SettingRow>
      </RowStack>

      {/* ── cuenta ─────────────────────────────────────────────── */}
      <SectionLabel>Cuenta</SectionLabel>
      <RowStack className="mt-2.5">
        <SettingRow name="Correo" sub="La cuenta con la que entras">
          <span className="text-[11.5px] leading-none font-semibold text-mid">
            {email ?? "sin correo"}
          </span>
        </SettingRow>
        <form action={signOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 bg-paper px-4 py-3 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] leading-[1.2] font-bold">
                Cerrar sesión
              </span>
              <span className="mt-1 block text-[10.5px] leading-[1.35] text-faint">
                Habrá que volver a entrar con la contraseña
              </span>
            </span>
            <span
              aria-hidden
              className="flex-none text-[16px] leading-none font-bold"
            >
              →
            </span>
          </button>
        </form>
      </RowStack>

      {/* ── datos ──────────────────────────────────────────────── */}
      <SectionLabel right={status()}>Datos</SectionLabel>
      <RowStack className="mt-2.5">
        <a
          href="/api/export"
          download
          className="flex w-full items-center gap-3 bg-paper px-4 py-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] leading-[1.2] font-bold">
              Exportar histórico (JSON)
            </span>
            <span className="mt-1 block text-[10.5px] leading-[1.35] text-faint">
              Todo lo tuyo en un archivo. En el plan gratuito esto ES la copia
              de seguridad: descárgalo cada semana.
            </span>
          </span>
          <span
            aria-hidden
            className="flex-none text-[16px] leading-none font-bold"
          >
            ↓
          </span>
        </a>

        {confirmClear ? (
          <Row className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] leading-[1.2] font-bold text-fail">
                ¿Seguro?
              </div>
              <div className="mt-1 text-[10.5px] leading-[1.35] text-faint">
                Se borran todas las sesiones y series registradas de esta
                temporada
              </div>
            </div>
            <div className="flex flex-none gap-1.5">
              <Chip
                active
                onClick={wipeHistory}
                className="border-fail bg-fail text-paper"
              >
                Sí
              </Chip>
              <Chip onClick={() => setConfirmClear(false)}>Cancelar</Chip>
            </div>
          </Row>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="flex w-full items-center gap-3 bg-paper px-4 py-3 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] leading-[1.2] font-bold text-fail">
                Borrar historial
              </span>
              <span className="mt-1 block text-[10.5px] leading-[1.35] text-faint">
                No se puede deshacer
              </span>
            </span>
            <span
              aria-hidden
              className="flex-none text-[16px] leading-none font-bold text-fail"
            >
              →
            </span>
          </button>
        )}
        {cleared ? (
          <Row>
            <div className="text-[11.5px] leading-[1.45] text-mid">
              Historial borrado. Las RM, la ola y el programa siguen intactos.
            </div>
          </Row>
        ) : null}
      </RowStack>

      <Footnote>
        Las RM, la ola y la regla de regresión son el motor: cambiarlas
        recalcula los pesos de las próximas sesiones, nunca las ya registradas.
      </Footnote>
    </div>
  );
}

/* ── row scaffolding ──────────────────────────────────────────── */

function SettingRow({
  name,
  sub,
  children,
}: {
  name: string;
  sub?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Row className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-[1.2] font-bold">{name}</div>
        {sub ? (
          <div className="mt-1 text-[10.5px] leading-[1.35] text-faint">
            {sub}
          </div>
        ) : null}
      </div>
      <div className="flex flex-none justify-end">{children}</div>
    </Row>
  );
}

function ChipRow<T extends string | number>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-none gap-1.5", className)}>
      {options.map((o) => (
        <Chip
          key={String(o.value)}
          active={o.value === value}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Chip>
      ))}
    </div>
  );
}
