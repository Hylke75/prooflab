-- Opdrachtgevers (readers) see the outcome of a survey on the experiment page: only the answer to the
-- pre-registered key question (a choice question, so no free text), with source, channel and duration for
-- the plausibility checks. Every other answer stays with the research team.

create or replace function public.survey_key_answers(p_experiment uuid)
returns table (id uuid, source text, channel text, duration_ms int, created_at timestamptz, key_answer jsonb)
language sql stable security definer set search_path = '' as $$
  select r.id, r.source, r.channel, r.duration_ms, r.created_at,
         case when jsonb_typeof(r.answers -> (e.config ->> 'key_question')) in ('string', 'array')
              then r.answers -> (e.config ->> 'key_question') end
  from public.survey_responses r
  join public.experiments e on e.id = r.experiment_id
  where r.experiment_id = p_experiment and e.type = 'survey' and public.can_read_idea(e.idea_id)
  order by r.created_at, r.id;
$$;
revoke execute on function public.survey_key_answers(uuid) from public, anon;
grant execute on function public.survey_key_answers(uuid) to authenticated;
