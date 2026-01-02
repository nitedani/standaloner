import 'package2';
import lodash from 'lodash';
export default lodash;
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fs.stat(fileURLToPath(new URL('./file.txt', import.meta.url)), () => {});
console.log(file);
