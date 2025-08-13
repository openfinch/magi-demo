import { MagiApp, ImageRecipe } from "@magi/cdktf";

export const app = new MagiApp({ project: "magi-wp", env: "dev", clouds: ["aws","gcp"] });

export const webBase = new ImageRecipe(app, "web-base", {
  sources: {
    aws: { publisher:"canonical", os:"ubuntu", version:"24.04", arch:"x86_64" },
    gcp: { project:"ubuntu-os-cloud", family:"ubuntu-2404-lts", arch:"x86-64" }
  },
  harden: { cisLevel:"1", autoUpdates:true, disablePasswordAuth:true, minimalPackages:true },
  packages: ["nginx","php-fpm","php-mysql","curl","jq","unzip","ca-certificates","lsb-release","gnupg"],
  steps: [
    // install datadog agent (no API key)
    { name:"datadog", shell:"bash", script: `set -euo pipefail
install -d -m0755 /etc/apt/keyrings
curl -fsSL https://keys.datadoghq.com/DATADOG_APT_KEY.public | gpg --dearmor -o /etc/apt/keyrings/datadog.gpg
echo "deb [signed-by=/etc/apt/keyrings/datadog.gpg] https://apt.datadoghq.eu/ stable 7" > /etc/apt/sources.list.d/datadog.list
apt-get update && apt-get install -y datadog-agent
systemctl disable datadog-agent` },
    // install wordpress (no config yet)
    { name:"wordpress", shell:"bash", script: `set -euo pipefail
mkdir -p /var/www && cd /var/www
curl -LO https://wordpress.org/latest.zip && unzip -q latest.zip && rm latest.zip
chown -R www-data:www-data /var/www/wordpress` }
  ],
  cloudInit: `
#cloud-config
write_files:
  - path: /usr/local/bin/magi-wp-bootstrap.sh
    permissions: "0755"
    content: |
      #!/usr/bin/env bash
      set -euo pipefail
      source /usr/local/bin/magi-secrets || true  # exports: DB_HOST, DB_NAME, DB_USER, DB_PASS, DD_API_KEY, WP_SALTS
      # Configure datadog if key available
      if [ -n "\${DD_API_KEY:-}" ]; then
        sed -i "s/^# api_key:.*/api_key: \${DD_API_KEY}/" /etc/datadog-agent/datadog.yaml || true
        systemctl enable datadog-agent && systemctl restart datadog-agent
      fi
      # Render wp-config.php
      cat >/var/www/wordpress/wp-config.php <<'PHP'
      <?php
      define('DB_NAME', getenv('DB_NAME'));
      define('DB_USER', getenv('DB_USER'));
      define('DB_PASSWORD', getenv('DB_PASS'));
      define('DB_HOST', getenv('DB_HOST'));
      define('DB_CHARSET', 'utf8mb4');
      define('DB_COLLATE', '');
      // Salts
      $salts = getenv('WP_SALTS');
      if ($salts) { eval($salts); }
      // Force S3/GCS offload via env
      define('WP_OFFLOAD_MEDIA_USE_SMART_ENDPOINTS', true);
      define('AS3CF_SETTINGS', json_encode([
        'provider' => getenv('OBJECT_PROVIDER'), // 'aws'|'gcp'
        'bucket'   => getenv('UPLOADS_BUCKET'),
        'enable-object-prefix' => true,
        'object-prefix' => 'wp-content/uploads'
      ]));
      // Let LB handle HTTPS
      if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
        $_SERVER['HTTPS'] = 'on';
      }
      PHP
      chown www-data:www-data /var/www/wordpress/wp-config.php
      systemctl enable php8.3-fpm || true
      systemctl restart php8.3-fpm || true
runcmd:
  - [/usr/local/bin/magi-wp-bootstrap.sh]
`,
  publish: { name: "magi/web-base", channels:["dev"], keepReleases: 10 }
});
