"use client";

import { type FormEvent, useState } from "react";
import { type FloorState, api } from "@/lib/api";
import { useAction } from "@/lib/useAction";
import { useUiStore } from "@/store/useUiStore";
import { Button, ErrorNote, Field, PanelShell, inputCls } from "./ui";

const ROLE_KEY = /^[a-z][a-z0-9_]*$/;

export function HirePanel({ floor, deskIndex }: { floor: FloorState; deskIndex: number }) {
  const select = useUiStore((s) => s.select);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const { busy, error, setError, run } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ROLE_KEY.test(roleKey)) {
      setError("role_key: латинские строчные буквы, цифры и «_», начинается с буквы.");
      return;
    }
    const r = await run("hire", () =>
      api.createAgent({ floor_id: floor.id, desk_index: deskIndex, name, title, role_key: roleKey, system_prompt: prompt }),
    );
    if (r.ok) select({ kind: "agent", id: r.value.id });
  };

  return (
    <PanelShell
      testId="hire-panel"
      eyebrow={`Свободное место · этаж ${floor.number} «${floor.name}» · место ${deskIndex + 1}`}
      title="Нанять сотрудника"
      subtitle="Сотрудник сядет за этот стол."
      onClose={() => select(null)}
    >
      <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Нанять сотрудника">
        <Field label="Имя">
          <input className={inputCls} name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Например, Ада" />
        </Field>
        <Field label="Должность">
          <input className={inputCls} name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Например, Data Analyst" />
        </Field>
        <Field label="role_key" hint="Уникальный ключ роли: латиница, цифры и «_»">
          <input className={`${inputCls} font-mono`} name="role_key" value={roleKey} onChange={(e) => setRoleKey(e.target.value.trim())} maxLength={64} placeholder="data_analyst" />
        </Field>
        <Field label="Системный промт">
          <textarea
            className={`${inputCls} min-h-40 resize-y font-mono text-xs leading-relaxed`}
            name="system_prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Кто ты, что делаешь, как оформляешь результат"
          />
        </Field>
        <ErrorNote text={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" busy={busy === "hire"} disabled={!name.trim() || !title.trim() || !roleKey}>
            Нанять
          </Button>
        </div>
      </form>
    </PanelShell>
  );
}
