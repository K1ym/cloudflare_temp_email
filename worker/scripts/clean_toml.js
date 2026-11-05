import fs from 'node:fs';

const filePath = 'wrangler.toml';
if (fs.existsSync(filePath)) {
  let content = fs.readFileSync(filePath, 'utf-8');
  // Strip UTF-8 BOM
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  // Strip markdown code fences (```toml, ```)
  const lines = content.split(/\r?\n/).filter(line => !line.trim().startsWith('```'));
  content = lines.join('\n').trim() + '\n';
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('[clean_toml] Successfully sanitized wrangler.toml before deployment (' + lines.length + ' lines)');
}
