import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://wayweft.dev",
  integrations: [
    starlight({
      title: "Wayweft Docs",
      description:
        "Setup guides, CLI usage, configuration notes, and roadmap details for Wayweft.",
      sidebar: [
        {
          label: "Overview",
          items: [{ label: "What is Wayweft?", slug: "index" }],
        },
        {
          label: "Guides",
          items: [
            { label: "Getting Started", slug: "getting-started" },
            { label: "Configuration", slug: "config" },
            { label: "CI", slug: "ci" },
            { label: "Roadmap", slug: "roadmap" },
          ],
        },
        {
          label: "CLI",
          items: [
            { label: "scan", slug: "cli/scan" },
            { label: "fix", slug: "cli/fix" },
            { label: "skill install", slug: "cli/skill-install" },
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
