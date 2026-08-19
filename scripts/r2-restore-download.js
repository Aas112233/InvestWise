import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;
const backupFile = process.env.BACKUP_FILE || 'latest.dump';

if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
  console.error('Missing required environment variables for R2 download.');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

async function main() {
  const key = backupFile.startsWith('backups/') ? backupFile : `backups/${backupFile}`;
  console.log(`Downloading ${key} from Cloudflare R2 (${bucketName})...`);

  const response = await s3.send(new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  }));

  const writeStream = fs.createWriteStream('./restore.dump');
  await pipeline(response.Body, writeStream);
  console.log(`✓ Downloaded ./restore.dump (${fs.statSync('./restore.dump').size} bytes)`);
}

main().catch(err => {
  console.error('Download failed:', err);
  process.exit(1);
});
