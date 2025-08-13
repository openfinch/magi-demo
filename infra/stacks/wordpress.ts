// stacks/wordpress.ts
import {
  MagiApp, WebService, StorageBucket, Database, Secrets, ImageChannelRef, Cdn
} from "@magi/cdktf";
import { webBase } from "../images/web-base";

const app = new MagiApp({ project:"magi-wp", env: process.env.ENV || "dev", clouds:["aws","gcp"] });

// ---------- Secrets ----------
const wpSalts = new Secrets.Secret("wp-salts", {
  logicalName: "wordpress/salts", rotationDays: 30,
  clouds: { aws:{store:"secretsManager"}, gcp:{store:"secretManager"} }
});

const ddApi = new Secrets.Secret("dd-api", {
  logicalName: "datadog/api-key",
  clouds: { aws:{store:"secretsManager"}, gcp:{store:"secretManager"} }
});

// DB credentials generated and stored automatically
const dbCreds = new Secrets.GeneratedDbCredentials("db-creds", {
  logicalName: "wordpress/db",
  usernamePrefix: "wp",
  rotateOnPasswordChange: true
});

// ---------- Database (managed, private) ----------
const db = new Database.MySql(app, "db", {
  version: "8.0",
  storageGb: 50,
  highAvailability: true,              // AWS: Multi-AZ RDS; GCP: HA Cloud SQL
  backups: { pointInTime: true, retainDays: 7 },
  maintenance: { day:"sun", hour:2 },
  networking: { private: true },       // no public IP
  credentials: dbCreds,                // Magi wires users/secret rotation
  flags: { sql_mode: "STRICT_ALL_TABLES" }
});

// ---------- Uploads bucket ----------
const uploads = new StorageBucket(app, "uploads", {
  versioning: true,
  encryption: { managed: true },       // AWS KMS / Cloud KMS
  lifecycle: [{ matchPrefix:["wp-content/uploads/"], noncurrentVersionsToKeep: 5, expireAfterDays: 365 }],
  cors: [{ origins:["*"], methods:["GET","HEAD"], responseHeaders:["*"], maxAgeSec: 3600 }],
  publicAccess: "private",
  presign: { enabled: true, defaultTtlSec: 900 } // Magi helper for presigned URLs
});

// Optional CDN in front of bucket for media
const cdn = new Cdn(app, "media-cdn", {
  origins: [uploads],
  https: { managedCert: true },
  caching: { defaultTtlSec: 86400 }
});

// ---------- Image reference ----------
const image: ImageChannelRef = webBase.channel(app.env); // dev -> stage -> prod by promotion

// ---------- Web tier ----------
const web = new WebService(app, "web", {
  image,
  port: 80,
  tls: { managed: true },              // ACM / Google Managed Cert
  autoscaling: { min: 2, max: 10, cpuTarget: 60 },
  healthCheck: { path: "/wp-includes/images/blank.gif" },
  networking: { expose: true, allowEgress: ["mysql:"+db, uploads] }, // egress to DB & bucket endpoints
  observability: { accessLogs: true, metrics: true, alarms: [{ type:"http5xxRate" }] },
  // WordPress runtime config—exported to userdata/startup via Magi
  env: {
    DB_HOST: db.endpoint,              // RDS or Cloud SQL private address/proxy
    DB_NAME: db.name,
    DB_USER: dbCreds.username,
    DB_PASS: dbCreds.password,
    UPLOADS_BUCKET: uploads.name,
    OBJECT_PROVIDER: "${magi.cloud}",  // string 'aws' | 'gcp' at synth time
    WP_SALTS: wpSalts,
  },
  agents: {
    datadog: { apiKey: ddApi, site: "datadoghq.eu", apm: true, logs: true, process: true }
  }
});

// Output the public URL (managed TLS)
web.exposeAs("wp_url");    // e.g., https://web.dev.magi-wp.example.com
uploads.exposeAs("uploads_bucket");
cdn?.exposeAs("media_cdn");
