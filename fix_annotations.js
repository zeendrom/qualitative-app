const fs = require('fs');
const filePath = 'd:/1/qualitative-app/app/page.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// Fix 1: background color fallback for highlight span
content = content.replace(
  'style={{backgroundColor: `${code?.color}40`, borderBottomColor: code?.color}}',
  'style={{backgroundColor: `${code?.color || \'#9ca3af\'}40`, borderBottomColor: code?.color || \'#9ca3af\'}}'
);

// Fix 2: sup backgroundColor fallback
content = content.replace(
  'style={{backgroundColor: code?.color, color:\'white\', padding:\'0.1rem 0.3rem\', borderRadius:\'4px\', cursor:\'pointer\', marginLeft:\'4px\', fontSize:\'0.65rem\'}} onClick={(e) => removeAnnotation(ann.id, e)} title="Hapus [{ann.createdBy}]">[{ann.createdBy[0]}] {code?.name}</sup>',
  'style={{backgroundColor: code?.color || \'#9ca3af\', color:\'white\', padding:\'0.1rem 0.3rem\', borderRadius:\'4px\', cursor:\'pointer\', marginLeft:\'4px\', fontSize:\'0.65rem\'}} onClick={(e) => removeAnnotation(ann.id, e)} title="Hapus [{ann.createdBy}]">[{ann.createdBy[0]}] {code?.name || \'Catatan\'}</sup>'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Done! Patched annotation highlight fallbacks.');
