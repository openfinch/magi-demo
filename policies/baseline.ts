import { PolicyPack, rules } from "@magi/policy";

export default new PolicyPack({
  name: "baseline",
  description: "Cross-cloud baseline guardrails for Magi stacks",
  rules: [

    // Enforce TLS on public LBs
    rules.resource("magi_webservice", "Public LB must have TLS", ({ input, report }) => {
      if (input.networking?.expose) {
        if (!input.tls || input.tls.managed === false) {
          report.violation(`Public WebService '${input.name}' is exposed without managed TLS`);
        }
      }
    }),

    // Block 0.0.0.0/0 except ports 80/443 (with TLS)
    rules.securityGroupRule(({ input, report }) => {
      const { cidr, port, protocol, parent } = input;
      if (cidr === "0.0.0.0/0" && protocol === "tcp") {
        const allowed = [80, 443];
        if (!allowed.includes(port)) {
          report.violation(
            `Security group '${parent}' allows public ingress on port ${port}`
          );
        }
      }
    }),

    // Require owner/env tags
    rules.tagging(({ input, report }) => {
      const tags = input.tags || {};
      if (!tags.owner) report.violation(`Resource '${input.name}' missing 'owner' tag`);
      if (!tags.env) report.violation(`Resource '${input.name}' missing 'env' tag`);
    }),

    // Bucket encryption & public access block
    rules.resource(["aws_s3_bucket", "google_storage_bucket"], "Buckets must be encrypted & private", ({ input, report }) => {
      if (!input.encryption || input.encryption.managed !== true) {
        report.violation(`Bucket '${input.name}' missing managed encryption`);
      }
      if (input.publicAccess && input.publicAccess !== "private") {
        report.violation(`Bucket '${input.name}' allows public access`);
      }
    }),

    // Optional: fail if ASG/MIG min size < 2 in prod
    rules.resource(["aws_autoscaling_group", "google_compute_instance_group_manager"], "Prod min size >= 2", ({ input, report, context }) => {
      if (context.env === "prod" && (input.minSize || input.autoscaling?.min) < 2) {
        report.violation(`Resource '${input.name}' in prod has min size < 2`);
      }
    })
  ]
});
