import { defineConfig } from "astro/config";
import node from "@astrojs/node";

const isDevCommand = process.argv.includes("dev");
const isBuildCommand = process.argv.includes("build");
const devAdapter = {
  name: "the-boys-tipping-dev-adapter",
  hooks: {
    "astro:config:done": ({ setAdapter }) => {
      setAdapter({
        name: "the-boys-tipping-dev-adapter",
        entrypointResolution: "auto",
        adapterFeatures: {
          buildOutput: "server",
          middlewareMode: "classic",
        },
        supportedAstroFeatures: {
          serverOutput: "stable",
          sharpImageService: "stable",
        },
      });
    },
  },
};

export default defineConfig({
  output: "server",
  publicDir: isBuildCommand ? "./.astro-public-empty" : "./public",
  adapter: isDevCommand ? devAdapter : node({
    mode: "standalone",
  }),
});
