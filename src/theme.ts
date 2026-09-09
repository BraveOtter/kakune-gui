export type Theme = "system" | "light" | "dark";

export function resolveTheme(theme: Theme, prefersDark: boolean): "light" | "dark" {
  return theme === "system" ? (prefersDark ? "dark" : "light") : theme;
}

export function initialTheme(): Theme {
  const stored = localStorage.getItem("kakune.theme");
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}
