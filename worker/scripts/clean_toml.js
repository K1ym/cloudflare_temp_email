import fs from 'node:fs';

async function run() {
  const filePath = 'wrangler.toml';
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, 'utf-8').trim();
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1).trim();

  // If the secret was pasted as JSON:
  if (content.startsWith('{')) {
    console.log('[clean_toml] Detected JSON configuration in Secret! Converting to wrangler.toml...');
    let jsonConfig = {};
    try {
      jsonConfig = JSON.parse(content);
    } catch (e) {
      console.error('[clean_toml] Failed to parse JSON:', e);
    }

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    let d1Id = '';
    let kvId = 'a7f3873344464ea48bf70d3d7f08cc9e';
    let dbName = 'cf_mail';

    if (accountId && apiToken) {
      try {
        console.log('[clean_toml] Querying Cloudflare D1 databases...');
        const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
          headers: { 'Authorization': `Bearer ${apiToken}` }
        });
        const data = await resp.json();
        if (data.success && data.result) {
          const db = data.result.find(d => d.name === 'cf_mail') || data.result[0];
          if (db) {
            d1Id = db.uuid;
            dbName = db.name;
            console.log('[clean_toml] Found D1 database:', dbName, 'ID:', d1Id);
          }
        } else {
          console.log('[clean_toml] D1 query response:', JSON.stringify(data));
        }
      } catch (err) {
        console.warn('[clean_toml] Could not query Cloudflare D1:', err);
      }
    }

    const domains = jsonConfig.DOMAINS || ['mail.anecumen.com', 'mail.levnyo.com'];
    const defaultDomains = jsonConfig.DEFAULT_DOMAINS || domains;
    const prefix = jsonConfig.PREFIX !== undefined ? jsonConfig.PREFIX : '';
    const enableCreate = jsonConfig.ENABLE_USER_CREATE_EMAIL !== false;
    const enableDelete = jsonConfig.ENABLE_USER_DELETE_EMAIL !== false;

    content = `name = "cloudflare_temp_email"
main = "src/worker.ts"
compatibility_date = "2025-04-01"
compatibility_flags = [ "nodejs_compat" ]
keep_vars = true

[assets]
directory = "../frontend/dist/"
binding = "ASSETS"
run_worker_first = true

[triggers]
crons = [ "0 0 */2 * *" ]

[[kv_namespaces]]
binding = "KV"
id = "${kvId}"

[[d1_databases]]
binding = "DB"
database_name = "${dbName}"
database_id = "${d1Id}"

[vars]
PREFIX = "${prefix}"
DEFAULT_DOMAINS = ${JSON.stringify(defaultDomains)}
DOMAINS = ${JSON.stringify(domains)}
JWT_SECRET = "wefqw23r1243efq3f234f235f54"
ADMIN_PASSWORDS = ["Hereiskyo1"]
ENABLE_USER_CREATE_EMAIL = ${enableCreate}
ENABLE_USER_DELETE_EMAIL = ${enableDelete}
`;
  } else {
    // Normal TOML cleaning
    const lines = content.split(/\r?\n/).filter(line => !line.trim().startsWith('```'));
    content = lines.join('\n').trim() + '\n';
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('[clean_toml] Final wrangler.toml written successfully. Sample:\n' + content.slice(0, 300));
  process.stderr.write('[clean_toml] Final wrangler.toml written successfully (' + content.length + ' bytes)\n');
}

run().catch(err => {
  console.error('[clean_toml] Unexpected error:', err);
});
