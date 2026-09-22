const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../src/controllers');
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.ts')) continue;
  const p = path.join(dir, f);
  let c = fs.readFileSync(p, 'utf8');
  if (!c.includes('req.params')) continue;
  if (!c.includes("from '../utils/params'")) {
    c = `import { paramId } from '../utils/params';\n` + c;
  }
  c = c.replace(/req\.params\.id/g, 'paramId(req.params.id)');
  c = c.replace(/req\.params\.hotelId/g, 'paramId(req.params.hotelId)');
  c = c.replace(/req\.params\.roomId/g, 'paramId(req.params.roomId)');
  c = c.replace(/req\.params\.providerId/g, 'paramId(req.params.providerId)');
  // avoid double wrapping
  c = c.replace(/paramId\(paramId\(([^)]+)\)\)/g, 'paramId($1)');
  fs.writeFileSync(p, c);
  console.log('fixed', f);
}
