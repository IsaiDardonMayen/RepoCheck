export type Ecosystem = 'npm' | 'PyPI' | 'Go' | 'Maven' | 'crates.io' | 'NuGet' | 'Packagist' | 'RubyGems';

export interface Dependency {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  /** Archivo del que salió (ruta dentro del repo). */
  file: string;
  /** `true` si la versión se dedujo de un rango (por ejemplo `^1.2.3`) y puede no ser la instalada. */
  approximate?: boolean;
}

export interface DependencyScan {
  dependencies: Dependency[];
  /** Avisos sobre lo que no se pudo leer o resolver; se muestran en la sección de cobertura. */
  notes: string[];
}

const SEMVER_START = /^\d+\.\d+\.\d+/;

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function baseOf(path: string): string {
  return path.split('/').pop() ?? path;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** package-lock.json: versiones exactas instaladas (formatos v1, v2 y v3). */
export function parsePackageLock(text: string, file: string): Dependency[] | undefined {
  const data = parseJson(text);
  if (!isRecord(data)) return undefined;
  const out: Dependency[] = [];

  const packages = data['packages'];
  if (isRecord(packages)) {
    for (const [key, value] of Object.entries(packages)) {
      if (key === '' || !isRecord(value) || value['link'] === true) continue;
      const marker = 'node_modules/';
      const at = key.lastIndexOf(marker);
      if (at === -1) continue; // paquetes del propio workspace
      const name = key.slice(at + marker.length);
      const version = value['version'];
      if (typeof version === 'string' && SEMVER_START.test(version)) {
        out.push({ ecosystem: 'npm', name, version, file });
      }
    }
    return out;
  }

  const walk = (deps: unknown): void => {
    if (!isRecord(deps)) return;
    for (const [name, value] of Object.entries(deps)) {
      if (!isRecord(value)) continue;
      const version = value['version'];
      if (typeof version === 'string' && SEMVER_START.test(version)) {
        out.push({ ecosystem: 'npm', name, version, file });
      }
      walk(value['dependencies']);
    }
  };
  walk(data['dependencies']);
  return out;
}

/** package.json sin lockfile: solo se aceptan versiones simples (`1.2.3`, `^1.2.3`, `~1.2.3`). */
export function parsePackageJson(text: string, file: string): { dependencies: Dependency[]; unresolved: number } | undefined {
  const data = parseJson(text);
  if (!isRecord(data)) return undefined;
  const dependencies: Dependency[] = [];
  let unresolved = 0;
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const block = data[section];
    if (!isRecord(block)) continue;
    for (const [name, range] of Object.entries(block)) {
      const m = typeof range === 'string' ? /^([\^~=v]*)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(range.trim()) : null;
      if (!m || m[2] === undefined) {
        unresolved++;
        continue;
      }
      const dep: Dependency = { ecosystem: 'npm', name, version: m[2], file };
      if (m[1]) dep.approximate = true;
      dependencies.push(dep);
    }
  }
  return { dependencies, unresolved };
}

/** requirements.txt: solo las líneas con versión fija (`==`). */
export function parseRequirements(text: string, file: string): { dependencies: Dependency[]; unresolved: number } {
  const dependencies: Dependency[] = [];
  let unresolved = 0;
  const pinned = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*===?\s*([A-Za-z0-9.!+_-]+)/;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (line === '' || line.startsWith('#') || line.startsWith('-') || /^(git\+|https?:|\.|\/)/.test(line)) continue;
    const m = pinned.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) {
      dependencies.push({ ecosystem: 'PyPI', name: m[1].toLowerCase().replace(/_/g, '-'), version: m[2], file });
    } else {
      unresolved++;
    }
  }
  return { dependencies, unresolved };
}

/** go.mod: bloques `require (...)` y líneas `require módulo versión`. */
export function parseGoMod(text: string, file: string): Dependency[] {
  const out: Dependency[] = [];
  let inRequire = false;
  const add = (spec: string): void => {
    const m = /^(\S+)\s+(v\d\S*)/.exec(spec.replace(/\/\/.*$/, '').trim());
    if (m?.[1] !== undefined && m[2] !== undefined) out.push({ ecosystem: 'Go', name: m[1], version: m[2], file });
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (inRequire) {
      if (line.startsWith(')')) inRequire = false;
      else add(line);
    } else if (/^require\s*\(/.test(line)) {
      inRequire = true;
    } else if (line.startsWith('require ')) {
      add(line.slice('require '.length));
    }
  }
  return out;
}

/** Quita comentarios XML para no leer dependencias comentadas. */
const stripXmlComments = (xml: string): string => xml.replace(/<!--[\s\S]*?-->/g, '');

function xmlTag(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(block);
  return m?.[1];
}

/** pom.xml (Maven): versiones literales o `${propiedad}` definidas en el mismo archivo. */
export function parsePom(text: string, file: string): { dependencies: Dependency[]; unresolved: number } {
  const xml = stripXmlComments(text);
  const props = new Map<string, string>();
  const propsBlock = /<properties>([\s\S]*?)<\/properties>/.exec(xml)?.[1] ?? '';
  for (const m of propsBlock.matchAll(/<([A-Za-z0-9._-]+)>\s*([^<]*?)\s*<\/\1>/g)) {
    if (m[1] !== undefined && m[2] !== undefined) props.set(m[1], m[2]);
  }
  // La versión del proyecto es la de la cabecera (antes de dependencias y build), sin contar el padre.
  const head = (xml.split(/<dependencyManagement>|<dependencies>|<build>|<profiles>/)[0] ?? '').replace(/<parent>[\s\S]*?<\/parent>/, '');
  const projectVersion = /<version>\s*([^<]*?)\s*<\/version>/.exec(head)?.[1];
  if (projectVersion) props.set('project.version', projectVersion);

  const dependencies: Dependency[] = [];
  let unresolved = 0;
  for (const m of xml.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const block = m[1] ?? '';
    const group = xmlTag(block, 'groupId');
    const artifact = xmlTag(block, 'artifactId');
    let version = xmlTag(block, 'version');
    if (!group || !artifact) continue;
    const prop = version === undefined ? undefined : /^\$\{([^}]+)\}$/.exec(version)?.[1];
    if (prop !== undefined) version = props.get(prop);
    if (version === undefined || !/^\d[\w.-]*$/.test(version)) {
      unresolved++;
      continue;
    }
    dependencies.push({ ecosystem: 'Maven', name: `${group}:${artifact}`, version, file });
  }
  return { dependencies, unresolved };
}

/** Cargo.lock (Rust): solo los paquetes que vienen de un registro (no los del propio proyecto). */
export function parseCargoLock(text: string, file: string): Dependency[] {
  const out: Dependency[] = [];
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const source = /^source\s*=\s*"registry\+/m.test(block);
    if (name && version && source) out.push({ ecosystem: 'crates.io', name, version, file });
  }
  return out;
}

/** Proyectos .NET: `packages.lock.json`, `*.csproj` (PackageReference) y `packages.config`. */
export function parseNuGet(text: string, file: string): { dependencies: Dependency[]; unresolved: number } | undefined {
  const dependencies: Dependency[] = [];
  let unresolved = 0;
  const add = (name: string | undefined, version: string | undefined): void => {
    if (name && version && /^\d+(\.\d+)*(-[0-9A-Za-z.-]+)?$/.test(version)) dependencies.push({ ecosystem: 'NuGet', name, version, file });
    else unresolved++;
  };
  if (baseOf(file) === 'packages.lock.json') {
    const data = parseJson(text);
    if (!isRecord(data) || !isRecord(data['dependencies'])) return undefined;
    for (const framework of Object.values(data['dependencies'])) {
      if (!isRecord(framework)) continue;
      for (const [name, v] of Object.entries(framework)) {
        if (isRecord(v) && typeof v['resolved'] === 'string' && v['type'] !== 'Project') add(name, v['resolved']);
      }
    }
    return { dependencies, unresolved };
  }
  const xml = stripXmlComments(text);
  for (const m of xml.matchAll(/<PackageReference\b([^>]*)>/g)) {
    const attrs = m[1] ?? '';
    add(/Include="([^"]+)"/.exec(attrs)?.[1], /Version="([^"]+)"/.exec(attrs)?.[1]);
  }
  for (const m of xml.matchAll(/<package\b([^>]*)\/?>/g)) {
    const attrs = m[1] ?? '';
    add(/\bid="([^"]+)"/.exec(attrs)?.[1], /\bversion="([^"]+)"/.exec(attrs)?.[1]);
  }
  return { dependencies, unresolved };
}

/** composer.lock (PHP). */
export function parseComposerLock(text: string, file: string): Dependency[] | undefined {
  const data = parseJson(text);
  if (!isRecord(data)) return undefined;
  const out: Dependency[] = [];
  for (const section of ['packages', 'packages-dev']) {
    const list = data[section];
    if (!Array.isArray(list)) continue;
    for (const p of list as unknown[]) {
      if (!isRecord(p) || typeof p['name'] !== 'string' || typeof p['version'] !== 'string') continue;
      const version = p['version'].replace(/^v/, '');
      if (/^\d/.test(version)) out.push({ ecosystem: 'Packagist', name: p['name'].toLowerCase(), version, file });
    }
  }
  return out;
}

/** Gemfile.lock (Ruby): las gemas instaladas en la sección `specs:`. */
export function parseGemfileLock(text: string, file: string): Dependency[] {
  const out: Dependency[] = [];
  let inSpecs = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s+specs:\s*$/.test(line)) {
      inSpecs = true;
    } else if (inSpecs && !/^ {4}\S/.test(line) && !/^ {6}\S/.test(line)) {
      inSpecs = false;
    } else if (inSpecs) {
      const m = /^ {4}([A-Za-z0-9_.-]+) \((\d[^)]*)\)\s*$/.exec(line);
      if (m?.[1] !== undefined && m[2] !== undefined) {
        out.push({ ecosystem: 'RubyGems', name: m[1], version: m[2].replace(/-(?!\d)[A-Za-z].*$/, ''), file });
      }
    }
  }
  return out;
}

/**
 * Extrae las dependencias de los archivos clave (ruta → texto).
 * Con `package-lock.json` en la misma carpeta se usan las versiones exactas;
 * si no, se intenta con `package.json`.
 */
export function extractDependencies(files: ReadonlyMap<string, string>): DependencyScan {
  const dependencies: Dependency[] = [];
  const notes: string[] = [];
  const lockDirs = new Set<string>();
  const cargoLockDirs = new Set<string>();
  const cargoTomls: string[] = [];

  for (const [path, text] of files) {
    if (baseOf(path) !== 'package-lock.json') continue;
    const deps = parsePackageLock(text, path);
    if (deps === undefined) {
      notes.push(`No se pudo leer ${path}: no es un JSON válido.`);
      continue;
    }
    lockDirs.add(dirOf(path));
    dependencies.push(...deps);
  }

  for (const [path, text] of files) {
    const name = baseOf(path);
    if (name === 'package.json' && !lockDirs.has(dirOf(path))) {
      const r = parsePackageJson(text, path);
      if (r === undefined) {
        notes.push(`No se pudo leer ${path}: no es un JSON válido.`);
        continue;
      }
      dependencies.push(...r.dependencies);
      if (r.dependencies.length > 0 || r.unresolved > 0) {
        notes.push(`${path}: sin package-lock.json, las versiones salen de los rangos y pueden no coincidir con las instaladas.`);
      }
      if (r.unresolved > 0) notes.push(`${path}: ${r.unresolved} dependencias con rangos complejos no se pudieron revisar.`);
    } else if (/^requirements.*\.txt$/.test(name)) {
      const r = parseRequirements(text, path);
      dependencies.push(...r.dependencies);
      if (r.unresolved > 0) notes.push(`${path}: ${r.unresolved} dependencias sin versión fija (==) no se pudieron revisar.`);
    } else if (name === 'go.mod') {
      dependencies.push(...parseGoMod(text, path));
    } else if (name === 'pom.xml') {
      const r = parsePom(text, path);
      dependencies.push(...r.dependencies);
      if (r.unresolved > 0) notes.push(`${path}: ${r.unresolved} dependencias sin versión literal (rangos o herencia del padre) no se pudieron revisar.`);
    } else if (name === 'Cargo.lock') {
      cargoLockDirs.add(dirOf(path));
      dependencies.push(...parseCargoLock(text, path));
    } else if (name === 'Cargo.toml') {
      cargoTomls.push(path);
    } else if (name === 'packages.lock.json' || name === 'packages.config' || name.endsWith('.csproj')) {
      const r = parseNuGet(text, path);
      if (r === undefined) {
        notes.push(`No se pudo leer ${path}: formato inesperado.`);
        continue;
      }
      dependencies.push(...r.dependencies);
      if (r.unresolved > 0) notes.push(`${path}: ${r.unresolved} paquetes con versión flotante o en rango no se pudieron revisar.`);
    } else if (name === 'composer.lock') {
      const r = parseComposerLock(text, path);
      if (r === undefined) notes.push(`No se pudo leer ${path}: no es un JSON válido.`);
      else dependencies.push(...r);
    } else if (name === 'Gemfile.lock') {
      dependencies.push(...parseGemfileLock(text, path));
    } else if (name === 'build.gradle' || name === 'build.gradle.kts') {
      notes.push(`${path}: Gradle todavía no se lee (solo Maven).`);
    } else if (name === 'yarn.lock' || name === 'pnpm-lock.yaml' || name === 'poetry.lock' || name === 'Pipfile.lock') {
      notes.push(`${path}: este tipo de archivo de bloqueo todavía no se lee.`);
    }
  }

  for (const toml of cargoTomls) {
    if (!cargoLockDirs.has(dirOf(toml))) notes.push(`${toml}: sin Cargo.lock no se pueden conocer las versiones instaladas.`);
  }

  const seen = new Set<string>();
  const unique = dependencies.filter((d) => {
    const key = `${d.ecosystem}|${d.name}|${d.version}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { dependencies: unique, notes };
}
