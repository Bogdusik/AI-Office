import { ApiError, type TaskStatus, type ValidationIssue } from "@/lib/api";
import type { Key, T } from "@/lib/i18n";

const status = (t: T, s: string) => t(`taskStatus.${s as TaskStatus}`);

/** Backend messages (409/422/404, in English) → what the director should read. Order matters: first match wins. */
const MESSAGES: [RegExp, (t: T, ...m: string[]) => string][] = [
  [/^Cannot move task from '(\w+)' to '(\w+)'/, (t, a, b) => t("errors.move", { from: status(t, a), to: status(t, b) })],
  [/^Cannot resume a task in status '(\w+)'/, (t, a) => t("errors.resume", { status: status(t, a) })],
  [/^Cannot retry a task in status '(\w+)'/, (t, a) => t("errors.retry", { status: status(t, a) })],
  [/^A director comment is required/, (t) => t("errors.commentRequired")],
  [/^Floor is full \((\d+)\/(\d+)\)/, (t, _a, b) => t("errors.floorFull", { capacity: b })],
  [/^Role key '(.+)' is already used/, (t, k) => t("errors.roleKeyTaken", { key: k })],
  [/^Agent has (\d+) unfinished task/, (t, n) => t("errors.unfinished", { count: n })],
  [/^Agent has tasks in progress/, (t) => t("errors.releaseTasks")],
  [/^Agent is not in the office/, (t) => t("errors.releaseAway")],
  [/^Agent is on the way/, (t) => t("errors.releaseOnTheWay")],
  [/^Agent \d+ is archived/, (t) => t("errors.archived")],
  [/^Desk (\d+) on floor (\d+) is taken/, (t, d, f) => t("errors.deskTaken", { desk: Number(d) + 1, floor: f })],
  [/^Desk \d+ does not exist/, (t) => t("errors.noDesk")],
  [/^Agents can only work on office floors/, (t) => t("errors.officeOnly")],
  [/^The reception floor cannot be deleted/, (t) => t("errors.receptionFloor")],
  [/^The floor with the director's office cannot be deleted/, (t) => t("errors.directorFloor")],
  [/^Floor has (\d+) agent/, (t, n) => t("errors.floorHasAgents", { count: n })],
  [/^Floor number (\d+) is already taken/, (t, n) => t("errors.floorExists", { number: n })],
  [/^Capacity \d+ is below/, (t) => t("errors.capacityBelow")],
  [/^The building already has a reception/, (t) => t("errors.receptionExists")],
  [/capacity must be/, (t) => t("errors.capacityKind")],
  [/not found$/, (t) => t("errors.gone")],
];

const FIELDS = new Set(["title", "description", "body", "name", "role_key", "system_prompt", "model", "capacity", "number", "summary", "goal", "constraints", "notes"]);

function issueText(t: T, i: ValidationIssue): string {
  const raw = String(i.loc.at(-1) ?? "");
  const field = FIELDS.has(raw) ? t(`fields.${raw}` as Key) : raw;
  const ctx = i.ctx ?? {};
  const problem =
    i.type === "string_too_short" || i.type === "missing"
      ? t("validation.required")
      : i.type === "string_too_long"
        ? t("validation.maxLength", { max: String(ctx.max_length) })
        : i.type === "greater_than_equal"
          ? t("validation.min", { min: String(ctx.ge) })
          : i.type === "less_than_equal"
            ? t("validation.max", { max: String(ctx.le) })
            : i.msg;
  return field ? t("validation.field", { field, problem }) : problem;
}

export function humanize(t: T, err: unknown): string {
  if (!(err instanceof ApiError)) return t("errors.noServer");
  const { detail } = err;
  if (Array.isArray(detail)) return detail.map((i) => issueText(t, i)).join("; ") || t("errors.checkFields");
  if (typeof detail === "string") {
    for (const [re, text] of MESSAGES) {
      const m = detail.match(re);
      if (m) return text(t, ...m.slice(1));
    }
  }
  if (err.status === 409) return t("errors.conflict");
  if (err.status === 422) return t("errors.checkFields");
  if (err.status === 404) return t("errors.notFound");
  return t("errors.server", { status: err.status });
}
