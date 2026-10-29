// Generated from the Supabase schema (mcp generate_typescript_types). Do not edit by hand.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_runs: {
        Row: {
          cost_usd: number
          created_at: string
          created_by: string | null
          detail: string | null
          id: string
          idea_id: string | null
          input_tokens: number
          model: string
          outcome: string
          output_tokens: number
          prompt_version: string
          purpose: string
          web_searches: number
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          created_by?: string | null
          detail?: string | null
          id?: string
          idea_id?: string | null
          input_tokens?: number
          model: string
          outcome: string
          output_tokens?: number
          prompt_version: string
          purpose: string
          web_searches?: number
        }
        Update: {
          cost_usd?: number
          created_at?: string
          created_by?: string | null
          detail?: string | null
          id?: string
          idea_id?: string | null
          input_tokens?: number
          model?: string
          outcome?: string
          output_tokens?: number
          prompt_version?: string
          purpose?: string
          web_searches?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_runs_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      assumption_claims: {
        Row: {
          assumption_id: string
          claim_id: string
          idea_id: string
          relation: string
        }
        Insert: {
          assumption_id: string
          claim_id: string
          idea_id: string
          relation: string
        }
        Update: {
          assumption_id?: string
          claim_id?: string
          idea_id?: string
          relation?: string
        }
        Relationships: [
          {
            foreignKeyName: "assumption_claims_assumption_id_fkey"
            columns: ["assumption_id"]
            isOneToOne: false
            referencedRelation: "assumptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assumption_claims_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assumption_claims_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      assumption_observations: {
        Row: {
          assumption_id: string
          idea_id: string
          observation_id: string
          relation: string
        }
        Insert: {
          assumption_id: string
          idea_id: string
          observation_id: string
          relation: string
        }
        Update: {
          assumption_id?: string
          idea_id?: string
          observation_id?: string
          relation?: string
        }
        Relationships: [
          {
            foreignKeyName: "assumption_observations_assumption_id_fkey"
            columns: ["assumption_id"]
            isOneToOne: false
            referencedRelation: "assumptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assumption_observations_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assumption_observations_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "observations"
            referencedColumns: ["id"]
          },
        ]
      }
      assumptions: {
        Row: {
          category: string
          created_at: string
          id: string
          idea_id: string
          importance: number
          origin: string
          statement: string
          status: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          idea_id: string
          importance?: number
          origin?: string
          statement: string
          status?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          idea_id?: string
          importance?: number
          origin?: string
          statement?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "assumptions_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          org_id: string | null
          action: string
          actor_id: string | null
          detail: Json | null
          id: number
          idea_id: string | null
          occurred_at: string
          row_id: string
          table_name: string
        }
        Insert: {
          org_id?: string | null
          action: string
          actor_id?: string | null
          detail?: Json | null
          id?: never
          idea_id?: string | null
          occurred_at?: string
          row_id: string
          table_name: string
        }
        Update: {
          org_id?: string | null
          action?: string
          actor_id?: string | null
          detail?: Json | null
          id?: never
          idea_id?: string | null
          occurred_at?: string
          row_id?: string
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_sources: {
        Row: {
          claim_id: string
          created_at: string
          excerpt_id: string | null
          id: string
          idea_id: string
          quote: string
          quote_check: string
          source_id: string
          stance: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          excerpt_id?: string | null
          id?: string
          idea_id: string
          quote: string
          quote_check?: string
          source_id: string
          stance?: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          excerpt_id?: string | null
          id?: string
          idea_id?: string
          quote?: string
          quote_check?: string
          source_id?: string
          stance?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_sources_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_sources_excerpt_id_fkey"
            columns: ["excerpt_id"]
            isOneToOne: false
            referencedRelation: "source_excerpts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_sources_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_sources_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      claims: {
        Row: {
          created_at: string
          created_by: string | null
          definition: string | null
          does_not_prove: string | null
          evidence_type: string
          freshness_kind: string
          id: string
          idea_id: string
          limitations: string | null
          numeric_value: number | null
          origin: string
          period: string | null
          question_id: string | null
          region: string | null
          section: string
          statement: string
          status: string
          status_reason: string | null
          supports: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          definition?: string | null
          does_not_prove?: string | null
          evidence_type: string
          freshness_kind?: string
          id?: string
          idea_id: string
          limitations?: string | null
          numeric_value?: number | null
          origin?: string
          period?: string | null
          question_id?: string | null
          region?: string | null
          section?: string
          statement: string
          status?: string
          status_reason?: string | null
          supports?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          definition?: string | null
          does_not_prove?: string | null
          evidence_type?: string
          freshness_kind?: string
          id?: string
          idea_id?: string
          limitations?: string | null
          numeric_value?: number | null
          origin?: string
          period?: string | null
          question_id?: string | null
          region?: string | null
          section?: string
          statement?: string
          status?: string
          status_reason?: string | null
          supports?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claims_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "research_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          org_id: string
          sector: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          org_id: string
          sector?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          sector?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          claim_id: string | null
          created_at: string
          differentiation_opportunity: string | null
          id: string
          idea_id: string
          kind: string
          last_checked_at: string | null
          name: string
          origin: string
          positioning: string | null
          price_checked_on: string | null
          pricing_model: string | null
          strengths: string | null
          target_buyer: string | null
          visible_price: string | null
          weaknesses: string | null
          website: string | null
        }
        Insert: {
          claim_id?: string | null
          created_at?: string
          differentiation_opportunity?: string | null
          id?: string
          idea_id: string
          kind: string
          last_checked_at?: string | null
          name: string
          origin?: string
          positioning?: string | null
          price_checked_on?: string | null
          pricing_model?: string | null
          strengths?: string | null
          target_buyer?: string | null
          visible_price?: string | null
          weaknesses?: string | null
          website?: string | null
        }
        Update: {
          claim_id?: string | null
          created_at?: string
          differentiation_opportunity?: string | null
          id?: string
          idea_id?: string
          kind?: string
          last_checked_at?: string | null
          name?: string
          origin?: string
          positioning?: string | null
          price_checked_on?: string | null
          pricing_model?: string | null
          strengths?: string | null
          target_buyer?: string | null
          visible_price?: string | null
          weaknesses?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitors_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitors_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      decisions: {
        Row: {
          action: string
          client_comment: string | null
          client_confirmed_at: string | null
          client_confirmed_by: string | null
          decided_at: string
          decided_by: string
          experiment_id: string | null
          id: string
          idea_id: string
          next_step: string | null
          rationale: string
          reality_check_id: string
        }
        Insert: {
          action: string
          client_comment?: string | null
          client_confirmed_at?: string | null
          client_confirmed_by?: string | null
          decided_at?: string
          decided_by?: string
          experiment_id?: string | null
          id?: string
          idea_id: string
          next_step?: string | null
          rationale: string
          reality_check_id: string
        }
        Update: {
          action?: string
          client_comment?: string | null
          client_confirmed_at?: string | null
          client_confirmed_by?: string | null
          decided_at?: string
          decided_by?: string
          experiment_id?: string | null
          id?: string
          idea_id?: string
          next_step?: string | null
          rationale?: string
          reality_check_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decisions_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_reality_check_id_fkey"
            columns: ["reality_check_id"]
            isOneToOne: false
            referencedRelation: "reality_checks"
            referencedColumns: ["id"]
          },
        ]
      }
      experiments: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          channels: Json
          config: Json
          cost_estimate_eur: number | null
          created_at: string
          ended_at: string | null
          ended_early: boolean
          ends_at: string | null
          hypothesis_id: string
          id: string
          idea_id: string
          owner_id: string
          public_slug: string | null
          started_at: string | null
          state: string
          title: string
          type: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          channels?: Json
          config?: Json
          cost_estimate_eur?: number | null
          created_at?: string
          ended_at?: string | null
          ended_early?: boolean
          ends_at?: string | null
          hypothesis_id: string
          id?: string
          idea_id: string
          owner_id?: string
          public_slug?: string | null
          started_at?: string | null
          state?: string
          title: string
          type: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          channels?: Json
          config?: Json
          cost_estimate_eur?: number | null
          created_at?: string
          ended_at?: string | null
          ended_early?: boolean
          ends_at?: string | null
          hypothesis_id?: string
          id?: string
          idea_id?: string
          owner_id?: string
          public_slug?: string | null
          started_at?: string | null
          state?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiments_hypothesis_id_fkey"
            columns: ["hypothesis_id"]
            isOneToOne: false
            referencedRelation: "hypotheses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiments_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      hypotheses: {
        Row: {
          assumption_id: string
          change_reason: string | null
          created_at: string
          expected_biases: string | null
          fail_threshold_pct: number | null
          id: string
          idea_id: string
          locked_at: string | null
          max_duration_days: number
          metric_denominator: string
          metric_label: string
          metric_numerator: string
          min_sample: number
          success_threshold_pct: number
          superseded_by: string | null
          target_group: string
          test_method: string
          version: number
          we_believe: string
        }
        Insert: {
          assumption_id: string
          change_reason?: string | null
          created_at?: string
          expected_biases?: string | null
          fail_threshold_pct?: number | null
          id?: string
          idea_id: string
          locked_at?: string | null
          max_duration_days: number
          metric_denominator: string
          metric_label: string
          metric_numerator: string
          min_sample: number
          success_threshold_pct: number
          superseded_by?: string | null
          target_group: string
          test_method: string
          version?: number
          we_believe: string
        }
        Update: {
          assumption_id?: string
          change_reason?: string | null
          created_at?: string
          expected_biases?: string | null
          fail_threshold_pct?: number | null
          id?: string
          idea_id?: string
          locked_at?: string | null
          max_duration_days?: number
          metric_denominator?: string
          metric_label?: string
          metric_numerator?: string
          min_sample?: number
          success_threshold_pct?: number
          superseded_by?: string | null
          target_group?: string
          test_method?: string
          version?: number
          we_believe?: string
        }
        Relationships: [
          {
            foreignKeyName: "hypotheses_assumption_id_fkey"
            columns: ["assumption_id"]
            isOneToOne: false
            referencedRelation: "assumptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hypotheses_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hypotheses_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "hypotheses"
            referencedColumns: ["id"]
          },
        ]
      }
      idea_members: {
        Row: {
          created_at: string
          email: string
          idea_id: string
          invited_by: string
          role: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          idea_id: string
          invited_by?: string
          role?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          idea_id?: string
          invited_by?: string
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "idea_members_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      ideas: {
        Row: {
          sprint_start: string | null
          sprint_weeks: number
          audience_detail: string | null
          budget_eur: number | null
          client_id: string | null
          created_at: string
          created_by: string
          decision_deadline: string | null
          decision_question: string
          decision_stakes: string | null
          description: string
          first_question: string | null
          id: string
          is_demo: boolean
          key_uncertainty: string | null
          org_id: string
          project_type: string
          region: string
          region_detail: string | null
          sector_template: string
          status: string
          target_audience: string
          title: string
          updated_at: string
        }
        Insert: {
          sprint_start?: string | null
          sprint_weeks?: number
          audience_detail?: string | null
          budget_eur?: number | null
          client_id?: string | null
          created_at?: string
          created_by?: string
          decision_deadline?: string | null
          decision_question: string
          decision_stakes?: string | null
          description: string
          first_question?: string | null
          id?: string
          is_demo?: boolean
          key_uncertainty?: string | null
          org_id: string
          project_type: string
          region: string
          region_detail?: string | null
          sector_template?: string
          status?: string
          target_audience: string
          title: string
          updated_at?: string
        }
        Update: {
          sprint_start?: string | null
          sprint_weeks?: number
          audience_detail?: string | null
          budget_eur?: number | null
          client_id?: string | null
          created_at?: string
          created_by?: string
          decision_deadline?: string | null
          decision_question?: string
          decision_stakes?: string | null
          description?: string
          first_question?: string | null
          id?: string
          is_demo?: boolean
          key_uncertainty?: string | null
          org_id?: string
          project_type?: string
          region?: string
          region_detail?: string | null
          sector_template?: string
          status?: string
          target_audience?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ideas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ideas_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      interviews: {
        Row: {
          consent_recorded: boolean
          created_at: string
          dmu_role: string
          experiment_id: string
          held_on: string
          id: string
          idea_id: string
          is_acquaintance: boolean
          participant_label: string
          record_type: string
          recruited_via: string
          retention_until: string
          segment: string | null
          transcript: string
        }
        Insert: {
          consent_recorded: boolean
          created_at?: string
          dmu_role: string
          experiment_id: string
          held_on: string
          id?: string
          idea_id: string
          is_acquaintance?: boolean
          participant_label: string
          record_type: string
          recruited_via: string
          retention_until?: string
          segment?: string | null
          transcript: string
        }
        Update: {
          consent_recorded?: boolean
          created_at?: string
          dmu_role?: string
          experiment_id?: string
          held_on?: string
          id?: string
          idea_id?: string
          is_acquaintance?: boolean
          participant_label?: string
          record_type?: string
          recruited_via?: string
          retention_until?: string
          segment?: string | null
          transcript?: string
        }
        Relationships: [
          {
            foreignKeyName: "interviews_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_cards: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          data_reliability: string
          experiment_id: string
          id: string
          idea_id: string
          metrics: Json
          status: string
          therefore: string
          verdict: string
          version: number
          we_believed: string
          we_learned: string
          we_observed: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          data_reliability: string
          experiment_id: string
          id?: string
          idea_id: string
          metrics?: Json
          status?: string
          therefore: string
          verdict: string
          version?: number
          we_believed: string
          we_learned: string
          we_observed: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          data_reliability?: string
          experiment_id?: string
          id?: string
          idea_id?: string
          metrics?: Json
          status?: string
          therefore?: string
          verdict?: string
          version?: number
          we_believed?: string
          we_learned?: string
          we_observed?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_cards_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_cards_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      observations: {
        Row: {
          created_at: string
          experiment_id: string | null
          id: string
          idea_id: string
          interview_id: string | null
          is_behaviour: boolean
          is_costly: boolean
          is_fact: boolean
          is_real_context: boolean
          is_synthetic: boolean
          kind: string
          origin: string
          quote: string | null
          quote_check: string
          summary: string
        }
        Insert: {
          created_at?: string
          experiment_id?: string | null
          id?: string
          idea_id: string
          interview_id?: string | null
          is_behaviour?: boolean
          is_costly?: boolean
          is_fact?: boolean
          is_real_context?: boolean
          is_synthetic?: boolean
          kind: string
          origin?: string
          quote?: string | null
          quote_check?: string
          summary: string
        }
        Update: {
          created_at?: string
          experiment_id?: string | null
          id?: string
          idea_id?: string
          interview_id?: string | null
          is_behaviour?: boolean
          is_costly?: boolean
          is_fact?: boolean
          is_real_context?: boolean
          is_synthetic?: boolean
          kind?: string
          origin?: string
          quote?: string | null
          quote_check?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "observations_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          ai_monthly_cap_usd: number
          created_at: string
          created_by: string
          id: string
          name: string
        }
        Insert: {
          ai_monthly_cap_usd?: number
          created_at?: string
          created_by?: string
          id?: string
          name: string
        }
        Update: {
          ai_monthly_cap_usd?: number
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reality_checks: {
        Row: {
          advice: string
          advice_reason: string
          ai_used: boolean
          created_at: string
          created_by: string | null
          findings: Json
          id: string
          idea_id: string
        }
        Insert: {
          advice: string
          advice_reason: string
          ai_used?: boolean
          created_at?: string
          created_by?: string | null
          findings: Json
          id?: string
          idea_id: string
        }
        Update: {
          advice?: string
          advice_reason?: string
          ai_used?: boolean
          created_at?: string
          created_by?: string | null
          findings?: Json
          id?: string
          idea_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reality_checks_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          shared_at: string | null
          shared_by: string | null
          client_viewed_at: string | null
          created_at: string
          created_by: string
          id: string
          idea_id: string
          snapshot: Json
          version: number
        }
        Insert: {
          shared_at?: string | null
          shared_by?: string | null
          client_viewed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          idea_id: string
          snapshot: Json
          version: number
        }
        Update: {
          shared_at?: string | null
          shared_by?: string | null
          client_viewed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          idea_id?: string
          snapshot?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "reports_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      research_questions: {
        Row: {
          created_at: string
          data_needed: string | null
          done_criterion: string
          id: string
          idea_id: string
          method: string
          origin: string
          position: number
          question: string
          status: string
          suggested_sources: string | null
          why_it_matters: string | null
        }
        Insert: {
          created_at?: string
          data_needed?: string | null
          done_criterion: string
          id?: string
          idea_id: string
          method?: string
          origin?: string
          position: number
          question: string
          status?: string
          suggested_sources?: string | null
          why_it_matters?: string | null
        }
        Update: {
          created_at?: string
          data_needed?: string | null
          done_criterion?: string
          id?: string
          idea_id?: string
          method?: string
          origin?: string
          position?: number
          question?: string
          status?: string
          suggested_sources?: string | null
          why_it_matters?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "research_questions_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      research_runs: {
        Row: {
          budget_usd: number
          cost_usd: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          idea_id: string
          mode: string
          started_by: string
          status: string
        }
        Insert: {
          budget_usd: number
          cost_usd?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          idea_id: string
          mode: string
          started_by?: string
          status?: string
        }
        Update: {
          budget_usd?: number
          cost_usd?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          idea_id?: string
          mode?: string
          started_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_runs_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      research_tasks: {
        Row: {
          attempts: number
          cost_usd: number
          detail: string | null
          finished_at: string | null
          id: string
          idea_id: string
          kind: string
          label: string
          output: Json | null
          position: number
          question_id: string | null
          run_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          cost_usd?: number
          detail?: string | null
          finished_at?: string | null
          id?: string
          idea_id: string
          kind: string
          label: string
          output?: Json | null
          position: number
          question_id?: string | null
          run_id: string
          started_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          cost_usd?: number
          detail?: string | null
          finished_at?: string | null
          id?: string
          idea_id?: string
          kind?: string
          label?: string
          output?: Json | null
          position?: number
          question_id?: string | null
          run_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_tasks_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_tasks_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "research_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_tasks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      segments: {
        Row: {
          created_at: string
          current_alternative: string | null
          id: string
          idea_id: string
          job_to_be_done: string | null
          label: string
          open_question: string | null
          pain: string | null
          role: string
        }
        Insert: {
          created_at?: string
          current_alternative?: string | null
          id?: string
          idea_id: string
          job_to_be_done?: string | null
          label: string
          open_question?: string | null
          pain?: string | null
          role: string
        }
        Update: {
          created_at?: string
          current_alternative?: string | null
          id?: string
          idea_id?: string
          job_to_be_done?: string | null
          label?: string
          open_question?: string | null
          pain?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "segments_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      sizing_factors: {
        Row: {
          claim_id: string | null
          id: string
          idea_id: string
          key: string
          label: string
          note: string | null
          position: number
          scenario_id: string
          unit: string
          value: number
        }
        Insert: {
          claim_id?: string | null
          id?: string
          idea_id: string
          key: string
          label: string
          note?: string | null
          position: number
          scenario_id: string
          unit: string
          value: number
        }
        Update: {
          claim_id?: string | null
          id?: string
          idea_id?: string
          key?: string
          label?: string
          note?: string | null
          position?: number
          scenario_id?: string
          unit?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "sizing_factors_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sizing_factors_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sizing_factors_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "sizing_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      sizing_scenarios: {
        Row: {
          id: string
          idea_id: string
          kind: string
          model: string
          updated_at: string
        }
        Insert: {
          id?: string
          idea_id: string
          kind: string
          model?: string
          updated_at?: string
        }
        Update: {
          id?: string
          idea_id?: string
          kind?: string
          model?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sizing_scenarios_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      source_excerpts: {
        Row: {
          created_at: string
          id: string
          idea_id: string
          location: string | null
          source_id: string
          text: string
        }
        Insert: {
          created_at?: string
          id?: string
          idea_id: string
          location?: string | null
          source_id: string
          text: string
        }
        Update: {
          created_at?: string
          id?: string
          idea_id?: string
          location?: string | null
          source_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_excerpts_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_excerpts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          access_note: string | null
          content_hash: string | null
          created_at: string
          domain: string | null
          id: string
          idea_id: string
          is_primary: boolean
          origin: string
          published_on: string | null
          publisher: string | null
          retrieved_at: string
          run_id: string | null
          source_type: string
          title: string
          url: string | null
        }
        Insert: {
          access_note?: string | null
          content_hash?: string | null
          created_at?: string
          domain?: string | null
          id?: string
          idea_id: string
          is_primary?: boolean
          origin?: string
          published_on?: string | null
          publisher?: string | null
          retrieved_at?: string
          run_id?: string | null
          source_type: string
          title: string
          url?: string | null
        }
        Update: {
          access_note?: string | null
          content_hash?: string | null
          created_at?: string
          domain?: string | null
          id?: string
          idea_id?: string
          is_primary?: boolean
          origin?: string
          published_on?: string | null
          publisher?: string | null
          retrieved_at?: string
          run_id?: string | null
          source_type?: string
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sources_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sources_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      test_events: {
        Row: {
          channel: string
          created_at: string
          day: string
          event_type: string
          experiment_id: string
          id: number
          idea_id: string
          variant: string
          visitor_hash: string
        }
        Insert: {
          channel?: string
          created_at?: string
          day?: string
          event_type: string
          experiment_id: string
          id?: never
          idea_id: string
          variant?: string
          visitor_hash: string
        }
        Update: {
          channel?: string
          created_at?: string
          day?: string
          event_type?: string
          experiment_id?: string
          id?: never
          idea_id?: string
          variant?: string
          visitor_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_events_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_events_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      test_submissions: {
        Row: {
          answers: Json
          channel: string
          consent_given: boolean
          consent_text: string
          created_at: string
          email: string | null
          experiment_id: string
          id: string
          idea_id: string
          retention_until: string
          variant: string
          visitor_hash: string
        }
        Insert: {
          answers?: Json
          channel?: string
          consent_given: boolean
          consent_text: string
          created_at?: string
          email?: string | null
          experiment_id: string
          id?: string
          idea_id: string
          retention_until?: string
          variant?: string
          visitor_hash: string
        }
        Update: {
          answers?: Json
          channel?: string
          consent_given?: boolean
          consent_text?: string
          created_at?: string
          email?: string | null
          experiment_id?: string
          id?: string
          idea_id?: string
          retention_until?: string
          variant?: string
          visitor_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_submissions_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_submissions_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_economics: {
        Row: {
          annual_churn_pct: number | null
          cac_eur: number | null
          fixed_costs_year: number | null
          gross_margin_pct: number | null
          idea_id: string
          notes: string | null
          price_per_customer_year: number | null
          updated_at: string
          upfront_investment: number | null
        }
        Insert: {
          annual_churn_pct?: number | null
          cac_eur?: number | null
          fixed_costs_year?: number | null
          gross_margin_pct?: number | null
          idea_id: string
          notes?: string | null
          price_per_customer_year?: number | null
          updated_at?: string
          upfront_investment?: number | null
        }
        Update: {
          annual_churn_pct?: number | null
          cac_eur?: number | null
          fixed_costs_year?: number | null
          gross_margin_pct?: number | null
          idea_id?: string
          notes?: string | null
          price_per_customer_year?: number | null
          updated_at?: string
          upfront_investment?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "unit_economics_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: true
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_read_idea: { Args: { p_idea: string }; Returns: boolean }
      can_write_idea: { Args: { p_idea: string }; Returns: boolean }
      claim_invitations: { Args: never; Returns: number }
      confirm_decision: { Args: { p_comment: string; p_decision: string }; Returns: boolean }
      create_organization: { Args: { p_name: string }; Returns: string }
      get_public_test: { Args: { p_slug: string }; Returns: Json }
      is_org_member: { Args: { p_org: string }; Returns: boolean }
      is_org_owner: { Args: { p_org: string }; Returns: boolean }
      record_test_event: {
        Args: { p_channel: string; p_event: string; p_key: string; p_rate_bucket: string; p_slug: string; p_variant: string; p_visitor: string }
        Returns: boolean
      }
      submit_test_form: {
        Args: {
          p_answers: Json
          p_channel: string
          p_consent: boolean
          p_consent_text: string
          p_email: string | null
          p_key: string
          p_rate_bucket: string
          p_slug: string
          p_variant: string
          p_visitor: string
        }
        Returns: boolean
      }
      add_research_cost: { Args: { p_cost: number; p_task: string }; Returns: number }
      org_ai_spend: { Args: { p_idea: string }; Returns: { spent: number; cap: number }[] }
      experiment_event_counts: {
        Args: { p_experiment: string }
        Returns: { channel: string; variant: string; viewers: number; clickers: number; submitters: number }[]
      }
      mark_report_viewed: { Args: { p_report: string }; Returns: boolean }
      may_create_account: { Args: { p_email: string; p_key: string }; Returns: boolean }
      observations_for_idea: {
        Args: { p_idea: string }
        Returns: {
          id: string
          idea_id: string
          experiment_id: string | null
          interview_id: string | null
          kind: string
          summary: string
          quote: string | null
          quote_check: string
          is_fact: boolean
          is_behaviour: boolean
          is_real_context: boolean
          is_costly: boolean
          is_synthetic: boolean
          origin: string
          created_at: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
