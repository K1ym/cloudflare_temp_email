import fs from 'node:fs';

async function run() {
  const filePath = 'wrangler.toml';
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, 'utf-8').trim();
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1).trim();

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  let d1Id = '';
  let kvId = 'a7f3873344464ea48bf70d3d7f08cc9e';
  let dbName = 'cf_mail';
  let r2Bucket = '';

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
      }
    } catch (err) {
      console.warn('[clean_toml] Could not query Cloudflare D1:', err);
    }

    try {
      console.log('[clean_toml] Querying Cloudflare R2 buckets...');
      const r2Resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`, {
        headers: { 'Authorization': `Bearer ${apiToken}` }
      });
      const r2Data = await r2Resp.json();
      if (r2Data.success && r2Data.result && r2Data.result.buckets) {
        const buckets = r2Data.result.buckets;
        console.log('[clean_toml] Found R2 buckets:', buckets.map(b => b.name));
        if (buckets.length > 0) {
          const matched = buckets.find(b => /mail|email|attach/i.test(b.name)) || buckets[0];
          r2Bucket = matched.name;
          console.log('[clean_toml] Selected R2 bucket:', r2Bucket);
        } else {
          console.log('[clean_toml] No R2 buckets found. Creating bucket "temp-email-attachments"...');
          const createResp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: 'temp-email-attachments' })
          });
          const createData = await createResp.json();
          if (createData.success) {
            r2Bucket = 'temp-email-attachments';
            console.log('[clean_toml] Successfully created R2 bucket:', r2Bucket);
          } else {
            console.log('[clean_toml] Failed to create R2 bucket:', JSON.stringify(createData));
          }
        }
      }

      const bucketToCors = r2Bucket || 'temp-email-attachments';
      try {
        await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketToCors}/cors`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            rules: [{
              allowed: {
                origins: ['*'],
                methods: ['GET', 'PUT', 'HEAD', 'POST', 'DELETE'],
                headers: ['*']
              },
              maxAgeSeconds: 3600
            }]
          })
        });
        console.log('[clean_toml] Configured CORS for R2 bucket:', bucketToCors);
      } catch (corsErr) {
        console.warn('[clean_toml] CORS configuration error:', corsErr);
      }
    } catch (err) {
      console.warn('[clean_toml] Could not query Cloudflare R2:', err);
    }
  }

  const s3Bucket = r2Bucket || 'temp-email-attachments';
  const s3Vars = `
S3_ENDPOINT = "https://13c501985b8bec46f384b0115e5f9ca4.r2.cloudflarestorage.com"
S3_ACCESS_KEY_ID = "a9804d952243736aa1601fc958f3f812"
S3_SECRET_ACCESS_KEY = "46ed19bb07a71ab17d3777f5bdcdf816b4e440e19c5629a316b2e9844e66afe2"
S3_BUCKET = "${s3Bucket}"
`;

  // If the secret was pasted as JSON:
  if (content.startsWith('{')) {
    console.log('[clean_toml] Detected JSON configuration in Secret! Converting to wrangler.toml...');
    let jsonConfig = {};
    try {
      jsonConfig = JSON.parse(content);
    } catch (e) {
      console.error('[clean_toml] Failed to parse JSON:', e);
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
${s3Vars}
`;
  } else {
    // Normal TOML cleaning: append S3 vars if not already present
    const lines = content.split(/\r?\n/).filter(line => !line.trim().startsWith('```'));
    content = lines.join('\n').trim() + '\n';
    if (!content.includes('S3_ENDPOINT')) {
      content += '\n' + s3Vars.trim() + '\n';
    }
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('[clean_toml] Final wrangler.toml written successfully. Sample:\n' + content.slice(0, 300));
  process.stderr.write('[clean_toml] Final wrangler.toml written successfully (' + content.length + ' bytes)\n');
}

run().catch(err => {
  console.error('[clean_toml] Unexpected error:', err);
});
