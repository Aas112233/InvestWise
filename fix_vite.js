const fs = require('fs');
const path = 'client/vite.config.ts';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('/// <reference types="vitest" />')) {
  content = '/// <reference types="vitest" />\n' + content;
}

const testConfig = `
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./setupTests.ts'],
  },
  build: {`;

content = content.replace('  build: {', testConfig);
fs.writeFileSync(path, content);
console.log('Updated vite.config.ts');
