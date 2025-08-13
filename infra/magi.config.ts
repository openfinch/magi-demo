export default {
  project: "magi-wp",
  policies: [
    { path: "./policies/baseline.ts", enforce: true },
    {
      repo: "github.com/our-org/magi-policies",
      ref: "cis-v1.3.2",
      path: "cis/cis.ts",
      enforce: true,
      alias: "cis"
    }
  ],

  environments: {
    dev:   { clouds: ["aws","gcp"], /* ... */ },
    stage: { clouds: ["aws","gcp"], /* ... */ },
    prod:  { clouds: ["aws","gcp"], /* ... */ }
  }
};