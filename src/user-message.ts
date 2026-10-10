const INTERNAL_CONTEXT = "[Codex Web thread files]";

export function visibleUserText(text: string) {
  const index = text.indexOf(INTERNAL_CONTEXT);
  return index < 0 ? text : text.slice(0, index).trimEnd();
}
