export function loadPrivateFonts() {
  const stylesheetUrl = import.meta.env.VITE_FONT_STYLESHEET_URL;
  if (!stylesheetUrl) return;

  const link = document.createElement('link');
  link.href = stylesheetUrl;
  link.rel = 'stylesheet';
  document.head.append(link);
}
