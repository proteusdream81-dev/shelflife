import { base44 } from "@/api/base44Client";

// The one-time "leave a review" prompt: it appears the first time a reader's
// library reaches five books, and never again on that device.
export const REVIEW_PROMPT_KEY = "review_prompt_shown";
export const REVIEW_PROMPT_AT = 5;

// A working Play Store link today; swap for the listing URL once ShelfLife is
// published on Google Play.
export const PLAY_STORE_URL = "https://play.google.com/store/search?q=ShelfLife%20reading%20list&c=apps";

export async function shouldPromptForReview() {
  try {
    if (localStorage.getItem(REVIEW_PROMPT_KEY)) return false;
    const user = await base44.auth.me();
    const total = await base44.entities.Book.count({ created_by_id: user.id });
    if (total < REVIEW_PROMPT_AT) return false;
    localStorage.setItem(REVIEW_PROMPT_KEY, "true");
    return true;
  } catch {
    // A review prompt is never worth breaking the add flow over.
    return false;
  }
}