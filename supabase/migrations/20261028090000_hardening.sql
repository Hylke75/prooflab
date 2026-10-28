-- Defence in depth on top of RLS (anon has no policies, so it already sees nothing).
-- Kept separate because revoking privileges asks for confirmation in Supabase.
revoke all on all tables in schema public from anon;
revoke all on public.ingest_keys from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_org_member(uuid), public.is_org_owner(uuid), public.can_write_idea(uuid), public.can_read_idea(uuid),
  public.create_organization(text), public.claim_invitations(), public.confirm_decision(uuid, text),
  public.get_public_test(text)
  to authenticated;
grant execute on function
  public.get_public_test(text),
  public.record_test_event(text, text, text, text, text, text),
  public.submit_test_form(text, text, text, text, text, text, jsonb, boolean, text)
  to anon, authenticated;
