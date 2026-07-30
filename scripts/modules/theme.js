import { icon } from "../utils/dom.js?v=20260730.2";

export function initializeTheme(defaultTheme, messages) {
  const button = document.querySelector("#theme-toggle");
  const saved = localStorage.getItem("promptpair-theme");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  let theme = saved || (defaultTheme === "system" ? (systemDark ? "dark" : "light") : defaultTheme);

  const render = () => {
    document.documentElement.dataset.theme = theme;
    const isDark = theme === "dark";
    button.innerHTML = icon(isDark ? "sun" : "moon");
    button.ariaLabel = isDark ? messages.actions.themeLight : messages.actions.themeDark;
  };
  button.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    localStorage.setItem("promptpair-theme", theme);
    render();
  });
  render();
}
