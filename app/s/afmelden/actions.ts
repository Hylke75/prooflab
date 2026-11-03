"use server";

import { redirect } from "next/navigation";
import { unsubscribe } from "@/lib/survey-unsubscribe";

// The page itself never changes anything on GET (mail scanners open links); this action runs on the button.
export async function confirmUnsubscribe(form: FormData) {
  const outcome = await unsubscribe(form.get("u"), form.get("e"));
  redirect(`/s/afmelden?status=${outcome}`);
}
