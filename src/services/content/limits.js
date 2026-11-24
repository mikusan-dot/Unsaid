// Single source of truth for categories and limits. Keep in sync with firestore.rules.
export const LIMITS = {
  letter: { title: [3, 100], body: [30, 5000] },
  question: { title: [10, 150], details: [0, 1000] },
  answer: { text: [2, 1500] },
  comment: { text: [1, 500] },
  thought: { text: [10, 280] },
  daily: { text: [2, 1000] },
  journal: { title: [0, 120], body: [1, 20000] },
};
export const LETTER_CATEGORIES = ["Someone I Miss", "To My Past Self", "To My Future Self", "Things I Never Said", "Unspoken Love", "Goodbye Letters", "Unsent Apologies"];
export const QUESTION_CATEGORIES = ["Relationships", "Friendship", "University Life", "Career", "Personal Growth", "Life Advice", "Random Questions"];
export const THOUGHT_CATEGORIES = ["Loneliness", "Hope", "Anxiety", "Gratitude", "Reflection"];
export const MOODS = ["Calm", "Heavy", "Hopeful", "Restless", "Grateful", "Numb", "Tender"];
export const REACTION_TYPES = [
  { type: "understand", label: "I understand" },
  { type: "alone", label: "Not alone" },
  { type: "feel", label: "Feel this" },
];
// The "daily question" day rolls over at 00:00 UTC + this many hours (server time).
export const DAILY_DAY_OFFSET_HOURS = 0;

export function checkLength(value, [min, max], label) {
  const len = String(value ?? "").trim().length;
  if (len < min) return `${label} needs at least ${min} characters.`;
  if (len > max) return `${label} can be at most ${max.toLocaleString()} characters.`;
  return "";
}
export const zeroReactions = () => ({ understand: 0, alone: 0, feel: 0 });
export const KINDS = { letter: "letters", question: "questions", answer: "answers", thought: "midnightThoughts" };
