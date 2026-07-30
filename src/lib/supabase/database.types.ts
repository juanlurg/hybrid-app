export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      ai_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          meta: Json
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          meta?: Json
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          meta?: Json
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ai_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_proposals: {
        Row: {
          accepted_indices: number[]
          applied_at: string | null
          changes: Json
          created_at: string
          dropped: Json
          id: string
          message_id: string | null
          phase_id: string | null
          program_id: string
          question: string
          rationale: string
          snapshot: Json | null
          status: Database["public"]["Enums"]["ai_proposal_status"]
          thread_id: string | null
          undone_at: string | null
          user_id: string
        }
        Insert: {
          accepted_indices?: number[]
          applied_at?: string | null
          changes?: Json
          created_at?: string
          dropped?: Json
          id?: string
          message_id?: string | null
          phase_id?: string | null
          program_id: string
          question?: string
          rationale?: string
          snapshot?: Json | null
          status?: Database["public"]["Enums"]["ai_proposal_status"]
          thread_id?: string | null
          undone_at?: string | null
          user_id: string
        }
        Update: {
          accepted_indices?: number[]
          applied_at?: string | null
          changes?: Json
          created_at?: string
          dropped?: Json
          id?: string
          message_id?: string | null
          phase_id?: string | null
          program_id?: string
          question?: string
          rationale?: string
          snapshot?: Json | null
          status?: Database["public"]["Enums"]["ai_proposal_status"]
          thread_id?: string | null
          undone_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_proposals_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "ai_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_proposals_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "program_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_proposals_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_proposals_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ai_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_threads: {
        Row: {
          created_at: string
          id: string
          program_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          program_id?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          program_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_threads_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      engine_events: {
        Row: {
          created_at: string
          dedup_key: string | null
          detail: string
          id: string
          kind: Database["public"]["Enums"]["engine_event_kind"]
          lift_id: string | null
          payload: Json
          program_id: string | null
          reverted_at: string | null
          session_id: string | null
          title: string
          user_id: string
          week: number | null
        }
        Insert: {
          created_at?: string
          dedup_key?: string | null
          detail?: string
          id?: string
          kind: Database["public"]["Enums"]["engine_event_kind"]
          lift_id?: string | null
          payload?: Json
          program_id?: string | null
          reverted_at?: string | null
          session_id?: string | null
          title: string
          user_id: string
          week?: number | null
        }
        Update: {
          created_at?: string
          dedup_key?: string | null
          detail?: string
          id?: string
          kind?: Database["public"]["Enums"]["engine_event_kind"]
          lift_id?: string | null
          payload?: Json
          program_id?: string | null
          reverted_at?: string | null
          session_id?: string | null
          title?: string
          user_id?: string
          week?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "engine_events_lift_id_fkey"
            columns: ["lift_id"]
            isOneToOne: false
            referencedRelation: "lifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engine_events_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engine_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          created_at: string
          cues: string | null
          default_rest_seconds: number
          equipment: Database["public"]["Enums"]["equipment_kind"]
          id: string
          is_unilateral: boolean
          modality: Database["public"]["Enums"]["load_mode"]
          name: string
          owner_id: string | null
          pattern: string | null
          slug: string
          substitution_for: string | null
        }
        Insert: {
          created_at?: string
          cues?: string | null
          default_rest_seconds?: number
          equipment?: Database["public"]["Enums"]["equipment_kind"]
          id?: string
          is_unilateral?: boolean
          modality?: Database["public"]["Enums"]["load_mode"]
          name: string
          owner_id?: string | null
          pattern?: string | null
          slug: string
          substitution_for?: string | null
        }
        Update: {
          created_at?: string
          cues?: string | null
          default_rest_seconds?: number
          equipment?: Database["public"]["Enums"]["equipment_kind"]
          id?: string
          is_unilateral?: boolean
          modality?: Database["public"]["Enums"]["load_mode"]
          name?: string
          owner_id?: string | null
          pattern?: string | null
          slug?: string
          substitution_for?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercises_substitution_for_fkey"
            columns: ["substitution_for"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      lifts: {
        Row: {
          created_at: string
          e1rm_kg: number
          exercise_id: string | null
          fail_count: number
          hold: boolean
          hold_at_kg: number | null
          id: string
          key: string
          kind: Database["public"]["Enums"]["lift_kind"]
          name: string
          penalty: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          e1rm_kg: number
          exercise_id?: string | null
          fail_count?: number
          hold?: boolean
          hold_at_kg?: number | null
          id?: string
          key: string
          kind: Database["public"]["Enums"]["lift_kind"]
          name: string
          penalty?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          e1rm_kg?: number
          exercise_id?: string | null
          fail_count?: number
          hold?: boolean
          hold_at_kg?: number | null
          id?: string
          key?: string
          kind?: Database["public"]["Enums"]["lift_kind"]
          name?: string
          penalty?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lifts_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      measurements: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["measurement_kind"]
          label: string
          notes: string
          payload: Json
          taken_on: string
          unit: string
          user_id: string
          value: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["measurement_kind"]
          label?: string
          notes?: string
          payload?: Json
          taken_on: string
          unit?: string
          user_id: string
          value?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["measurement_kind"]
          label?: string
          notes?: string
          payload?: Json
          taken_on?: string
          unit?: string
          user_id?: string
          value?: number | null
        }
        Relationships: []
      }
      mobility_items: {
        Row: {
          created_at: string
          dose: string
          dose_unit: string
          group_name: string
          id: string
          name: string
          note: string
          owner_id: string | null
          position: number
          slug: string
        }
        Insert: {
          created_at?: string
          dose: string
          dose_unit?: string
          group_name: string
          id?: string
          name: string
          note?: string
          owner_id?: string | null
          position?: number
          slug: string
        }
        Update: {
          created_at?: string
          dose?: string
          dose_unit?: string
          group_name?: string
          id?: string
          name?: string
          note?: string
          owner_id?: string | null
          position?: number
          slug?: string
        }
        Relationships: []
      }
      mobility_logs: {
        Row: {
          completed_slugs: string[]
          created_at: string
          id: string
          notes: string
          performed_on: string
          session_id: string | null
          total_items: number
          user_id: string
        }
        Insert: {
          completed_slugs?: string[]
          created_at?: string
          id?: string
          notes?: string
          performed_on: string
          session_id?: string | null
          total_items?: number
          user_id: string
        }
        Update: {
          completed_slugs?: string[]
          created_at?: string
          id?: string
          notes?: string
          performed_on?: string
          session_id?: string | null
          total_items?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mobility_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auto_deload: boolean
          auto_rest_timer: boolean
          available_equipment: Database["public"]["Enums"]["equipment_kind"][]
          bar_kg: number
          body_weight_kg: number | null
          created_at: string
          display_name: string
          dumbbell_step_kg: number
          height_cm: number | null
          id: string
          inc_lower_kg: number
          inc_upper_kg: number
          keep_screen_awake: boolean
          kettlebells_kg: number[]
          last_export_at: string | null
          locale: string
          lthr: number | null
          onboarded_at: string | null
          plates_kg: number[]
          pulley_step_kg: number
          regression_rule: Database["public"]["Enums"]["regression_rule"]
          rest_sound: boolean
          rest_vibration: boolean
          rounding_kg: number
          show_plate_breakdown: boolean
          sync_rm_after_retest: boolean
          target_rir: string
          updated_at: string
        }
        Insert: {
          auto_deload?: boolean
          auto_rest_timer?: boolean
          available_equipment?: Database["public"]["Enums"]["equipment_kind"][]
          bar_kg?: number
          body_weight_kg?: number | null
          created_at?: string
          display_name?: string
          dumbbell_step_kg?: number
          height_cm?: number | null
          id: string
          inc_lower_kg?: number
          inc_upper_kg?: number
          keep_screen_awake?: boolean
          kettlebells_kg?: number[]
          last_export_at?: string | null
          locale?: string
          lthr?: number | null
          onboarded_at?: string | null
          plates_kg?: number[]
          pulley_step_kg?: number
          regression_rule?: Database["public"]["Enums"]["regression_rule"]
          rest_sound?: boolean
          rest_vibration?: boolean
          rounding_kg?: number
          show_plate_breakdown?: boolean
          sync_rm_after_retest?: boolean
          target_rir?: string
          updated_at?: string
        }
        Update: {
          auto_deload?: boolean
          auto_rest_timer?: boolean
          available_equipment?: Database["public"]["Enums"]["equipment_kind"][]
          bar_kg?: number
          body_weight_kg?: number | null
          created_at?: string
          display_name?: string
          dumbbell_step_kg?: number
          height_cm?: number | null
          id?: string
          inc_lower_kg?: number
          inc_upper_kg?: number
          keep_screen_awake?: boolean
          kettlebells_kg?: number[]
          last_export_at?: string | null
          locale?: string
          lthr?: number | null
          onboarded_at?: string | null
          plates_kg?: number[]
          pulley_step_kg?: number
          regression_rule?: Database["public"]["Enums"]["regression_rule"]
          rest_sound?: boolean
          rest_vibration?: boolean
          rounding_kg?: number
          show_plate_breakdown?: boolean
          sync_rm_after_retest?: boolean
          target_rir?: string
          updated_at?: string
        }
        Relationships: []
      }
      program_days: {
        Row: {
          day_index: number
          id: string
          phase_id: string
          slot_id: string
        }
        Insert: {
          day_index: number
          id?: string
          phase_id: string
          slot_id: string
        }
        Update: {
          day_index?: number
          id?: string
          phase_id?: string
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_days_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "program_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_days_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "program_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      program_exercises: {
        Row: {
          created_at: string
          effort: string
          equipment: Database["public"]["Enums"]["equipment_kind"] | null
          exercise_id: string | null
          fixed_weight_kg: number | null
          id: string
          is_primary: boolean
          lift_key: string | null
          load_mode: Database["public"]["Enums"]["load_mode"]
          name: string
          notes: string
          position: number
          rep_max: number
          rep_min: number
          rest_seconds: number
          sets: number
          slot_id: string
          superset_group: number | null
          tag: string
        }
        Insert: {
          created_at?: string
          effort?: string
          equipment?: Database["public"]["Enums"]["equipment_kind"] | null
          exercise_id?: string | null
          fixed_weight_kg?: number | null
          id?: string
          is_primary?: boolean
          lift_key?: string | null
          load_mode?: Database["public"]["Enums"]["load_mode"]
          name: string
          notes?: string
          position: number
          rep_max: number
          rep_min: number
          rest_seconds?: number
          sets: number
          slot_id: string
          superset_group?: number | null
          tag?: string
        }
        Update: {
          created_at?: string
          effort?: string
          equipment?: Database["public"]["Enums"]["equipment_kind"] | null
          exercise_id?: string | null
          fixed_weight_kg?: number | null
          id?: string
          is_primary?: boolean
          lift_key?: string | null
          load_mode?: Database["public"]["Enums"]["load_mode"]
          name?: string
          notes?: string
          position?: number
          rep_max?: number
          rep_min?: number
          rest_seconds?: number
          sets?: number
          slot_id?: string
          superset_group?: number | null
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_exercises_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "program_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      program_lift_defaults: {
        Row: {
          default_e1rm_kg: number
          exercise_slug: string | null
          id: string
          kind: Database["public"]["Enums"]["lift_kind"]
          lift_key: string
          name: string
          position: number
          program_id: string
        }
        Insert: {
          default_e1rm_kg: number
          exercise_slug?: string | null
          id?: string
          kind: Database["public"]["Enums"]["lift_kind"]
          lift_key: string
          name: string
          position?: number
          program_id: string
        }
        Update: {
          default_e1rm_kg?: number
          exercise_slug?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["lift_kind"]
          lift_key?: string
          name?: string
          position?: number
          program_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_lift_defaults_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      program_phases: {
        Row: {
          created_at: string
          cycle_weeks: number | null
          emphasis: string
          id: string
          key: string
          name: string
          notes: string
          pct_of_rm: number | null
          position: number
          program_id: string
          progression_mode: string
          starts_on: string | null
          wave: number[] | null
          weeks: number
        }
        Insert: {
          created_at?: string
          cycle_weeks?: number | null
          emphasis?: string
          id?: string
          key: string
          name: string
          notes?: string
          pct_of_rm?: number | null
          position: number
          program_id: string
          progression_mode?: string
          starts_on?: string | null
          wave?: number[] | null
          weeks: number
        }
        Update: {
          created_at?: string
          cycle_weeks?: number | null
          emphasis?: string
          id?: string
          key?: string
          name?: string
          notes?: string
          pct_of_rm?: number | null
          position?: number
          program_id?: string
          progression_mode?: string
          starts_on?: string | null
          wave?: number[] | null
          weeks?: number
        }
        Relationships: [
          {
            foreignKeyName: "program_phases_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      program_run_sessions: {
        Row: {
          id: string
          notes: string
          phase_id: string
          prescription: string
          slot_id: string
          structure: Json | null
          target_minutes: number | null
          week: number
        }
        Insert: {
          id?: string
          notes?: string
          phase_id: string
          prescription: string
          slot_id: string
          structure?: Json | null
          target_minutes?: number | null
          week: number
        }
        Update: {
          id?: string
          notes?: string
          phase_id?: string
          prescription?: string
          slot_id?: string
          structure?: Json | null
          target_minutes?: number | null
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "program_run_sessions_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "program_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_run_sessions_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "program_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      program_slots: {
        Row: {
          created_at: string
          id: string
          key: string
          label: string
          phase_id: string
          position: number
          session_type: Database["public"]["Enums"]["session_type"]
          subtitle: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          label: string
          phase_id: string
          position?: number
          session_type: Database["public"]["Enums"]["session_type"]
          subtitle?: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          label?: string
          phase_id?: string
          position?: number
          session_type?: Database["public"]["Enums"]["session_type"]
          subtitle?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_slots_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "program_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          created_at: string
          cycle_weeks: number
          ends_on: string | null
          goal: string
          id: string
          is_active: boolean
          is_template: boolean
          name: string
          race_name: string | null
          race_on: string | null
          slug: string | null
          source: string
          starts_on: string
          summary: string
          updated_at: string
          user_id: string | null
          wave: number[]
        }
        Insert: {
          created_at?: string
          cycle_weeks?: number
          ends_on?: string | null
          goal?: string
          id?: string
          is_active?: boolean
          is_template?: boolean
          name: string
          race_name?: string | null
          race_on?: string | null
          slug?: string | null
          source?: string
          starts_on: string
          summary?: string
          updated_at?: string
          user_id?: string | null
          wave?: number[]
        }
        Update: {
          created_at?: string
          cycle_weeks?: number
          ends_on?: string | null
          goal?: string
          id?: string
          is_active?: boolean
          is_template?: boolean
          name?: string
          race_name?: string | null
          race_on?: string | null
          slug?: string | null
          source?: string
          starts_on?: string
          summary?: string
          updated_at?: string
          user_id?: string | null
          wave?: number[]
        }
        Relationships: []
      }
      run_logs: {
        Row: {
          avg_hr: number | null
          created_at: string
          decoupling_pct: number | null
          distance_km: number | null
          dominant_zone: string | null
          duration_seconds: number | null
          id: string
          max_hr: number | null
          notes: string
          perceived_effort: number | null
          prescription: string
          session_id: string
          user_id: string
        }
        Insert: {
          avg_hr?: number | null
          created_at?: string
          decoupling_pct?: number | null
          distance_km?: number | null
          dominant_zone?: string | null
          duration_seconds?: number | null
          id?: string
          max_hr?: number | null
          notes?: string
          perceived_effort?: number | null
          prescription?: string
          session_id: string
          user_id: string
        }
        Update: {
          avg_hr?: number | null
          created_at?: string
          decoupling_pct?: number | null
          distance_km?: number | null
          dominant_zone?: string | null
          duration_seconds?: number | null
          id?: string
          max_hr?: number | null
          notes?: string
          perceived_effort?: number | null
          prescription?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          day_index: number
          duration_seconds: number | null
          id: string
          notes: string
          phase_id: string | null
          program_id: string | null
          scheduled_on: string
          session_type: Database["public"]["Enums"]["session_type"]
          slot_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["session_status"]
          title: string
          tonnage_kg: number
          updated_at: string
          user_id: string
          week: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          day_index: number
          duration_seconds?: number | null
          id?: string
          notes?: string
          phase_id?: string | null
          program_id?: string | null
          scheduled_on: string
          session_type: Database["public"]["Enums"]["session_type"]
          slot_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          title?: string
          tonnage_kg?: number
          updated_at?: string
          user_id: string
          week: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          day_index?: number
          duration_seconds?: number | null
          id?: string
          notes?: string
          phase_id?: string | null
          program_id?: string | null
          scheduled_on?: string
          session_type?: Database["public"]["Enums"]["session_type"]
          slot_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          title?: string
          tonnage_kg?: number
          updated_at?: string
          user_id?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "sessions_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "program_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "program_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      set_logs: {
        Row: {
          exercise_name: string
          id: string
          lift_key: string | null
          logged_at: string
          missed_range: boolean
          position: number
          program_exercise_id: string | null
          reps: number | null
          rir: number | null
          seconds: number | null
          session_id: string
          set_index: number
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          exercise_name: string
          id?: string
          lift_key?: string | null
          logged_at?: string
          missed_range?: boolean
          position?: number
          program_exercise_id?: string | null
          reps?: number | null
          rir?: number | null
          seconds?: number | null
          session_id: string
          set_index: number
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          exercise_name?: string
          id?: string
          lift_key?: string | null
          logged_at?: string
          missed_range?: boolean
          position?: number
          program_exercise_id?: string | null
          reps?: number | null
          rir?: number | null
          seconds?: number | null
          session_id?: string
          set_index?: number
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "set_logs_program_exercise_id_fkey"
            columns: ["program_exercise_id"]
            isOneToOne: false
            referencedRelation: "program_exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "set_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_read_program: { Args: { p_program_id: string }; Returns: boolean }
      clone_program: {
        Args: {
          p_activate?: boolean
          p_name?: string
          p_source_id: string
          p_starts_on?: string
        }
        Returns: string
      }
      onboard_athlete: {
        Args: {
          p_body_weight_kg?: number
          p_display_name?: string
          p_lthr?: number
          p_starts_on?: string
          p_template_slug?: string
        }
        Returns: string
      }
      owns_program: { Args: { p_program_id: string }; Returns: boolean }
      program_of_phase: { Args: { p_phase_id: string }; Returns: string }
      program_of_slot: { Args: { p_slot_id: string }; Returns: string }
      shift_program: {
        Args: { p_days: number; p_program_id: string }
        Returns: undefined
      }
    }
    Enums: {
      ai_proposal_status: "pending" | "applied" | "discarded" | "undone"
      engine_event_kind:
        | "fail_hold"
        | "fail_penalty"
        | "clean_reset"
        | "cycle_bump"
        | "lthr_test"
        | "rm_retest"
        | "manual_rm"
        | "ai_change"
        | "program_created"
        | "phase_started"
        | "accessory_bump"
        | "plan_shifted"
      equipment_kind:
        | "barbell"
        | "dumbbell"
        | "kettlebell"
        | "pulley"
        | "bodyweight"
        | "band"
        | "dip_bars"
        | "machine"
      lift_kind: "lower" | "upper"
      load_mode:
        | "engine"
        | "fixed"
        | "bodyweight"
        | "weighted_bodyweight"
        | "rpe"
      measurement_kind: "lthr" | "rm_estimate" | "time_trial" | "body"
      regression_rule: "conservative" | "standard" | "aggressive"
      session_status: "planned" | "in_progress" | "done" | "partial" | "skipped"
      session_type:
        | "strength"
        | "run_quality"
        | "run_long"
        | "run_easy"
        | "run_test"
        | "mobility"
        | "rest"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ai_proposal_status: ["pending", "applied", "discarded", "undone"],
      engine_event_kind: [
        "fail_hold",
        "fail_penalty",
        "clean_reset",
        "cycle_bump",
        "lthr_test",
        "rm_retest",
        "manual_rm",
        "ai_change",
        "program_created",
        "phase_started",
        "accessory_bump",
        "plan_shifted",
      ],
      equipment_kind: [
        "barbell",
        "dumbbell",
        "kettlebell",
        "pulley",
        "bodyweight",
        "band",
        "dip_bars",
        "machine",
      ],
      lift_kind: ["lower", "upper"],
      load_mode: [
        "engine",
        "fixed",
        "bodyweight",
        "weighted_bodyweight",
        "rpe",
      ],
      measurement_kind: ["lthr", "rm_estimate", "time_trial", "body"],
      regression_rule: ["conservative", "standard", "aggressive"],
      session_status: ["planned", "in_progress", "done", "partial", "skipped"],
      session_type: [
        "strength",
        "run_quality",
        "run_long",
        "run_easy",
        "run_test",
        "mobility",
        "rest",
      ],
    },
  },
} as const

