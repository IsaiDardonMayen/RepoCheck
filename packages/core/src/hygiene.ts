import type { FileInfo } from './languages';
import type { Category, Finding, Severity } from './types';

export interface HygieneOptions {
  /** Desde este tamaño un archivo se considera grande (aviso bajo). Por defecto 5 MB. */
  largeFileBytes?: number;
  /** Desde este tamaño el aviso sube de nivel. Por defecto 25 MB. */
  hugeFileBytes?: number;
  /** Máximo de hallazgos por regla; el resto se resume en una nota. Por defecto 25. */
  maxFindingsPerRule?: number;
}

export interface HygieneResult {
  findings: Finding[];
  notes: string[];
}

const MB = 1024 * 1024;

interface JunkDir {
  names: readonly string[];
  severity: Severity;
  title: string;
  fix: string;
  /** Mínimo de archivos para avisar, y extensiones que confirman que es una compilación. */
  minFiles?: number;
  compiledExt?: readonly string[];
}

const COMPILED = ['.class', '.jar', '.war', '.dll', '.exe', '.pdb', '.o', '.obj', '.so', '.dylib', '.a', '.lib', '.rlib', '.rmeta'];

const JUNK_DIRS: readonly JunkDir[] = [
  { names: ['node_modules'], severity: 'medium', title: 'Dependencias de Node versionadas', fix: 'Quita la carpeta del repositorio y agrégala a .gitignore. Las dependencias se instalan con `npm install`.' },
  { names: ['venv', '.venv'], severity: 'medium', title: 'Entorno virtual de Python versionado', minFiles: 20, fix: 'Quita el entorno virtual y agrégalo a .gitignore. Declara las dependencias en requirements.txt.' },
  { names: ['__pycache__'], severity: 'low', title: 'Caché de Python versionada', fix: 'Quita los archivos .pyc y agrega `__pycache__/` a .gitignore.' },
  { names: ['dist', 'build', 'out'], severity: 'low', title: 'Carpeta de compilación versionada', minFiles: 3, fix: 'Si se genera al compilar, quítala del repo y agrégala a .gitignore. Si es intencional (por ejemplo, un sitio publicado), ignora este aviso.' },
  { names: ['target', 'bin', 'obj'], severity: 'low', title: 'Archivos compilados versionados', minFiles: 1, compiledExt: COMPILED, fix: 'Quita los binarios generados y agrega la carpeta a .gitignore.' },
  { names: ['.idea', '.vs', '.vscode-test'], severity: 'low', title: 'Archivos del editor versionados', fix: 'Quita la carpeta del editor y agrégala a .gitignore para no compartir configuración personal.' },
  { names: ['coverage', '.nyc_output', '.gradle', '.next', '.nuxt', '.angular', '.pytest_cache'], severity: 'low', title: 'Archivos generados versionados', fix: 'Quita la carpeta y agrégala a .gitignore: se regenera al compilar o probar.' },
];

const KEY_EXT = ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.ppk'];
const KEY_NAMES = ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'];
const DB_EXT = ['.sqlite', '.sqlite3', '.db', '.mdb', '.accdb'];
const BINARY_EXT = ['.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.war', '.o', '.obj', '.a', '.lib', '.pyc', '.pdb', '.msi', '.apk', '.ipa', '.iso', '.dmg'];
const ARCHIVE_EXT = ['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2', '.xz'];
const JUNK_FILES = ['.DS_Store', 'Thumbs.db', 'desktop.ini'];
const ENV_TEMPLATE = /\.(?:example|sample|template|dist|defaults|schema)$/i;

const ext = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
};
const baseOf = (path: string): string => path.split('/').pop() ?? path;

function isEnvFile(name: string): boolean {
  return (name === '.env' || name.startsWith('.env.')) && !ENV_TEMPLATE.test(name);
}

/**
 * Revisa la higiene del repo a partir de la lista de archivos (rutas y tamaños):
 * credenciales y datos versionados, carpetas generadas, binarios, archivos enormes
 * y la falta de .gitignore, README o licencia. No lee el contenido de los archivos.
 */
export function checkHygiene(files: readonly FileInfo[], options: HygieneOptions = {}): HygieneResult {
  const large = options.largeFileBytes ?? 5 * MB;
  const huge = options.hugeFileBytes ?? 25 * MB;
  const maxPerRule = options.maxFindingsPerRule ?? 25;
  const findings: Finding[] = [];
  const counts = new Map<string, number>();
  const notes: string[] = [];

  const add = (ruleId: string, category: Category, severity: Severity, file: string, title: string, fix: string): void => {
    const n = (counts.get(ruleId) ?? 0) + 1;
    counts.set(ruleId, n);
    if (n <= maxPerRule) findings.push({ ruleId, category, severity, file, title, fix });
  };

  // 1. Carpetas generadas: un hallazgo por carpeta (la más externa), no uno por archivo.
  const covered: string[] = [];
  const dirFiles = new Map<string, { rule: JunkDir; count: number; compiled: boolean }>();
  for (const f of files) {
    const parts = f.path.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const rule = JUNK_DIRS.find((j) => j.names.includes(parts[i] as string));
      if (!rule) continue;
      const dir = parts.slice(0, i + 1).join('/') + '/';
      const entry = dirFiles.get(dir) ?? { rule, count: 0, compiled: false };
      entry.count++;
      if (rule.compiledExt?.includes(ext(baseOf(f.path)))) entry.compiled = true;
      dirFiles.set(dir, entry);
      break; // solo la carpeta más externa de esta ruta
    }
  }
  for (const [dir, { rule, count, compiled }] of [...dirFiles].sort(([a], [b]) => a.localeCompare(b))) {
    if (count < (rule.minFiles ?? 1)) continue;
    if (rule.compiledExt && !compiled) continue;
    covered.push(dir);
    add('HYG-GENERATED-DIR', 'hygiene', rule.severity, dir, `${rule.title} (${count} archivos)`, rule.fix);
  }
  const insideCovered = (path: string): boolean => covered.some((d) => path.startsWith(d));

  // 2. Carpeta .git dentro del repo o del zip.
  if (files.some((f) => f.path.startsWith('.git/'))) {
    add('HYG-GIT-DIR', 'hygiene', 'medium', '.git/', 'Carpeta .git incluida', 'Quita la carpeta .git antes de compartir: contiene todo el historial, incluidos secretos que ya se hayan borrado.');
  }

  // 3. Archivo por archivo.
  for (const f of files) {
    if (f.path.startsWith('.git/') || insideCovered(f.path)) continue;
    const name = baseOf(f.path);
    const e = ext(name);

    if (isEnvFile(name)) {
      add('HYG-ENV-FILE', 'hygiene', 'high', f.path, 'Archivo de entorno versionado', 'Quita el archivo del repo, agrégalo a .gitignore y publica un `.env.example` con valores falsos. Cambia las credenciales que contenía.');
    } else if (KEY_EXT.includes(e) || KEY_NAMES.includes(name)) {
      add('HYG-KEY-FILE', 'hygiene', 'high', f.path, 'Archivo de llave o certificado versionado', 'Quita el archivo del repo y trátalo como comprometido: genera una llave nueva. Guarda las llaves fuera del repositorio.');
    } else if (DB_EXT.includes(e)) {
      add('HYG-DATABASE-FILE', 'hygiene', 'medium', f.path, 'Base de datos versionada', 'Quita el archivo y agrégalo a .gitignore: puede contener datos personales o credenciales. Si necesitas datos de ejemplo, publica una versión sintética.');
    } else if (e === '.sql' && f.size >= MB) {
      add('HYG-DATABASE-FILE', 'hygiene', 'medium', f.path, 'Volcado de base de datos grande versionado', 'Revisa que no contenga datos reales y considera quitarlo del repositorio.');
    } else if (e === '.log') {
      add('HYG-LOG-FILE', 'hygiene', 'low', f.path, 'Archivo de registro versionado', 'Quita el registro y agrega `*.log` a .gitignore: puede revelar rutas, usuarios o credenciales.');
    } else if (BINARY_EXT.includes(e)) {
      add('HYG-BINARY-FILE', 'hygiene', 'low', f.path, 'Archivo binario o compilado versionado', 'Evita versionar binarios: publícalos como releases o genéralos al compilar.');
    } else if (ARCHIVE_EXT.includes(e)) {
      add('HYG-ARCHIVE-FILE', 'hygiene', 'low', f.path, 'Archivo comprimido versionado', 'Revisa qué contiene y evita versionar archivos comprimidos: ocultan contenido a las revisiones.');
    } else if (JUNK_FILES.includes(name)) {
      add('HYG-OS-FILE', 'hygiene', 'low', f.path, 'Archivo del sistema operativo versionado', 'Quítalo y agrega su nombre a .gitignore.');
    }

    if (f.size >= huge) {
      add('HYG-LARGE-FILE', 'hygiene', 'medium', f.path, `Archivo muy grande (${Math.round(f.size / MB)} MB)`, 'GitHub avisa desde 50 MB y rechaza desde 100 MB. Usa Git LFS o publícalo como release.');
    } else if (f.size >= large) {
      add('HYG-LARGE-FILE', 'hygiene', 'low', f.path, `Archivo grande (${Math.round(f.size / MB)} MB)`, 'Considera Git LFS o un release: los archivos grandes hacen lento el clonado.');
    }
  }

  // 4. Archivos que deberían existir en la raíz.
  const root = files.filter((f) => !f.path.includes('/')).map((f) => f.path);
  if (files.length > 0) {
    if (!root.includes('.gitignore')) {
      add('HYG-NO-GITIGNORE', 'hygiene', 'low', '.gitignore', 'Falta el archivo .gitignore', 'Crea un .gitignore para tu lenguaje (por ejemplo, desde github.com/github/gitignore) para no versionar compilaciones ni secretos.');
    }
    if (!root.some((n) => /^readme(\.[a-z]+)?$/i.test(n))) {
      add('HYG-NO-README', 'hygiene', 'medium', 'README.md', 'Falta el README', 'Agrega un README que explique qué hace el proyecto, cómo instalarlo y cómo usarlo.');
    }
    if (!root.some((n) => /^(?:license|licence|copying|unlicense)(?:[.-][a-z0-9]+)?$/i.test(n))) {
      add('HYG-NO-LICENSE', 'licenses', 'low', 'LICENSE', 'Falta la licencia', 'Sin licencia, nadie puede legalmente usar ni modificar tu código. Elige una en choosealicense.com.');
    }
  }

  for (const [ruleId, n] of counts) {
    if (n > maxPerRule) notes.push(`${ruleId}: ${n} coincidencias; se muestran las primeras ${maxPerRule}.`);
  }
  return { findings, notes };
}
