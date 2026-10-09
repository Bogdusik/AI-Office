"use client";

import { type FormEvent, useState } from "react";
import { type FloorState, api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useAction } from "@/lib/useAction";
import { useUiStore } from "@/store/useUiStore";
import { Button, ErrorNote, Field, PanelShell, inputCls } from "./ui";

const ROLE_KEY = /^[a-z][a-z0-9_]*$/;

export function HirePanel({ floor, deskIndex }: { floor: FloorState; deskIndex: number }) {
  const t = useT();
  const select = useUiStore((s) => s.select);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const { busy, error, setError, run } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ROLE_KEY.test(roleKey)) {
      setError(t("errors.roleKeyFormat"));
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
      eyebrow={t("hire.eyebrow", { floor: floor.number, floorName: floor.name, desk: deskIndex + 1 })}
      title={t("hire.title")}
      subtitle={t("hire.subtitle")}
      onClose={() => select(null)}
    >
      <form onSubmit={submit} className="flex flex-col gap-3" aria-label={t("hire.title")}>
        <Field label={t("hire.name")}>
          <input className={inputCls} name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder={t("hire.namePlaceholder")} />
        </Field>
        <Field label={t("hire.jobTitle")}>
          <input className={inputCls} name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t("hire.jobTitlePlaceholder")} />
        </Field>
        <Field label="role_key" hint={t("hire.roleKeyHint")}>
          <input className={`${inputCls} font-mono`} name="role_key" value={roleKey} onChange={(e) => setRoleKey(e.target.value.trim())} maxLength={64} placeholder="data_analyst" />
        </Field>
        <Field label={t("hire.systemPrompt")}>
          <textarea
            className={`${inputCls} min-h-40 resize-y font-mono text-xs leading-relaxed`}
            name="system_prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("hire.promptPlaceholder")}
          />
        </Field>
        <ErrorNote text={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" busy={busy === "hire"} disabled={!name.trim() || !title.trim() || !roleKey}>
            {t("hire.submit")}
          </Button>
        </div>
      </form>
    </PanelShell>
  );
}
