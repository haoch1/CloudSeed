export const sessionDurationOptions = [
  { seconds: 12 * 60 * 60, label: "12 小时" },
  { seconds: 24 * 60 * 60, label: "1 天" },
  { seconds: 7 * 24 * 60 * 60, label: "7 天" },
  { seconds: 30 * 24 * 60 * 60, label: "30 天" },
  { seconds: 90 * 24 * 60 * 60, label: "90 天" },
] as const;

export type SessionDurationSeconds =
  (typeof sessionDurationOptions)[number]["seconds"];
export const defaultSessionDurationSeconds: SessionDurationSeconds =
  30 * 24 * 60 * 60;

export function isSessionDurationSeconds(
  value: unknown,
): value is SessionDurationSeconds {
  return (
    typeof value === "number" &&
    sessionDurationOptions.some((option) => option.seconds === value)
  );
}
