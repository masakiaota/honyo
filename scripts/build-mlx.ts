#!/usr/bin/env node
// Run AFTER scripts/build.ts, which removes build/. No Python or model download.
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const packageDir = join(root, 'native', 'mlx');
const scratch = join(root, 'output', 'native-mlx');
const derivedData = join(scratch, 'DerivedData');
const sourcePackages = join(scratch, 'SourcePackages');
const destination = join(root, 'build', 'mlx');

function run(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: packageDir, stdio: 'inherit' });
}

function metallibs(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected resource symlink: ${path}`);
    if (entry.isDirectory()) return metallibs(path);
    return entry.name === 'default.metallib' ? [path] : [];
  });
}

function copySwiftBackDeploymentLibraries(executable: string, staging: string): string[] {
  // Recent Swift toolchains autolink compatibility dylibs that older macOS does
  // not provide. xcodebuild embeds these for app/test bundles, not CLI products.
  const swiftc = realpathSync(
    execFileSync('xcrun', ['--find', 'swiftc'], { encoding: 'utf8' }).trim(),
  );
  const libraryRoot = join(dirname(dirname(swiftc)), 'lib');
  const searchDirectories = readdirSync(libraryRoot)
    .filter(name => name === 'swift' || /^swift-\d/.test(name))
    .sort()
    .map(name => join(libraryRoot, name, 'macosx'));
  const copied = new Map<string, string>();
  const pending = [executable];
  while (pending.length > 0) {
    const dependencies = execFileSync('otool', ['-L', pending.pop()!], { encoding: 'utf8' });
    for (const match of dependencies.matchAll(/^\s+@rpath\/(libswift[\w]+\.dylib)\s/gm)) {
      const name = match[1]!;
      if (copied.has(name)) continue;
      const source = searchDirectories.map(directory => join(directory, name)).find(existsSync);
      if (!source) throw new Error(`Cannot locate required Swift back-deployment library: ${name}`);
      const target = join(staging, name);
      cpSync(source, target);
      copied.set(name, target);
      pending.push(target);
    }
    const unexpected = dependencies.match(/^\s+@rpath\/(?!libswift)[^\s]+/gm);
    if (unexpected?.length)
      throw new Error(`Unpackaged runtime dependencies: ${unexpected.join(', ')}`);
  }
  if (copied.size > 0) run('install_name_tool', ['-add_rpath', '@loader_path', executable]);
  return [...copied.values()];
}

function copyDependencyLicenses(pinned: Buffer, staging: string): void {
  type Pin = { identity: string; location: string; state: { revision: string; version?: string } };
  type Checkout = {
    packageRef: { identity: string };
    state: { checkoutState: { revision: string } };
    subpath: string;
  };
  const pins = (JSON.parse(pinned.toString('utf8')) as { pins: Pin[] }).pins;
  const checkouts = (
    JSON.parse(readFileSync(join(sourcePackages, 'workspace-state.json'), 'utf8')) as {
      object: { dependencies: Checkout[] };
    }
  ).object.dependencies;
  const checkoutRoot = realpathSync(join(sourcePackages, 'checkouts'));
  const licenses = join(staging, 'licenses');
  mkdirSync(licenses);
  const index = pins.map(pin => {
    if (!/^[a-z0-9-]+$/.test(pin.identity)) throw new Error('Unsafe dependency identity');
    const checkout = checkouts.find(item => item.packageRef.identity === pin.identity);
    if (!checkout || checkout.state.checkoutState.revision !== pin.state.revision)
      throw new Error(`License checkout does not match pinned revision: ${pin.identity}`);
    const source = realpathSync(join(checkoutRoot, checkout.subpath));
    const sourceRelative = relative(checkoutRoot, source);
    if (!sourceRelative || sourceRelative.startsWith('..') || isAbsolute(sourceRelative))
      throw new Error(`Unsafe dependency checkout: ${source}`);
    const notices: string[] = [];
    function visit(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === '.build') continue;
        const path = join(directory, entry.name);
        const isNotice = /^(LICENSE|NOTICE|COPYING)(?:[._-].*)?$/i.test(entry.name);
        if (entry.isSymbolicLink()) {
          if (isNotice) throw new Error(`Unexpected license symlink: ${path}`);
          continue;
        }
        if (entry.isDirectory()) visit(path);
        else if (entry.isFile() && isNotice) {
          if (statSync(path).size === 0) throw new Error(`Empty dependency license: ${path}`);
          const name = relative(source, path);
          const target = join(licenses, pin.identity, name);
          mkdirSync(dirname(target), { recursive: true });
          cpSync(path, target);
          notices.push(name);
        }
      }
    }
    // Includes nested vendored/submodule licenses, not just the Swift wrapper's
    // license (notably MLX C/C++, fmt, json, metal-cpp, and xgrammar).
    visit(source);
    if (!notices.some(name => !name.includes('/') && /^(LICENSE|COPYING)/i.test(name)))
      throw new Error(`Missing root dependency license: ${pin.identity}`);
    return { ...pin, notices: notices.sort() };
  });
  writeFileSync(join(licenses, 'dependencies.json'), JSON.stringify(index, null, 2) + '\n');
  writeFileSync(join(licenses, 'Package.resolved'), pinned);
}

function validateResources(directory: string): void {
  const libraries = metallibs(directory);
  if (libraries.length !== 1)
    throw new Error('Expected exactly one default.metallib in mlx-swift_Cmlx.bundle');
  const library = libraries[0]!;
  if (
    statSync(library).size === 0 ||
    readFileSync(library).subarray(0, 4).toString('ascii') !== 'MTLB'
  ) {
    throw new Error(`Missing or invalid compiled Metal resource: ${library}`);
  }
}

try {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(
      'build:mlx requires Apple Silicon macOS and full Xcode (MLX helper is arm64 only)',
    );
  }
  const lock = join(packageDir, 'Package.resolved');
  const pinned = readFileSync(lock);
  mkdirSync(scratch, { recursive: true });
  run('xcodebuild', [
    '-scheme',
    'HonyoMlx',
    '-configuration',
    'Release',
    '-destination',
    'platform=macOS,arch=arm64',
    '-derivedDataPath',
    derivedData,
    '-clonedSourcePackagesDirPath',
    sourcePackages,
    '-onlyUsePackageVersionsFromResolvedFile',
    '-disableAutomaticPackageResolution',
    // -enableCodeCoverage is test-action-only; build uses explicit settings.
    'ENABLE_CODE_COVERAGE=NO',
    'CLANG_ENABLE_CODE_COVERAGE=NO',
    'CLANG_COVERAGE_MAPPING=NO',
    'CLANG_COVERAGE_MAPPING_LINKER_ARGS=NO',
    'GCC_GENERATE_TEST_COVERAGE_FILES=NO',
    'GCC_INSTRUMENT_PROGRAM_FLOW_ARCS=NO',
    'ARCHS=arm64',
    'CODE_SIGNING_ALLOWED=NO',
    'MACOSX_DEPLOYMENT_TARGET=14.0',
    'build',
  ]);
  if (!readFileSync(lock).equals(pinned))
    throw new Error('Build changed Package.resolved; review dependency pins before packaging');
  const products = join(derivedData, 'Build', 'Products', 'Release');
  const executable = join(products, 'honyo-mlx');
  const bundle = join(products, 'mlx-swift_Cmlx.bundle');
  if (!existsSync(executable) || !existsSync(bundle))
    throw new Error('Xcode did not produce helper and sibling Metal bundle');
  validateResources(bundle);
  const loadCommands = execFileSync('otool', ['-l', executable], { encoding: 'utf8' });
  if (/__llvm_(?:prf|cov)/.test(loadCommands))
    throw new Error('Refusing coverage-instrumented production helper');
  const architectures = execFileSync('lipo', ['-archs', executable], { encoding: 'utf8' }).trim();
  if (architectures !== 'arm64')
    throw new Error(`Expected arm64 helper, received: ${architectures}`);

  // Stage complete validated artifacts before replacing a previous working output.
  mkdirSync(join(root, 'build'), { recursive: true });
  const staging = mkdtempSync(join(root, 'build', '.mlx-staging-'));
  cpSync(executable, join(staging, 'honyo-mlx'));
  cpSync(bundle, join(staging, 'mlx-swift_Cmlx.bundle'), { recursive: true });
  chmodSync(join(staging, 'honyo-mlx'), 0o755);
  validateResources(join(staging, 'mlx-swift_Cmlx.bundle'));
  copyDependencyLicenses(pinned, staging);
  // Local launches get an ad-hoc hardened signature; electron-builder re-signs
  // the resource executable with the distribution identity when one is provided.
  const stagedExecutable = join(staging, 'honyo-mlx');
  const runtimeLibraries = copySwiftBackDeploymentLibraries(stagedExecutable, staging);
  const swiftRuntimeNotices = join(staging, 'licenses', 'swift-runtime');
  cpSync(join(packageDir, 'Licenses', 'SwiftRuntime'), swiftRuntimeNotices, { recursive: true });
  const compilerVersion = execFileSync('xcrun', ['swiftc', '--version'], { encoding: 'utf8' });
  writeFileSync(
    join(swiftRuntimeNotices, 'toolchain.txt'),
    compilerVersion +
      '\nBundled compatibility libraries:\n' +
      runtimeLibraries.map(path => relative(staging, path)).join('\n') +
      '\n',
  );
  for (const binary of [...runtimeLibraries, stagedExecutable]) {
    run('codesign', ['--force', '--sign', '-', '--options', 'runtime', binary]);
    run('codesign', ['--verify', '--strict', binary]);
  }

  // Verify the exact absolute destination AND its real parent before any deletion.
  // Never follow a workspace symlink to delete outside the intended build output.
  const parent = realpathSync(dirname(destination));
  const child = relative(root, destination);
  if (parent !== join(root, 'build') || child !== join('build', 'mlx') || isAbsolute(child)) {
    throw new Error(`Unsafe build output path: ${destination}`);
  }
  if (existsSync(destination)) {
    if (lstatSync(destination).isSymbolicLink())
      throw new Error('Refusing symlink build/mlx output');
    rmSync(destination, { recursive: true });
  }
  renameSync(staging, destination);
  console.log(`MLX helper: ${join(destination, 'honyo-mlx')}`);
  console.log(`Metal resource: ${join(destination, 'mlx-swift_Cmlx.bundle')}`);
} catch (error) {
  console.error('Native MLX build failed:', error);
  process.exitCode = 1;
}
