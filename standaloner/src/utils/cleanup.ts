import type { RolldownOutput } from 'rolldown';
import type { RollupOutput } from 'rollup';
import path from 'path';
import fs from 'fs';

export function cleanup(out: RolldownOutput | RollupOutput, outputDir: string) {
  const outFilePaths = out.output.map(o => path.join(outputDir, o.fileName));
  const bundledModuleIds = out.output.flatMap(o => ('moduleIds' in o ? o.moduleIds : []));
  const filesToDelete = bundledModuleIds.filter(
    id => id.startsWith(outputDir) && !outFilePaths.includes(id)
  );

  // Delete files and collect directories
  const parentDirs = new Set<string>();
  for (const file of filesToDelete) {
    try {
      fs.unlinkSync(file);
      parentDirs.add(path.dirname(file));
    } catch (error) {
      // Ignore errors
    }
  }

  // Delete empty directories
  for (const dir of parentDirs) {
    try {
      if (fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    } catch (error) {
      // Ignore errors
    }
  }
}
