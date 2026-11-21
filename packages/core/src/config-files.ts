import { checkCompose, checkDockerfile } from './dockerfile';
import { redactSecrets, type SecretRule } from './secrets';
import type { Finding } from './types';
import { checkWorkflow } from './workflows';

export interface ConfigScan {
  findings: Finding[];
  /** Cuántos archivos de cada tipo se revisaron. */
  checked: { dockerfiles: number; composeFiles: number; workflows: number };
}

const isDockerfile = (name: string): boolean => /^Dockerfile(?:\..+)?$/.test(name) || /\.dockerfile$/i.test(name);
const isCompose = (name: string): boolean => /^(?:docker-)?compose(?:\..+)?\.ya?ml$/i.test(name);
const isWorkflow = (path: string): boolean => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path);

/** Indica si un archivo es de infraestructura (Docker o workflow), para elegir qué descargar. */
export function isConfigFile(path: string): boolean {
  const name = path.split('/').pop() ?? path;
  return isDockerfile(name) || isCompose(name) || isWorkflow(path);
}

/**
 * Aplica la revisión que corresponde a cada archivo (ruta → texto). Con `secretRules`, cualquier
 * secreto que quede en un fragmento se enmascara antes de devolverlo.
 */
export function checkConfigFiles(files: ReadonlyMap<string, string>, options: { secretRules?: readonly SecretRule[] } = {}): ConfigScan {
  const findings: Finding[] = [];
  const checked = { dockerfiles: 0, composeFiles: 0, workflows: 0 };
  for (const [path, text] of files) {
    const name = path.split('/').pop() ?? path;
    if (isWorkflow(path)) {
      checked.workflows++;
      findings.push(...checkWorkflow(text, path));
    } else if (isDockerfile(name)) {
      checked.dockerfiles++;
      findings.push(...checkDockerfile(text, path));
    } else if (isCompose(name)) {
      checked.composeFiles++;
      findings.push(...checkCompose(text, path));
    }
  }
  const rules = options.secretRules;
  if (rules) {
    for (const f of findings) if (f.snippet !== undefined) f.snippet = redactSecrets(f.snippet, rules);
  }
  return { findings, checked };
}
