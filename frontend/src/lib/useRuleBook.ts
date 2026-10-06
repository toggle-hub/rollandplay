import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import type { RuleBook } from "../api/types";

/** Loads a rule book the viewer can read; undefined while loading, without an id, or when it can't be loaded. */
export function useRuleBook(id?: string): RuleBook | undefined {
  const [book, setBook] = useState<RuleBook>();
  useEffect(() => {
    setBook(undefined);
    if (!id) return;
    let live = true;
    apiFetch<RuleBook>(`/api/rule-books/${id}`).then((loaded) => { if (live) setBook(loaded); }).catch(() => {});
    return () => { live = false; };
  }, [id]);
  return book;
}
