const fs = require('fs');
const filePath = 'app/page.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// Ganti regex dengan flag /s (dotAll ES2018) ke [\s\S]* yang kompatibel
const before = 'raw.match(/(open_codes|narrative_codes)"\\s*:\\s*(\\[.*)/s)';
const after   = 'raw.match(/(open_codes|narrative_codes)"\\s*:\\s*([\\s\\S]*)/)'  ;

if (content.includes(before)) {
  content = content.replace(before, after);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✅ Regex berhasil diperbaiki.');
} else {
  console.log('⚠️  Pola tidak ditemukan — mungkin sudah diperbaiki.');
}
