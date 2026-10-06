import { ApiError, type TaskStatus, type ValidationIssue } from "@/lib/api";
import { TASK_STATUS } from "@/lib/labels";

const status = (s: string) => TASK_STATUS[s as TaskStatus]?.label ?? s;

/** Backend messages (409/422/404) → what the director should read. Order matters: first match wins. */
const MESSAGES: [RegExp, (...m: string[]) => string][] = [
  [/^Cannot move task from '(\w+)' to '(\w+)'/, (a, b) => `Нельзя перевести задачу из «${status(a)}» в «${status(b)}». Статус мог измениться — данные обновлены.`],
  [/^Cannot resume a task in status '(\w+)'/, (a) => `Продолжить можно только задачу на паузе или на доработке, а эта сейчас «${status(a)}».`],
  [/^A director comment is required/, () => "Чтобы вернуть задачу, напишите комментарий: что исправить."],
  [/^Floor is full \((\d+)\/(\d+)\)/, (a, b) => `Этаж заполнен: заняты все ${b} мест.`],
  [/^Role key '(.+)' is already used/, (k) => `role_key «${k}» уже занят другим сотрудником.`],
  [/^Agent has (\d+) unfinished task/, (n) => `У сотрудника незавершённых задач: ${n}. Отмените или завершите их перед архивированием.`],
  [/^Agent \d+ is archived/, () => "Сотрудник уже в архиве."],
  [/^Desk (\d+) on floor (\d+) is taken/, (d, f) => `Место ${Number(d) + 1} на этаже ${f} уже занято.`],
  [/^Desk \d+ does not exist/, () => "Такого места на этаже нет."],
  [/^Agents can only work on office floors/, () => "Сотрудники могут работать только на офисных этажах."],
  [/^Floor has (\d+) agent/, (n) => `На этаже работают сотрудники (${n}). Сначала переведите или архивируйте их.`],
  [/^Floor number (\d+) is already taken/, (n) => `Этаж ${n} уже существует.`],
  [/^Capacity \d+ is below/, () => "Вместимость меньше, чем сотрудников на этаже."],
  [/^The building already has a reception/, () => "Ресепшен в здании уже есть."],
  [/capacity must be/, () => "Вместимость не подходит для этого типа этажа."],
  [/not found$/, () => "Объект не найден: возможно, его уже удалили. Данные обновлены."],
];

const FIELDS: Record<string, string> = {
  title: "Заголовок",
  description: "Описание",
  body: "Комментарий",
  name: "Имя",
  role_key: "role_key",
  system_prompt: "Системный промт",
  model: "Модель",
  capacity: "Вместимость",
  number: "Номер",
  summary: "Кто я",
  goal: "Цель",
  constraints: "Ограничения",
  notes: "Заметки",
};

function issueText(i: ValidationIssue): string {
  const field = FIELDS[String(i.loc.at(-1))] ?? String(i.loc.at(-1) ?? "");
  const ctx = i.ctx ?? {};
  const what =
    i.type === "string_too_short" || i.type === "missing"
      ? "нужно заполнить"
      : i.type === "string_too_long"
        ? `не длиннее ${ctx.max_length} символов`
        : i.type === "greater_than_equal"
          ? `не меньше ${ctx.ge}`
          : i.type === "less_than_equal"
            ? `не больше ${ctx.le}`
            : i.msg;
  return field ? `${field}: ${what}` : what;
}

export function humanize(err: unknown): string {
  if (!(err instanceof ApiError)) return "Нет связи с сервером. Проверьте, что backend запущен.";
  const { detail } = err;
  if (Array.isArray(detail)) return detail.map(issueText).join("; ") || "Проверьте заполнение полей.";
  if (typeof detail === "string") {
    for (const [re, text] of MESSAGES) {
      const m = detail.match(re);
      if (m) return text(...m.slice(1));
    }
  }
  if (err.status === 409) return "Действие сейчас недоступно: состояние изменилось. Данные обновлены.";
  if (err.status === 422) return "Проверьте заполнение полей.";
  if (err.status === 404) return "Объект не найден: возможно, его уже удалили.";
  return `Ошибка сервера (${err.status}).`;
}
