// Vite (electron-vite main build and Vitest) inlines `?raw` imports as strings.
// Bundled SKILL.md files ride into the main bundle this way, so a packaged app
// needs no extra resource copy step.
declare module '*.md?raw' {
  const content: string;
  export default content;
}
