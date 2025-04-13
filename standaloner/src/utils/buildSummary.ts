import path from 'path';
import { Colors } from './logging.js';

// Store build statistics
interface AssetStats {
  totalAssets: number;
  totalSize: number;
  assetsByType: Record<string, { count: number; size: number }>;
  largestAssets: Array<{ name: string; size: number; type: string }>;
}

interface ReferenceStats {
  totalReferences: number;
  referencesByType: Record<string, number>;
  processedFiles: Set<string>;
  // Track detailed reference information
  detailedReferences: Array<{ type: string; filePath: string; fileName: string }>;
}

interface DependencyStats {
  totalPackages: number;
  multiVersionPackages: number;
  totalFiles: number;
  packageNames: Set<string>;
}

class BuildSummary {
  private static instance: BuildSummary;

  // Asset statistics
  private assets: AssetStats = {
    totalAssets: 0,
    totalSize: 0,
    assetsByType: {},
    largestAssets: []
  };

  // Reference statistics
  private references: ReferenceStats = {
    totalReferences: 0,
    referencesByType: {},
    processedFiles: new Set(),
    detailedReferences: []
  };

  // Dependency statistics
  private dependencies: DependencyStats = {
    totalPackages: 0,
    multiVersionPackages: 0,
    totalFiles: 0,
    packageNames: new Set<string>()
  };

  // Build timing
  private startTime: number = Date.now();
  private endTime: number = 0;

  // Private constructor for singleton
  private constructor() {}

  // Get singleton instance
  public static getInstance(): BuildSummary {
    if (!BuildSummary.instance) {
      BuildSummary.instance = new BuildSummary();
    }
    return BuildSummary.instance;
  }

  // Reset all statistics
  public reset(): void {
    this.startTime = Date.now();
    this.endTime = 0;

    this.assets = {
      totalAssets: 0,
      totalSize: 0,
      assetsByType: {},
      largestAssets: []
    };

    this.references = {
      totalReferences: 0,
      referencesByType: {},
      processedFiles: new Set(),
      detailedReferences: []
    };

    this.dependencies = {
      totalPackages: 0,
      multiVersionPackages: 0,
      totalFiles: 0,
      packageNames: new Set<string>()
    };
  }

  // Record asset emission
  public recordAsset(filePath: string, size: number): void {
    const fileName = path.basename(filePath);
    const fileExt = path.extname(filePath).toLowerCase().substring(1) || 'unknown';

    // Update total stats
    this.assets.totalAssets++;
    this.assets.totalSize += size;

    // Update type stats
    if (!this.assets.assetsByType[fileExt]) {
      this.assets.assetsByType[fileExt] = { count: 0, size: 0 };
    }
    this.assets.assetsByType[fileExt].count++;
    this.assets.assetsByType[fileExt].size += size;

    // Track largest assets (keep top 5)
    this.assets.largestAssets.push({ name: fileName, size, type: fileExt });
    this.assets.largestAssets.sort((a, b) => b.size - a.size);
    if (this.assets.largestAssets.length > 5) {
      this.assets.largestAssets.pop();
    }
  }

  // Record reference processing
  public recordReference(filePath: string, referenceType: string): void {
    this.references.totalReferences++;

    // Count by type
    this.references.referencesByType[referenceType] =
      (this.references.referencesByType[referenceType] || 0) + 1;

    // Track unique processed files
    this.references.processedFiles.add(filePath);

    // Store detailed reference information
    const fileName = path.basename(filePath);
    this.references.detailedReferences.push({
      type: referenceType,
      filePath,
      fileName
    });
  }

  // Record dependency tracing
  public recordDependencies(
    totalPackages: number,
    multiVersionPackages: number,
    totalFiles: number,
    packageNames?: string[]
  ): void {
    this.dependencies.totalPackages = totalPackages;
    this.dependencies.multiVersionPackages = multiVersionPackages;
    this.dependencies.totalFiles = totalFiles;

    // Add package names if provided
    if (packageNames && packageNames.length > 0) {
      packageNames.forEach(name => this.dependencies.packageNames.add(name));
    }
  }

  // Add a single package name
  public addPackageName(packageName: string): void {
    this.dependencies.packageNames.add(packageName);
  }

  // Mark build as complete
  public markComplete(): void {
    this.endTime = Date.now();
  }

  // Format file size
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} kB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  // Print the summary
  public printSummary(): void {
    if (this.endTime === 0) {
      this.markComplete();
    }

    // const duration = ((this.endTime - this.startTime) / 1000).toFixed(2);

    // console.log('\n' + Colors.green + '✓' + Colors.reset + ` standaloner bundled in ${duration}s\n`);

    // Assets section
    if (this.assets.totalAssets > 0) {
      console.log(Colors.cyan + 'Assets:' + Colors.reset);

      // Print by type
      const typeEntries = Object.entries(this.assets.assetsByType)
        .sort((a, b) => b[1].size - a[1].size);

      for (const [type, { count, size }] of typeEntries) {
        console.log(`  ${type.padEnd(10)} ${count.toString().padStart(3)} files  ${this.formatSize(size).padStart(10)}`);
      }

      // Total
      console.log(`  ${'total'.padEnd(10)} ${this.assets.totalAssets.toString().padStart(3)} files  ${this.formatSize(this.assets.totalSize).padStart(10)}\n`);
    }

    // References section
    if (this.references.totalReferences > 0) {
      console.log(Colors.cyan + 'References:' + Colors.reset);

      // Print by type
      const refEntries = Object.entries(this.references.referencesByType)
        .sort((a, b) => b[1] - a[1]);

      for (const [type, count] of refEntries) {
        console.log(`  ${type.padEnd(10)} ${count.toString().padStart(3)} references`);
      }

      // Total
      console.log(`  ${'total'.padEnd(10)} ${this.references.totalReferences.toString().padStart(3)} references in ${this.references.processedFiles.size} files`);

      // Display detailed references
      if (this.references.detailedReferences.length > 0) {
        console.log('\n  Files:');

        // Group references by file
        const fileGroups = new Map<string, Array<{type: string}>>();

        for (const ref of this.references.detailedReferences) {
          if (!fileGroups.has(ref.fileName)) {
            fileGroups.set(ref.fileName, []);
          }
          fileGroups.get(ref.fileName)!.push({ type: ref.type });
        }

        // Display each file and its reference types
        for (const [fileName, refs] of Array.from(fileGroups.entries()).sort()) {
          const types = refs.map(r => r.type).join(', ');
          console.log(`  ${fileName} (${types})`);
        }
      }

      console.log();
    }

    // Dependencies section
    if (this.dependencies.totalPackages > 0) {
      console.log(Colors.cyan + 'Dependencies:' + Colors.reset);
      console.log(`  ${this.dependencies.totalPackages} packages (${this.dependencies.multiVersionPackages} with multiple versions)`);
      console.log(`  ${this.dependencies.totalFiles} files copied\n`);
    }
  }
}

export const buildSummary = BuildSummary.getInstance();
export default buildSummary;
