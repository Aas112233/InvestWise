import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs';

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;
const filename = process.env.FILENAME;
const retentionDays = parseInt(process.env.RETENTION_DAYS || '30', 10);

if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !filename) {
  console.error('Missing required environment variables for R2 upload.');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

async function main() {
  console.log(`Uploading ${filename} to Cloudflare R2 (${bucketName})...`);
  const fileStream = fs.createReadStream(filename);
  const fileStat = fs.statSync(filename);

  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: `backups/${filename}`,
    Body: fileStream,
    ContentLength: fileStat.size,
  }));
  console.log(`✓ Uploaded backups/${filename}`);

  console.log(`Updating latest pointer...`);
  const latestStream = fs.createReadStream(filename);
  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: `backups/latest.dump`,
    Body: latestStream,
    ContentLength: fileStat.size,
  }));
  console.log(`✓ Updated backups/latest.dump`);

  // Pruning
  console.log(`Checking for backups older than ${retentionDays} days...`);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const list = await s3.send(new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: 'backups/investwise-backup-',
  }));

  if (list.Contents) {
    for (const obj of list.Contents) {
      if (obj.LastModified && obj.LastModified < cutoff && obj.Key) {
        console.log(`Pruning expired backup: ${obj.Key}`);
        await s3.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: obj.Key,
        }));
      }
    }
  }
  console.log(`Backup completed successfully!`);
}

main().catch(err => {
  console.error('Upload failed:', err);
  process.exit(1);
});
