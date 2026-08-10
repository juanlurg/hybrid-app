export type ThemePref = "system" | "light" | "dark";

export const THEME_KEY = "bloques:theme";

/** Page colour per theme — also what the browser chrome is tinted with. */
export const THEME_COLOR = { light: "#f2f4ef", dark: "#0f1210" } as const;

/**
 * Runs as the first thing in the body, before anything paints: resolves
 * "system" against the OS and stamps `data-theme` on <html>. The CSS only
 * knows two themes, so there is never a third state to render.
 */
export const THEME_SCRIPT = `(function(){var t;try{t=localStorage.getItem("${THEME_KEY}")}catch(e){}var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"})()`;
