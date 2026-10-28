'use strict';
// Aggregate SELECTs only. No table creation, queue import or content approval.
const { createRequire } = require('node:module');
const requireServer = createRequire('/opt/openelf-api/package.json');
async function main() {
  const config = requireServer('./src/config');
  const connection = await requireServer('mysql2/promise').createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user,
    password: config.db.password, database: config.db.name,
  });
  try {
    const [rows] = await connection.execute(`SELECT environment, kind,
      CASE WHEN JSON_VALID(payload) THEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.moderationStatus')), 'unreviewed')
      ELSE 'invalid_json' END AS review_status, COUNT(*) AS count
      FROM payment_objects WHERE kind IN ('elf', 'post')
      GROUP BY environment, kind, review_status ORDER BY environment, kind, review_status`);
    const [visible] = await connection.execute(`SELECT p.environment, COUNT(*) AS approved_posts_with_approved_author
      FROM payment_objects p JOIN payment_objects e ON e.environment=p.environment AND e.kind='elf'
      AND e.object_id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(p.payload),p.payload,'{}'),'$.elfId'))
      WHERE p.kind='post' AND JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(p.payload),p.payload,'{}'),'$.moderationStatus'))='approved'
      AND JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(e.payload),e.payload,'{}'),'$.moderationStatus'))='approved'
      GROUP BY p.environment`);
    console.log(JSON.stringify({ counts: rows, approvedAuthorAndPost: visible,
      note: '公开流读取Production；配对计数尚未扣除制裁和个人屏蔽。缺少记录不补造示例内容。' }, null, 2));
    console.log('只读统计结束，未输出账号、正文、密钥；未修改数据库。');
  } finally { await connection.end(); }
}
main().catch(error => { console.error('统计失败：' + (error.code || 'CHECK_SERVER_DATABASE_CONFIG')); process.exitCode = 1; });
