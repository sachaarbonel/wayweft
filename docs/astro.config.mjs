import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://wayweft.dev",
  integrations: [
    starlight({
      title: "Wayweft Docs",
      description:
        "Detect duplicate code in TypeScript monorepos and preserve codebase memory across AI coding agent sessions with Wayweft.",
      tagline:
        "Duplicate code detection, safe codemods, and codebase memory for AI coding agent workflows.",
      customCss: ["./src/styles/brand.css"],
      components: {
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      sidebar: [
        {
          label: "Overview",
          items: [{ label: "Documentation Home", slug: "docs" }],
        },
        {
          label: "Guides",
          items: [
            { label: "Getting Started", slug: "docs/getting-started" },
            { label: "Configuration", slug: "docs/config" },
            { label: "CI", slug: "docs/ci" },
            { label: "Changelog", slug: "docs/changelog" },
            { label: "Roadmap", slug: "docs/roadmap" },
          ],
        },
        {
          label: "CLI",
          items: [
            { label: "scan", slug: "docs/cli/scan" },
            { label: "fix", slug: "docs/cli/fix" },
            { label: "doctor", slug: "docs/cli/doctor" },
            { label: "skill install", slug: "docs/cli/skill-install" },
          ],
        },
      ],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/sachaarbonel/wayweft",
        },
      ],
    }),
  ],
});
